import React, { useEffect, useRef } from 'react';
import { KeyframeData, JointNode } from '../types';
import { Play, Pause, Square, Plus, Trash2, Move } from 'lucide-react';
import { generateIKWalkCycle } from '../utils/ik';

interface TimelineProps {
  currentFrame: number;
  keyframes: KeyframeData[];
  isPlaying: boolean;
  onFrameChange: (frame: number) => void;
  onPlayToggle: (playing: boolean) => void;
  onKeyframesUpdate: (keyframes: KeyframeData[]) => void;
  joints: JointNode[];
  onJointsUpdate: (joints: JointNode[]) => void;
}

export default function Timeline({
  currentFrame,
  keyframes,
  isPlaying,
  onFrameChange,
  onPlayToggle,
  onKeyframesUpdate,
  joints,
  onJointsUpdate
}: TimelineProps) {
  const maxFrames = 60; // 0 to 59 frames loop
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Playback timer progression
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = 1000 / 24; // 24 FPS standard
      timerRef.current = setInterval(() => {
        onFrameChange((currentFrame + 1) % maxFrames);
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, currentFrame]);

  // Sync keyframe rotations back to joint sliders when scrubbing on the timeline manually
  useEffect(() => {
    if (!isPlaying && keyframes.length > 0) {
      const exactMatch = keyframes.find(k => k.frame === currentFrame);
      if (exactMatch) {
         let changed = false;
         const nextJoints = joints.map(joint => {
           const stored = exactMatch.rotations[joint.id];
           if (stored) {
             const hasDiff = Math.abs(joint.rotation[0] - stored[0]) > 0.001 ||
                             Math.abs(joint.rotation[1] - stored[1]) > 0.001 ||
                             Math.abs(joint.rotation[2] - stored[2]) > 0.001;
             if (hasDiff) {
               changed = true;
               return { ...joint, rotation: [...stored] as [number, number, number] };
             }
           }
           return joint;
         });
         if (changed) {
           onJointsUpdate(nextJoints);
         }
      }
    }
  }, [currentFrame, isPlaying, keyframes, joints, onJointsUpdate]);

  const handleFrameClick = (frame: number) => {
    onFrameChange(frame);
  };

  const handleInsertKeyframe = () => {
    // Collect present rotations of all joints
    const rotationsMap: Record<string, [number, number, number]> = {};
    joints.forEach((j) => {
      rotationsMap[j.id] = [...j.rotation] as [number, number, number];
    });

    // Replace if frame exists, otherwise insert cleanly
    const existingIdx = keyframes.findIndex(k => k.frame === currentFrame);
    if (existingIdx !== -1) {
      const copy = [...keyframes];
      copy[existingIdx] = { frame: currentFrame, rotations: rotationsMap };
      onKeyframesUpdate(copy);
    } else {
      onKeyframesUpdate([...keyframes, { frame: currentFrame, rotations: rotationsMap }]);
    }
  };

  const handleDeleteKeyframe = () => {
    const updated = keyframes.filter(k => k.frame !== currentFrame);
    onKeyframesUpdate(updated);
  };

  const handleClearAll = () => {
    onKeyframesUpdate([]);
    // Restore zero-pose
    const cleared = joints.map(j => ({ ...j, rotation: [0, 0, 0] as [number, number, number] }));
    onJointsUpdate(cleared);
  };

  // Preset animation: Smart IK-driven arm swing gait
  const applyPresetAnimation = () => {
    onPlayToggle(false);
    
    // Generate smart IK walk cycle with enhanced arm swing
    const frameSplits = [0, 15, 30, 45, 59];
    const newKeyframes: KeyframeData[] = [];
    
    const generated = generateIKWalkCycle(joints);
    generated.forEach((rotations, index) => {
      newKeyframes.push({
        frame: frameSplits[index],
        rotations: rotations
      });
    });
    onKeyframesUpdate(newKeyframes);
    onFrameChange(0);
    setTimeout(() => {
      onPlayToggle(true);
    }, 150);
  };

  const hasKeyframeAtCurrent = keyframes.some(k => k.frame === currentFrame);

  return (
    <div className="bg-slate-900/90 border-t border-slate-800 p-4 shrink-0 flex flex-col gap-4 select-none">
      {/* Top Slider and keyframe dot markers */}
      <div className="flex flex-col gap-2 relative">
        <div className="flex justify-between items-center text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-mono text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1">
              帧号 {currentFrame.toString().padStart(2, '0')} / {maxFrames - 1}
            </span>
            <span className="text-slate-500 text-[10px]">（24帧每秒 动作循环）</span>
          </div>

          <div className="flex gap-2 text-[10px]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => applyPresetAnimation()}
              className="flex items-center gap-1 bg-amber-500/10 hover:bg-amber-550 border border-amber-500/30 text-amber-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer font-bold"
              title="使用 3D CCD-IK 逆向动力学算子物理生成智能摆臂步态轨迹"
            >
              <Move className="w-3 h-3" />
              <span>IK 智能摆臂步态</span>
            </button>
          </div>
        </div>

        {/* Dynamic Timeline track */}
        <div className="relative pt-4 pb-2 bg-slate-950/60 rounded-lg px-2 border border-slate-800/80">
          {/* Keyframe Dot Indicators layered over timeline */}
          <div className="absolute top-[1.25rem] left-2 right-2 h-4 pointer-events-none">
            {keyframes.map((k) => {
              const pct = (k.frame / (maxFrames - 1)) * 100;
              return (
                <div
                  key={k.frame}
                  className={`absolute w-2.5 h-2.5 rounded-full border border-slate-950 transform -translate-x-1/2 cursor-pointer transition-transform hover:scale-125 ${
                    k.frame === currentFrame ? 'bg-amber-400 scale-125' : 'bg-indigo-400'
                  }`}
                  style={{ left: `${pct}%`, top: '1px' }}
                  title={`关键帧 @ 帧 ${k.frame}`}
                />
              );
            })}
          </div>

          <input
            type="range"
            min="0"
            max={maxFrames - 1}
            value={currentFrame}
            onChange={(e) => handleFrameClick(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 pt-0.5"
          />

          <div className="flex justify-between text-[10px] text-slate-600 font-mono mt-1 px-1">
            <span>F_00</span>
            <span>F_15</span>
            <span>F_30</span>
            <span>F_45</span>
            <span>F_59</span>
          </div>
        </div>
      </div>

      {/* Playback Buttons Layout */}
      <div className="flex items-center justify-between border-t border-slate-800/60 pt-3">
        {/* Simple playback speed buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPlayToggle(!isPlaying)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold select-none cursor-pointer transition shadow ${
              isPlaying
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-slate-950" />
                <span>暂停播放</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>播放动作</span>
              </>
            )}
          </button>

          {isPlaying && (
            <button
              onClick={() => onPlayToggle(false)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg cursor-pointer transition"
              title="停止"
            >
              <Square className="w-3.5 h-3.5 fill-slate-300" />
            </button>
          )}
        </div>

        {/* Keyframe insert and deletions controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleInsertKeyframe}
            className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
              hasKeyframeAtCurrent
                ? 'bg-indigo-950/60 border-indigo-700/60 text-indigo-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
            title="在此帧记录骨骼偏转角度"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{hasKeyframeAtCurrent ? '覆盖关键帧' : '录入关键帧'}</span>
          </button>

          {hasKeyframeAtCurrent && (
            <button
              onClick={handleDeleteKeyframe}
              className="flex items-center gap-1 border border-red-900 hover:border-red-800 bg-red-950/20 hover:bg-red-950/60 text-red-300 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition"
              title="清除当前帧的关键帧"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除帧</span>
            </button>
          )}

          <button
            onClick={handleClearAll}
            className="border border-slate-800 hover:border-slate-700 bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition"
          >
            清空所有动画
          </button>
        </div>
      </div>
    </div>
  );
}
