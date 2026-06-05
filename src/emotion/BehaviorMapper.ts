import type { EmotionVector } from '../types';

/**
 * 根据当前情绪，对可用动画列表进行加权排序
 * 返回按情绪匹配度排序的动画名数组
 */

// 动画类型推测规则 — 根据动画名中的关键词判断其特征
interface AnimationTrait {
  keyword: string;
  arousalBias: number;   // -1~1  偏好高/低唤醒
  pleasureBias: number;  // -1~1  关联正面/负面情绪
  dominanceBias: number; // -1~1  关联高/低支配
}

const TRAIT_RULES: AnimationTrait[] = [
  // 高兴类
  { keyword: 'wave', arousalBias: 0.6, pleasureBias: 0.7, dominanceBias: 0.2 },
  { keyword: 'dance', arousalBias: 0.9, pleasureBias: 0.6, dominanceBias: 0.3 },
  { keyword: 'jump', arousalBias: 0.85, pleasureBias: 0.4, dominanceBias: 0.2 },
  { keyword: 'clap', arousalBias: 0.7, pleasureBias: 0.6, dominanceBias: 0.1 },
  { keyword: 'cheer', arousalBias: 0.9, pleasureBias: 0.7, dominanceBias: 0.4 },
  { keyword: 'happy', arousalBias: 0.6, pleasureBias: 0.8, dominanceBias: 0.3 },
  { keyword: 'laugh', arousalBias: 0.7, pleasureBias: 0.7, dominanceBias: 0.2 },
  { keyword: 'thumbs', arousalBias: 0.3, pleasureBias: 0.5, dominanceBias: 0.4 },
  { keyword: 'victory', arousalBias: 0.8, pleasureBias: 0.7, dominanceBias: 0.7 },
  { keyword: 'celebrate', arousalBias: 0.9, pleasureBias: 0.8, dominanceBias: 0.6 },

  // 放松类
  { keyword: 'idle', arousalBias: -0.5, pleasureBias: 0.1, dominanceBias: 0.1 },
  { keyword: 'sit', arousalBias: -0.6, pleasureBias: 0.0, dominanceBias: 0.0 },
  { keyword: 'relax', arousalBias: -0.7, pleasureBias: 0.4, dominanceBias: 0.1 },
  { keyword: 'sleep', arousalBias: -0.95, pleasureBias: 0.1, dominanceBias: -0.3 },
  { keyword: 'breath', arousalBias: -0.5, pleasureBias: 0.2, dominanceBias: 0.2 },
  { keyword: 'stretch', arousalBias: 0.0, pleasureBias: 0.2, dominanceBias: 0.1 },

  // 悲伤/消极类
  { keyword: 'cry', arousalBias: 0.2, pleasureBias: -0.8, dominanceBias: -0.6 },
  { keyword: 'sad', arousalBias: -0.3, pleasureBias: -0.7, dominanceBias: -0.5 },
  { keyword: 'sigh', arousalBias: -0.4, pleasureBias: -0.5, dominanceBias: -0.3 },
  { keyword: 'head', arousalBias: -0.3, pleasureBias: -0.4, dominanceBias: -0.3 },

  // 愤怒类
  { keyword: 'angry', arousalBias: 0.8, pleasureBias: -0.6, dominanceBias: 0.6 },
  { keyword: 'kick', arousalBias: 0.8, pleasureBias: -0.4, dominanceBias: 0.5 },
  { keyword: 'punch', arousalBias: 0.85, pleasureBias: -0.5, dominanceBias: 0.6 },
  { keyword: 'stomp', arousalBias: 0.7, pleasureBias: -0.5, dominanceBias: 0.5 },

  // 惊讶类
  { keyword: 'surprise', arousalBias: 0.85, pleasureBias: 0.0, dominanceBias: -0.5 },
  { keyword: 'shock', arousalBias: 0.9, pleasureBias: -0.3, dominanceBias: -0.6 },

  // 害怕/焦虑类
  { keyword: 'scared', arousalBias: 0.7, pleasureBias: -0.6, dominanceBias: -0.7 },
  { keyword: 'fear', arousalBias: 0.7, pleasureBias: -0.5, dominanceBias: -0.6 },
  { keyword: 'hide', arousalBias: 0.4, pleasureBias: -0.3, dominanceBias: -0.5 },

  // 社交类
  { keyword: 'greet', arousalBias: 0.4, pleasureBias: 0.4, dominanceBias: 0.1 },
  { keyword: 'hello', arousalBias: 0.4, pleasureBias: 0.5, dominanceBias: 0.2 },
  { keyword: 'bow', arousalBias: -0.1, pleasureBias: 0.1, dominanceBias: -0.2 },
  { keyword: 'talk', arousalBias: 0.2, pleasureBias: 0.1, dominanceBias: 0.2 },
  { keyword: 'nod', arousalBias: 0.0, pleasureBias: 0.1, dominanceBias: 0.0 },
  { keyword: 'shake', arousalBias: 0.0, pleasureBias: -0.1, dominanceBias: 0.2 },

  // 走路/移动
  { keyword: 'walk', arousalBias: 0.1, pleasureBias: 0.1, dominanceBias: 0.3 },
  { keyword: 'run', arousalBias: 0.7, pleasureBias: 0.2, dominanceBias: 0.3 },
];

/**
 * 评估单个动画与当前情绪的匹配度 (0~1)
 */
function scoreAnimation(clipName: string, emotion: EmotionVector): number {
  const lower = clipName.toLowerCase();

  let matched = false;
  let totalBias = 0;

  for (const rule of TRAIT_RULES) {
    if (lower.includes(rule.keyword)) {
      matched = true;
      // 计算动画特征与当前情绪 PAD 向量在三维空间中的余弦相似度偏移
      const ea = rule.arousalBias - emotion.arousal;
      const ep = rule.pleasureBias - emotion.pleasure;
      const ed = rule.dominanceBias - emotion.dominance;
      const dist = Math.sqrt(ea * ea + ep * ep + ed * ed);
      // 距离越近 → 匹配度越高
      totalBias = Math.max(totalBias, 1 - dist / Math.sqrt(3));
    }
  }

  return matched ? totalBias : 0.5; // 未匹配到任何特征 → 中性分
}

/**
 * 返回按情绪匹配度降序排列的动画列表
 */
export function rankAnimationsByEmotion(
  availableClips: string[],
  emotion: EmotionVector,
): Array<{ name: string; score: number }> {
  return availableClips
    .map((name) => ({ name, score: scoreAnimation(name, emotion) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 加权随机选择动画（匹配度越高越可能被选中）
 */
export function weightedPickAnimation(
  rankedClips: Array<{ name: string; score: number }>,
): string | null {
  if (rankedClips.length === 0) return null;

  const totalWeight = rankedClips.reduce((s, c) => s + c.score, 0);
  if (totalWeight === 0) return rankedClips[0].name;

  let roll = Math.random() * totalWeight;
  for (const clip of rankedClips) {
    roll -= clip.score;
    if (roll <= 0) return clip.name;
  }

  return rankedClips[rankedClips.length - 1].name;
}

/**
 * 便捷方法：从原始动画列表中根据情绪选一个动画
 */
export function pickAnimationByEmotion(
  availableClips: string[],
  emotion: EmotionVector,
): string | null {
  const ranked = rankAnimationsByEmotion(availableClips, emotion);
  return weightedPickAnimation(ranked);
}
