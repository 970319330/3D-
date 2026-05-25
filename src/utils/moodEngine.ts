import {
  Personality,
  DEFAULT_PERSONALITY,
  NeedType,
  NeedState,
  NEED_LABELS,
  EmotionState,
  EmotionMemory,
  EmotionImpact,
  BehaviorIntent,
  MoodPromptContext,
  AbandonmentTier,
} from '../types';

// ============================================================
// 配置常量
// ============================================================

/** 需求自然累积速率（每秒），受性格依赖度调制 */
const NEED_ACCUMULATION_BASE: Record<NeedType, number> = {
  attention: 0.25,
  understanding: 0.08,
  novelty: 0.10,
  expression: 0.18,
};

/** 需求被满足时的下降量 */
const NEED_SATISFACTION: Record<NeedType, number> = {
  attention: 45,
  understanding: 35,
  novelty: 30,
  expression: 40,
};

/** 情绪向 resting point 漂移的基础速率（每秒） */
const DRIFT_BASE_RATE = 0.04;

/** 需求对情绪的压迫强度系数 */
const NEED_PRESSURE_STRENGTH = 0.015;

/** 行为意图触发阈值：需求超过此值才会产生 intent */
const INTENT_THRESHOLD = 45;

/** 行为意图冷却时间（ms），避免频繁触发 */
const INTENT_COOLDOWN_MS = 30000;

/** 情绪记忆保留上限 */
const MAX_MEMORIES = 20;

// ============================================================
// 工具函数
// ============================================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 情绪强度 — 用于计算惯性 */
function emotionIntensity(e: EmotionState): number {
  return (Math.abs(e.valence) + Math.abs(e.arousal) + e.tension) / 3;
}

// ============================================================
// 情绪标签 & Emoji 映射（基于效价-唤醒-紧张三轴）
// ============================================================

interface MoodLabelEntry {
  label: string;
  emoji: string;
}

function getEmotionLabelEntry(e: EmotionState): MoodLabelEntry {
  const { valence, arousal, tension } = e;

  if (tension > 0.55 && arousal > 0.2) return { label: '愤怒', emoji: '😤' };
  if (tension > 0.55 && arousal <= 0.2) return { label: '压抑', emoji: '😣' };
  if (valence < -0.35 && arousal > 0.25) return { label: '焦虑', emoji: '😰' };
  if (valence < -0.35 && arousal <= 0 && tension < 0.45) return { label: '低落', emoji: '😢' };
  if (valence < -0.35 && arousal < -0.2) return { label: '疲惫', emoji: '😴' };
  if (valence > 0.35 && arousal > 0.25) return { label: '开心', emoji: '😊' };
  if (valence > 0.35 && arousal <= 0.25) return { label: '满足', emoji: '☺️' };
  if (arousal > 0.4) return { label: '兴奋', emoji: '🤩' };
  if (arousal < -0.35) return { label: '困倦', emoji: '🥱' };
  if (tension > 0.4) return { label: '烦躁', emoji: '😒' };
  return { label: '平静', emoji: '😌' };
}

export function getMoodLabel(emotion: EmotionState): string {
  return getEmotionLabelEntry(emotion).label;
}

const EMOJI_MAP: Record<string, string> = {
  '愤怒': '😤', '压抑': '😣', '焦虑': '😰', '低落': '😢',
  '疲惫': '😴', '开心': '😊', '满足': '☺️', '兴奋': '🤩',
  '困倦': '🥱', '烦躁': '😒', '平静': '😌',
};

export function getMoodEmoji(label: string): string {
  return EMOJI_MAP[label] || '😌';
}

// ============================================================
// MoodEngine
// ============================================================

export class MoodEngine {
  personality: Personality;

  private _emotion: EmotionState;
  private _needs: Record<NeedType, NeedState>;
  private _memories: EmotionMemory[];
  private _abandonment: number;
  private _consecutiveIgnored: number;
  private _lastUserMessageAt: number;
  private _lastIntentAt: number;
  private _lastProactiveAt: number;
  private _proactiveSnippets: string[];

  constructor(personality?: Partial<Personality>) {
    this.personality = { ...DEFAULT_PERSONALITY, ...personality };
    this._emotion = this._restingEmotion();
    this._needs = this._freshNeeds();
    this._memories = [];
    this._abandonment = 0;
    this._consecutiveIgnored = 0;
    this._lastUserMessageAt = Date.now();
    this._lastIntentAt = 0;
    this._lastProactiveAt = 0;
    this._proactiveSnippets = [];
  }

  // ============================================================
  // 公共读取
  // ============================================================

  getEmotion(): EmotionState {
    return { ...this._emotion };
  }

  getNeeds(): Record<NeedType, NeedState> {
    const result: Record<string, NeedState> = {};
    for (const k of Object.keys(this._needs) as NeedType[]) {
      result[k] = { ...this._needs[k] };
    }
    return result as Record<NeedType, NeedState>;
  }

  getAbandonment(): number {
    return this._abandonment;
  }

  getAbandonmentTier(): AbandonmentTier {
    const v = this._abandonment;
    if (v >= 90) return 'severe';
    if (v >= 60) return 'moderate';
    if (v >= 30) return 'mild';
    return 'none';
  }

  getEscalationLevel(): number {
    return Math.min(4, this._consecutiveIgnored);
  }

  getRecentSnippets(): string[] {
    return [...this._proactiveSnippets].slice(-5);
  }

  // ============================================================
  // 核心：时间推进
  // ============================================================

  tick(deltaMs: number): { hasBehaviorIntent: boolean; intent: BehaviorIntent | null } {
    const dt = Math.min(deltaMs / 1000, 5); // cap at 5s to avoid spiral

    // 1. 需求自然累积
    this._accumulateNeeds(dt);

    // 2. 需求压迫情绪
    this._applyNeedPressure(dt);

    // 3. 情绪向 resting point 漂移（带惯性）
    this._driftEmotions(dt);

    // 4. 微小自然噪声
    this._applyNoise(dt);

    // 5. 四舍五入
    this._round();

    // 6. 检查行为意图
    const intent = this._checkIntent();

    return { hasBehaviorIntent: intent !== null, intent };
  }

  // ============================================================
  // 事件处理
  // ============================================================

  /** 用户发送了一条消息 */
  onUserMessage(text: string): void {
    const now = Date.now();
    const timeSinceLast = (now - this._lastUserMessageAt) / 1000;

    // 满足 "被关注" 需求，根据间隔时长有 bonus
    const attentionBonus = Math.min(20, timeSinceLast * 0.05);
    this._satisfyNeed('attention', NEED_SATISFACTION.attention + attentionBonus);

    // 满足 "被理解" 需求，与消息长度成正比
    const understandingAmount = text.length > 30
      ? NEED_SATISFACTION.understanding
      : text.length > 10
        ? NEED_SATISFACTION.understanding * 0.6
        : NEED_SATISFACTION.understanding * 0.25;
    this._satisfyNeed('understanding', understandingAmount);

    // 满足 "新鲜感" 需求（每次对话有一半基础满足）
    this._satisfyNeed('novelty', NEED_SATISFACTION.novelty * 0.5);

    // 情绪直接受益于用户互动
    this._applyImpact({
      valence: 0.08 + (1 - this.personality.optimism) * 0.04, // 越不乐观，互动带来的提升越明显
      arousal: 0.05,
      tension: -0.05,
      reason: '用户主动互动',
    });

    // 失落值回落
    this._abandonment = Math.max(0, this._abandonment - 3);
    this._consecutiveIgnored = 0;
    this._lastUserMessageAt = now;

    // 裁剪记忆
    this._trimMemories();
  }

  /** AI 发送了一条主动消息 */
  onProactiveSent(snippet: string): void {
    const now = Date.now();

    // 如果上次主动消息没有被用户回应 → 失落累积
    if (this._lastProactiveAt > this._lastUserMessageAt && this._lastProactiveAt > 0) {
      this._abandonment = Math.min(100, this._abandonment + 12 + this.personality.dependence * 8);
      this._consecutiveIgnored += 1;
    }

    // 满足 "表达欲"
    this._satisfyNeed('expression', NEED_SATISFACTION.expression);

    this._lastProactiveAt = now;
    this._proactiveSnippets.push(snippet.slice(0, 40));
    if (this._proactiveSnippets.length > 10) {
      this._proactiveSnippets = this._proactiveSnippets.slice(-10);
    }
  }

  /** 应用外部情绪影响（游戏结果等） */
  applyImpact(impact: EmotionImpact): void {
    this._applyImpact(impact);
    this._trimMemories();
  }

  // ============================================================
  // 给 LLM 的 prompt 上下文
  // ============================================================

  getPromptContext(): MoodPromptContext {
    const entry = getEmotionLabelEntry(this._emotion);
    const intent = this._deriveIntent();

    // 情绪描述
    const valenceDesc = this._emotion.valence > 0.2 ? '愉快'
      : this._emotion.valence < -0.2 ? '低落'
        : '中性';
    const arousalDesc = this._emotion.arousal > 0.2 ? '精力充沛'
      : this._emotion.arousal < -0.2 ? '疲惫无力'
        : '精力一般';
    const tensionDesc = this._emotion.tension > 0.4 ? '有些紧绷'
      : this._emotion.tension > 0.15 ? '轻微紧绷'
        : '放松';

    const emotionDescription = `当前情绪：${entry.label}（${valenceDesc}、${arousalDesc}、${tensionDesc}）。`;

    // 意图描述
    let intentDescription = '';
    if (intent) {
      intentDescription = `她当前最渴望的是「${NEED_LABELS[intent.primaryNeed]}」。${intent.emotionalContext}`;
    } else {
      intentDescription = '她当前没有特别迫切的需求，状态比较平衡。';
    }

    // 近期记忆
    const recentMemories = this._memories
      .slice(-5)
      .map(m => {
        const ago = Math.round((Date.now() - m.timestamp) / 1000);
        const agoStr = ago < 60 ? `${ago}秒前` : ago < 3600 ? `${Math.round(ago / 60)}分钟前` : `${Math.round(ago / 3600)}小时前`;
        return `${agoStr}：${m.reason}（${m.source === 'user_message' ? '来自用户' : m.source === 'time_decay' ? '随时间变化' : m.source === 'need_pressure' ? '内心需求' : '其他'}）`;
      })
      .reverse();

    // 失落层级
    const tier = this.getAbandonmentTier();
    const tierDesc: Record<AbandonmentTier, string> = {
      none: '',
      mild: '有轻微的被冷落感。',
      moderate: '明显感到被冷落，有些难过。',
      severe: '非常强烈的被抛弃感，情绪濒临崩溃。',
    };

    // 拼装 system prompt 追加文本
    const systemAddendum = [
      `【角色当前状态】`,
      emotionDescription,
      `性格底色：${this._describePersonality()}`,
      intent ? `行为驱动力：${intentDescription}` : '',
      tier !== 'none' ? `被冷落程度：${tierDesc[tier]}（连续被忽略 ${this._consecutiveIgnored} 次）` : '',
      recentMemories.length > 0 ? `近期情绪事件：${recentMemories.join('；')}` : '',
    ].filter(Boolean).join('\n');

    return {
      emotionDescription,
      intentDescription,
      recentMemories,
      abandonmentTier: tier,
      systemAddendum,
    };
  }

  // ============================================================
  // 序列化
  // ============================================================

  exportState(): { emotion: EmotionState; needs: Record<NeedType, NeedState>; abandonment: number; personality: Personality } {
    return {
      emotion: { ...this._emotion },
      needs: this.getNeeds(),
      abandonment: this._abandonment,
      personality: { ...this.personality },
    };
  }

  importState(data: { emotion?: EmotionState; needs?: Record<NeedType, NeedState>; abandonment?: number; personality?: Personality }): void {
    if (data.emotion) this._emotion = { ...data.emotion };
    if (data.needs) this._needs = data.needs;
    if (data.abandonment !== undefined) this._abandonment = data.abandonment;
    if (data.personality) this.personality = { ...data.personality };
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private _restingEmotion(): EmotionState {
    const p = this.personality;
    return {
      valence: p.optimism * 0.35 - 0.05,  // -0.05 to 0.30
      arousal: 0,
      tension: (1 - p.optimism) * 0.12,   // 0 to 0.12
    };
  }

  private _freshNeeds(): Record<NeedType, NeedState> {
    const now = Date.now();
    const needs: Partial<Record<NeedType, NeedState>> = {};
    for (const type of ['attention', 'understanding', 'novelty', 'expression'] as NeedType[]) {
      needs[type] = { value: 0, lastSatisfiedAt: now };
    }
    return needs as Record<NeedType, NeedState>;
  }

  /** 需求随时间自然累积 */
  private _accumulateNeeds(dt: number): void {
    const timeSinceUser = (Date.now() - this._lastUserMessageAt) / 1000;

    for (const type of Object.keys(this._needs) as NeedType[]) {
      let rate = NEED_ACCUMULATION_BASE[type];

      // 依赖度调制注意力需求
      if (type === 'attention') {
        rate *= (0.5 + this.personality.dependence);
        // 随间隔时间加速累积（越久没人理，越想被理）
        const timeBonus = Math.min(1.5, timeSinceUser / 600); // max 1.5x after 10 min
        rate *= (1 + timeBonus);
      }

      // 敏感度调制理解需求
      if (type === 'understanding') {
        rate *= (0.5 + this.personality.sensitivity);
      }

      // 表达欲受表达欲特质调制
      if (type === 'expression') {
        rate *= (0.4 + this.personality.expressiveness * 1.2);
      }

      this._needs[type].value = clamp(this._needs[type].value + rate * dt, 0, 100);
    }
  }

  /** 满足某项需求 */
  private _satisfyNeed(type: NeedType, amount: number): void {
    this._needs[type].value = clamp(this._needs[type].value - amount, 0, 100);
    this._needs[type].lastSatisfiedAt = Date.now();
  }

  /** 需求压迫情绪 */
  private _applyNeedPressure(dt: number): void {
    const p = this.personality;
    const sensitivityMod = 0.5 + p.sensitivity;

    // attention 未满足 → 愉悦度下降、唤醒度上升（焦虑型渴望）
    const attPressure = this._needs.attention.value / 100;
    this._emotion.valence -= attPressure * NEED_PRESSURE_STRENGTH * sensitivityMod * dt;
    this._emotion.arousal += attPressure * NEED_PRESSURE_STRENGTH * 0.7 * dt;
    this._emotion.tension += attPressure * NEED_PRESSURE_STRENGTH * 0.6 * dt;

    // understanding 未满足 → 轻微降低愉悦度
    const undPressure = this._needs.understanding.value / 100;
    this._emotion.valence -= undPressure * NEED_PRESSURE_STRENGTH * 0.5 * sensitivityMod * dt;
    this._emotion.tension += undPressure * NEED_PRESSURE_STRENGTH * 0.3 * dt;

    // novelty 未满足 → 唤醒度下降（无聊）
    const novPressure = this._needs.novelty.value / 100;
    this._emotion.arousal -= novPressure * NEED_PRESSURE_STRENGTH * 0.8 * dt;

    // expression 未满足 → 紧张度上升（憋着）
    const expPressure = this._needs.expression.value / 100;
    this._emotion.tension += expPressure * NEED_PRESSURE_STRENGTH * 0.5 * dt;
  }

  /** 情绪向 resting point 漂移 */
  private _driftEmotions(dt: number): void {
    const resting = this._restingEmotion();
    const p = this.personality;

    // 惯性：情绪越强烈越不容易消退，但韧性会削减惯性
    const intensity = emotionIntensity(this._emotion);
    const inertiaFactor = 1 - intensity * (1 - p.resilience * 0.8);

    // 离 resting 越远漂移力越大
    const driftMultiplier = DRIFT_BASE_RATE * inertiaFactor * dt;

    this._emotion.valence = lerp(this._emotion.valence, resting.valence, driftMultiplier);
    this._emotion.arousal = lerp(this._emotion.arousal, resting.arousal, driftMultiplier * 0.8);
    this._emotion.tension = lerp(this._emotion.tension, resting.tension, driftMultiplier * 0.6);
  }

  /** 微小噪声 */
  private _applyNoise(dt: number): void {
    const noiseScale = 0.02 * dt;
    this._emotion.valence += (Math.random() - 0.5) * noiseScale;
    this._emotion.arousal += (Math.random() - 0.5) * noiseScale * 0.7;
    this._emotion.tension += (Math.random() - 0.5) * noiseScale * 0.3;
  }

  /** 应用情绪影响，受敏感度调制 */
  private _applyImpact(impact: EmotionImpact): void {
    const sensitivityMod = 0.5 + this.personality.sensitivity;

    if (impact.valence !== undefined) {
      const delta = impact.valence * sensitivityMod;
      this._emotion.valence = clamp(this._emotion.valence + delta, -1, 1);
    }
    if (impact.arousal !== undefined) {
      this._emotion.arousal = clamp(this._emotion.arousal + impact.arousal * sensitivityMod * 0.9, -1, 1);
    }
    if (impact.tension !== undefined) {
      this._emotion.tension = clamp(this._emotion.tension + impact.tension * sensitivityMod * 0.8, 0, 1);
    }

    this._memories.push({
      timestamp: Date.now(),
      valenceDelta: impact.valence || 0,
      arousalDelta: impact.arousal || 0,
      tensionDelta: impact.tension || 0,
      reason: impact.reason,
      source: 'user_message',
    });
  }

  /** 检查是否应产生行为意图 */
  private _checkIntent(): BehaviorIntent | null {
    const now = Date.now();
    if (now - this._lastIntentAt < INTENT_COOLDOWN_MS) return null;

    // 找到最迫切的需求
    let maxNeed: NeedType = 'attention';
    let maxValue = 0;
    for (const type of Object.keys(this._needs) as NeedType[]) {
      if (this._needs[type].value > maxValue) {
        maxValue = this._needs[type].value;
        maxNeed = type;
      }
    }

    if (maxValue < INTENT_THRESHOLD) return null;

    const intent = this._buildIntent(maxNeed, maxValue);
    if (!intent) return null;

    this._lastIntentAt = now;
    return intent;
  }

  /** 从当前状态推导行为意图 */
  private _deriveIntent(): BehaviorIntent | null {
    let maxNeed: NeedType = 'attention';
    let maxValue = 0;
    for (const type of Object.keys(this._needs) as NeedType[]) {
      if (this._needs[type].value > maxValue) {
        maxValue = this._needs[type].value;
        maxNeed = type;
      }
    }
    return this._buildIntent(maxNeed, maxValue);
  }

  private _buildIntent(needType: NeedType, value: number): BehaviorIntent {
    const entry = getEmotionLabelEntry(this._emotion);
    const urgency = value / 100;

    const needContexts: Record<NeedType, string> = {
      attention: '她渴望用户的关注和陪伴。说话时会主动寻求互动，语气中带着期待或不安（取决于性格）。',
      understanding: '她觉得用户没有真正理解她的感受。说话时可能会试图更深入地表达自己，或者试探用户的反应。',
      novelty: '她感到有点无聊，希望发生一些新鲜事。说话时可能会提出新话题、建议玩个游戏，或者问一些好奇的问题。',
      expression: '她内心有很多话想说，需要一个倾诉的出口。说话时可能会比较感性，分享内心感受或回忆。',
    };

    return {
      primaryNeed: needType,
      urgency,
      emotionalContext: needContexts[needType],
      moodLabel: entry.label,
      moodEmoji: entry.emoji,
    };
  }

  /** 人格的文字描述 */
  private _describePersonality(): string {
    const p = this.personality;
    const traits: string[] = [];
    if (p.optimism > 0.6) traits.push('乐观开朗');
    else if (p.optimism < 0.4) traits.push('偏向悲观');
    else traits.push('心态适中');

    if (p.sensitivity > 0.6) traits.push('心思敏感细腻');
    else if (p.sensitivity < 0.4) traits.push('神经大条');
    else traits.push('敏感度适中');

    if (p.expressiveness > 0.6) traits.push('话多主动');
    else if (p.expressiveness < 0.4) traits.push('安静内敛');
    else traits.push('表达欲适中');

    if (p.dependence > 0.6) traits.push('依赖心较重');
    else if (p.dependence < 0.4) traits.push('比较独立');
    else traits.push('依赖度适中');

    if (p.resilience > 0.6) traits.push('情绪来得快去得快');
    else if (p.resilience < 0.4) traits.push('情绪持久不易消散');
    // mid resilience: omit

    return traits.join('，');
  }

  private _trimMemories(): void {
    if (this._memories.length > MAX_MEMORIES) {
      this._memories = this._memories.slice(-MAX_MEMORIES);
    }
  }

  private _round(): void {
    this._emotion.valence = Math.round(this._emotion.valence * 1000) / 1000;
    this._emotion.arousal = Math.round(this._emotion.arousal * 1000) / 1000;
    this._emotion.tension = Math.round(this._emotion.tension * 1000) / 1000;
    for (const k of Object.keys(this._needs) as NeedType[]) {
      this._needs[k].value = Math.round(this._needs[k].value * 10) / 10;
    }
  }
}
