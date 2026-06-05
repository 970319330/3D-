export { EmotionEngine } from './EmotionEngine';
export { perceiveFromText, createSystemEvent, parseLLMEmotionResponse } from './PerceptionLayer';
export { buildEmotionContext, injectToSystemPrompt } from './EmotionInjector';
export { pickAnimationByEmotion, rankAnimationsByEmotion, weightedPickAnimation } from './BehaviorMapper';
export {
  EMOTION_PRESETS,
  PERSONALITY_PRESETS,
  findClosestEmotionLabel,
  getEmotionVector,
} from './EmotionPresets';
