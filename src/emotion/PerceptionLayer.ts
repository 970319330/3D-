import type { EmotionEvent, EmotionVector } from '../types';
import { EMOTION_PRESETS } from './EmotionPresets';

/**
 * 情感关键词词典 — 快速本地匹配，无需调 LLM
 * 每条规则：(关键词列表, PAD 偏移, 衰减系数, 情绪标签)
 */

interface KeywordRule {
  keywords: string[];
  delta: EmotionVector;
  decay: number;
  label: string;
}

const POSITIVE_EMOJIS = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const NEGATIVE_EMOJIS = /[\u{1F620}-\u{1F62F}\u{1F630}-\u{1F63F}\u{1F640}-\u{1F64F}\u{1F494}]/u;

const RULES: KeywordRule[] = [
  // ===== 正面高唤醒 =====
  {
    keywords: ['哈哈', '哈哈哈', '笑死', '太好笑了', '逗死', '笑死我了'],
    delta: { pleasure: 0.35, arousal: 0.40, dominance: 0.10 },
    decay: 0.6,
    label: '开心',
  },
  {
    keywords: ['太棒', '厉害', '牛', '牛逼', '好强', '佩服', '赞', '优秀'],
    delta: { pleasure: 0.30, arousal: 0.30, dominance: 0.05 },
    decay: 0.5,
    label: '赞赏',
  },
  {
    keywords: ['兴奋', '激动', '期待', '期待ing', '迫不及待'],
    delta: { pleasure: 0.35, arousal: 0.50, dominance: 0.05 },
    decay: 0.4,
    label: '兴奋',
  },

  // ===== 正面低唤醒 =====
  {
    keywords: ['舒服', '好惬意', '巴适', '安逸', '享受'],
    delta: { pleasure: 0.25, arousal: -0.20, dominance: 0.10 },
    decay: 0.5,
    label: '舒适',
  },
  {
    keywords: ['谢谢', '感谢', '感激', '感恩', '多谢'],
    delta: { pleasure: 0.30, arousal: 0.05, dominance: -0.10 },
    decay: 0.5,
    label: '感激',
  },
  {
    keywords: ['喜欢', '好可爱', '可爱', '好喜欢', '爱了'],
    delta: { pleasure: 0.30, arousal: 0.20, dominance: -0.05 },
    decay: 0.45,
    label: '喜爱',
  },

  // ===== 负面高唤醒 =====
  {
    keywords: ['气死', '太气了', '愤怒', '生气', '火大', '离谱'],
    delta: { pleasure: -0.30, arousal: 0.45, dominance: 0.25 },
    decay: 0.5,
    label: '愤怒',
  },
  {
    keywords: ['焦虑', '紧张', '担心', '好怕', '害怕', '怎么办'],
    delta: { pleasure: -0.25, arousal: 0.40, dominance: -0.40 },
    decay: 0.6,
    label: '焦虑',
  },
  {
    keywords: ['烦', '烦死', '烦死了', '好烦', '别吵', '受不了', '够了'],
    delta: { pleasure: -0.30, arousal: 0.30, dominance: 0.15 },
    decay: 0.55,
    label: '烦躁',
  },

  // ===== 负面低唤醒 =====
  {
    keywords: ['难过', '伤心', '哭', '好难受', '想哭', '泪目', '破防'],
    delta: { pleasure: -0.40, arousal: -0.15, dominance: -0.30 },
    decay: 0.6,
    label: '悲伤',
  },
  {
    keywords: ['无聊', '没意思', '无聊死', '没劲', '提不起劲'],
    delta: { pleasure: -0.15, arousal: -0.45, dominance: -0.10 },
    decay: 0.7,
    label: '无聊',
  },
  {
    keywords: ['孤独', '寂寞', '没人理我', '一个人'],
    delta: { pleasure: -0.25, arousal: -0.20, dominance: -0.35 },
    decay: 0.6,
    label: '孤独',
  },
  {
    keywords: ['累', '好累', '累了', '困', '好困', '疲惫', '没精力'],
    delta: { pleasure: -0.10, arousal: -0.50, dominance: -0.25 },
    decay: 0.65,
    label: '疲惫',
  },

  // ===== 中性/好奇 =====
  {
    keywords: ['好奇', '想知道', '为什么', '是什么', '怎么回事', '啥意思'],
    delta: { pleasure: 0.10, arousal: 0.25, dominance: 0.10 },
    decay: 0.4,
    label: '好奇',
  },
  {
    keywords: ['你好', '嗨', '早', '晚上好', 'hello', 'hi'],
    delta: { pleasure: 0.15, arousal: 0.10, dominance: 0.05 },
    decay: 0.3,
    label: '友好问候',
  },
  {
    keywords: ['晚安', '拜拜', '再见', 'bye', '先走了'],
    delta: { pleasure: 0.05, arousal: -0.15, dominance: 0.05 },
    decay: 0.5,
    label: '告别',
  },
  {
    keywords: ['对不起', '抱歉', '不好意思'],
    delta: { pleasure: -0.10, arousal: -0.10, dominance: -0.25 },
    decay: 0.45,
    label: '抱歉',
  },
  {
    keywords: ['？', '?'],
    delta: { pleasure: 0.00, arousal: 0.15, dominance: -0.05 },
    decay: 0.3,
    label: '疑问',
  },
];

/**
 * 本地关键词感知：分析用户输入，返回 EmotionEvent
 */
export function perceiveFromText(input: string): EmotionEvent | null {
  const text = input.trim();
  if (!text) return null;

  let bestMatch: KeywordRule | null = null;
  let bestScore = 0;

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        // 关键词越长匹配越准
        const score = kw.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = rule;
        }
      }
    }
  }

  // Emoji 辅助判断
  let emojiDelta: EmotionVector = { pleasure: 0, arousal: 0, dominance: 0 };
  if (POSITIVE_EMOJIS.test(text)) {
    emojiDelta = { pleasure: 0.15, arousal: 0.20, dominance: 0.05 };
  }
  if (NEGATIVE_EMOJIS.test(text)) {
    emojiDelta.pleasure -= 0.15;
    emojiDelta.arousal += 0.10;
    emojiDelta.dominance -= 0.05;
  }

  // 感叹号密度 → 唤醒度修正
  const exclaimRatio = (text.match(/[!！]/g) ?? []).length / Math.max(1, text.length);
  if (exclaimRatio > 0.05) {
    emojiDelta.arousal += 0.15;
  }

  // 省略号 → 低唤醒
  if (text.includes('...') || text.includes('…')) {
    emojiDelta.arousal -= 0.10;
  }

  // 句子长度影响支配度：长句 → 更低支配（更认真/更不自信）
  if (text.length > 100) {
    emojiDelta.dominance -= 0.10;
  }

  if (bestMatch) {
    return {
      type: 'user_message',
      vectorDelta: {
        pleasure: bestMatch.delta.pleasure + emojiDelta.pleasure,
        arousal: bestMatch.delta.arousal + emojiDelta.arousal,
        dominance: bestMatch.delta.dominance + emojiDelta.dominance,
      },
      decay: bestMatch.decay,
      label: bestMatch.label,
    };
  }

  // 无关键词匹配但有 emoji 或标点信号
  if (Math.abs(emojiDelta.pleasure) > 0.05 || Math.abs(emojiDelta.arousal) > 0.05) {
    return {
      type: 'user_message',
      vectorDelta: emojiDelta,
      decay: 0.5,
      label: '语气感知',
    };
  }

  // 无匹配 → 极微弱的正面偏移（用户主动说话说明有兴趣）
  return {
    type: 'user_message',
    vectorDelta: { pleasure: 0.02, arousal: 0.05, dominance: 0.02 },
    decay: 0.3,
    label: '互动',
  };
}

/**
 * 创建系统事件（非用户消息触发）
 */
export function createSystemEvent(
  eventType: EmotionEvent['type'],
  label: string,
  delta: Partial<EmotionVector>,
  decay = 0.5,
): EmotionEvent {
  return {
    type: eventType,
    vectorDelta: {
      pleasure: delta.pleasure ?? 0,
      arousal: delta.arousal ?? 0,
      dominance: delta.dominance ?? 0,
    },
    decay,
    label,
  };
}

/**
 * 根据 LLM 返回的情绪标签覆盖感知结果（异步，由服务端回传）
 */
export function parseLLMEmotionResponse(
  json: { label?: string; pleasure?: number; arousal?: number; dominance?: number },
): EmotionEvent | null {
  if (!json.label && json.pleasure === undefined) return null;

  return {
    type: 'user_message',
    vectorDelta: {
      pleasure: json.pleasure ?? EMOTION_PRESETS[json.label ?? 'neutral']?.pleasure ?? 0,
      arousal: json.arousal ?? EMOTION_PRESETS[json.label ?? 'neutral']?.arousal ?? 0,
      dominance: json.dominance ?? EMOTION_PRESETS[json.label ?? 'neutral']?.dominance ?? 0,
    },
    decay: 0.5,
    label: json.label ?? 'neutral',
  };
}
