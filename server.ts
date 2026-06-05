import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

function prepareGeminiContents(history: any[], additionalPrompt: string) {
  const merged: { role: 'user' | 'model'; text: string }[] = [];

  for (const item of history) {
    if (!item.text) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].text += "\n" + item.text;
    } else {
      merged.push({ role, text: item.text });
    }
  }

  if (additionalPrompt) {
    if (merged.length > 0 && merged[merged.length - 1].role === 'user') {
      merged[merged.length - 1].text += "\n" + additionalPrompt;
    } else {
      merged.push({ role: 'user', text: additionalPrompt });
    }
  }

  const sliced = merged.slice(-20);

  while (sliced.length > 0 && sliced[0].role !== 'user') {
    sliced.shift();
  }

  if (sliced.length === 0) {
    sliced.push({ role: 'user', text: additionalPrompt || "你好" });
  }

  return sliced.map(s => ({
    role: s.role,
    parts: [{ text: s.text }]
  }));
}

function prepareOpenAIMessages(history: any[], additionalPrompt: string, systemInstruction: string) {
  const merged: { role: 'user' | 'assistant'; text: string }[] = [];

  for (const item of history) {
    if (!item.text) continue;
    const role = item.role === 'model' ? 'assistant' : 'user';
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].text += "\n" + item.text;
    } else {
      merged.push({ role, text: item.text });
    }
  }

  if (additionalPrompt) {
    if (merged.length > 0 && merged[merged.length - 1].role === 'user') {
      merged[merged.length - 1].text += "\n" + additionalPrompt;
    } else {
      merged.push({ role: 'user', text: additionalPrompt });
    }
  }

  const sliced = merged.slice(-20);

  while (sliced.length > 0 && sliced[0].role !== 'user') {
    sliced.shift();
  }

  if (sliced.length === 0) {
    sliced.push({ role: 'user', text: additionalPrompt || "你好" });
  }

  return [
    { role: "system", content: systemInstruction },
    ...sliced.map(s => ({
      role: s.role,
      content: s.text
    }))
  ];
}

function parseLLMResponse(text: string): any {
  if (!text || !text.trim()) {
    return {
      reply: "（收到空回复，可能已被大模型安全策略拦截，或网络暂时波动。请重试）",
      animation: ""
    };
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (initialError) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch (e) {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
          } catch (innerErr) {
            // ignore, throw fallback
          }
        }
      }
    } else {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
        } catch (e) {
          // ignore
        }
      }
    }
    // Final robust fallback: treat the entire body as the reply text
    return {
      reply: trimmed,
      animation: ""
    };
  }
}

async function fetchOpenAICompatibleChat(
  targetUrl: string, 
  apiKey: string, 
  payload: { model: string; messages: any[]; response_format?: any }
) {
  let response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok && payload.response_format) {
    const errTextCopy = await response.clone().text();
    const isFormatError = errTextCopy.toLowerCase().includes("format") || 
                          errTextCopy.toLowerCase().includes("json") || 
                          errTextCopy.toLowerCase().includes("response_format") ||
                          response.status === 400 ||
                          response.status === 422;
    if (isFormatError) {
      console.warn("API 拒绝了 response_format (JSON 模式)，正在尝试无 JSON 模式重新请求...");
      const { response_format, ...fallbackPayload } = payload;
      response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(fallbackPayload)
      });
    }
  }
  return response;
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // API Route FIRST for the custom models proxy
  app.post("/api/llm/chat", async (req, res) => {
    try {
      const {
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        systemInstruction = '你是一个友好的3D虚拟人伴侣。可以使用动作来辅助你的表达。',
        prompt = '',
        animations = [],
        history = []
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
      }

      const formattedSystemInstruction = `${systemInstruction}

可用骨骼动画：${JSON.stringify(animations)}

只输出 JSON：{"reply":"回复文本","animation":"动画名或空字符串"}`;

      // Provider 1: Gemini (default)
      if (provider === 'gemini') {
        const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
        if (!finalKey) {
          return res.status(400).json({ error: "未设置 Gemini API Key。请在侧边栏「大模型设置」中输入，或在 Settings > Secrets 传入。" });
        }

        const finalModelName = model || "gemini-3.5-flash";

        const ai = new GoogleGenAI({
          apiKey: finalKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const contents = prepareGeminiContents(history, prompt);

        console.log(`[Gemini Request] Model: ${finalModelName}, History Length: ${history.length}, Prompt: "${prompt}"`);
        
        const response = await ai.models.generateContent({
          model: finalModelName,
          contents: contents,
          config: {
            systemInstruction: formattedSystemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: {
                  type: Type.STRING,
                  description: "陪伴助理对用户的语音或文字回复内容。语言要亲切、口语化，长度在1-4句话之间。",
                },
                animation: {
                  type: Type.STRING,
                  description: "当前表达最适合配上的骨骼动画名称。必须从可用骨骼动画列表中挑选，无合适动作的话返回空字符串。",
                },
              },
              required: ["reply", "animation"],
            },
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          },
        });

        // Robust check for finishes reason, blocked content & candidate counts
        const candidate = response.candidates?.[0];
        if (candidate?.finishReason === "SAFETY") {
          console.warn("[Gemini API] WARNING: Output was blocked by safety filters.");
          return res.json({
            reply: "（被安全过滤器拦截。AI认为这段对话探讨了过于沉重或敏感的心情话题。请换个更轻松的情感话题吧。）",
            animation: ""
          });
        }

        const text = response.text;
        if (!text) {
          console.warn("[Gemini API] WARNING: response.text is empty or undefined. Finished reason:", candidate?.finishReason);
          return res.json({
            reply: "（收到空回复，可能已被大模型安全策略拦截，或网络暂时波动。请重试）",
            animation: ""
          });
        }

        const parsed = parseLLMResponse(text);
        return res.json(parsed);
      } else {
        // Provider 2, 3 & 4: DeepSeek, Qwen & Custom OpenAI Compatible
        let finalKey = apiKey;
        let finalBaseUrl = baseUrl;
        let finalModelName = model;

        if (provider === 'deepseek') {
          finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
          finalBaseUrl = baseUrl || "https://api.deepseek.com";
          finalModelName = model || "deepseek-chat";
        } else if (provider === 'qwen') {
          finalKey = apiKey || process.env.DASHSCOPE_API_KEY || "sk-a16630bdca2841cbb25a974a934e35e6";
          finalBaseUrl = baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
          finalModelName = model || "qwen-max";
        } else {
          finalKey = apiKey;
          finalBaseUrl = baseUrl || "https://api.openai.com/v1";
          finalModelName = model || "gpt-4o-mini";
        }

        if (!finalKey) {
          return res.status(400).json({ error: `未设置 ${provider === 'deepseek' ? 'DeepSeek' : provider === 'qwen' ? 'Qwen' : '自定义'} API Key。请在大模型设置中填入。` });
        }

        const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
        const targetUrl = `${cleanBaseUrl}/chat/completions`;

        const messages = prepareOpenAIMessages(history, prompt, formattedSystemInstruction);

        const chatPayload = {
          model: finalModelName,
          messages: messages,
          response_format: { type: "json_object" }
        };

        const response = await fetchOpenAICompatibleChat(targetUrl, finalKey, chatPayload);

        const responseText = await response.text();

        if (!response.ok) {
          return res.status(response.status).json({ 
            error: `API 接口调用失败 (${response.status}): ${responseText || '无响应内容'}` 
          });
        }

        if (!responseText || !responseText.trim()) {
          return res.status(502).json({ 
            error: "中继接口调用返回了空内容。这通常说明大模型接口超时，或者 API 密钥/代理端点/模型名称配置有误。" 
          });
        }

        let chatData: any;
        try {
          chatData = JSON.parse(responseText);
        } catch (err) {
          if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html") || responseText.trim().startsWith("<")) {
            return res.status(502).json({ 
              error: `大模型端点返回了 HTML 网页内容（而非期望的 JSON 数据）。这通常是因为 Nginx 网关报错、域名被拦截、404 未找到、或代理配置有误。返回的前150个字符为：\n${responseText.substring(0, 150)}` 
            });
          }
          return res.status(502).json({ 
            error: `中继返回格式解析失败。内容并非标准的 JSON。内容的前150个字符为：\n${responseText.substring(0, 150)}` 
          });
        }

        const messageContent = chatData.choices?.[0]?.message?.content || "{}";
        const parsed = parseLLMResponse(messageContent);
        return res.json(parsed);
      }

    } catch (error: any) {
      console.error("LLM Gateway Chat Error:", error);
      return res.status(500).json({ error: error?.message || "大模型网关中继组件处理异常" });
    }
  });

  // TTS Speech Synthesizer Route
  app.post("/api/llm/tts", async (req, res) => {
    try {
      const { text, voice, apiKey } = req.body;
      const finalKey = apiKey || process.env.DASHSCOPE_API_KEY;

      if (!finalKey) {
        return res.status(400).json({ error: "尚未在「设置」中配置 阿里云 DashScope API Key。请输入后重试。" });
      }

      if (!text) {
        return res.status(400).json({ error: "语音合成文本内容不能为空。" });
      }

      const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/speech-synthesizer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${finalKey}`
        },
        body: JSON.stringify({
          model: "cosyvoice-v1",
          input: {
            text: text
          },
          parameters: {
            speaker: voice || "loongying",
            audio_format: "mp3",
            sample_rate: 22050
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `阿里云语音合成失败 (${response.status}): ${errText}` });
      }

      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(Buffer.from(buffer));

    } catch (error: any) {
      console.error("TTS Middleware Error:", error);
      return res.status(500).json({ error: error?.message || "音色中继服务处理异常" });
    }
  });

  // Proactive chat endpoint — triggered when model is idle
  app.post("/api/llm/proactive-chat", async (req, res) => {
    try {
      const {
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        systemInstruction = '你是一个友好的3D虚拟人伴侣。可以使用动作来辅助你的表达。',
        animations = [],
        emotionContext = '',
        history = []
      } = req.body;

      // 根据情绪上下文定制主动发言提示
      const baseProactivePrompt = "说句话来打破沉默吧，可以随便聊聊近况。";
      const proactivePrompt = emotionContext
        ? `${baseProactivePrompt}\n（你自己此刻的内在状态是：${emotionContext}。这是你自己的感受，不要误以为用户也有同样的状态。）`
        : baseProactivePrompt;

      const formattedSystemInstruction = `${systemInstruction}

可用骨骼动画：${JSON.stringify(animations)}

只输出 JSON：{"reply":"你想说的话","animation":"动画名或空字符串"}`;

      // Provider 1: Gemini (default)
      if (provider === 'gemini') {
        const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
        if (!finalKey) {
          return res.status(400).json({ error: "未设置 Gemini API Key。请在侧边栏「大模型设置」中输入。" });
        }

        const finalModelName = model || "gemini-3.5-flash";

        const ai = new GoogleGenAI({
          apiKey: finalKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const contents = prepareGeminiContents(history, proactivePrompt);

        console.log(`[Gemini Proactive Request] Model: ${finalModelName}, History Length: ${history.length}, Prompt: "${proactivePrompt}"`);

        const response = await ai.models.generateContent({
          model: finalModelName,
          contents: contents,
          config: {
            systemInstruction: formattedSystemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: {
                  type: Type.STRING,
                  description: "陪伴助理打破沉默或发起的对话内容。语言要亲切、口语化，长度在1-4句话之间。",
                },
                animation: {
                  type: Type.STRING,
                  description: "当前表达最适合配上的骨骼动画名称。必须从可用骨骼动画列表中挑选，无合适动作的话返回空字符串。",
                },
              },
              required: ["reply", "animation"],
            },
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          },
        });

        const candidate = response.candidates?.[0];
        if (candidate?.finishReason === "SAFETY") {
          console.warn("[Gemini API Proactive] WARNING: Proactive output was blocked by safety filters.");
          return res.json({
            reply: "（想跟你说话，但有些话害羞说不来呢。我们聊点好玩的吧！）",
            animation: ""
          });
        }

        const text = response.text;
        if (!text) {
          console.warn("[Gemini API Proactive] WARNING: response.text is empty or undefined. Finished reason:", candidate?.finishReason);
          return res.json({
            reply: "（本来想打破沉默的，不过网络有一点调皮，请先对我说句话吧！）",
            animation: ""
          });
        }

        const parsed = parseLLMResponse(text);
        return res.json(parsed);
      } else {
        // Provider 2, 3 & 4: DeepSeek, Qwen & Custom OpenAI Compatible
        let finalKey = apiKey;
        let finalBaseUrl = baseUrl;
        let finalModelName = model;

        if (provider === 'deepseek') {
          finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
          finalBaseUrl = baseUrl || "https://api.deepseek.com";
          finalModelName = model || "deepseek-chat";
        } else if (provider === 'qwen') {
          finalKey = apiKey || process.env.DASHSCOPE_API_KEY || "sk-a16630bdca2841cbb25a974a934e35e6";
          finalBaseUrl = baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
          finalModelName = model || "qwen-max";
        } else {
          finalKey = apiKey;
          finalBaseUrl = baseUrl || "https://api.openai.com/v1";
          finalModelName = model || "gpt-4o-mini";
        }

        if (!finalKey) {
          return res.status(400).json({ error: `未设置 ${provider === 'deepseek' ? 'DeepSeek' : provider === 'qwen' ? 'Qwen' : '自定义'} API Key。请在大模型设置中填入。` });
        }

        const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
        const targetUrl = `${cleanBaseUrl}/chat/completions`;

        const messages = prepareOpenAIMessages(history, proactivePrompt, formattedSystemInstruction);

        const chatPayload = {
          model: finalModelName,
          messages: messages,
          response_format: { type: "json_object" }
        };

        const response = await fetchOpenAICompatibleChat(targetUrl, finalKey, chatPayload);

        const responseText = await response.text();

        if (!response.ok) {
          return res.status(response.status).json({ 
            error: `API 接口调用失败 (${response.status}): ${responseText || '无响应内容'}` 
          });
        }

        if (!responseText || !responseText.trim()) {
          return res.status(502).json({ 
            error: "中继接口从主动消息代理处返回了空内容。这说明大模型可能超时，或者 API 密钥/端点输入有错。" 
          });
        }

        let chatData: any;
        try {
          chatData = JSON.parse(responseText);
        } catch (err) {
          if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html") || responseText.trim().startsWith("<")) {
            return res.status(502).json({ 
              error: `大模型主动对白端点返回了 HTML 网页内容（而非期望的 JSON 数据）。返回的前150个字符为：\n${responseText.substring(0, 150)}` 
            });
          }
          return res.status(502).json({ 
            error: `主动消息中继返回格式解析失败。内容并非标准的 JSON。内容的前150个字符为：\n${responseText.substring(0, 150)}` 
          });
        }

        const messageContent = chatData.choices?.[0]?.message?.content || "{}";
        const parsed = parseLLMResponse(messageContent);
        return res.json(parsed);
      }

    } catch (error: any) {
      console.error("LLM Proactive Chat Error:", error);
      return res.status(500).json({ error: error?.message || "主动聊天处理异常" });
    }
  });

  // Serve static UI assets inside Vite Dev Server / production build folder
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started. Listening on http://localhost:${PORT}`);
  });
}

startServer();
