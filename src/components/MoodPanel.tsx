import React from 'react';
import { EmotionState, NeedState, NeedType, NEED_LABELS, BehaviorIntent, AbandonmentTier } from '../types';
import { getMoodEmoji } from '../utils/moodEngine';

interface MoodPanelProps {
  emotion: EmotionState;
  needs: Record<NeedType, NeedState>;
  intent: BehaviorIntent | null;
  abandonment: number;
  abandonmentTier: AbandonmentTier;
}

const NEED_COLORS: Record<NeedType, { bar: string; bg: string }> = {
  attention: { bar: 'bg-rose-400', bg: 'bg-rose-500/15' },
  understanding: { bar: 'bg-blue-400', bg: 'bg-blue-500/15' },
  novelty: { bar: 'bg-amber-400', bg: 'bg-amber-500/15' },
  expression: { bar: 'bg-emerald-400', bg: 'bg-emerald-500/15' },
};

export default function MoodPanel({ emotion, needs, intent, abandonment, abandonmentTier }: MoodPanelProps) {
  // Map valence (-1..1) and arousal (-1..1) to grid position (0%..100%)
  const gridX = ((emotion.valence + 1) / 2) * 100; // 0% = distressed, 100% = happy
  const gridY = ((1 - emotion.arousal) / 2) * 100; // 0% = excited, 100% = lethargic

  // Tension affects the dot border
  const tensionWidth = 1 + emotion.tension * 4;
  const tensionColor = emotion.tension > 0.5 ? 'border-red-400' : emotion.tension > 0.2 ? 'border-amber-400' : 'border-white/30';

  const label = intent?.moodLabel || '平静';
  const emoji = intent?.moodEmoji || getMoodEmoji(label);

  return (
    <div className="bg-[#0a1222] border border-slate-800/80 rounded-lg p-3 select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-lg leading-none">{emoji}</span>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-mono tracking-wide">当前心情</span>
            <span className="text-xs font-bold text-slate-100">{label}</span>
          </div>
        </div>
        {/* Personality hint */}
        <span className="text-[8px] text-slate-600 font-mono italic">性格驱动</span>
      </div>

      {/* Affect Grid */}
      <div className="relative mb-2.5">
        {/* Grid background with quadrant coloring */}
        <div className="relative w-full aspect-[2/1.5] rounded-md overflow-hidden border border-slate-700/50">
          {/* Quadrant backgrounds */}
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            {/* Top-left: high arousal, low valence = anxious/angry */}
            <div className="bg-red-500/5" />
            {/* Top-right: high arousal, high valence = excited/happy */}
            <div className="bg-emerald-500/5" />
            {/* Bottom-left: low arousal, low valence = sad/depressed */}
            <div className="bg-blue-500/5" />
            {/* Bottom-right: low arousal, high valence = content/calm */}
            <div className="bg-amber-500/5" />
          </div>

          {/* Crosshairs */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700/40" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-700/40" />

          {/* Axis labels */}
          <span className="absolute left-0.5 top-1 text-[7px] text-slate-600 font-mono">亢奋</span>
          <span className="absolute left-0.5 bottom-0.5 text-[7px] text-slate-600 font-mono">萎靡</span>
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[7px] text-slate-600 font-mono">痛苦</span>
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[7px] text-slate-600 font-mono">愉快</span>

          {/* Emotion dot */}
          <div
            className={`absolute w-3 h-3 rounded-full bg-white shadow-lg shadow-white/20 transition-all duration-1000 ease-out border-2 ${tensionColor}`}
            style={{
              left: `calc(${gridX}% - 6px)`,
              top: `calc(${gridY}% - 6px)`,
              borderWidth: `${tensionWidth}px`,
              opacity: 0.9,
            }}
          />
        </div>
      </div>

      {/* Need indicators */}
      <div className="flex flex-col gap-1">
        {(Object.keys(needs) as NeedType[]).map(type => {
          const val = needs[type].value;
          const colors = NEED_COLORS[type];
          const isActive = intent?.primaryNeed === type;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <span className={`text-[9px] w-10 text-right shrink-0 font-mono transition-colors ${
                isActive ? 'text-slate-300' : 'text-slate-500'
              }`}>
                {NEED_LABELS[type]}
              </span>
              <div className={`flex-1 h-1 rounded-full overflow-hidden ${colors.bg}`}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar} ${
                    isActive ? 'brightness-125' : ''
                  }`}
                  style={{ width: `${val}%` }}
                />
              </div>
              {isActive && (
                <span className="text-[7px] text-amber-400 font-mono animate-pulse shrink-0">
                  驱动
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Abandonment bar */}
      {abandonment > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-800/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 w-10 text-right shrink-0 font-mono">
              {Math.round(abandonment)}
            </span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-purple-500/15">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out bg-purple-400"
                style={{ width: `${Math.min(100, abandonment)}%` }}
              />
            </div>
            <span className="text-[9px] text-slate-500 shrink-0 flex items-center gap-0.5">
              失落
              {abandonmentTier !== 'none' && (
                <span className="text-purple-400">
                  {abandonmentTier === 'severe' ? '!!!' : abandonmentTier === 'moderate' ? '!!' : '!'}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
