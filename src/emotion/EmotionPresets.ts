import type { EmotionVector, EmotionPersonality } from '../types';

/**
 * 预定义情绪标签 → PAD 向量映射
 * 参考 Mehrabian & Russell (1974) PAD 情绪量表
 */

export const EMOTION_PRESETS: Record<string, EmotionVector> = {
  // 正面 + 高唤醒
  joyful:     { pleasure: 0.80, arousal: 0.65, dominance: 0.45 },
  excited:    { pleasure: 0.70, arousal: 0.85, dominance: 0.30 },
  energetic:  { pleasure: 0.55, arousal: 0.80, dominance: 0.50 },

  // 正面 + 中性唤醒
  content:    { pleasure: 0.70, arousal: 0.10, dominance: 0.35 },
  relaxed:    { pleasure: 0.60, arousal: -0.50, dominance: 0.20 },
  warm:       { pleasure: 0.65, arousal: 0.05, dominance: 0.15 },

  // 正面 + 低唤醒
  peaceful:   { pleasure: 0.50, arousal: -0.70, dominance: 0.10 },
  sleepy:     { pleasure: 0.30, arousal: -0.85, dominance: -0.10 },

  // 中性
  curious:    { pleasure: 0.20, arousal: 0.40, dominance: 0.30 },
  neutral:    { pleasure: 0.05, arousal: 0.00, dominance: 0.10 },
  indifferent:{ pleasure: 0.00, arousal: -0.50, dominance: 0.05 },

  // 负面 + 高唤醒
  angry:      { pleasure: -0.60, arousal: 0.80, dominance: 0.60 },
  anxious:    { pleasure: -0.55, arousal: 0.75, dominance: -0.60 },
  frustrated: { pleasure: -0.50, arousal: 0.55, dominance: 0.30 },

  // 负面 + 中性唤醒
  sad:        { pleasure: -0.70, arousal: -0.20, dominance: -0.50 },
  lonely:     { pleasure: -0.60, arousal: -0.30, dominance: -0.55 },
  disappointed:{ pleasure: -0.45, arousal: -0.10, dominance: -0.25 },

  // 负面 + 低唤醒
  depressed:  { pleasure: -0.75, arousal: -0.55, dominance: -0.70 },
  bored:      { pleasure: -0.30, arousal: -0.70, dominance: -0.20 },
  exhausted:  { pleasure: -0.40, arousal: -0.80, dominance: -0.45 },

  // 高支配
  confident:  { pleasure: 0.50, arousal: 0.40, dominance: 0.80 },
  proud:      { pleasure: 0.60, arousal: 0.45, dominance: 0.75 },

  // 低支配
  shy:        { pleasure: 0.10, arousal: 0.30, dominance: -0.60 },
  submissive: { pleasure: -0.05, arousal: -0.10, dominance: -0.70 },

  // 惊讶（唤醒极高，支配为负）
  surprised:  { pleasure: 0.15, arousal: 0.90, dominance: -0.40 },
  amazed:     { pleasure: 0.50, arousal: 0.85, dominance: -0.20 },
};

/**
 * 预置情绪人格
 */
export const PERSONALITY_PRESETS: Record<string, EmotionPersonality> = {
  /** 乐观开朗 — 默认人格 */
  cheerful: {
    name: '开朗',
    baseline: { pleasure: 0.40, arousal: 0.20, dominance: 0.25 },
    responsiveness: 0.6,
    recoveryRate: 0.08,
    inertiaFactor: 0.5,
  },

  /** 沉稳内敛 */
  calm: {
    name: '沉稳',
    baseline: { pleasure: 0.25, arousal: -0.30, dominance: 0.30 },
    responsiveness: 0.35,
    recoveryRate: 0.12,
    inertiaFactor: 0.3,
  },

  /** 敏感忧郁 */
  sensitive: {
    name: '敏感',
    baseline: { pleasure: 0.05, arousal: -0.10, dominance: -0.15 },
    responsiveness: 0.85,
    recoveryRate: 0.04,
    inertiaFactor: 0.7,
  },

  /** 活泼热情 */
  energetic: {
    name: '活泼',
    baseline: { pleasure: 0.50, arousal: 0.50, dominance: 0.35 },
    responsiveness: 0.7,
    recoveryRate: 0.06,
    inertiaFactor: 0.4,
  },

  /** 傲娇 */
  tsundere: {
    name: '傲娇',
    baseline: { pleasure: 0.10, arousal: 0.15, dominance: 0.45 },
    responsiveness: 0.75,
    recoveryRate: 0.05,
    inertiaFactor: 0.65,
  },
};

/**
 * 根据名称查找情绪 PAD 值，找不到返回 neutral
 */
export function getEmotionVector(label: string): EmotionVector {
  return EMOTION_PRESETS[label] ?? EMOTION_PRESETS.neutral;
}

/**
 * 根据当前 PAD 向量反查最近的情绪标签
 */
export function findClosestEmotionLabel(vec: EmotionVector): string {
  let bestLabel = 'neutral';
  let bestDist = Infinity;

  for (const [label, preset] of Object.entries(EMOTION_PRESETS)) {
    const dp = vec.pleasure - preset.pleasure;
    const da = vec.arousal - preset.arousal;
    const dd = vec.dominance - preset.dominance;
    const dist = dp * dp + da * da + dd * dd;
    if (dist < bestDist) {
      bestDist = dist;
      bestLabel = label;
    }
  }
  return bestLabel;
}

/**
 * 将 PAD 向量转换为人类可读的情绪强度描述
 */
export function describeIntensity(vec: EmotionVector): string {
  const mag = Math.sqrt(
    vec.pleasure ** 2 + vec.arousal ** 2 + vec.dominance ** 2,
  );
  if (mag < 0.2) return '几乎感觉不到';
  if (mag < 0.4) return '轻微的';
  if (mag < 0.6) return '明显的';
  if (mag < 0.9) return '强烈的';
  return '极度的';
}
