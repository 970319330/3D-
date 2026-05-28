import React, { useState, useRef, useEffect } from 'react';
import { MoodState, MoodDelta } from '../types';
import { getMoodLabel, getMoodEmoji } from '../utils/moodEngine';

interface MoodPanelProps {
  mood: MoodState;
  onMoodDelta?: (delta: MoodDelta) => void;
}

const DIMENSIONS: { key: keyof MoodState; label: string; color: string; bg: string }[] = [
  { key: 'happiness', label: '快乐', color: 'bg-amber-400', bg: 'bg-amber-500/15' },
  { key: 'energy', label: '精力', color: 'bg-emerald-400', bg: 'bg-emerald-500/15' },
  { key: 'anger', label: '愤怒', color: 'bg-red-400', bg: 'bg-red-500/15' },
  { key: 'sadness', label: '悲伤', color: 'bg-blue-400', bg: 'bg-blue-500/15' },
];

export default function MoodPanel({ mood, onMoodDelta }: MoodPanelProps) {
  const label = getMoodLabel(mood);
  const emoji = getMoodEmoji(label);
  
  const gridRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Map 4D mood back to 2D coordinates for visual knob positioning
  // Horizontal (X) represents positive valence (happiness) vs negative valence (anger/sadness)
  // Vertical (Y) represents arousal / energy
  let pctX = 50;
  if (mood.happiness > 0) {
    pctX = 50 + mood.happiness / 2;
  } else {
    const maxNegative = Math.max(mood.sadness, mood.anger);
    pctX = 50 - maxNegative / 2;
  }
  const pctY = mood.energy;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!gridRef.current) return;
    gridRef.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateMoodFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateMoodFromEvent(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (gridRef.current) {
      gridRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const updateMoodFromEvent = (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
    if (!gridRef.current || !onMoodDelta) return;
    const rect = gridRef.current.getBoundingClientRect();
    const xRaw = ((e.clientX - rect.left) / rect.width) * 100;
    const yRaw = 100 - (((e.clientY - rect.top) / rect.height) * 100);

    const targetX = Math.min(100, Math.max(0, xRaw));
    const targetY = Math.min(100, Math.max(0, yRaw));

    // Convert 2D location to 4D mood values
    let happiness = 0;
    let sadness = 0;
    let anger = 0;
    const energy = Math.round(targetY);

    if (targetX >= 50) {
      happiness = Math.round((targetX - 50) * 2);
    } else {
      const valenceScale = (50 - targetX) * 2;
      if (targetY >= 50) {
        anger = Math.round(valenceScale);
        sadness = 0;
      } else {
        sadness = Math.round(valenceScale);
        anger = 0;
      }
    }

    const delta: MoodDelta = {
      happiness: happiness - mood.happiness,
      energy: energy - mood.energy,
      anger: anger - mood.anger,
      sadness: sadness - mood.sadness,
    };

    onMoodDelta(delta);
  };

  return (
    <div className="bg-[#0a1222] border border-slate-800/80 rounded-xl p-3 select-none flex flex-col gap-3">
      {/* Dominant mood header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xl leading-none">{emoji}</span>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-mono tracking-wide">当前心情状态</span>
            <span className="text-xs font-bold text-slate-100 flex items-center gap-1">
              <span>{label}</span>
              <span className="text-[9px] font-normal text-slate-400">({Math.round(pctX)}, {Math.round(pctY)})</span>
            </span>
          </div>
        </div>
        <span className="text-[9px] text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-900 font-mono uppercase tracking-widest font-bold">
          2D Mood Pad
        </span>
      </div>

      {/* 2D Flat Square Selector Area */}
      <div 
        ref={gridRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative aspect-square w-full bg-slate-950 rounded-xl border border-slate-800 cursor-crosshair overflow-hidden touch-none"
      >
        {/* Quadrant color glows */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-15">
          {/* Top Left (Anger Red) */}
          <div className="bg-red-500/20" />
          {/* Top Right (Happy Amber) */}
          <div className="bg-amber-500/20" />
          {/* Bottom Left (Sad Blue) */}
          <div className="bg-blue-500/20" />
          {/* Bottom Right (Calm Emerald) */}
          <div className="bg-emerald-500/20" />
        </div>

        {/* Center Grid Crosshair Axes */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-800/60 dashed" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-800/60 dashed" />

        {/* Quadrant Text Overlays */}
        <div className="absolute top-2 left-2 text-[8px] text-slate-500 font-bold uppercase pointer-events-none">
          😡 愤怒 (Anger)
        </div>
        <div className="absolute top-2 right-2 text-[8px] text-slate-500 font-bold uppercase pointer-events-none text-right">
          😊 快乐 (Joy)
        </div>
        <div className="absolute bottom-2 left-2 text-[8px] text-slate-500 font-bold uppercase pointer-events-none">
          😢 悲伤 (Sadness)
        </div>
        <div className="absolute bottom-2 right-2 text-[8px] text-slate-500 font-bold uppercase pointer-events-none text-right">
          😴 疲惫 (Tired)
        </div>

        {/* Axis Label Guides */}
        <div className="absolute inset-x-0 bottom-1 flex justify-center pointer-events-none">
          <span className="text-[7.5px] text-slate-600 font-semibold tracking-wider uppercase">← 愉悦度 (Valence) →</span>
        </div>
        <div className="absolute inset-y-0 left-1 flex items-center pointer-events-none [writing-mode:vertical-lr] rotate-180">
          <span className="text-[7.5px] text-slate-600 font-semibold tracking-wider uppercase">← 精力唤醒 (Arousal) →</span>
        </div>

        {/* Interactive Pointer Handle Knob */}
        <div 
          className={`absolute w-4 h-4 rounded-full border-2 border-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/60 flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 transition-shadow duration-150 z-10 pointer-events-none ${
            isDragging ? 'scale-125 ring-2 ring-indigo-400' : ''
          }`}
          style={{
            left: `${pctX}%`,
            bottom: `${pctY}%`
          }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-white shadow-inner animate-pulse" />
        </div>
      </div>

      {/* Numeric readout slider progress bars below */}
      <div className="flex flex-col gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-900/60">
        {DIMENSIONS.map(({ key, label, color, bg }) => {
          const val = Math.round(mood[key]);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-6 text-right shrink-0 font-mono">
                {val}
              </span>
              <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${bg}`}>
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${color}`}
                  style={{ width: `${val}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-550 w-8 shrink-0">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
