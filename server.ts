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
        animations = [],
        systemAddendum = '',
        history = [],
        contextSummary = '',
        temperature = 0.9
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
      }

      // Build conversation history text
      let historyText = '';
      if (contextSummary) {
        historyText += `【之前的对话总结】\n${contextSummary}\n\n`;
      }
      if (history.length > 0) {
        historyText += '【最近的对话记录】\n';
        historyText += history.map((m: any) => `${m.role === 'user' ? '用户' : 'AI伴侣'}: ${m.content}`).join('\n');
        historyText += '\n';
      }
      const fullPrompt = historyText ? `${historyText}\n用户刚刚说: ${prompt}` : prompt;

      // System instruction
      const formattedSystemInstruction = `${systemInstruction}

你正在控制一个加载在Web 3D编辑器中的动画角色。
当前模型包含以下可执行的内置骨骼动画动作列表（动作名称）：
${JSON.stringify(animations)}

${systemAddendum}

任务：
1. 像角色本身一样，以自然的语气回答用户的聊天请求。请结合对话历史和角色当前状态来理解上下文。
2. 根据你的回答语境、情绪、语气，从上方内置动作列表中，选择极其适配的一个动作名称 fill 到 'animation' 属性中。
3. 如果动作列表为空或没有合适的动作，请将 'animation' 设为 ""。
4. 根据对话内容对角色情绪的影响，输出 emotionImpact（愉悦度valence、唤醒度arousal、紧张度tension的变化量，范围 -0.3 到 0.3）。
5. 你必须「只输出」一段符合下方结构的 JSON 对象：
{
  "reply": "你的回复文本，注意保持简短、自然、温和。",
  "animation": "匹配动画的 EXACT 名称（严格区分大小写且必须是输入列表里的项）",
  "emotionImpact": {
    "valence": 0,
    "arousal": 0,
    "tension": 0,
    "reason": "简短描述为什么产生这个情绪变化（5-15字）"
  }
}
emotionImpact 不强制要求，如果对话没有明显引起情绪变化可以不输出此字段。`;

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
          contents: fullPrompt,
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
            { role: "user", content: fullPrompt }
          ],
          response_format: { type: "json_object" },
          temperature,
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

  // Proactive Chat — LLM initiates a conversation based on current emotional state
  app.post("/api/llm/proactive-chat", async (req, res) => {
    try {
      const {
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        systemInstruction = '你是一个充满活力、有温度的三维手办伴侣、陪伴小精灵。',
        animations = [],
        history = [],
        contextSummary = '',
        systemAddendum = '',
        moodLabel = '平静',
        recentTopics = [],
        temperature = 1.0
      } = req.body;

      // Anti-repeat: prevent semantic repetition
      const antiRepeatInstruction = recentTopics && recentTopics.length > 0
        ? `【避免重复】你最近说过这些：${JSON.stringify(recentTopics)}。这次请从一个全新的角度切入——换个完全不同的话题或表达方式。可以分享一个小观察、提出一个有趣的疑问、或者用轻松的语气关心用户。`
        : '';

      // Build conversation history text
      let proactiveHistoryText = '';
      if (contextSummary) {
        proactiveHistoryText += `【之前的对话总结】\n${contextSummary}\n\n`;
      }
      if (history.length > 0) {
        proactiveHistoryText += '【最近的对话记录】\n';
        proactiveHistoryText += history.map((m: any) => `${m.role === 'user' ? '用户' : 'AI伴侣'}: ${m.content}`).join('\n');
        proactiveHistoryText += '\n';
      }

      const basePrompt = `当前情绪标签：${moodLabel}。请根据角色的内心状态，用角色的身份主动向用户说一句自然的话。`;

      const formattedPrompt = proactiveHistoryText ? `${proactiveHistoryText}\n${basePrompt}` : basePrompt;

      const formattedSystemInstruction = `${systemInstruction}

你是一个有心情、有性格的3D虚拟人伴侣。你的内心状态会驱动你的主动对话。
当前模型包含以下可执行的内置骨骼动画动作列表（动作名称）：
${JSON.stringify(animations)}

${systemAddendum}
${antiRepeatInstruction}

任务：
1. 根据「角色当前状态」中的描述，用角色的身份主动向用户说一句话。
2. 你的话要有真实的情绪驱动力——你是"想要"说什么，而不是"被要求"说什么。让用户感受到你是一个有内心世界的存在。
3. 从内置动作列表中选择一个适配当前心情的动作，没有则填空字符串。
4. 你必须「只输出」一段符合下方结构的 JSON 对象：
{
  "reply": "角色的主动发言，简短自然，10-40字。",
  "animation": "匹配心情的动作名称，或空字符串"
}`;

      const executeLLMCall = async (finalKey: string, finalBaseUrl: string, finalModelName: string) => {
        if (provider === 'gemini' || (!finalBaseUrl && provider !== 'deepseek' && provider !== 'custom')) {
          const ai = new GoogleGenAI({
            apiKey: finalKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          const response = await ai.models.generateContent({
            model: finalModelName,
            contents: formattedPrompt,
            config: {
              systemInstruction: formattedSystemInstruction,
              responseMimeType: "application/json",
              temperature,
            },
          });

          const text = response.text || "{}";
          let cleanText = text.trim();
          if (cleanText.startsWith("```json")) cleanText = cleanText.slice(7);
          else if (cleanText.startsWith("```")) cleanText = cleanText.slice(3);
          if (cleanText.endsWith("```")) cleanText = cleanText.slice(0, -3);
          return JSON.parse(cleanText.trim());
        } else {
          const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
          const targetUrl = `${cleanBaseUrl}/chat/completions`;

          const chatPayload = {
            model: finalModelName,
            messages: [
              { role: "system", content: formattedSystemInstruction },
              { role: "user", content: formattedPrompt }
            ],
            response_format: { type: "json_object" },
            temperature,
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
            throw new Error(`API call failed (${response.status}): ${errText}`);
          }

          const chatData: any = await response.json();
          const messageContent = chatData.choices?.[0]?.message?.content || "{}";
          return JSON.parse(messageContent.trim());
        }
      };

      let result: any;
      if (provider === 'gemini') {
        const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 Gemini API Key" });
        result = await executeLLMCall(finalKey, '', model || "gemini-3.5-flash");
      } else if (provider === 'deepseek') {
        const finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 DeepSeek API Key" });
        result = await executeLLMCall(finalKey, baseUrl || "https://api.deepseek.com", model || "deepseek-chat");
      } else {
        if (!apiKey) return res.status(400).json({ error: "未设置 API Key" });
        result = await executeLLMCall(apiKey, baseUrl || "https://api.openai.com/v1", model || "gpt-4o-mini");
      }

      return res.json(result);
    } catch (error: any) {
      console.error("Proactive Chat Error:", error);
      return res.status(500).json({ error: error?.message || "主动对话服务异常" });
    }
  });

  // Game — interactive mini-games to boost mood when user engages during low mood
  app.post("/api/llm/game", async (req, res) => {
    try {
      const {
        action,           // 'start' | 'evaluate'
        gameType,         // 'guess_mood' | 'two_choice' | 'chain_story'
        userAnswer = '',
        storySoFar = '',
        round = 1,
        maxRounds = 3,
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        promptContext = null,
        history = [],
        contextSummary = '',
        temperature = 0.95
      } = req.body;

      if (!action || !gameType) {
        return res.status(400).json({ error: "Missing action or gameType" });
      }

      // Build history text
      let historyText = '';
      if (contextSummary) historyText += `【之前的对话总结】\n${contextSummary}\n\n`;
      if (history.length > 0) {
        historyText += '【最近的对话记录】\n';
        historyText += history.map((m: any) => `${m.role === 'user' ? '用户' : 'AI伴侣'}: ${m.content}`).join('\n');
        historyText += '\n';
      }

      let systemPrompt: string;
      let userPrompt: string;

      const ctx = promptContext || {};
      const moodLabel = ctx.emotionDescription || '平静';
      const moodContextText = ctx.systemAddendum || '';

      if (action === 'start') {
        const gamePrompts: Record<string, string> = {
          guess_mood: `你正在和用户玩"猜心情"小游戏。
${moodContextText}
请设计一个简短的场景描述（1-2句话，30-50字），来描述你此刻的内心感受，让用户猜你的心情。
给出4个中文选项（如：开心、难过、生气、平静），其中1个是正确答案（基于当前情绪状态）。
输出JSON: { "gamePrompt": { "gameType": "guess_mood", "question": "场景描述...", "options": ["选项1","选项2","选项3","选项4"], "correctAnswer": "正确选项" } }`,
          two_choice: `你正在和用户玩"二选一"小游戏。
${moodContextText}
根据你的内心状态和角色设定，提出一个有趣的二选一问题。
两个选项都应该是正面的、有趣的，没有对错之分。问题要轻松好玩！
输出JSON: { "gamePrompt": { "gameType": "two_choice", "question": "你的问题（20-40字）", "options": ["选项A", "选项B"] } }`,
          chain_story: `你正在和用户玩"接龙故事"小游戏。你先起一个有趣的故事开头（20-40字），然后让用户接下一句。共${maxRounds}轮。
输出JSON: { "gamePrompt": { "gameType": "chain_story", "question": "你的故事开头...", "storySoFar": "你的故事开头...", "round": 1, "maxRounds": ${maxRounds} } }`,
        };

        systemPrompt = gamePrompts[gameType] || gamePrompts.guess_mood;
        userPrompt = historyText ? `${historyText}\n开始一个${gameType}游戏吧。` : `开始一个${gameType}游戏吧。`;
      } else if (action === 'evaluate') {
        const evalPrompts: Record<string, string> = {
          guess_mood: `用户正在和你玩"猜心情"游戏。
用户的答案是: "${userAnswer}"
${moodContextText}
请热情地回应用户！如果猜对了就大大称赞，如果猜错了就温柔地告诉他正确答案并鼓励他。
游戏互动会提升情绪——emotionImpact的valence应有+0.15到+0.25的提升。
输出JSON: { "gameResult": { "gameType": "guess_mood", "isCorrect": true或false, "emotionImpact": {"valence": 数值, "arousal": 数值, "reason": "原因"}, "aiResponse": "你的热情回应（30-60字）", "isComplete": true } }`,
          two_choice: `用户正在和你玩"二选一"游戏。
用户选择了: "${userAnswer}"
请根据用户的选择，给出个性化的有趣回应。两个选项都没有对错，根据用户的选择发挥你的创意！
游戏互动会提升情绪——emotionImpact的valence应有+0.15到+0.25的提升。
输出JSON: { "gameResult": { "gameType": "two_choice", "emotionImpact": {"valence": 数值, "arousal": 数值, "reason": "原因"}, "aiResponse": "你的有趣回应（30-60字）", "isComplete": true } }`,
          chain_story: `用户正在和你玩"接龙故事"小游戏。
之前的故事: ${storySoFar}
用户续写: "${userAnswer}"
请根据用户的续写继续发展故事（30-60字），保持连贯有趣。这是第${round}轮，还剩${maxRounds - round}轮。
${round >= maxRounds ? '这是最后一轮了，请给故事一个温馨有趣的结尾。' : '请继续留悬念让用户接着写。'}
游戏互动会提升情绪——emotionImpact的valence应有+0.1到+0.15的提升。
输出JSON: { "gameResult": { "gameType": "chain_story", "emotionImpact": {"valence": 数值, "arousal": 数值, "reason": "原因"}, "aiResponse": "你的故事续写", "isComplete": ${round >= maxRounds} } }`,
        };

        systemPrompt = evalPrompts[gameType] || evalPrompts.guess_mood;
        userPrompt = historyText || '请评估游戏回答。';
      } else {
        return res.status(400).json({ error: "Invalid action. Use 'start' or 'evaluate'." });
      }

      const fullSystemPrompt = `${systemPrompt}\n\n你必须「只输出」一段符合结构的JSON对象，不要含有任何其他多余字符或JSON外的markdown包裹。`;

      const executeLLMCall = async (finalKey: string, finalBaseUrl: string, finalModelName: string) => {
        if (provider === 'gemini' || (!finalBaseUrl && provider !== 'deepseek' && provider !== 'custom')) {
          const ai = new GoogleGenAI({
            apiKey: finalKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          const response = await ai.models.generateContent({
            model: finalModelName,
            contents: userPrompt,
            config: {
              systemInstruction: fullSystemPrompt,
              responseMimeType: "application/json",
              temperature,
            },
          });

          const text = response.text || "{}";
          let cleanText = text.trim();
          if (cleanText.startsWith("```json")) cleanText = cleanText.slice(7);
          else if (cleanText.startsWith("```")) cleanText = cleanText.slice(3);
          if (cleanText.endsWith("```")) cleanText = cleanText.slice(0, -3);
          return JSON.parse(cleanText.trim());
        } else {
          const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
          const targetUrl = `${cleanBaseUrl}/chat/completions`;

          const chatPayload = {
            model: finalModelName,
            messages: [
              { role: "system", content: fullSystemPrompt },
              { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature,
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
            throw new Error(`API call failed (${response.status}): ${errText}`);
          }

          const chatData: any = await response.json();
          const messageContent = chatData.choices?.[0]?.message?.content || "{}";
          return JSON.parse(messageContent.trim());
        }
      };

      let result: any;
      if (provider === 'gemini') {
        const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 Gemini API Key" });
        result = await executeLLMCall(finalKey, '', model || "gemini-3.5-flash");
      } else if (provider === 'deepseek') {
        const finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 DeepSeek API Key" });
        result = await executeLLMCall(finalKey, baseUrl || "https://api.deepseek.com", model || "deepseek-chat");
      } else {
        if (!apiKey) return res.status(400).json({ error: "未设置 API Key" });
        result = await executeLLMCall(apiKey, baseUrl || "https://api.openai.com/v1", model || "gpt-4o-mini");
      }

      return res.json(result);
    } catch (error: any) {
      console.error("Game Endpoint Error:", error);
      return res.status(500).json({ error: error?.message || "游戏服务异常" });
    }
  });

  // Context Compression — summarize old conversation turns when history grows too large
  app.post("/api/llm/compress-context", async (req, res) => {
    try {
      const {
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        messages = [],
        contextSummary = '',
        temperature = 0.5
      } = req.body;

      if (!messages || messages.length === 0) {
        return res.json({ summary: contextSummary || '' });
      }

      let textToCompress = '';
      if (contextSummary) {
        textToCompress += `之前的对话总结：\n${contextSummary}\n\n`;
      }
      textToCompress += '需要压缩的对话记录：\n';
      textToCompress += messages.map((m: any) =>
        `${m.role === 'user' ? '用户' : 'AI伴侣'}: ${m.content}`
      ).join('\n');

      const compressionInstruction = `你是一个对话摘要专家。请将上面的对话历史压缩为一段简洁的摘要（100-250字）。
保留关键信息：用户的名字/称呼、重要话题、情感变化、角色关系发展、用户偏好、关键事件。
输出格式：只输出摘要文本，不要JSON包裹，不要任何额外说明或标记。`;

      const executeLLMCall = async (finalKey: string, finalBaseUrl: string, finalModelName: string) => {
        if (provider === 'gemini' || (!finalBaseUrl && provider !== 'deepseek' && provider !== 'custom')) {
          const ai = new GoogleGenAI({
            apiKey: finalKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          const response = await ai.models.generateContent({
            model: finalModelName,
            contents: textToCompress,
            config: {
              systemInstruction: compressionInstruction,
            },
          });

          return (response.text || '').trim();
        } else {
          const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
          const targetUrl = `${cleanBaseUrl}/chat/completions`;

          const chatPayload = {
            model: finalModelName,
            messages: [
              { role: "system", content: compressionInstruction },
              { role: "user", content: textToCompress }
            ],
            temperature,
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
            throw new Error(`API call failed (${response.status}): ${errText}`);
          }

          const chatData: any = await response.json();
          return (chatData.choices?.[0]?.message?.content || '').trim();
        }
      };

      let summary: string;
      if (provider === 'gemini') {
        const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 Gemini API Key" });
        summary = await executeLLMCall(finalKey, '', model || "gemini-3.5-flash");
      } else if (provider === 'deepseek') {
        const finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
        if (!finalKey) return res.status(400).json({ error: "未设置 DeepSeek API Key" });
        summary = await executeLLMCall(finalKey, baseUrl || "https://api.deepseek.com", model || "deepseek-chat");
      } else {
        if (!apiKey) return res.status(400).json({ error: "未设置 API Key" });
        summary = await executeLLMCall(apiKey, baseUrl || "https://api.openai.com/v1", model || "gpt-4o-mini");
      }

      return res.json({ summary });
    } catch (error: any) {
      console.error("Context Compression Error:", error);
      return res.status(500).json({ error: error?.message || "上下文压缩服务异常" });
    }
  });

  // AI Motion Generation — translates natural language to joint rotation keyframes
  app.post("/api/llm/motion", async (req, res) => {
    try {
      const {
        provider = 'gemini',
        apiKey = '',
        baseUrl = '',
        model = '',
        prompt = '',
        joints = [],
        temperature = 0.85
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Missing motion prompt" });
      }

      // Build a compact joint map for the LLM to understand the skeleton topology
      const jointSummary = joints.map((j: any) => ({
        id: j.id,
        name: j.name,
        parentId: j.parentId,
        chain: getChainToRoot(j.id, joints)
      }));

      function getChainToRoot(id: string, all: any[]): string[] {
        const chain: string[] = [];
        let cur = all.find(j => j.id === id);
        while (cur) {
          chain.unshift(cur.id);
          cur = cur.parentId ? all.find(j => j.id === cur!.parentId) : null;
        }
        return chain;
      }

      // Identify arm/leg chains for IK-aware prompting
      const lArm = jointSummary.find((j: any) => j.id === 'l_shoulder' || j.id.includes('shoulder') && j.id.includes('l'));
      const rArm = jointSummary.find((j: any) => j.id === 'r_shoulder' || j.id.includes('shoulder') && j.id.includes('r'));
      const lLeg = jointSummary.find((j: any) => j.id === 'l_hip' || j.id.includes('hip') && j.id.includes('l'));
      const rLeg = jointSummary.find((j: any) => j.id === 'r_hip' || j.id.includes('hip') && j.id.includes('r'));

      const motionSystemPrompt = `你是 3D 骨骼动效编排引擎。根据用户的自然语言动作描述，生成 5 个关键帧（帧号 0, 15, 30, 45, 59）的人形骨骼关节旋转角度。

骨骼拓扑结构（父子链陈列）：
${JSON.stringify(jointSummary, null, 2)}

关键规则：
1. 输出 5 个关键帧（frame: 0, 15, 30, 45, 59），构成 60 FPS 循环动画
2. 每个关键帧内，仅需列出有实际旋转变化的关节（静止关节省略）
3. 旋转格式为欧拉角 [rx, ry, rz]，单位弧度（radians）
4. rx 绕X轴（前后弯曲），ry 绕Y轴（左右扭转），rz 绕Z轴（内外旋转）
5. 人体关节合理范围：上肢 -1.5~1.5，下肢 -1.2~1.2，脊柱 -0.8~0.8
6. 确保关键帧间动作连贯流畅，首帧(0)与末帧(59)应接近以形成循环
7. 手臂链路径: ${lArm ? lArm.chain.join(' → ') : 'l_shoulder → l_elbow'} / ${rArm ? rArm.chain.join(' → ') : 'r_shoulder → r_elbow'}
8. 腿链路径: ${lLeg ? lLeg.chain.join(' → ') : 'l_hip → l_knee → l_foot'} / ${rLeg ? rLeg.chain.join(' → ') : 'r_hip → r_knee → r_foot'}
9. 肩膀旋转控制上臂方向，肘部旋转控制前臂弯曲
10. 步行动作：手臂与对侧腿反向摆动；挥手动作：单臂举起+肘部弯曲

输出 JSON 格式（严格按此结构，不含任何额外文本或 markdown）：
{
  "description": "简短的动作描述",
  "keyframes": [
    { "frame": 0, "rotations": { "jointId": [rx, ry, rz] } },
    { "frame": 15, "rotations": { "jointId": [rx, ry, rz] } },
    { "frame": 30, "rotations": { ... } },
    { "frame": 45, "rotations": { ... } },
    { "frame": 59, "rotations": { ... } }
  ]
}`;

      const executeLLMCall = async (finalKey: string, finalBaseUrl: string, finalModelName: string) => {
        if (provider === 'gemini' || (!finalBaseUrl && provider !== 'deepseek' && provider !== 'custom')) {
          const ai = new GoogleGenAI({
            apiKey: finalKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          console.log(`[motion] Calling Gemini model=${finalModelName} prompt=${prompt.slice(0, 50)}`);

          const geminiResponse = await ai.models.generateContent({
            model: finalModelName,
            contents: `用户想要的动作: ${prompt}`,
            config: {
              systemInstruction: motionSystemPrompt,
              responseMimeType: "application/json",
              temperature,
            },
          });

          const text = geminiResponse.text;
          console.log(`[motion] Gemini raw text (first 300 chars):`, (text || '').slice(0, 300));

          if (!text || text.trim().length === 0) {
            throw new Error("Gemini returned empty response text");
          }

          // Strip markdown fences if present
          let cleanText = text.trim();
          if (cleanText.startsWith("```json")) {
            cleanText = cleanText.slice(7);
          } else if (cleanText.startsWith("```")) {
            cleanText = cleanText.slice(3);
          }
          if (cleanText.endsWith("```")) {
            cleanText = cleanText.slice(0, -3);
          }
          cleanText = cleanText.trim();

          return JSON.parse(cleanText);
        } else {
          const cleanBaseUrl = finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl;
          const targetUrl = `${cleanBaseUrl}/chat/completions`;

          const chatPayload = {
            model: finalModelName,
            messages: [
              { role: "system", content: motionSystemPrompt },
              { role: "user", content: `用户想要的动作: ${prompt}` }
            ],
            response_format: { type: "json_object" },
            temperature,
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
            throw new Error(`API call failed (${response.status}): ${errText}`);
          }

          const chatData: any = await response.json();
          const messageContent = chatData.choices?.[0]?.message?.content || "{}";
          return JSON.parse(messageContent.trim());
        }
      };

      let result: any;
      try {
        if (provider === 'gemini') {
          const finalKey = apiKey || process.env.GEMINI_API_KEY || "";
          if (!finalKey) throw new Error("Missing Gemini API Key");
          result = await executeLLMCall(finalKey, '', model || "gemini-3.5-flash");
        } else if (provider === 'deepseek') {
          const finalKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
          if (!finalKey) throw new Error("Missing DeepSeek API Key");
          result = await executeLLMCall(finalKey, baseUrl || "https://api.deepseek.com", model || "deepseek-chat");
        } else {
          if (!apiKey) throw new Error("Missing API Key for custom provider");
          result = await executeLLMCall(apiKey, baseUrl || "https://api.openai.com/v1", model || "gpt-4o-mini");
        }

        // Validate structure
        if (!result.keyframes || !Array.isArray(result.keyframes)) {
          return res.status(422).json({ error: "LLM 返回的数据缺少有效的 keyframes 数组", raw: result });
        }

        // Validate each keyframe has frame number and rotations object
        const validated = result.keyframes.map((kf: any, idx: number) => {
          if (typeof kf.frame !== 'number') {
            // Assign default frame positions
            const defaults = [0, 15, 30, 45, 59];
            kf.frame = defaults[idx] || idx * 15;
          }
          if (!kf.rotations || typeof kf.rotations !== 'object') {
            kf.rotations = {};
          }
          return kf;
        });

        return res.json({
          description: result.description || prompt,
          keyframes: validated
        });
      } catch (parseErr: any) {
        console.error("Motion generation parse error:", parseErr);
        return res.status(422).json({ error: "解析 LLM 动作生成结果失败: " + parseErr.message });
      }
    } catch (error: any) {
      console.error("LLM Motion Gateway Error:", error);
      return res.status(500).json({ error: error?.message || "AI 动作生成服务异常" });
    }
  });

  // TTS — Aliyun DashScope Qwen3-TTS-Flash
  app.post("/api/llm/tts", async (req, res) => {
    try {
      const { text, voice = 'Cherry', apiKey = '' } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Missing text for TTS synthesis" });
      }

      const finalKey = apiKey || process.env.DASHSCOPE_API_KEY || "";
      if (!finalKey) {
        return res.status(400).json({ error: "未配置阿里云 DASHSCOPE_API_KEY。请在侧边栏「设置」中填入，或在服务端环境变量中配置。" });
      }

      const dashscopeResp = await fetch(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${finalKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen3-tts-flash",
            input: {
              text,
              voice,
              format: "mp3",
            },
          }),
        }
      );

      if (!dashscopeResp.ok) {
        let errMsg = `DashScope TTS 请求失败 (${dashscopeResp.status})`;
        try {
          const errBody = await dashscopeResp.json();
          if (errBody?.message) errMsg += `: ${errBody.message}`;
          if (errBody?.code) errMsg += ` (${errBody.code})`;
        } catch {
          // Body not JSON — ignore
        }
        return res.status(dashscopeResp.status).json({ error: errMsg });
      }

      // Qwen3-TTS-Flash returns JSON with an audio download URL
      const dashData = await dashscopeResp.json();
      const audioUrl: string | undefined = dashData?.output?.audio?.url;
      const audioDataB64: string | undefined = dashData?.output?.audio?.data;

      if (audioDataB64) {
        const buffer = Buffer.from(audioDataB64, "base64");
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(buffer);
      }

      if (audioUrl) {
        const audioResp = await fetch(audioUrl);
        if (!audioResp.ok) {
          return res.status(502).json({ error: "无法从 DashScope 下载语音文件" });
        }
        const audioBuffer = await audioResp.arrayBuffer();
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(Buffer.from(audioBuffer));
      }

      return res.status(502).json({ error: "DashScope 返回了无效的 TTS 响应：缺少音频数据" });
    } catch (error: any) {
      console.error("TTS Proxy Error:", error);
      return res.status(500).json({ error: error?.message || "TTS 语音合成服务异常" });
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
