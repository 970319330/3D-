import React, { useEffect, useRef } from 'react';
import { KeyframeData, JointNode } from '../types';
import { Play, Pause, Square, Plus, Trash2, Zap, Sparkles, Rewind, Move } from 'lucide-react';
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

  // Preset generative animation patterns based on formulas:
  const applyPresetAnimation = (style: 'wave' | 'dance' | 'walk' | 'bend' | 'ik-walk') => {
    onPlayToggle(false);
    
    // Generate keyframes at clean split frames (0, 15, 30, 45, 59)
    const frameSplits = [0, 15, 30, 45, 59];
    const newKeyframes: KeyframeData[] = [];

    if (style === 'ik-walk') {
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
      return;
    }

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
        const isRight = nameLower.includes('r_') || nameLower.includes('right') || idLower.includes('r_') || idLower.includes('right');
        
        const isPelvis = nameLower.includes('root') || nameLower.includes('pelvis') || nameLower.includes('hips') || idLower.includes('root') || idLower.includes('pelvis') || idLower.includes('hips');
        const isSpine = nameLower.includes('spine') || nameLower.includes('chest') || nameLower.includes('torso') || idLower.includes('spine') || idLower.includes('chest') || idLower.includes('torso');
        const isNeckHead = nameLower.includes('neck') || nameLower.includes('head') || idLower.includes('neck') || idLower.includes('head');
        
        const isForearmElbow = nameLower.includes('elbow') || nameLower.includes('forearm') || idLower.includes('elbow') || idLower.includes('forearm');
        const isShoulderArm = (nameLower.includes('shoulder') || nameLower.includes('arm') || idLower.includes('shoulder') || idLower.includes('arm')) && !isForearmElbow && !nameLower.includes('leg');
        
        const isThighHip = nameLower.includes('hip') || nameLower.includes('upleg') || nameLower.includes('thigh') || nameLower.includes('upperleg') || idLower.includes('hip') || idLower.includes('upleg') || idLower.includes('thigh') || idLower.includes('upperleg');
        const isKneeCalf = (nameLower.includes('knee') || nameLower.includes('leg') || nameLower.includes('calf') || nameLower.includes('shin') || idLower.includes('knee') || idLower.includes('leg') || idLower.includes('calf') || idLower.includes('shin')) && !isThighHip && !nameLower.includes('foot') && !nameLower.includes('ankle') && !nameLower.includes('toe');
        const isFoot = nameLower.includes('foot') || nameLower.includes('ankle') || nameLower.includes('toe') || idLower.includes('foot') || idLower.includes('ankle') || idLower.includes('toe');

        if (style === 'wave') {
          // Unilateral highly natural right-hand waving motion with organic posture balancing and head nodding
          if (isShoulderArm) {
            if (isRight) {
              // Right arm raised high outwards and slightly forward
              rz = 1.35; 
              rx = -0.22 + Math.sin(radiansPhase * 2.0) * 0.05;
            } else {
              // Left arm hanging naturally at rest, slightly splayed is Left side (so Z is negative)
              rz = -0.15;
              rx = 0.12; 
            }
          }
          if (isForearmElbow) {
            if (isRight) {
              // Right elbow bent upwards and shaking sideways (high-frequency wave)
              rx = 1.15;
              ry = Math.sin(radiansPhase * 3.5) * 0.55; // pivot waving
              rz = -0.15 + Math.cos(radiansPhase * 3.5) * 0.15;
            } else {
              // Left elbow relaxed forward
              rx = 0.22;
            }
          }
          if (isSpine) {
            // Torso shifts weight to the left to counterweight the high wave on the right
            rx = 0.04 + Math.sin(radiansPhase) * 0.02;
            rz = -0.06 + Math.sin(radiansPhase * 2.0) * 0.03; // rhythmic body balance swaying
          }
          if (isNeckHead) {
            // Gentle nodding tilts towards the hand
            rz = 0.05 + Math.cos(radiansPhase * 2.0) * 0.04;
            rx = 0.04;
          }
        } else if (style === 'dance') {
          // Salsa hip rolls & rhythmic torso ripples (S-curve spine flow and bouncing knee-drops)
          if (isPelvis) {
            rz = Math.sin(radiansPhase) * 0.28; // Elegant side sway
            ry = Math.cos(radiansPhase) * 0.18; // rhythmic twist
            rx = Math.abs(Math.cos(radiansPhase)) * -0.08 - 0.05; // double-pace drop bounce
          }
          if (isSpine) {
            // Torso is phase-delayed by pi/4 to create a snake-like ripple effect
            const rippleSec = radiansPhase - Math.PI / 4.0;
            rx = Math.sin(radiansPhase * 2.0 - Math.PI / 4.0) * 0.12; // deep bounce contraction
            rz = -Math.sin(rippleSec) * 0.22; // counter balances hips lateral swing
            ry = -Math.sin(radiansPhase) * 0.12;
          }
          if (isNeckHead) {
            rz = Math.sin(radiansPhase) * 0.08;
            rx = 0.04 + Math.sin(radiansPhase * 2.0) * 0.03;
          }
          if (isShoulderArm) {
            // Elegant asynchronous arm waves
            if (isLeft) {
              rz = -0.65 + Math.sin(radiansPhase) * 0.25;
              rx = 0.2 + Math.cos(radiansPhase) * 0.25;
            } else {
              rz = 0.65 + Math.cos(radiansPhase) * 0.25;
              rx = 0.2 + Math.sin(radiansPhase) * 0.25;
            }
          }
          if (isForearmElbow) {
            // Double speed punch-coordination curl
            if (isLeft) {
              rx = 0.75 + Math.sin(radiansPhase * 2.0) * 0.25;
            } else {
              rx = 0.75 + Math.cos(radiansPhase * 2.0) * 0.25;
            }
          }
          if (isThighHip) {
            // Pelvis weight transfer to knee bend
            const baseLeg = isLeft ? radiansPhase : radiansPhase + Math.PI;
            rx = -0.05 - Math.max(0, Math.sin(baseLeg) * 0.12);
          }
          if (isKneeCalf) {
            const baseLeg = isLeft ? radiansPhase : radiansPhase + Math.PI;
            rx = 0.20 + Math.sin(baseLeg) * 0.18;
          }
          if (isFoot) {
            const baseLeg = isLeft ? radiansPhase : radiansPhase + Math.PI;
            rx = Math.max(0, -Math.sin(baseLeg)) * 0.15;
          }
        } else if (style === 'walk') {
          // Leg and arm movements are exactly 180 degrees out of phase across sagittal/coronal splits,
          // using anatomical parameters tracking a genuine human walking gait:
          const offsetPhase = isLeft ? radiansPhase : radiansPhase + Math.PI;

          if (isThighHip) {
            // Hip flexion has peak angle of 23° / 0.4 rad (swing forward, negative) 
            // and extension of 11° / -0.2 rad (stance backward, positive)
            rx = -0.10 + Math.sin(offsetPhase) * 0.30; 
            rz = (isLeft ? -1 : 1) * 0.05; // natural splay width
          }
          
          if (isKneeCalf) {
            // Biomechanically accurate double-peak knee action:
            // Peak 1: Early swing phase flexion to let foot clear ground (approx 55 degrees / 0.95 rad)
            // Peak 2: Stance phase shock absorption / dampening (approx 12 degrees / 0.20 rad)
            const legSwing = Math.sin(offsetPhase);
            rx = legSwing > 0 
              ? legSwing * 0.95 + 0.05 
              : Math.max(0.05, Math.abs(legSwing) * 0.24); // smooth spring loading during stance
          }

          if (isFoot) {
            // Dorsiflexes up (rx < 0) during swing to avoid toe-drag; plantarflexes down (rx > 0) at push-off
            const legSwing = Math.sin(offsetPhase);
            rx = legSwing > 0 ? -0.12 : 0.22 * Math.sin(offsetPhase + 0.2);
          }
          
          if (isShoulderArm) {
            // Arm swings opposite to same-side leg
            const armPhase = isLeft ? radiansPhase + Math.PI : radiansPhase;
            rx = Math.sin(armPhase) * 0.28; // swing amplitude
            rz = (isLeft ? -1 : 1) * (0.15 + Math.sin(radiansPhase) * 0.04); // clear hip profile dynamically
          }
          
          if (isForearmElbow) {
            const armPhase = isLeft ? radiansPhase + Math.PI : radiansPhase;
            // Elbow angles flex forward when arm swings forward, and extends swing back
            rx = 0.40 + Math.sin(armPhase) * 0.18;
          }

          if (isPelvis) {
            // Transverse pelvis rot, hip drop on swing leg and double vertical bobbing
            // Hips bounce down twice per full stride cycle (during double-support transfer)
            rx = -0.04 + Math.sin(radiansPhase * 2.0) * 0.03;
            rz = Math.sin(radiansPhase) * 0.04; // coronal tilt
            ry = Math.cos(radiansPhase) * 0.06; // transverse twist
          }
          
          if (isSpine) {
            // Upper spine and shoulder girdle rotate opposite to keep alignment
            ry = -Math.cos(radiansPhase) * 0.04;
            rz = -Math.sin(radiansPhase) * 0.03;
            rx = 0.03 + Math.sin(radiansPhase * 2.0) * 0.01;
          }

          if (isNeckHead) {
            // Head is anatomically stabilized, correcting for hip/chest rotations
            rx = 0.02 - Math.sin(radiansPhase * 2.0) * 0.015;
            rz = -Math.sin(radiansPhase) * 0.01;
          }
        } else {
          // Elegant classical bowing movement using a custom power phase curve f(x) = sin^2(x)
          // to slow down at the maximum stretch state for a respectful posture holding:
          const scale = Math.pow(Math.sin(radiansPhase / 2.0), 2.2);

          if (isSpine) {
            // Deep chest-head-spine coordinate hinge
            rx = scale * 0.75; // ~43 degrees forward bow
          }
          if (isPelvis) {
            // Hips slide slightly backwards to offset gravity shift (keeping balance)
            rx = scale * 0.22;
          }
          if (isNeckHead) {
            // Head tilts down respecting spine angle
            rx = scale * 0.32;
          }
          if (isThighHip) {
            rx = scale * 0.16; // soft hip tilt flex
          }
          if (isKneeCalf) {
            rx = scale * 0.12; // slight knee cushion
          }
          if (isFoot) {
            rx = scale * -0.04;
          }
          if (isShoulderArm) {
            // Hands slide gracefully along the side/front of thighs symmetrically
            rz = (isLeft ? -1 : 1) * (0.16 - scale * 0.08);
            rx = scale * -0.28;
          }
          if (isForearmElbow) {
            rx = scale * 0.15; // natural thumb alignment bend
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
              onClick={() => applyPresetAnimation('ik-walk')}
              className="flex items-center gap-1 bg-amber-500/10 hover:bg-amber-550 border border-amber-500/30 text-amber-300 hover:text-white px-2.5 py-1 rounded transition duration-150 cursor-pointer font-bold"
              title="使用 3D CCD-IK 逆向动力学算子物理生成骨骼步态轨迹"
            >
              <Move className="w-3 h-3" />
              <span>IK 智能步态</span>
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
