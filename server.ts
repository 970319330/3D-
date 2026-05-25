import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

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
        animations = []
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
      }

      // Prepend exact mechanical schema rules for JSON output structure
      const formattedSystemInstruction = `${systemInstruction}

你正在控制一个加载在Web 3D编辑器中的动画角色。
当前模型包含以下可执行的内置骨骼动画动作列表（动作名称）：
${JSON.stringify(animations)}

任务：
1. 像角色本身一样，以自然的语气回答用户的聊天问题（Prompt）。
2. 根据你的回答语境、情绪、语气，从上方内置动作列表中，选择极其适配的一个动作名称 fill 到 'animation' 属性中。
3. 如果动作列表为空或没有合适的动作，请将 'animation' 设为 ""。
4. 你必须「只输出」一段符合下方结构的 JSON 对象，不要含有任何其他多余字符或 JSON 外的 markdown 包裹：
{
  "reply": "你的回复文本，注意保持简短、自然、温和，与用户交流。",
  "animation": "匹配动画的 EXACT 名称（严格区分大小写且必须是输入列表里的项）"
}`;

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

        const response = await ai.models.generateContent({
          model: finalModelName,
          contents: prompt,
          config: {
            systemInstruction: formattedSystemInstruction,
            responseMimeType: "application/json",
          },
        });

        const text = response.text || "{}";
        try {
          const parsed = JSON.parse(text.trim());
          return res.json(parsed);
        } catch {
          let cleanText = text.trim();
          if (cleanText.startsWith("```json")) {
            cleanText = cleanText.substring(7);
          }
          if (cleanText.endsWith("```")) {
            cleanText = cleanText.substring(0, cleanText.length - 3);
          }
          const parsed = JSON.parse(cleanText.trim());
          return res.json(parsed);
        }
      } else {
        // Provider 2 & 3: DeepSeek & Custom OpenAI Compatible
        let finalKey = apiKey;
        let finalBaseUrl = baseUrl;
        let finalModelName = model;

        if (provider === 'deepseek') {
          finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
          finalBaseUrl = baseUrl || "https://api.deepseek.com";
          finalModelName = model || "deepseek-chat";
        } else {
          finalKey = apiKey;
          finalBaseUrl = baseUrl || "https://api.openai.com/v1";
          finalModelName = model || "gpt-4o-mini";
        }

        if (!finalKey) {
          return res.status(400).json({ error: `未设置 ${provider === 'deepseek' ? 'DeepSeek' : '自定义'} API Key。请在大模型设置中填入。` });
        }

        const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
        const targetUrl = `${cleanBaseUrl}/chat/completions`;

        const chatPayload = {
          model: finalModelName,
          messages: [
            { role: "system", content: formattedSystemInstruction },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        };

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${finalKey}`
          },
          body: JSON.stringify(chatPayload)
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).json({ error: `API 接口调用失败 (${response.status}): ${errText}` });
        }

        const chatData: any = await response.json();
        const messageContent = chatData.choices?.[0]?.message?.content || "{}";

        try {
          const parsed = JSON.parse(messageContent.trim());
          return res.json(parsed);
        } catch {
          let cleanText = messageContent.trim();
          if (cleanText.startsWith("```json")) {
            cleanText = cleanText.substring(7);
          }
          if (cleanText.endsWith("```")) {
            cleanText = cleanText.substring(0, cleanText.length - 3);
          }
          const parsed = JSON.parse(cleanText.trim());
          return res.json(parsed);
        }
      }

    } catch (error: any) {
      console.error("LLM Gateway Chat Error:", error);
      return res.status(500).json({ error: error?.message || "大模型网关中继组件处理异常" });
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
