import React, { useEffect, useRef } from 'react';
import { KeyframeData, JointNode } from '../types';
import { Play, Pause, Square, Plus, Trash2, Zap, Sparkles, Rewind } from 'lucide-react';

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

  // Preset generative animation patterns based on formulas:
  const applyPresetAnimation = (style: 'wave' | 'dance' | 'walk' | 'bend') => {
    onPlayToggle(false);
    
    // Generate keyframes at clean split frames (0, 15, 30, 45, 59)
    const frameSplits = [0, 15, 30, 45, 59];
    const newKeyframes: KeyframeData[] = [];

    frameSplits.forEach((f) => {
      const rotationsMap: Record<string, [number, number, number]> = {};
      const radiansPhase = (f / maxFrames) * Math.PI * 2;

      joints.forEach((joint) => {
        let rx = 0;
        let ry = 0;
        let rz = 0;

        const nameLower = joint.name.toLowerCase();
        const idLower = joint.id.toLowerCase();
        
        // Comprehensive mapping covering humanoid skeletons: Mixamo, Rigify, Custom, Chinese translations, etc.
        const isLeft = nameLower.includes('l_') || nameLower.includes('left') || idLower.includes('l_') || idLower.includes('left');
        
        const isPelvis = nameLower.includes('root') || nameLower.includes('pelvis') || nameLower.includes('hips') || idLower.includes('root') || idLower.includes('pelvis') || idLower.includes('hips');
        const isSpine = nameLower.includes('spine') || nameLower.includes('chest') || nameLower.includes('torso') || idLower.includes('spine') || idLower.includes('chest') || idLower.includes('torso');
        const isNeckHead = nameLower.includes('neck') || nameLower.includes('head') || idLower.includes('neck') || idLower.includes('head');
        
        const isForearmElbow = nameLower.includes('elbow') || nameLower.includes('forearm') || idLower.includes('elbow') || idLower.includes('forearm');
        const isShoulderArm = (nameLower.includes('shoulder') || nameLower.includes('arm') || idLower.includes('shoulder') || idLower.includes('arm')) && !isForearmElbow && !nameLower.includes('leg');
        
        const isThighHip = nameLower.includes('hip') || nameLower.includes('upleg') || nameLower.includes('thigh') || nameLower.includes('upperleg') || idLower.includes('hip') || idLower.includes('upleg') || idLower.includes('thigh') || idLower.includes('upperleg');
        const isKneeCalf = (nameLower.includes('knee') || nameLower.includes('leg') || nameLower.includes('calf') || nameLower.includes('shin') || idLower.includes('knee') || idLower.includes('leg') || idLower.includes('calf') || idLower.includes('shin')) && !isThighHip && !nameLower.includes('foot') && !nameLower.includes('ankle') && !nameLower.includes('toe');

        if (style === 'wave') {
          // Wave raised arm dynamically; keep opposite arm stationary with relaxed natural angle
          if (isShoulderArm || isForearmElbow) {
            if (isLeft) {
              // Left arm waving high
              rz = -0.7 + Math.sin(radiansPhase * 2.0) * 0.45; // quick-tempo waving
              rx = -0.15 + Math.cos(radiansPhase) * 0.15;
            } else {
              // Right arm waving splayed symmetrically
              rz = 0.7 + Math.sin(radiansPhase * 2.0) * 0.45;
              rx = -0.15 + Math.cos(radiansPhase) * 0.15;
            }
          }
          // Spine sways gently in resonance
          if (isSpine) {
            rx = Math.sin(radiansPhase) * 0.08;
            ry = Math.cos(radiansPhase) * 0.05;
          }
          if (isNeckHead) {
            rz = Math.sin(radiansPhase) * 0.06;
          }
        } else if (style === 'dance') {
          // Energetic rhythmic dancing containing bouncing pelvis sway, bicep curls, and spinal twisting
          if (isPelvis) {
            rz = Math.sin(radiansPhase) * 0.35; // Hip sway side-to-side
            ry = Math.cos(radiansPhase) * 0.22; // Hip twisting
            rx = Math.abs(Math.sin(radiansPhase * 2.0)) * -0.12; // bounce down-and-up
          }
          if (isSpine) {
            rx = Math.sin(radiansPhase * 2.0) * 0.18; // double-pace spinal nod
            ry = Math.sin(radiansPhase) * 0.15;
            rz = Math.cos(radiansPhase) * 0.1;
          }
          if (isShoulderArm) {
            rx = Math.sin(radiansPhase) * 0.45;
            rz = (isLeft ? -1 : 1) * (0.55 + Math.sin(radiansPhase * 2.0) * 0.25);
          }
          if (isForearmElbow) {
            // coordinated pump loops
            rx = 0.7 + Math.sin(radiansPhase * 2.0) * 0.35;
          }
          if (isThighHip) {
            rx = Math.sin(radiansPhase) * 0.25;
          }
        } else if (style === 'walk') {
          // Seamless walking cycle where left & right sides are 180 degrees out of phase
          const offsetPhase = isLeft ? radiansPhase : radiansPhase + Math.PI;

          // Leg swinging back and forth
          if (isThighHip) {
            rx = Math.sin(offsetPhase) * 0.55; // thigh swing
            rz = (isLeft ? -1 : 1) * 0.05; // slight outward stance comfort
          }
          
          if (isKneeCalf) {
            // Knee bends only backward (positive/negative depending on skeletal frame) during swing phase
            // Typically we only bend knees (rx > 0) when the leg swings backward (sin < 0)
            const bendFactor = Math.sin(offsetPhase + Math.PI / 5.0);
            rx = Math.max(0, bendFactor * 0.85); 
          }
          
          // Coordinated arm swing in complete opposition to leg gait
          if (isShoulderArm) {
            const armPhase = isLeft ? radiansPhase + Math.PI : radiansPhase;
            rx = Math.sin(armPhase) * 0.42; // swing
            rz = (isLeft ? -1 : 1) * (0.12 + Math.sin(radiansPhase) * 0.08); // dynamic shoulder width spacing
          }
          
          if (isForearmElbow) {
            const armPhase = isLeft ? radiansPhase + Math.PI : radiansPhase;
            // Elbows naturally fold slightly forward as the arm swings forward
            rx = 0.35 + Math.sin(armPhase) * 0.22;
          }

          // Pelvis bounces down and up twice per full walk stride
          if (isPelvis) {
            rx = Math.abs(Math.sin(radiansPhase * 2.0)) * -0.06 - 0.02;
            ry = Math.sin(radiansPhase) * 0.1; // pelvic rotation
          }
          // Neck counter-balances hip sways
          if (isNeckHead) {
            rx = 0.05 + Math.sin(radiansPhase * 2.0) * 0.05;
          }
        } else {
          // Forward Bowing exercise
          if (isSpine) {
            rx = 0.55 + Math.sin(radiansPhase) * 0.55; // Elegant deep chest/back bow
          }
          if (isPelvis) {
            rx = 0.25 + Math.sin(radiansPhase) * 0.25; // Hips carry center of gravity back
          }
          if (isNeckHead) {
            rx = 0.22 + Math.sin(radiansPhase) * 0.22; // Neck folds forward gracefully
          }
          if (isKneeCalf) {
            // Knee bends slightly to maintain weight balance during the bow
            rx = Math.max(0, -Math.sin(radiansPhase) * 0.18);
          }
          if (isShoulderArm) {
            // Arms hang relaxed down due to gravity during bow
            rz = (isLeft ? -1 : 1) * 0.15;
            rx = -Math.sin(radiansPhase) * 0.15;
          }
        }

        rotationsMap[joint.id] = [rx, ry, rz];
      });

      newKeyframes.push({ frame: f, rotations: rotationsMap });
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
              onClick={() => applyPresetAnimation('wave')}
              className="flex items-center gap-1 bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>招手预设</span>
            </button>
            <button
              onClick={() => applyPresetAnimation('dance')}
              className="flex items-center gap-1 bg-violet-500/20 hover:bg-violet-500 text-violet-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer"
            >
              <Zap className="w-3 h-3" />
              <span>摇摆热舞</span>
            </button>
            <button
              onClick={() => applyPresetAnimation('walk')}
              className="flex items-center gap-1 bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer"
            >
              <Rewind className="w-3 h-3 rotate-180" />
              <span>步行姿态</span>
            </button>
            <button
              onClick={() => applyPresetAnimation('bend')}
              className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer"
            >
              <span>深腹鞠躬</span>
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
