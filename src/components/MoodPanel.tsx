import React from 'react';
import { MoodState } from '../types';
import { getMoodLabel, getMoodEmoji } from '../utils/moodEngine';

interface MoodPanelProps {
  mood: MoodState;
}

const DIMENSIONS: { key: keyof MoodState; label: string; color: string; bg: string }[] = [
  { key: 'happiness', label: '快乐', color: 'bg-amber-400', bg: 'bg-amber-500/15' },
  { key: 'energy', label: '精力', color: 'bg-emerald-400', bg: 'bg-emerald-500/15' },
  { key: 'anger', label: '愤怒', color: 'bg-red-400', bg: 'bg-red-500/15' },
  { key: 'sadness', label: '悲伤', color: 'bg-blue-400', bg: 'bg-blue-500/15' },
];

export default function MoodPanel({ mood }: MoodPanelProps) {
  const label = getMoodLabel(mood);
  const emoji = getMoodEmoji(label);

  return (
    <div className="bg-[#0a1222] border border-slate-800/80 rounded-lg p-3 select-none">
      {/* Dominant mood header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-lg leading-none">{emoji}</span>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-mono tracking-wide">当前心情</span>
            <span className="text-xs font-bold text-slate-100">{label}</span>
          </div>
        </div>
      </div>

      {/* Mood bars */}
      <div className="flex flex-col gap-1.5">
        {DIMENSIONS.map(({ key, label, color, bg }) => {
          const val = Math.round(mood[key]);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-6 text-right shrink-0 font-mono">
                {val}
              </span>
              <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${bg}`}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
                  style={{ width: `${val}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-500 w-8 shrink-0">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
