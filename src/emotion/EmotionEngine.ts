import type {
  EmotionVector,
  EmotionState,
  EmotionEvent,
  EmotionSnapshot,
  EmotionPersonality,
} from '../types';
import { PERSONALITY_PRESETS, findClosestEmotionLabel } from './EmotionPresets';

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class EmotionEngine {
  public state: EmotionState;

  private tickTimer: number | null = null;

  constructor(personality?: EmotionPersonality) {
    const p = personality ?? PERSONALITY_PRESETS.cheerful;
    this.state = {
      current: { ...p.baseline },
      baseline: { ...p.baseline },
      personality: p,
      history: [],
      lastUpdate: Date.now(),
    };
  }

  /** 启动心跳 — 驱动情绪自然衰减（1Hz 默认） */
  start(intervalMs = 1000): void {
    if (this.tickTimer) return;
    this.tickTimer = window.setInterval(() => this.tick(), intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** 每 tick 执行：稳态衰减 + baseline 漂移 + 快照记录 */
  tick(): void {
    const now = Date.now();
    const dtSec = (now - this.state.lastUpdate) / 1000;
    this.state.lastUpdate = now;

    const { current, baseline, personality } = this.state;

    // 稳态回归：current → baseline
    const revertRate = 1 - Math.pow(1 - personality.recoveryRate, dtSec);
    this.state.current = {
      pleasure: lerp(current.pleasure, baseline.pleasure, revertRate),
      arousal: lerp(current.arousal, baseline.arousal, revertRate),
      dominance: lerp(current.dominance, baseline.dominance, revertRate),
    };

    // Baseline 向近期历史均值缓慢漂移
    if (this.state.history.length >= 5) {
      const recent = this.state.history.slice(-20);
      const avgP = recent.reduce((s, h) => s + h.vector.pleasure, 0) / recent.length;
      const avgA = recent.reduce((s, h) => s + h.vector.arousal, 0) / recent.length;
      const avgD = recent.reduce((s, h) => s + h.vector.dominance, 0) / recent.length;

      const driftRate = 0.003 * dtSec;
      this.state.baseline = {
        pleasure: lerp(baseline.pleasure, avgP, driftRate),
        arousal: lerp(baseline.arousal, avgA, driftRate),
        dominance: lerp(baseline.dominance, avgD, driftRate),
      };
    }

    // 每 30 秒记录一次快照
    const lastSnapshot = this.state.history.at(-1);
    if (!lastSnapshot || now - lastSnapshot.timestamp > 30000) {
      this.recordSnapshot();
    }
  }

  /** 接收情绪事件并叠加到当前状态 */
  applyEvent(event: EmotionEvent): void {
    const { personality, current } = this.state;
    const r = personality.responsiveness;

    // 受人格 responsiveness 调制
    const delta: EmotionVector = {
      pleasure: event.vectorDelta.pleasure * r,
      arousal: event.vectorDelta.arousal * r,
      dominance: event.vectorDelta.dominance * r,
    };

    // 带惯性保护：高强度时更难被立即改变
    const intensity = this.currentIntensity();
    const resistance = intensity * personality.inertiaFactor;
    const factor = 1 - resistance;

    this.state.current = {
      pleasure: clamp(current.pleasure + delta.pleasure * factor),
      arousal: clamp(current.arousal + delta.arousal * factor),
      dominance: clamp(current.dominance + delta.dominance * factor),
    };

    this.state.lastUpdate = Date.now();
  }

  /** 记录情绪快照 */
  recordSnapshot(label?: string): void {
    const snapshot: EmotionSnapshot = {
      vector: { ...this.state.current },
      label: label ?? findClosestEmotionLabel(this.state.current),
      intensity: this.currentIntensity(),
      timestamp: Date.now(),
    };
    this.state.history.push(snapshot);

    if (this.state.history.length > 500) {
      this.state.history = this.state.history.slice(-500);
    }
  }

  /** 切换人格 */
  setPersonality(personality: EmotionPersonality, resetVectors = true): void {
    this.state.personality = personality;
    if (resetVectors) {
      this.state.current = { ...personality.baseline };
      this.state.baseline = { ...personality.baseline };
    }
  }

  /** 强制设置当前情绪 */
  setEmotion(vec: Partial<EmotionVector>): void {
    if (vec.pleasure !== undefined) this.state.current.pleasure = clamp(vec.pleasure);
    if (vec.arousal !== undefined) this.state.current.arousal = clamp(vec.arousal);
    if (vec.dominance !== undefined) this.state.current.dominance = clamp(vec.dominance);
    this.state.lastUpdate = Date.now();
  }

  /** 当前情绪综合强度 (0~1) */
  currentIntensity(): number {
    const { pleasure, arousal, dominance } = this.state.current;
    const mag = Math.sqrt(pleasure ** 2 + arousal ** 2 + dominance ** 2);
    return Math.min(1, mag / Math.sqrt(3));
  }

  /** 导出序列化状态 */
  serialize(): string {
    return JSON.stringify({
      current: this.state.current,
      baseline: this.state.baseline,
      personality: this.state.personality,
      lastUpdate: this.state.lastUpdate,
      historySummary: this.state.history.slice(-20).map((h) => ({
        label: h.label,
        intensity: h.intensity,
        timestamp: h.timestamp,
      })),
    });
  }

  /** 从序列化状态恢复 */
  deserialize(json: string): void {
    try {
      const data = JSON.parse(json);
      this.state.current = data.current;
      this.state.baseline = data.baseline;
      this.state.personality = data.personality;
      this.state.lastUpdate = data.lastUpdate;
      this.state.history = (data.historySummary ?? []).map(
        (h: { label: string; intensity: number; timestamp: number }) => ({
          vector: { ...this.state.current },
          label: h.label,
          intensity: h.intensity,
          timestamp: h.timestamp,
        }),
      );
    } catch {
      // 反序列化失败则保持默认状态
    }
  }
}
