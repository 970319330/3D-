export interface JointNode {
  id: string;
  name: string;
  parentId: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface WeightBrushSettings {
  size: number;
  strength: number;
  mode: 'add' | 'subtract' | 'smooth';
}

export interface KeyframeData {
  frame: number;
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

// ========== Emotion System Types ==========

/** PAD 三维情绪向量（Pleasure-Arousal-Dominance） */
export interface EmotionVector {
  pleasure: number;   // -1.0 ~ +1.0  愉悦度
  arousal: number;    // -1.0 ~ +1.0  唤醒度
  dominance: number;  // -1.0 ~ +1.0  支配度
}

/** 情绪人格配置 — 决定 baseline 和响应曲线 */
export interface EmotionPersonality {
  name: string;
  baseline: EmotionVector;          // 稳态锚点
  responsiveness: number;           // 0~1 对外界刺激的敏感度
  recoveryRate: number;             // 0~1 情绪恢复速度（越大回归越快）
  inertiaFactor: number;            // 0~1 情绪惯性（越大余韵越长）
}

/** 情绪快照 */
export interface EmotionSnapshot {
  vector: EmotionVector;
  label: string;
  intensity: number;       // 0~1
  timestamp: number;
}

/** 情绪事件 */
export interface EmotionEvent {
  type: 'user_message' | 'system_event' | 'time_passage' | 'animation_trigger' | 'proactive_speech';
  vectorDelta: EmotionVector;
  decay: number;           // 0~1 该事件影响的衰减速度
  label: string;
}

/** 情绪完整状态 */
export interface EmotionState {
  current: EmotionVector;
  baseline: EmotionVector;
  personality: EmotionPersonality;
  history: EmotionSnapshot[];
  lastUpdate: number;
}

/** 情绪注入上下文 — 发送给 LLM 的情绪描述 */
export interface EmotionContext {
  padDescription: string;       // 自然语言描述当前情绪
  toneGuide: string;            // 语气/风格指导
  animationBias: string[];      // 倾向的动画类型
  proactivityLevel: number;     // 0~1 主动发言倾向
}
