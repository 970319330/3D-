import { MoodKey, MoodState, MoodDelta, ThresholdEvent, ProactiveChatEvent } from '../types';

const DEFAULT_MOOD: MoodState = {
  happiness: 60,
  energy: 50,
  anger: 5,
  sadness: 10,
};

// Natural decay: each dimension drifts toward its resting value
const DECAY_CONFIG: Record<MoodKey, { resting: number; ratePerSec: number }> = {
  happiness: { resting: 0, ratePerSec: 0.2 },
  energy: { resting: 0, ratePerSec: 0.15 },
  anger: { resting: 0, ratePerSec: 0.4 },
  sadness: { resting: 0, ratePerSec: 0.4 },
};

// Threshold definitions for proactive events
const THRESHOLDS: ThresholdEvent[] = [
  { dimension: 'happiness', label: 'very_happy', min: 80, max: 100, cooldownMs: 60000, lastTriggeredAt: 0 },
  { dimension: 'happiness', label: 'very_unhappy', min: 0, max: 20, cooldownMs: 60000, lastTriggeredAt: 0 },
  { dimension: 'energy', label: 'energetic', min: 80, max: 100, cooldownMs: 60000, lastTriggeredAt: 0 },
  { dimension: 'energy', label: 'exhausted', min: 0, max: 20, cooldownMs: 60000, lastTriggeredAt: 0 },
  { dimension: 'anger', label: 'angry', min: 75, max: 100, cooldownMs: 60000, lastTriggeredAt: 0 },
  { dimension: 'sadness', label: 'sad', min: 75, max: 100, cooldownMs: 60000, lastTriggeredAt: 0 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMoodLabel(mood: MoodState): string {
  if (mood.anger > 60) return '愤怒';
  if (mood.sadness > 60) return '悲伤';
  if (mood.happiness > 65) return '快乐';
  if (mood.energy < 25) return '疲惫';
  return '平静';
}

export function getMoodEmoji(label: string): string {
  switch (label) {
    case '愤怒': return '😡';
    case '悲伤': return '😢';
    case '快乐': return '😊';
    case '疲惫': return '😴';
    default: return '😌';
  }
}

export class MoodEngine {
  private state: MoodState;
  private thresholds: ThresholdEvent[];

  constructor(initialState?: Partial<MoodState>) {
    this.state = { ...DEFAULT_MOOD, ...initialState };
    this.thresholds = THRESHOLDS.map(t => ({ ...t }));
  }

  getState(): MoodState {
    return { ...this.state };
  }

  getThresholds(): ThresholdEvent[] {
    return this.thresholds.map(t => ({ ...t }));
  }

  applyDelta(delta: MoodDelta): void {
    for (const key of Object.keys(delta) as MoodKey[]) {
      const val = delta[key];
      if (val !== undefined) {
        this.state[key] = clamp(this.state[key] + val, 0, 100);
      }
    }
  }

  /**
   * Called every ~1 second.
   * Returns proactive events that should trigger a chat.
   */
  tick(deltaMs: number): ProactiveChatEvent[] {
    const deltaSec = deltaMs / 1000;

    // Natural decay toward resting values
    for (const key of Object.keys(this.state) as MoodKey[]) {
      const config = DECAY_CONFIG[key];
      const current = this.state[key];
      const diff = current - config.resting;
      if (Math.abs(diff) < 0.01) continue;
      const step = Math.sign(diff) * -1 * config.ratePerSec * deltaSec;
      if (Math.abs(step) > Math.abs(diff)) {
        this.state[key] = config.resting;
      } else {
        this.state[key] = clamp(current + step, 0, 100);
      }
    }

    // Random micro-fluctuation for natural feel
    for (const key of Object.keys(this.state) as MoodKey[]) {
      const noise = (Math.random() - 0.5) * 1.0 * deltaSec;
      this.state[key] = clamp(this.state[key] + noise, 0, 100);
    }

    // Round to 1 decimal
    for (const key of Object.keys(this.state) as MoodKey[]) {
      this.state[key] = Math.round(this.state[key] * 10) / 10;
    }

    // Check thresholds
    return this.getProactiveEvents();
  }

  /**
   * Returns threshold events that are currently active and not in cooldown.
   */
  getProactiveEvents(): ProactiveChatEvent[] {
    const now = Date.now();
    const events: ProactiveChatEvent[] = [];

    for (const threshold of this.thresholds) {
      const value = this.state[threshold.dimension];
      const inRange = value >= threshold.min && value <= threshold.max;
      const cooled = now - threshold.lastTriggeredAt >= threshold.cooldownMs;

      if (inRange && cooled) {
        threshold.lastTriggeredAt = now;
        events.push({
          dimension: threshold.dimension,
          label: threshold.label,
          value,
        });
      }
    }

    return events;
  }

  exportState(): MoodState {
    return { ...this.state };
  }

  importState(data: MoodState): void {
    this.state = { ...data };
  }
}
