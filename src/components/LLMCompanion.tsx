import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Settings, Sparkles, AlertCircle, RefreshCw, Eye, EyeOff, User, Film, HelpCircle, Sliders, Play, Trash2, Volume2, VolumeX, Activity } from 'lucide-react';
import { EmotionState, EmotionImpact, NeedState, NeedType, BehaviorIntent, MoodPromptContext, KeyframeData, JointNode, AbandonmentTier, GamePrompt, GameResult } from '../types';
import MoodPanel from './MoodPanel';
import { getMoodLabel, getMoodEmoji } from '../utils/moodEngine';

interface LLMConfig {
  provider: 'gemini' | 'deepseek' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  systemInstruction: string;
}

interface Message {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  animation?: string;
  error?: boolean;
  timestamp: Date;
  emotionImpact?: EmotionImpact;
  isProactive?: boolean;
  motionKeyframes?: KeyframeData[];
  motionDescription?: string;
  gamePrompt?: GamePrompt;
  gameResult?: GameResult;
}

interface LLMCompanionProps {
  detectedClips: string[];
  onTriggerAnimation: (clipName: string) => void;
  emotion: EmotionState;
  needs: Record<NeedType, NeedState>;
  intent: BehaviorIntent | null;
  promptContext: MoodPromptContext;
  moodEventTrigger?: number;
  joints: JointNode[];
  onMotionGenerated: (keyframes: KeyframeData[]) => void;
  isPlaying: boolean;
  onSetPlaying: (playing: boolean) => void;
  abandonment: number;
  abandonmentTier: AbandonmentTier;
  activeGame: GamePrompt | null;
  onUserMessage: (text: string) => void;
  onProactiveSent: (snippet: string) => void;
  onGameStart: (game: GamePrompt) => void;
  onGameComplete: (result: GameResult) => void;
  onResetMood: () => void;
}

const DEFAULT_SYSTEM_INSTRUCTION = "你是一个充满活力、有温度的三维手办伴侣、陪伴小精灵。请用亲切、拟人化、简短的语气与用户进行角色扮演互动，每次回答控制在100字以内。";

export default function LLMCompanion({
  detectedClips,
  onTriggerAnimation,
  emotion,
  needs,
  intent,
  promptContext,
  moodEventTrigger = 0,
  joints,
  onMotionGenerated,
  isPlaying,
  onSetPlaying,
  abandonment,
  abandonmentTier,
  activeGame,
  onUserMessage,
  onProactiveSent,
  onGameStart,
  onGameComplete,
  onResetMood,
}: LLMCompanionProps) {
  // Stored state settings
  const [provider, setProvider] = useState<'gemini' | 'deepseek' | 'custom'>(() => {
    return (localStorage.getItem('ai_provider') as 'gemini' | 'deepseek' | 'custom') || 'gemini';
  });

  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem(`ai_key_${provider}`) || '';
  });

  const [baseUrl, setBaseUrl] = useState(() => {
    if (provider === 'gemini') return '';
    if (provider === 'deepseek') return 'https://api.deepseek.com';
    return localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1';
  });

  const [model, setModel] = useState(() => {
    if (provider === 'gemini') return 'gemini-3.5-flash';
    if (provider === 'deepseek') return 'deepseek-chat';
    return localStorage.getItem('ai_model') || 'gpt-4o-mini';
  });

  const [systemInstruction, setSystemInstruction] = useState(() => {
    return localStorage.getItem('ai_sys_prompt') || DEFAULT_SYSTEM_INSTRUCTION;
  });

  // TTS audio States
  const [useVoice, setUseVoice] = useState<boolean>(() => {
    return localStorage.getItem('ai_use_voice') === 'true';
  });

  const [dashscopeApiKey, setDashscopeApiKey] = useState(() => {
    return localStorage.getItem('ai_dashscope_key') || '';
  });

  const [selectedVoice, setSelectedVoice] = useState(() => {
    return localStorage.getItem('ai_selected_voice') || 'Cherry';
  });

  const [isPlayingAudio, setIsPlayingAudio] = useState<string | null>(null);
  const isPlayingAudioRef = useRef<string | null>(null);
  const setIsPlayingAudioSafely = (v: string | null) => {
    isPlayingAudioRef.current = v;
    setIsPlayingAudio(v);
  };

  // UI state managers
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showKeySecret, setShowKeySecret] = useState<boolean>(false);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const isTypingRef = useRef(false);
  const setTyping = (v: boolean) => {
    isTypingRef.current = v;
    setIsTyping(v);
  };
  const [motionMode, setMotionMode] = useState<boolean>(false);

  // Proactive chat state
  const [isProactiveThinking, setIsProactiveThinking] = useState<boolean>(false);
  const isProactiveThinkingRef = useRef(false);
  const setProactiveThinking = (v: boolean) => {
    isProactiveThinkingRef.current = v;
    setIsProactiveThinking(v);
  };
  const lastProactiveTimeRef = useRef<number>(0);
  const proactiveCooldownRef = useRef<number>(10000); // 10s min between proactive chats from timer
  const lastUserMessageTimeRef = useRef<number>(0); // tracks when user last chatted — suppresses proactive during active conversation
  const USER_ACTIVE_SUPPRESS_MS = 45000; // pause proactive chats for 45s after user's last message
  const moodPanelRef = useRef<HTMLDivElement>(null);

  // Emotion & needs refs for proactive timer
  const emotionRef = useRef(emotion);
  useEffect(() => { emotionRef.current = emotion; }, [emotion]);
  const intentRef = useRef(intent);
  useEffect(() => { intentRef.current = intent; }, [intent]);
  const promptContextRef = useRef(promptContext);
  useEffect(() => { promptContextRef.current = promptContext; }, [promptContext]);
  const recentTopicsRef = useRef<string[]>([]);
  const activeGameRef = useRef(activeGame);
  useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);
  const lastProactiveMessageIdRef = useRef<string | null>(null);
  const pendingAbandonmentCheckRef = useRef<boolean>(false);
  const recentProactiveMsgsRef = useRef<{ role: string; content: string }[]>([]);

  // Stable refs for config values needed in timer callbacks
  const configRef = useRef({ provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice, temperature: 0.9 });
  useEffect(() => {
    configRef.current = { provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice, temperature: 0.9 };
  }, [provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice]);

  // Shared proactive chat function — callable from anywhere without closure issues
  const doProactiveChat = async () => {
    if (isProactiveThinkingRef.current) return;
    // Skip if game is active
    if (activeGameRef.current) return;
    // Skip if audio from a previous message is still playing
    if (isPlayingAudioRef.current) return;
    // Don't interrupt active user conversation
    if (Date.now() - lastUserMessageTimeRef.current < USER_ACTIVE_SUPPRESS_MS) return;

    // Check if previous proactive was ignored by user
    if (pendingAbandonmentCheckRef.current) {
      onProactiveSent('');
    }
    pendingAbandonmentCheckRef.current = true;

    const cfg = configRef.current;
    const clips = detectedClipsRef.current;
    const ctx = promptContextRef.current;
    const curIntent = intentRef.current;
    const label = curIntent?.moodLabel || getMoodLabel(emotionRef.current);

    setProactiveThinking(true);
    try {
      const resp = await fetch('/api/llm/proactive-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          systemInstruction: cfg.systemInstruction,
          animations: clips,
          history: [...recentProactiveMsgsRef.current, ...buildHistoryFrom(messagesRef.current)].slice(-40),
          contextSummary: contextSummaryRef.current,
          temperature: cfg.temperature ?? 1.0,
          systemAddendum: ctx.systemAddendum,
          moodLabel: label,
          recentTopics: recentTopicsRef.current
        })
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.warn('[proactive-chat] API error:', resp.status, errText.slice(0, 200));
        return;
      }
      const data = await resp.json();
      if (!data?.reply) {
        console.warn('[proactive-chat] empty reply');
        return;
      }
      const emotionImpact = data?.emotionImpact;
      if (emotionImpact && emotionImpact.reason) {
        // Apply through App which forwards to engine
        // We don't apply directly — engine.onProactiveSent handles expression satisfaction
      }
      if (data?.animation && clips.includes(data.animation)) {
        onTriggerAnimation(data.animation);
      }
      const aiMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: data.reply,
        animation: data?.animation || '',
        timestamp: new Date(),
        emotionImpact,
        isProactive: true
      };
      setMessages(prev => [...prev, aiMsg]);
      lastProactiveMessageIdRef.current = aiMsg.id;
      recentTopicsRef.current = [...recentTopicsRef.current.slice(-4), data.reply.slice(0, 30)];
      recentProactiveMsgsRef.current = [...recentProactiveMsgsRef.current.slice(-4), { role: 'assistant', content: data.reply }];
      const expectedMsgs = [...messagesRef.current, aiMsg];
      maybeCompressContext(expectedMsgs);
      if (cfg.useVoice && data.reply) {
        await playTextSpeech(data.reply, aiMsg.id);
      }
    } catch (err: any) {
      console.warn('[proactive-chat] exception:', err?.message);
    } finally {
      setProactiveThinking(false);
      lastProactiveTimeRef.current = Date.now();
      // Lower cooldown when there's an active intent (needs are high)
      const hasUrgentNeed = (intentRef.current?.urgency ?? 0) > 0.5;
      proactiveCooldownRef.current = hasUrgentNeed ? 25000 : 10000;
    }
  };
  // Store in ref so timer callback can access latest version
  const doProactiveChatRef = useRef(doProactiveChat);
  doProactiveChatRef.current = doProactiveChat;

  // Message history
  const [messages, setMessages] = useState<Message[]>(() => {
    const defaultGreetings: Message[] = [
      {
        id: 'welcome',
        sender: 'ai',
        text: '你好！我是你的 3D 虚拟人伴侣。接入并在「设置」中配置好大模型 API Key 以后，我就能根据你发给我的聊天内容，自动识别其中蕴含的语境感情，并自动执行合适的 3D 内置骨骼动画动作哦！快来试试吧。',
        timestamp: new Date()
      }
    ];
    return defaultGreetings;
  });

  const [contextSummary, setContextSummary] = useState<string>('');
  const contextSummaryRef = useRef(contextSummary);
  useEffect(() => { contextSummaryRef.current = contextSummary; }, [contextSummary]);

  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Build conversation history from recent messages (last 20 rounds = 40 messages)
  const buildHistoryFrom = (msgs: Message[]) => {
    const conversationMsgs = msgs.filter(m => m.sender === 'user' || m.sender === 'ai');
    const recent = conversationMsgs.slice(-40);
    return recent.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }));
  };

  // Compress old messages when exceeding 20 rounds
  const maybeCompressContext = async (currentMessages: Message[]) => {
    const conversationMsgs = currentMessages.filter(m => m.sender === 'user' || m.sender === 'ai');
    if (conversationMsgs.length <= 40) return;

    const oldMessages = conversationMsgs.slice(0, conversationMsgs.length - 40);
    const cfg = configRef.current;
    try {
      const resp = await fetch('/api/llm/compress-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          messages: oldMessages.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
          contextSummary: contextSummaryRef.current
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.summary) setContextSummary(data.summary);
      }
    } catch (err) {
      console.warn('[compress] failed:', err);
    }
  };

  const messagesLenRef = useRef(messages.length);
  useEffect(() => { messagesLenRef.current = messages.length; }, [messages.length]);
  const detectedClipsRef = useRef(detectedClips);
  useEffect(() => { detectedClipsRef.current = detectedClips; }, [detectedClips]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // TTS playback logic
  const playTextSpeech = async (text: string, msgId: string) => {
    try {
      setIsPlayingAudioSafely(msgId);
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const response = await fetch('/api/llm/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
          apiKey: dashscopeApiKey
        })
      });

      if (!response.ok) {
        let errMsg = '阿里云语音合成中继请求失败';
        try {
          const errData = await response.json();
          if (errData?.error) errMsg = errData.error;
        } catch {
          const text = await response.text().catch(() => '');
          if (text) errMsg = text.slice(0, 200);
        }
        throw new Error(errMsg);
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      // Wrap audio playback in a Promise that resolves on end/error
      await new Promise<void>((resolve) => {
        audio.onended = () => {
          setIsPlayingAudioSafely(null);
          resolve();
        };
        audio.onerror = () => {
          setIsPlayingAudioSafely(null);
          resolve();
        };
        audio.play().catch(() => {
          setIsPlayingAudioSafely(null);
          resolve();
        });
      });
    } catch (err: any) {
      console.error(err);
      setIsPlayingAudioSafely(null);
      const errMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'system',
        text: `语音播放失败: ${err?.message || '未知错误'}. 请进入右上角「设置」中配置好阿里云 DASHSCOPE_API_KEY。`,
        error: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errMsg]);
    }
  };

  // Synchronize dynamic keys and config structures on provider shift
  useEffect(() => {
    localStorage.setItem('ai_provider', provider);
    const savedKey = localStorage.getItem(`ai_key_${provider}`) || '';
    setApiKey(savedKey);

    if (provider === 'gemini') {
      setBaseUrl('');
      setModel('gemini-3.5-flash');
    } else if (provider === 'deepseek') {
      setBaseUrl('https://api.deepseek.com');
      setModel('deepseek-chat');
    } else {
      const savedUrl = localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1';
      const savedModel = localStorage.getItem('ai_model') || 'gpt-4o-mini';
      setBaseUrl(savedUrl);
      setModel(savedModel);
    }
  }, [provider]);

  // Persistent save
  const handleSaveConfig = () => {
    localStorage.setItem(`ai_key_${provider}`, apiKey);
    localStorage.setItem('ai_sys_prompt', systemInstruction);
    localStorage.setItem('ai_use_voice', String(useVoice));
    localStorage.setItem('ai_dashscope_key', dashscopeApiKey);
    localStorage.setItem('ai_selected_voice', selectedVoice);
    if (provider === 'custom') {
      localStorage.setItem('ai_base_url', baseUrl);
      localStorage.setItem('ai_model', model);
    }
    setShowSettings(false);
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'new_start',
        sender: 'system',
        text: '会话上下文已重置。',
        timestamp: new Date()
      }
    ]);
    setContextSummary('');
    onResetMood();
  };

  // Scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, isProactiveThinking]);

  // Respond to mood threshold events (e.g. happiness dropped into 'very_unhappy' range)
  const prevMoodEventTrigger = useRef(moodEventTrigger);
  useEffect(() => {
    if (moodEventTrigger === 0) return; // initial mount, skip
    if (moodEventTrigger === prevMoodEventTrigger.current) return;
    prevMoodEventTrigger.current = moodEventTrigger;
    if (isTypingRef.current || isProactiveThinkingRef.current || isPlayingAudioRef.current) return;
    // Suppress proactive chats while user is actively conversing
    if (Date.now() - lastUserMessageTimeRef.current < USER_ACTIVE_SUPPRESS_MS) return;
    // Brief delay so mood state has propagated before we snapshot it
    const timer = setTimeout(() => {
      if (isTypingRef.current || isProactiveThinkingRef.current || isPlayingAudioRef.current) return;
      if (Date.now() - lastUserMessageTimeRef.current < USER_ACTIVE_SUPPRESS_MS) return;
      doProactiveChatRef.current();
    }, 300);
    return () => clearTimeout(timer);
  }, [moodEventTrigger]);

  // Proactive chat fallback timer — catches mood decay triggering when user is idle
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastProactiveTimeRef.current < proactiveCooldownRef.current) return;
      if (isTypingRef.current || isProactiveThinkingRef.current || isPlayingAudioRef.current) return;
      // Suppress proactive chats while user is actively conversing
      if (now - lastUserMessageTimeRef.current < USER_ACTIVE_SUPPRESS_MS) return;
      doProactiveChatRef.current();
    }, 10000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AI Motion Generation — send natural language to LLM, get joint rotation keyframes back
  const handleMotionGeneration = async (userText: string) => {
    const cfg = configRef.current;
    let response: Response;
    try {
      response = await fetch('/api/llm/motion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          prompt: userText,
          joints: joints.map(j => ({ id: j.id, name: j.name, parentId: j.parentId })),
          temperature: cfg.temperature ?? 0.85
        })
      });

      // Read body as text first to avoid JSON parse crashes on empty/partial responses
      const bodyText = await response.text();

      let data: any;
      try {
        data = JSON.parse(bodyText);
      } catch {
        throw new Error(`服务端返回了无效 JSON (HTTP ${response.status}): ${bodyText.slice(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(data?.error || `AI 动作生成请求失败 (HTTP ${response.status})`);
      }

      const keyframes: KeyframeData[] = (data.keyframes || []).map((kf: any) => ({
        frame: kf.frame,
        rotations: kf.rotations || {}
      }));

      if (keyframes.length === 0) {
        throw new Error('AI 未返回有效的关键帧数据');
      }

      // Push keyframes to timeline and start playback
      onMotionGenerated(keyframes);
      setTimeout(() => onSetPlaying(true), 200);

      return {
        description: data.description || userText,
        keyframes
      };
    } catch (err: any) {
      throw err;
    }
  };

  // Handle game answer — evaluate the user's response and advance game state
  const handleGameAnswer = async (answer: string) => {
    const game = activeGameRef.current;
    if (!game) return;

    setTyping(true);
    try {
      const cfg = configRef.current;
      const resp = await fetch('/api/llm/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'evaluate',
          gameType: game.gameType,
          userAnswer: answer,
          storySoFar: game.storySoFar,
          round: game.round,
          maxRounds: game.maxRounds,
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          promptContext: promptContextRef.current,
          temperature: cfg.temperature ?? 0.95,
        }),
      });
      if (!resp.ok) throw new Error('Game API failed');
      const data = await resp.json();
      const result: GameResult = data.gameResult;

      const resultMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: result.aiResponse,
        timestamp: new Date(),
        gameResult: result,
      };
      setMessages(prev => [...prev, resultMsg]);

      if (result.isComplete) {
        onGameComplete(result);
      } else {
        const nextGame: GamePrompt = {
          ...game,
          storySoFar: `${game.storySoFar || ''}\n用户: ${answer}\nAI: ${result.aiResponse}`,
          round: (game.round || 1) + 1,
        };
        onGameStart(nextGame);
      }
    } catch (err) {
      console.warn('[game] error:', err);
      onGameComplete({ gameType: game.gameType, emotionImpact: { reason: '' }, aiResponse: '', isComplete: true });
    } finally {
      setTyping(false);
    }
  };

  // Handle LLM API query (chat or motion generation)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isTyping) return;

    const userText = inputMessage.trim();
    setInputMessage('');

    // Append user message immediately
    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userText,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setTyping(true);

    // Record user interaction — satisfies needs, shifts emotions
    onUserMessage(userText);
    pendingAbandonmentCheckRef.current = false;

    // Reset proactive cooldown since user is actively chatting
    lastProactiveTimeRef.current = Date.now();
    lastUserMessageTimeRef.current = Date.now();

    // Branch: motion generation mode
    if (motionMode) {
      try {
        const result = await handleMotionGeneration(userText);

        const aiMsg: Message = {
          id: crypto.randomUUID(),
          sender: 'ai',
          text: `已生成动作「${result.description}」共 ${result.keyframes.length} 个关键帧，已写入时间轴并开始播放。`,
          timestamp: new Date(),
          motionKeyframes: result.keyframes,
          motionDescription: result.description
        };
        setMessages(prev => [...prev, aiMsg]);
      } catch (err: any) {
        const errMsg: Message = {
          id: crypto.randomUUID(),
          sender: 'system',
          text: `AI 动作生成失败: ${err?.message || '未知错误'}`,
          error: true,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errMsg]);
      } finally {
        setTyping(false);
      }
      return;
    }

    // Normal chat mode
    try {
      const response = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider,
          apiKey,
          baseUrl,
          model,
          systemInstruction,
          prompt: userText,
          animations: detectedClips,
          systemAddendum: promptContextRef.current.systemAddendum,
          history: buildHistoryFrom([...messages, userMsg]),
          contextSummary: contextSummaryRef.current,
          temperature: configRef.current.temperature ?? 0.9
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData?.error || '接口请求失败');
      }

      const resData = await response.json();

      const aiReply = resData?.reply || '没有给出有效的文字回复。';
      const triggeredAnim = resData?.animation || '';
      const emotionImpact = resData?.emotionImpact;

      // Append AI response
      const aiMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: aiReply,
        animation: triggeredAnim,
        timestamp: new Date(),
        emotionImpact,
      };
      setMessages(prev => [...prev, aiMsg]);
      const expectedMessages = [...messages, userMsg, aiMsg];
      maybeCompressContext(expectedMessages);

      // TTS voice playback triggering if enabled
      if (useVoice && aiReply) {
        playTextSpeech(aiReply, aiMsg.id);
      }

      // If animation was detected and exists in available clips, play it
      if (triggeredAnim && detectedClips.includes(triggeredAnim)) {
        onTriggerAnimation(triggeredAnim);
      }

      // Check if we should offer a game (low emotion + user engaging + 35% chance)
      const currentEmotion = emotionRef.current;
      const hasLowMood = currentEmotion.valence < -0.1 || currentEmotion.arousal < -0.2;
      if (hasLowMood && !activeGameRef.current && Math.random() < 0.35) {
        const gameType: import('../types').GameType = currentEmotion.tension > 0.4 ? 'guess_mood'
          : currentEmotion.arousal < -0.25 ? 'two_choice'
          : 'chain_story';
        try {
          const gameResp = await fetch('/api/llm/game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'start',
              gameType,
              provider,
              apiKey,
              baseUrl,
              model,
              promptContext: promptContextRef.current,
              history: buildHistoryFrom([...messages, userMsg, aiMsg]),
              contextSummary: contextSummaryRef.current,
              temperature: configRef.current.temperature ?? 0.95,
            })
          });
          if (gameResp.ok) {
            const gameData = await gameResp.json();
            if (gameData?.gamePrompt) {
              const gameMsg: Message = {
                id: crypto.randomUUID(),
                sender: 'ai',
                text: gameData.gamePrompt.question,
                timestamp: new Date(),
                gamePrompt: gameData.gamePrompt,
              };
              setMessages(prev => [...prev, gameMsg]);
              onGameStart(gameData.gamePrompt);
              setTyping(false);
              return; // Game is now active, skip normal proactive timeout
            }
          }
        } catch { /* fall through to normal flow */ }
      }

    } catch (err: any) {
      console.error(err);
      const errMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'system',
        text: `调用大模型出错: ${err?.message || '未知错误'}. 请点开右上角「设置」检查 API Key 与代理端点设置是否正确。`,
        error: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setTyping(false);
      // Proactive chats after user messages are now handled by the mood-aware timer
      // and mood event triggers, which respect the USER_ACTIVE_SUPPRESS_MS cooldown.
      // This prevents the "double dialogue" pattern where the AI would respond to
      // the user and then immediately fire a second proactive message.
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#08101c]/90 border border-slate-800/80 rounded-xl overflow-hidden shadow-2xl relative">

      {/* Mini Titlebar Header */}
      <div className="bg-[#0c1626] border-b border-slate-800 px-4 py-3 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600/20 p-1.5 rounded-lg border border-indigo-500/30">
            <Bot className="w-4 h-4 text-indigo-400 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-200 tracking-wider">交互式大模型伴侣</span>
              <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-indigo-400 uppercase font-mono tracking-widest leading-3 font-semibold">
                {provider}
              </span>
            </div>
            <span className="text-[9px] text-slate-500 font-mono">Real-time Semantic Animation Driver</span>
          </div>
        </div>

        {/* Configurations Toggler */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMotionMode(!motionMode)}
            className={`p-1.5 rounded transition cursor-pointer text-[10px] font-bold flex items-center gap-1 ${
              motionMode
                ? 'bg-emerald-600 text-white shadow shadow-emerald-600/30'
                : 'bg-slate-800 text-slate-400 hover:text-emerald-400 hover:bg-slate-700'
            }`}
            title={motionMode ? '动作生成模式：AI 直接生成关节关键帧并驱动骨骼' : '切换至 AI 动作生成模式'}
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">动作</span>
          </button>
          <button
            onClick={handleClearHistory}
            title="清空会话上下文"
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded transition cursor-pointer ${
              showSettings
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
            title="配置大模型"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mood Panel — always visible above messages */}
      <div ref={moodPanelRef} className="px-3 pt-3 pb-1 shrink-0">
        <MoodPanel
          emotion={emotion}
          needs={needs}
          intent={intent}
          abandonment={abandonment}
          abandonmentTier={abandonmentTier}
        />
      </div>

      {/* Model settings panels overlay */}
      {showSettings ? (
        <div className="flex flex-col flex-1 p-4 bg-[#0a1221] overflow-y-auto custom-scrollbar border-b border-indigo-500/10 text-xs gap-4 relative z-20">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800">
            <span className="font-bold text-slate-350 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              大模型连接参数设置
            </span>
          </div>

          {/* Provider Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold leading-relaxed">对接主控端:</label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setProvider('gemini')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium ${
                  provider === 'gemini'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Gemini
              </button>
              <button
                type="button"
                onClick={() => setProvider('deepseek')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium ${
                  provider === 'deepseek'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                DeepSeek
              </button>
              <button
                type="button"
                onClick={() => setProvider('custom')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium ${
                  provider === 'custom'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom OpenAI
              </button>
            </div>
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-400 font-semibold">API Key秘钥匙:</label>
              <button
                type="button"
                onClick={() => setShowKeySecret(!showKeySecret)}
                className="text-slate-500 hover:text-indigo-400 font-medium scale-90"
              >
                {showKeySecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <input
              type={showKeySecret ? "text" : "password"}
              className="w-full bg-[#070b13] border border-slate-800 rounded px-3 py-2 text-slate-200 font-mono tracking-wider focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-650"
              placeholder={
                provider === 'gemini'
                  ? "可以留空。默认使用服务器配置的密钥..."
                  : `输入你的 ${provider} API Key密钥`
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          {/* Custom Endpoint Base URL for Custom LLM */}
          {provider !== 'gemini' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-semibold">API 代理端点 (Base URL):</label>
              <input
                type="text"
                disabled={provider === 'deepseek'}
                className={`w-full border rounded px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                  provider === 'deepseek'
                    ? 'bg-slate-850 border-slate-800 opacity-60'
                    : 'bg-[#070b13] border-slate-800 focus:border-indigo-600'
                }`}
                placeholder="例如: https://api.deepseek.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}

          {/* Model selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold">模型代号 (Model Name):</label>
            <input
              type="text"
              disabled={provider === 'gemini' || provider === 'deepseek'}
              className={`w-full border rounded px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                provider === 'gemini' || provider === 'deepseek'
                  ? 'bg-slate-850 border-slate-800 opacity-60'
                  : 'bg-[#070b13] border-slate-800 focus:border-indigo-600'
              }`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          {/* System prompt instruction */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold">系统提示词 (System Instruction):</label>
            <textarea
              rows={4}
              className="w-full bg-[#070b13] border border-slate-800 rounded px-3 py-2 text-slate-250 leading-relaxed resize-none focus:outline-none focus:border-indigo-600"
              value={systemInstruction}
              onChange={(e) => setSystemInstruction(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between pb-1 border-b border-slate-800 mt-2">
            <span className="font-bold text-slate-350 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              阿里云 TTS 语音设定 (qwen3-tts-flash)
            </span>
          </div>

          {/* Toggle Voice play */}
          <div className="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/40">
            <div className="flex flex-col">
              <span className="text-slate-300 font-semibold">自动语音播报 (TTS)</span>
              <span className="text-[10px] text-slate-500">AI回复后自动转换为语音合成发音播放</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useVoice}
                onChange={(e) => setUseVoice(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-300 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white" />
            </label>
          </div>

          {/* Dashscope API Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold">阿里云 DASHSCOPE_API_KEY:</label>
            <input
              type="password"
              className="w-full bg-[#070b13] border border-slate-800 rounded px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-600"
              placeholder="留空则使用服务器端配置。格式如: sk-..."
              value={dashscopeApiKey}
              onChange={(e) => setDashscopeApiKey(e.target.value)}
            />
          </div>

          {/* Selected voice code */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold">TTS 发音音色 (Voice Speaker):</label>
            <select
              className="w-full bg-[#070b13] border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-600"
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
            >
              <option value="Cherry">Cherry / 芊悦 (阳光积极小姐姐)</option>
              <option value="Bella">Bella / 萌宝 (小萝莉)</option>
              <option value="Ethan">Ethan / 晨煦 (温暖阳光男声)</option>
              <option value="Jennifer">Jennifer / 詹妮弗 (品牌级美语女声)</option>
              <option value="Momo">Momo / 茉兔 (可爱女声)</option>
              <option value="Serena">Serena / 苏瑶 (标准女声)</option>
              <option value="Katerina">Katerina / 卡捷琳娜 (御姐音色)</option>
              <option value="Ryan">Ryan / 甜茶 (戏感张力男声)</option>
            </select>
          </div>

          {/* Save buttons */}
          <div className="flex items-center gap-2 pt-2 justify-end">
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="px-3 py-1.5 rounded hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-500 transition cursor-pointer shadow shadow-indigo-600/30"
            >
              保存参数
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Messages layout pane */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar min-h-0 bg-[#060a12]/60">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  msg.sender === 'user'
                    ? 'self-end items-end'
                    : msg.sender === 'system'
                    ? 'self-center w-full text-center'
                    : 'self-start items-start'
                }`}
              >

                {/* sender name details */}
                <div className="flex items-center gap-1.5 mb-1 select-none text-[10px] text-slate-500 font-mono">
                  {msg.sender === 'user' ? (
                    <>
                      <span>You</span>
                      <User className="w-3 h-3 text-slate-600" />
                    </>
                  ) : msg.sender === 'system' ? (
                    <span className="text-[9px] bg-slate-900 border border-slate-850 px-2 py-0.5 rounded text-amber-500/70">
                      系统通知
                    </span>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-indigo-500" />
                      <span className="font-semibold text-indigo-400">
                        {msg.isProactive ? `Companion (${getMoodEmoji(getMoodLabel(emotion))})` : 'Companion Avatar'}
                      </span>
                      {msg.isProactive && (
                        <span className="text-[8px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded font-mono">
                          主动
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* message bubble frame */}
                <div className="flex items-start gap-1.5">
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-full ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-indigo-50 rounded-tr-none shadow-md shadow-indigo-600/5'
                        : msg.sender === 'system'
                        ? msg.error
                          ? 'bg-red-500/10 border border-red-500/30 text-red-300 w-full rounded-lg text-left font-mono'
                          : 'bg-slate-850/30 border border-slate-800 text-slate-400 rounded-lg text-center'
                        : msg.isProactive
                        ? 'bg-amber-500/10 border border-amber-500/20 text-slate-100 rounded-tl-none shadow'
                        : 'bg-slate-800/80 border border-slate-700/40 text-slate-100 rounded-tl-none shadow'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>

                    {/* Animation indicator tag at bottom of AI response */}
                    {msg.animation && (
                      <div className="mt-2.5 flex items-center gap-1.5 select-none bg-[#090f19] border border-indigo-500/20 rounded px-2 py-1 text-[10px] font-mono text-indigo-300 self-start">
                        <Film className="w-3 h-3 text-indigo-400" />
                        <span>驱动骨络动画:</span>
                        <strong className="text-indigo-200">{msg.animation}</strong>
                      </div>
                    )}

                    {/* AI Motion Generation keyframes indicator */}
                    {msg.motionKeyframes && msg.motionKeyframes.length > 0 && (
                      <div className="mt-2.5 flex flex-col gap-1 select-none bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1.5 text-[10px] font-mono text-emerald-300 self-start">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-3 h-3 text-emerald-400" />
                          <span>AI 生成动作:</span>
                          <strong className="text-emerald-200">{msg.motionDescription || '自定义动作'}</strong>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {msg.motionKeyframes.map((kf, i) => {
                            const jointCount = Object.keys(kf.rotations).length;
                            return (
                              <span key={i} className="bg-emerald-950/60 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[9px] text-emerald-400">
                                帧{kf.frame}({jointCount}关节)
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Emotion impact indicator */}
                    {msg.emotionImpact && msg.emotionImpact.reason && (
                      <div className="mt-1.5 flex items-center gap-1.5 select-none text-[9px] text-slate-500 font-mono">
                        <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                        <span>情绪变化: </span>
                        {msg.emotionImpact.valence !== undefined && (
                          <span className={msg.emotionImpact.valence > 0 ? 'text-emerald-400' : 'text-red-400'}>
                            愉悦{msg.emotionImpact.valence > 0 ? '+' : ''}{Math.round(msg.emotionImpact.valence * 100)}
                          </span>
                        )}
                        {msg.emotionImpact.arousal !== undefined && (
                          <span className={msg.emotionImpact.arousal > 0 ? 'text-emerald-400' : 'text-blue-400'}>
                            唤醒{msg.emotionImpact.arousal > 0 ? '+' : ''}{Math.round(msg.emotionImpact.arousal * 100)}
                          </span>
                        )}
                        {msg.emotionImpact.tension !== undefined && (
                          <span className={msg.emotionImpact.tension > 0 ? 'text-red-400' : 'text-emerald-400'}>
                            紧张{msg.emotionImpact.tension > 0 ? '+' : ''}{Math.round(msg.emotionImpact.tension * 100)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual Audio playback trigger button for AI responses */}
                  {msg.sender === 'ai' && (
                    <button
                      type="button"
                      onClick={() => playTextSpeech(msg.text, msg.id)}
                      className={`p-1.5 rounded-lg border border-slate-850 bg-slate-900 transition flex items-center justify-center shrink-0 hover:bg-slate-800 hover:text-white cursor-pointer ${
                        isPlayingAudio === msg.id
                          ? 'text-emerald-400 border-emerald-500/30 animate-pulse'
                          : 'text-slate-500'
                      }`}
                      title="重读/播放此回复语音"
                    >
                      <Volume2 className={`w-3.5 h-3.5 ${isPlayingAudio === msg.id ? 'scale-110' : ''}`} />
                    </button>
                  )}
                </div>

              </div>
            ))}

            {/* AI typing state loader */}
            {isTyping && (
              <div className="self-start flex flex-col items-start max-w-[80%]">
                <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-500 font-mono">
                  <Bot className="w-3 h-3 text-indigo-500 animate-spin" />
                  <span>AI正在语义分析并生成动作...</span>
                </div>
                <div className="bg-slate-850/40 border border-slate-800 px-4 py-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Proactive chat thinking indicator */}
            {isProactiveThinking && (
              <div className="self-start flex flex-col items-start max-w-[80%]">
                <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-500 font-mono">
                  <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
                  <span>角色正在感应心情变化...</span>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 px-4 py-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick list of available animations with fast triggers */}
          <div className="px-4 py-2 bg-[#09101c]/50 border-t border-b border-slate-800/60 select-none shrink-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span className="flex items-center gap-1.5">
                <Film className="w-3 h-3 text-emerald-400" />
                内置原生骨片动作 ({detectedClips.length})
              </span>
              <span>点击直接测试预览</span>
            </div>
            {detectedClips.length > 0 ? (
              <div className="flex flex-wrap gap-1 max-h-[72px] overflow-y-auto custom-scrollbar">
                {detectedClips.map((clip) => (
                  <button
                    key={clip}
                    onClick={() => onTriggerAnimation(clip)}
                    className="bg-[#0b1626] border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-300 hover:bg-indigo-600/30 hover:border-indigo-500 hover:text-white transition cursor-pointer"
                  >
                    {clip}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 italic">检测到当前载入的模型中未承载内置骨骼动作序列。</p>
            )}
          </div>

          {/* Game UI — replaces normal input when game is active */}
          {activeGame ? (
            <div className="p-3 bg-[#0a1221] border-t border-slate-800 shrink-0 relative z-10 select-none">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-emerald-400 font-mono flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  {activeGame.gameType === 'guess_mood' ? '🎭 猜心情' : activeGame.gameType === 'two_choice' ? '🎯 二选一' : '📝 接龙故事'}
                </span>
                <button
                  onClick={() => onGameComplete({ gameType: activeGame.gameType, emotionImpact: { reason: '跳过游戏' }, aiResponse: '', isComplete: true })}
                  className="text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  跳过游戏
                </button>
              </div>
              {(activeGame.gameType === 'guess_mood' || activeGame.gameType === 'two_choice') && activeGame.options ? (
                <div className="flex flex-wrap gap-1.5">
                  {activeGame.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => handleGameAnswer(opt)}
                      disabled={isTyping}
                      className="bg-[#060a12] border border-emerald-700/40 rounded-lg px-3 py-2 text-xs text-slate-100 hover:bg-emerald-600/20 hover:border-emerald-500 disabled:opacity-50 transition cursor-pointer"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : activeGame.gameType === 'chain_story' ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (inputMessage.trim()) { handleGameAnswer(inputMessage.trim()); setInputMessage(''); } }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    disabled={isTyping}
                    className="flex-1 bg-[#060a12] border border-emerald-700/40 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                    placeholder={`续写故事 (第${activeGame.round || 1}/${activeGame.maxRounds || 3}轮)...`}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || isTyping}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-emerald-50 px-3.5 py-2 rounded-lg flex items-center justify-center transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            /* Normal chat input */
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-[#0a1221] border-t border-slate-800 shrink-0 flex gap-2 relative z-10 select-none"
            >
              <input
                type="text"
                disabled={isTyping}
                className="flex-1 bg-[#060a12] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-600 disabled:opacity-50"
                placeholder={
                  motionMode
                    ? "描述你想让角色做的动作，如：挥动右手、跳个舞、鞠躬..."
                    : detectedClips.length > 0
                      ? "发个消息，让 AI 依据上下文自动匹配动画动作..."
                      : "当前模型无动画，AI 仅进行普通文本交互..."
                }
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || isTyping}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-indigo-50 px-3.5 py-2 rounded-lg flex items-center justify-center transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </>
      )}

    </div>
  );
}
