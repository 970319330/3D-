export interface JointNode {
  id: string;
  name: string;
  parentId: string | null;
  // Position in model's local space (rest pose)
  position: [number, number, number];
  // Temporal pose transformation (rotation applied during pose/animation mode)
  rotation: [number, number, number]; // Euler angles in radians (XYZ)
}

export interface WeightBrushSettings {
  size: number;
  strength: number;
  mode: 'add' | 'subtract' | 'smooth';
}

export interface KeyframeData {
  frame: number;
  // rotation offset for each joint ID: jointId -> [rx, ry, rz] values (Euler angles in radians)
  rotations: Record<string, [number, number, number]>;
}

export interface AnimationClipData {
  id: string;
  name: string;
  durationFrames: number;
  keyframes: KeyframeData[];
}

export type EditorMode = 'edit-model' | 'edit-skeleton' | 'rigging' | 'animate' | 'ai-companion';

export interface ModelPreset {
  id: string;
  name: string;
  type: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf';
  label: string;
}

// ============================================================
// 心情系统 v2 — 三层架构：性格 → 需求 → 情绪
// ============================================================

/** 性格特质 — 稳定，决定情绪底色和行为参数 */
export interface Personality {
  /** 乐观度 0-1：高=天然开心，低=容易看到消极面 */
  optimism: number;
  /** 敏感度 0-1：高=情绪容易被事件放大 */
  sensitivity: number;
  /** 表达欲 0-1：高=话多主动，低=安静内敛 */
  expressiveness: number;
  /** 依赖度 0-1：高=渴望陪伴，被冷落时失落上升更快 */
  dependence: number;
  /** 韧性 0-1：高=情绪来得快去得快，低=情绪久久不散 */
  resilience: number;
}

export const DEFAULT_PERSONALITY: Personality = {
  optimism: 0.65,
  sensitivity: 0.6,
  expressiveness: 0.7,
  dependence: 0.55,
  resilience: 0.45,
};

/** 需求维度 */
export type NeedType = 'attention' | 'understanding' | 'novelty' | 'expression';

export const NEED_LABELS: Record<NeedType, string> = {
  attention: '被关注',
  understanding: '被理解',
  novelty: '新鲜感',
  expression: '表达欲',
};

export interface NeedState {
  /** 0=完全满足，100=极度渴望 */
  value: number;
  /** 上次被满足的时间戳 */
  lastSatisfiedAt: number;
}

/** 情绪状态 — 基于心理学的效价-唤醒-紧张模型 */
export interface EmotionState {
  /** 愉悦度 ﹣1 (痛苦) 到 +1 (愉快) */
  valence: number;
  /** 唤醒度 ﹣1 (萎靡) 到 +1 (亢奋) */
  arousal: number;
  /** 紧张度 0 (放松) 到 1 (愤怒/焦虑) */
  tension: number;
}

/** 情绪记忆 — 记录每次情绪变化的原因 */
export interface EmotionMemory {
  timestamp: number;
  valenceDelta: number;
  arousalDelta: number;
  tensionDelta: number;
  reason: string;
  source: 'user_message' | 'user_action' | 'game_result' | 'time_decay' | 'need_pressure';
}

/** 行为意图 — 由需求+情绪驱动，告诉 LLM "角色想要什么" */
export interface BehaviorIntent {
  /** 最强烈的需求 */
  primaryNeed: NeedType;
  /** 紧急程度 0-1 */
  urgency: number;
  /** 情绪上下文描述，直接注入 LLM prompt */
  emotionalContext: string;
  /** 综合情绪标签（中文） */
  moodLabel: string;
  /** 对应的 emoji */
  moodEmoji: string;
}

/** 情绪影响 — 事件对情绪的改变 */
export interface EmotionImpact {
  valence?: number;
  arousal?: number;
  tension?: number;
  reason: string;
}

/** 给 LLM 的完整心情上下文 */
export interface MoodPromptContext {
  /** 当前情绪的自然语言描述 */
  emotionDescription: string;
  /** 行为意图描述 */
  intentDescription: string;
  /** 最近的记忆摘要 */
  recentMemories: string[];
  /** 失落层级 */
  abandonmentTier: AbandonmentTier;
  /** 需要被注入 system prompt 的完整文本 */
  systemAddendum: string;
}

// ============================================================
// 失落值层级（保留，用于 UI 展示）
// ============================================================

export type AbandonmentTier = 'none' | 'mild' | 'moderate' | 'severe';

// ============================================================
// 小游戏系统（保留）
// ============================================================

export type GameType = 'guess_mood' | 'two_choice' | 'chain_story';

export interface GamePrompt {
  gameType: GameType;
  question: string;
  options?: string[];
  correctAnswer?: string;
  storySoFar?: string;
  round?: number;
  maxRounds?: number;
}

export interface GameResult {
  gameType: GameType;
  isCorrect?: boolean;
  emotionImpact: EmotionImpact;
  aiResponse: string;
  isComplete: boolean;
}

// ============================================================
// 向后兼容别名（过渡期使用）
// ============================================================

/** @deprecated 使用 EmotionState 替代 */
export type MoodState = EmotionState & { happiness?: number; energy?: number; anger?: number; sadness?: number; abandonment?: number };

/** @deprecated 使用 EmotionImpact 替代 */
export type MoodDelta = Partial<Record<string, number>>;
