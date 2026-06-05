import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Bot, Send, Settings, Sparkles, AlertCircle, RefreshCw, Eye, EyeOff, User, Film, HelpCircle, Sliders, Play, Trash2, Volume2, VolumeX, Heart } from 'lucide-react';
import {
  EmotionEngine,
  perceiveFromText,
  buildEmotionContext,
  injectToSystemPrompt,
  pickAnimationByEmotion,
  PERSONALITY_PRESETS,
  findClosestEmotionLabel,
} from '../emotion';
import type { EmotionContext, EmotionPersonality } from '../types';

interface LLMConfig {
  provider: 'gemini' | 'deepseek' | 'qwen' | 'custom';
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
  isProactive?: boolean;
}

interface LLMCompanionProps {
  detectedClips: string[];
  onTriggerAnimation: (clipName: string) => void;
  onStateChange?: (state: { latestReply: string | null; isTyping: boolean; isProactiveThinking: boolean }) => void;
}

const DEFAULT_SYSTEM_INSTRUCTION = "你是一个三维手办伴侣、陪伴小精灵。用拟人化、简短的语气与用户互动，每次回答控制在100字以内。";

// 挂机时间阈值：5分钟无用户交互后进入idle状态
const IDLE_TIMEOUT = 1 * 60 * 1000; // 300000ms

export default function LLMCompanion({
  detectedClips,
  onTriggerAnimation,
  onStateChange
}: LLMCompanionProps) {
  // Stored state settings
  const [provider, setProvider] = useState<'gemini' | 'deepseek' | 'qwen' | 'custom'>(() => {
    return (localStorage.getItem('ai_provider') as 'gemini' | 'deepseek' | 'qwen' | 'custom') || 'gemini';
  });

  const [apiKey, setApiKey] = useState(() => {
    const saved = localStorage.getItem(`ai_key_${provider}`);
    if (saved) return saved;
    if (provider === 'qwen') return 'sk-a16630bdca2841cbb25a974a934e35e6';
    return '';
  });

  const [baseUrl, setBaseUrl] = useState(() => {
    if (provider === 'gemini') return '';
    if (provider === 'deepseek') return 'https://api.deepseek.com';
    if (provider === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    return localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1';
  });

  const [model, setModel] = useState(() => {
    if (provider === 'gemini') return 'gemini-3.5-flash';
    if (provider === 'deepseek') return 'deepseek-v4-flash';
    if (provider === 'qwen') return 'qwen-max';
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

  // ========== Emotion Engine ==========
  const emotionEngineRef = useRef<EmotionEngine | null>(null);
  const [emotionContext, setEmotionContext] = useState<EmotionContext | null>(null);
  const [emotionLabel, setEmotionLabel] = useState<string>('neutral');
  const [emotionPersonality, setEmotionPersonality] = useState<EmotionPersonality>(() => {
    const saved = localStorage.getItem('ai_emotion_personality');
    if (saved) {
      try { return JSON.parse(saved) as EmotionPersonality; } catch { /* ignore */ }
    }
    return PERSONALITY_PRESETS.cheerful;
  });

  // 初始化 / 恢复 EmotionEngine
  useEffect(() => {
    const engine = new EmotionEngine(emotionPersonality);
    const savedState = localStorage.getItem('ai_emotion_state');
    if (savedState) {
      engine.deserialize(savedState);
    }
    emotionEngineRef.current = engine;
    engine.start(1000);

    // 初始情绪上下文
    setEmotionContext(buildEmotionContext(engine.state));
    setEmotionLabel(findClosestEmotionLabel(engine.state.current));

    // 定时更新 UI 中的情绪显示
    const uiUpdater = setInterval(() => {
      if (emotionEngineRef.current) {
        setEmotionContext(buildEmotionContext(emotionEngineRef.current.state));
        setEmotionLabel(findClosestEmotionLabel(emotionEngineRef.current.state.current));
      }
    }, 5000);

    return () => {
      engine.stop();
      clearInterval(uiUpdater);
      // 持久化
      localStorage.setItem('ai_emotion_state', engine.serialize());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 人格切换时重新初始化引擎
  useEffect(() => {
    if (emotionEngineRef.current) {
      emotionEngineRef.current.setPersonality(emotionPersonality, true);
      setEmotionContext(buildEmotionContext(emotionEngineRef.current.state));
      setEmotionLabel(findClosestEmotionLabel(emotionEngineRef.current.state.current));
      localStorage.setItem('ai_emotion_personality', JSON.stringify(emotionPersonality));
      localStorage.setItem('ai_emotion_state', emotionEngineRef.current.serialize());
    }
  }, [emotionPersonality]);

  const [isPlayingAudio, setIsPlayingAudio] = useState<string | null>(null);

  // UI state managers
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showKeySecret, setShowKeySecret] = useState<boolean>(false);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);

  // Proactive chat state
  const [isProactiveThinking, setIsProactiveThinking] = useState<boolean>(false);
  const lastProactiveTimeRef = useRef<number>(0);
  const lastUserActivityRef = useRef<number>(Date.now()); // 记录最后一次用户交互时间

  // Stable refs for config values and states needed in timer callbacks
  const configRef = useRef({ provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice });
  useEffect(() => {
    configRef.current = { provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice };
  }, [provider, apiKey, baseUrl, model, systemInstruction, useVoice, dashscopeApiKey, selectedVoice]);

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

  const messagesLenRef = useRef(messages.length);
  useEffect(() => { messagesLenRef.current = messages.length; }, [messages.length]);
  const detectedClipsRef = useRef(detectedClips);
  useEffect(() => { detectedClipsRef.current = detectedClips; }, [detectedClips]);

  const isTypingRef = useRef(isTyping);
  useEffect(() => { isTypingRef.current = isTyping; }, [isTyping]);

  const isProactiveThinkingRef = useRef(isProactiveThinking);
  useEffect(() => { isProactiveThinkingRef.current = isProactiveThinking; }, [isProactiveThinking]);

  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Find latest AI reply text for 3D Space speech bubble
  const latestReply = useMemo(() => {
    const aiMsgs = messages.filter(m => m.sender === 'ai');
    return aiMsgs.length > 0 ? aiMsgs[aiMsgs.length - 1].text : null;
  }, [messages]);

  // Synthesis engine for clean soft feedback chime
  const playSoftSynthChime = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      
      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Soft synth tone generator helper
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; // Warm organic base
        osc.frequency.setValueAtTime(freq, startTime);

        // Lowpass filter to avoid abrasive digital harmonics
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 1.5, startTime);
        filter.Q.setValueAtTime(0.8, startTime);

        // Amplitude gain envelope (Soft attack + Exponential decay)
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.06, startTime + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        // Connect graph
        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      // Play soft arpeggiator (E-major Pentatonic scale segment)
      playTone(659.25, now, 1.0);        // E5
      playTone(880.00, now + 0.08, 0.9);   // A5
      playTone(1109.73, now + 0.16, 0.82); // C#6
      playTone(1318.51, now + 0.24, 0.7);  // E6

    } catch (e) {
      console.warn('Web Audio playback failed or blocked by autoplay restrictions:', e);
    }
  }, []);

  // Monitor when a new AI message ID is received to trigger audio cue
  const lastPlayedAiMsgRef = useRef<string | null>(null);
  useEffect(() => {
    const aiMsgs = messages.filter(m => m.sender === 'ai');
    if (aiMsgs.length > 0) {
      const latestAi = aiMsgs[aiMsgs.length - 1];
      // Skip playing for the initial welcome message, and don't re-trigger for same msg ID
      if (latestAi.id !== 'welcome' && latestAi.id !== lastPlayedAiMsgRef.current) {
        lastPlayedAiMsgRef.current = latestAi.id;
        playSoftSynthChime();
      }
    }
  }, [messages, playSoftSynthChime]);

  // Bubble up current state for 3D Viewport presentation
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        latestReply,
        isTyping,
        isProactiveThinking
      });
    }
  }, [latestReply, isTyping, isProactiveThinking, onStateChange]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // TTS playback logic
  const playTextSpeech = async (text: string, msgId: string) => {
    try {
      setIsPlayingAudio(msgId);
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
        const errText = await response.text();
        let errMsg = '阿里云语音合成中继请求失败';
        try {
          const parsedErr = JSON.parse(errText);
          errMsg = parsedErr?.error || errMsg;
        } catch {
          errMsg = errText || `HTTP 错误 ${response.status}`;
        }
        throw new Error(errMsg);
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlayingAudio(null);
      };
      audio.onerror = () => {
        setIsPlayingAudio(null);
      };
      await audio.play();
    } catch (err: any) {
      console.error(err);
      setIsPlayingAudio(null);
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
    let savedKey = localStorage.getItem(`ai_key_${provider}`) || '';
    if (!savedKey && provider === 'qwen') {
      savedKey = 'sk-a16630bdca2841cbb25a974a934e35e6';
      localStorage.setItem(`ai_key_${provider}`, savedKey);
    }
    setApiKey(savedKey);

    if (provider === 'gemini') {
      setBaseUrl('');
      setModel('gemini-3.5-flash');
    } else if (provider === 'deepseek') {
      setBaseUrl('https://api.deepseek.com');
      setModel('deepseek-chat');
    } else if (provider === 'qwen') {
      setBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
      setModel('qwen-max');
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
    if (provider === 'custom' || provider === 'qwen') {
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
  };

  // Scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, isProactiveThinking]);

  // Proactive chat timer — check every 30 seconds for idle state
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (isTypingRef.current || isProactiveThinkingRef.current) return;

      // 检查用户是否处于idle状态（超过IDLE_TIMEOUT时间无交互）
      const isIdle = now - lastUserActivityRef.current >= IDLE_TIMEOUT;
      if (!isIdle) return;

      // 每次触发前至少间隔30秒（防止过于频繁）
      if (now - lastProactiveTimeRef.current < 30000) return;

      lastProactiveTimeRef.current = now;

      const clips = detectedClipsRef.current;
      const cfg = configRef.current;

      // 使用情绪驱动的主动发言等级，而非固定阈值
      const ctx = emotionEngineRef.current
        ? buildEmotionContext(emotionEngineRef.current.state)
        : null;
      const proactivity = ctx?.proactivityLevel ?? 0.3;

      // 低于阈值则跳过此次主动发言
      if (proactivity < 0.15) return;

      // 心情低落 + 高唤醒 → 缩短间隔（更频繁寻求互动）
      const minInterval = proactivity > 0.6 ? 15000 : 30000;
      if (now - lastProactiveTimeRef.current < minInterval) return;

      const emotionPrompt = ctx
        ? injectToSystemPrompt(cfg.systemInstruction, ctx)
        : cfg.systemInstruction;

      const historyPayload = messagesRef.current
        .filter(msg => msg.sender === 'user' || msg.sender === 'ai')
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'model',
          text: msg.text
        }));

      (async () => {
        setIsProactiveThinking(true);
        try {
          const resp = await fetch('/api/llm/proactive-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: cfg.provider,
              apiKey: cfg.apiKey,
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              systemInstruction: emotionPrompt,
              animations: clips,
              emotionContext: ctx?.padDescription ?? '',
              history: historyPayload,
            })
          });
          if (!resp.ok) return;
          const respText = await resp.text();
          let data: any = null;
          try {
            data = JSON.parse(respText);
          } catch {
            data = { reply: respText || '...', animation: '' };
          }
          if (data?.animation && clips.includes(data.animation)) {
            onTriggerAnimation(data.animation);
          }
          const aiMsg: Message = {
            id: crypto.randomUUID(),
            sender: 'ai',
            text: data?.reply || '...',
            animation: data?.animation || '',
            timestamp: new Date(),
            isProactive: true
          };
          setMessages(prev => [...prev, aiMsg]);
          if (cfg.useVoice && data?.reply) {
            playTextSpeech(data.reply, aiMsg.id);
          }
        } catch (_) { /* silent */ }
        finally { setIsProactiveThinking(false); }
      })();
    }, 30000); // 每30秒检查一次
    return () => clearInterval(interval);
    // Stable deps — all dynamic values read via refs to avoid restarting the interval
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle LLM API query
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isTyping) return;

    const userText = inputMessage.trim();
    setInputMessage('');

    // 更新最后用户活动时间
    lastUserActivityRef.current = Date.now();

    // 情绪感知：分析用户输入
    const emotionEvent = perceiveFromText(userText);
    if (emotionEvent && emotionEngineRef.current) {
      emotionEngineRef.current.applyEvent(emotionEvent);
      emotionEngineRef.current.recordSnapshot(emotionEvent.label);
    }

    // 生成带情绪上下文的 system prompt
    const currentEmotionCtx = emotionEngineRef.current
      ? buildEmotionContext(emotionEngineRef.current.state)
      : null;
    const emotionPrompt = currentEmotionCtx
      ? injectToSystemPrompt(systemInstruction, currentEmotionCtx)
      : systemInstruction;

    // Append user message immediately
    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userText,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    const historyPayload = messages
      .filter(msg => msg.sender === 'user' || msg.sender === 'ai')
      .map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        text: msg.text
      }));

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
          systemInstruction: emotionPrompt,
          prompt: userText,
          animations: detectedClips,
          history: historyPayload,
        })
      });

      const responseText = await response.text();
      let resData: any = null;

      if (!response.ok) {
        let errMsg = '接口请求失败';
        try {
          const parsedErr = JSON.parse(responseText);
          errMsg = parsedErr?.error || errMsg;
        } catch {
          errMsg = responseText || `HTTP 错误 ${response.status}`;
        }
        throw new Error(errMsg);
      }

      try {
        resData = JSON.parse(responseText);
      } catch {
        resData = {
          reply: responseText || '没有给出有效的文字回复。',
          animation: ''
        };
      }

      const aiReply = resData?.reply || '没有给出有效的文字回复。';
      const triggeredAnim = resData?.animation || '';

      // Append AI response
      const aiMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: aiReply,
        animation: triggeredAnim,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);

      // TTS voice playback triggering if enabled
      if (useVoice && aiReply) {
        playTextSpeech(aiReply, aiMsg.id);
      }

      // If animation was detected and exists in available clips, play it
      // otherwise fallback to emotion-based selection
      let finalAnim = triggeredAnim;
      if (!finalAnim || !detectedClips.includes(finalAnim)) {
        if (emotionEngineRef.current && detectedClips.length > 0) {
          finalAnim = pickAnimationByEmotion(
            detectedClips,
            emotionEngineRef.current.state.current,
          ) ?? '';
        }
      }
      if (finalAnim && detectedClips.includes(finalAnim)) {
        onTriggerAnimation(finalAnim);
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
      setIsTyping(false);
    }
  };

  // 情绪光晕颜色
  const emotionGlowColor = (() => {
    if (!emotionLabel) return '#818cf8';
    const label = emotionLabel.toLowerCase();
    if (label.includes('joy') || label.includes('excited') || label.includes('happy') || label.includes('energetic'))
      return '#fbbf24';
    if (label.includes('sad') || label.includes('angry') || label.includes('depressed') || label.includes('anxious'))
      return '#ef4444';
    if (label.includes('calm') || label.includes('relaxed') || label.includes('peaceful') || label.includes('content'))
      return '#34d399';
    return '#818cf8';
  })();

  return (
    <div className="flex flex-col h-full bg-[#08101c]/90 border border-slate-800/80 rounded-xl overflow-hidden shadow-2xl relative">

      {/* Mini Titlebar Header */}
      <div className="bg-[#0c1626] border-b border-slate-800 px-4 py-3 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600/20 p-1.5 rounded-lg border border-indigo-500/30 relative">
            <Bot className="w-4 h-4 text-indigo-400" />
            <span
              className="absolute inset-0 rounded-lg opacity-40 animate-pulse"
              style={{
                background: `radial-gradient(circle, ${emotionGlowColor} 0%, transparent 70%)`,
              }}
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-200 tracking-wider">交互式大模型伴侣</span>
              <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-indigo-400 uppercase font-mono tracking-widest leading-3 font-semibold">
                {provider}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500 font-mono">
                {emotionContext?.toneGuide?.slice(0, 30) ?? 'Semantic Animation Driver'}
              </span>
              {emotionLabel && emotionLabel !== 'neutral' && (
                <span className="text-[8px] bg-pink-500/10 text-pink-400 border border-pink-500/20 px-1 py-0 rounded font-mono flex items-center gap-0.5">
                  <Heart className="w-2 h-2" />
                  {emotionLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Configurations Toggler */}
        <div className="flex items-center gap-1.5">
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
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setProvider('gemini')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium text-[10px] text-center ${
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
                className={`py-1.5 rounded border transition cursor-pointer font-medium text-[10px] text-center ${
                  provider === 'deepseek'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                DeepSeek
              </button>
              <button
                type="button"
                onClick={() => setProvider('qwen')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium text-[10px] text-center ${
                  provider === 'qwen'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Qwen
              </button>
              <button
                type="button"
                onClick={() => setProvider('custom')}
                className={`py-1.5 rounded border transition cursor-pointer font-medium text-[10px] text-center ${
                  provider === 'custom'
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom
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
                disabled={provider === 'deepseek' || provider === 'qwen'}
                className={`w-full border rounded px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                  provider === 'deepseek' || provider === 'qwen'
                    ? 'bg-slate-850 border-slate-800 opacity-60'
                    : 'bg-[#070b13] border-slate-800 focus:border-indigo-600'
                }`}
                placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1"
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

          {/* 情绪人格选择 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-semibold flex items-center gap-1">
              <Heart className="w-3 h-3 text-pink-400" />
              情绪人格 (Emotion Personality):
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(PERSONALITY_PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEmotionPersonality(p)}
                  className={`py-1.5 rounded border transition cursor-pointer text-[10px] font-medium ${
                    emotionPersonality.name === p.name
                      ? 'bg-pink-600/25 border-pink-500 text-pink-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <span className="text-[9px] text-slate-600">
              影响情绪响应速度、恢复速度和基线情绪倾向
            </span>
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
              <option value="Cherry">Cherry (经典甜美女声)</option>
              <option value="Coco">Coco (活力女声)</option>
              <option value="Bella">Bella (温暖女声)</option>
              <option value="Diane">Diane (成熟英文女声)</option>
              <option value="Abby">Abby (温柔童声)</option>
              <option value="Eric">Eric (知性男声)</option>
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
                        {msg.isProactive ? 'Companion (主动)' : 'Companion Avatar'}
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

          {/* Form input field at bottom */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 bg-[#0a1221] border-t border-slate-800 shrink-0 flex gap-2 relative z-10 select-none"
          >
            <input
              type="text"
              disabled={isTyping}
              className="flex-1 bg-[#060a12] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-600 disabled:opacity-50"
              placeholder={
                detectedClips.length > 0
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
        </>
      )}

    </div>
  );
}
