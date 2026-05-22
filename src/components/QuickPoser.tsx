import React, { useState, useEffect, useCallback } from 'react';
import { JointNode } from '../types';
import { Sparkles, RotateCw, Dumbbell, Accessibility, RefreshCw, Wand2, Target, Move, Sliders } from 'lucide-react';
import { solveCCDIK, computeWorldTransforms } from '../utils/ik';

interface QuickPoserProps {
  joints: JointNode[];
  onUpdateJoints: (newJoints: JointNode[]) => void;
  selectedJointId: string | null;
  onSelectJoint: (id: string | null) => void;
}

export default function QuickPoser({
  joints,
  onUpdateJoints,
  selectedJointId,
  onSelectJoint
}: QuickPoserProps) {

  // --- 逆向运动学 (Inverse Kinematics) 核心状态与算法绑定 ---
  const [ikLimb, setIkLimb] = useState<'left-arm' | 'right-arm' | 'left-leg' | 'right-leg'>('right-arm');
  const [ikTarget, setIkTarget] = useState({ x: 0.6, y: 1.3, z: 0.0 });
  const [showIKConfig, setShowIKConfig] = useState<boolean>(true);

  // 获取特定肢体链的节点与终端效应器配置
  const getIKChainDetails = (limbType: 'left-arm' | 'right-arm' | 'left-leg' | 'right-leg') => {
    switch (limbType) {
      case 'left-arm':
        return {
          chainIds: ['l_shoulder', 'l_elbow'],
          endId: 'l_elbow',
          label: '左上肢 (左肘端效器)'
        };
      case 'right-arm':
        return {
          chainIds: ['r_shoulder', 'r_elbow'],
          endId: 'r_elbow',
          label: '右上肢 (右肘端效器)'
        };
      case 'left-leg':
        return {
          chainIds: ['l_hip', 'l_knee', 'l_foot'],
          endId: 'l_foot',
          label: '左下肢 (左脚终端)'
        };
      case 'right-leg':
        return {
          chainIds: ['r_hip', 'r_knee', 'r_foot'],
          endId: 'r_foot',
          label: '右下肢 (右脚终端)'
        };
    }
  };

  // 将滑块的坐标数值直接锁定至当前物理实体终端骨骼真正的全球绝对坐标
  const syncIKTargetToEffector = useCallback((limbType: typeof ikLimb) => {
    try {
      const details = getIKChainDetails(limbType);
      const transforms = computeWorldTransforms(joints);
      const transform = transforms.get(details.endId);
      if (transform) {
        const pos = transform.worldPosition;
        setIkTarget({
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          z: Number(pos.z.toFixed(2))
        });
      }
    } catch (err) {
      console.warn("Failed to sync effector world position:", err);
    }
  }, [joints]);

  // 切换目标部位时，立刻进行坐标自动对准
  useEffect(() => {
    syncIKTargetToEffector(ikLimb);
  }, [ikLimb, syncIKTargetToEffector]);

  // 当滑块在前端被拖移时，立刻联动微秒级的 CCD-IK 算子，重算链路并输出关节组旋转角度
  const handleIKTargetChange = (axis: 'x' | 'y' | 'z', value: number) => {
    const nextTarget = { ...ikTarget, [axis]: value };
    setIkTarget(nextTarget);

    const details = getIKChainDetails(ikLimb);
    const solved = solveCCDIK(joints, details.chainIds, details.endId, [nextTarget.x, nextTarget.y, nextTarget.z], 15);
    onUpdateJoints(solved);
  };

  // 通过预设空间绝对座标快捷驱动骨骼生成
  const applyIKPreset = (x: number, y: number, z: number) => {
    setIkTarget({ x, y, z });
    const details = getIKChainDetails(ikLimb);
    const solved = solveCCDIK(joints, details.chainIds, details.endId, [x, y, z], 22);
    onUpdateJoints(solved);
  };

  // Helper to identify standard humanoid limb types based on name/id heuristic
  const classifyJoint = (j: JointNode) => {
    const nameL = j.name.toLowerCase();
    const idL = j.id.toLowerCase();

    const isLeft = nameL.includes('l_') || nameL.includes('left') || idL.includes('l_') || idL.includes('left');
    const isRight = nameL.includes('r_') || nameL.includes('right') || idL.includes('r_') || idL.includes('right');

    const isForearmElbow = nameL.includes('elbow') || nameL.includes('forearm') || idL.includes('elbow') || idL.includes('forearm');
    const isShoulderArm = (nameL.includes('shoulder') || nameL.includes('arm') || idL.includes('shoulder') || idL.includes('arm')) && !isForearmElbow && !nameL.includes('leg');
    
    const isThighHip = nameL.includes('hip') || nameL.includes('upleg') || nameL.includes('thigh') || nameL.includes('upperleg') || idL.includes('hip') || idL.includes('upleg') || idL.includes('thigh') || idL.includes('upperleg');
    const isKneeCalf = (nameL.includes('knee') || nameL.includes('leg') || nameL.includes('calf') || nameL.includes('shin') || idL.includes('knee') || idL.includes('leg') || idL.includes('calf') || idL.includes('shin')) && !isThighHip && !nameL.includes('foot') && !nameL.includes('ankle') && !nameL.includes('toe');
    const isFoot = nameL.includes('foot') || nameL.includes('ankle') || nameL.includes('toe') || idL.includes('foot') || idL.includes('ankle') || idL.includes('toe');

    const isSpine = nameL.includes('spine') || nameL.includes('chest') || nameL.includes('torso') || idL.includes('spine') || idL.includes('chest') || idL.includes('torso');
    const isNeckHead = nameL.includes('neck') || nameL.includes('head') || idL.includes('neck') || idL.includes('head');

    return {
      isLeft,
      isRight,
      isShoulderArm,
      isForearmElbow,
      isThighHip,
      isKneeCalf,
      isFoot,
      isSpine,
      isNeckHead
    };
  };

  // Preset Posing operations
  const applyPoseUpdate = (updater: (j: JointNode, info: ReturnType<typeof classifyJoint>) => [number, number, number] | null) => {
    let affectedCount = 0;
    const nextJoints = joints.map((joint) => {
      const info = classifyJoint(joint);
      const newRot = updater(joint, info);
      if (newRot) {
        affectedCount++;
        return { ...joint, rotation: newRot };
      }
      return joint;
    });
    
    if (affectedCount > 0) {
      onUpdateJoints(nextJoints);
    }
  };

  // Clear pose offsets (zero out rotation parameters)
  const resetAllJoints = () => {
    const nextJoints = joints.map((j) => ({
      ...j,
      rotation: [0, 0, 0] as [number, number, number]
    }));
    onUpdateJoints(nextJoints);
  };

  // Poser Functions
  const raiseHand = (side: 'left' | 'right') => {
    applyPoseUpdate((joint, info) => {
      // Raising hand from T-pose:
      // Since T-pose arms are already splayed outward horizontally, raising hands means
      // bending the elbow joint upwards (about 1.3 - 1.5 rad) and elevating the shoulder slightly.
      if (side === 'left' && info.isLeft) {
        if (info.isShoulderArm) return [0.1, 0.1, -1.0]; // Raise shoulder up & forward
        if (info.isForearmElbow) return [0, 0, -1.4];   // Flex elbow pointing forearm up
      }
      if (side === 'right' && info.isRight) {
        if (info.isShoulderArm) return [-0.1, -0.1, 1.0]; // Raise shoulder up & forward
        if (info.isForearmElbow) return [0, 0, 1.4];     // Flex elbow pointing forearm up
      }
      return null;
    });
  };

  const lowerHand = (side: 'left' | 'right') => {
    applyPoseUpdate((joint, info) => {
      if (side === 'left' && info.isLeft && (info.isShoulderArm || info.isForearmElbow)) {
        return [0, 0, 0];
      }
      if (side === 'right' && info.isRight && (info.isShoulderArm || info.isForearmElbow)) {
        return [0, 0, 0];
      }
      return null;
    });
  };

  const raiseLeg = (side: 'left' | 'right') => {
    applyPoseUpdate((joint, info) => {
      if (side === 'left' && info.isLeft) {
        if (info.isThighHip) return [-0.8, 0, 0.1]; // Swing thigh forward
        if (info.isKneeCalf) return [1.2, 0, 0];   // Flex knee backward
      }
      if (side === 'right' && info.isRight) {
        if (info.isThighHip) return [-0.8, 0, -0.1]; // Swing thigh forward
        if (info.isKneeCalf) return [1.2, 0, 0];    // Flex knee backward
      }
      return null;
    });
  };

  const lowerLeg = (side: 'left' | 'right') => {
    applyPoseUpdate((joint, info) => {
      if (side === 'left' && info.isLeft && (info.isThighHip || info.isKneeCalf || info.isFoot)) {
        return [0, 0, 0];
      }
      if (side === 'right' && info.isRight && (info.isThighHip || info.isKneeCalf || info.isFoot)) {
        return [0, 0, 0];
      }
      return null;
    });
  };

  // Advanced creative postures
  const applyMacroPose = (poseType: 'greeting' | 'prayer' | 'kick' | 'bow' | 'balance') => {
    applyPoseUpdate((joint, info) => {
      switch (poseType) {
        case 'greeting': // Classy right hand waving, left arm hanging relaxed at the side
          if (info.isRight) {
            // Right arm raised, splayed out-and-up, slightly rotated forward
            if (info.isShoulderArm) return [0.2, -0.2, 0.7]; 
            // Right elbow bent deeply (~85 degrees) to pointing forearm up for a beautiful wave
            if (info.isForearmElbow) return [0, 0, 1.5];
          }
          if (info.isLeft) {
            // Left arm relaxed hanging naturally down next to the hips
            if (info.isShoulderArm) return [0, 0, -1.3];
            if (info.isForearmElbow) return [0, 0, -0.15];
          }
          if (info.isSpine) return [0.05, 0, 0.05]; // Slight weight shift tilt
          if (info.isNeckHead) return [0.08, 0, -0.05]; // Head tilted slightly towards wave
          return null;

        case 'prayer': // Traditional palm-joined greeting/prayer in front of chest
          if (info.isLeft) {
            if (info.isShoulderArm) return [0.4, 0.4, -0.8]; // rotate shoulder forward and inward
            if (info.isForearmElbow) return [0, 0, -1.3];   // flex elbow inwards
          }
          if (info.isRight) {
            if (info.isShoulderArm) return [0.4, -0.4, 0.8]; // rotate shoulder forward and inward
            if (info.isForearmElbow) return [0, 0, 1.3];     // flex elbow inwards
          }
          if (info.isSpine) return [0.12, 0, 0]; // Modest spinal neck dip bowing
          if (info.isNeckHead) return [0.18, 0, 0]; // Chin tucked
          return null;

        case 'kick': // Martial arts side-kick pose
          if (info.isRight) { // Standing base leg
            if (info.isThighHip) return [0.15, 0, -0.05];
            if (info.isKneeCalf) return [0.25, 0, 0];
          }
          if (info.isLeft) { // Striking kick leg raised high and outwards
            if (info.isThighHip) return [-1.1, 0, 0.45]; // Swing thigh up and out
            if (info.isKneeCalf) return [0.4, 0, 0];    // Knee slightly bent for strength
          }
          if (info.isShoulderArm) { // Lateral balance arms
            return info.isLeft ? [0.1, 0, -0.9] : [-0.1, 0, 0.9];
          }
          if (info.isForearmElbow) {
            return info.isLeft ? [0, 0, -0.3] : [0, 0, 0.3];
          }
          if (info.isSpine) return [0.12, 0, -0.28]; // Torso leaning away to maintain gravity center
          if (info.isNeckHead) return [0.1, 0, -0.1];
          return null;

        case 'bow': // Respectful deep bowing posture
          if (info.isSpine) return [0.65, 0, 0]; // Flex waist/spine forward
          if (info.isNeckHead) return [0.28, 0, 0]; // Head nodding down
          if (info.isShoulderArm) {
            // Arms hanging naturally down along gravity vectors
            return info.isLeft ? [0.15, 0, -0.25] : [0.15, 0, 0.25];
          }
          if (info.isThighHip) return [0.14, 0, 0]; // Hips sit back slightly for balance
          if (info.isKneeCalf) return [0.1, 0, 0];  // Soft knees
          return null;

        case 'balance': // Martial arts "Crane stance" standing on one leg
          if (info.isRight) { // Standing leg
            if (info.isThighHip) return [0.12, 0, -0.04];
            if (info.isKneeCalf) return [0.22, 0, 0];
          }
          if (info.isLeft) { // Knee raised high with shin straight down
            if (info.isThighHip) return [-1.2, 0, 0.15]; // Thigh raised high forward
            if (info.isKneeCalf) return [1.8, 0, 0];     // Flex knee deeply to point foot down
          }
          if (info.isShoulderArm) { // Wings spread horizontally splayed for balance
            return info.isLeft ? [0, 0, -1.25] : [0, 0, 1.25];
          }
          if (info.isForearmElbow) { // Soft elbow balance bends
            return info.isLeft ? [0, 0, -0.4] : [0, 0, 0.4];
          }
          if (info.isSpine) return [0.08, 0, 0.05];
          return null;

        default:
          return null;
      }
    });
  };

  // Symmetry Mirroring: Mirror angle from selected joint to its symmetrical opposite
  const mirrorSelectedJoint = () => {
    if (!selectedJointId) return;
    const selectedJoint = joints.find(j => j.id === selectedJointId);
    if (!selectedJoint) return;

    const sourceName = selectedJoint.name.toLowerCase();
    const sourceId = selectedJoint.id.toLowerCase();
    
    // Determine the target symmetric match by swapping L/R prefixes/suffixes
    let targetNamePattern = '';
    const isLeft = sourceName.includes('left') || sourceName.includes('l_') || sourceId.includes('left') || sourceId.includes('l_');
    const isRight = sourceName.includes('right') || sourceName.includes('r_') || sourceId.includes('right') || sourceId.includes('r_');

    if (!isLeft && !isRight) {
      // Non-symmetrical bones (e.g. spine, pelvis, neck) don't need symmetry
      return;
    }

    const nextJoints = joints.map((joint) => {
      const targetName = joint.name.toLowerCase();
      const targetId = joint.id.toLowerCase();
      
      let isMatch = false;
      if (isLeft) {
        // Source is Left, looking for Right
        const baseName = sourceName.replace('left', '').replace('l_', '');
        const targetBase = targetName.replace('right', '').replace('r_', '');
        if (baseName === targetBase && (targetName.includes('right') || targetName.includes('r_') || targetId.includes('right') || targetId.includes('r_'))) {
          isMatch = true;
        }
      } else if (isRight) {
        // Source is Right, looking for Left
        const baseName = sourceName.replace('right', '').replace('r_', '');
        const targetBase = targetName.replace('left', '').replace('l_', '');
        if (baseName === targetBase && (targetName.includes('left') || targetName.includes('l_') || targetId.includes('left') || targetId.includes('l_'))) {
          isMatch = true;
        }
      }

      if (isMatch) {
        const [rx, ry, rz] = selectedJoint.rotation;
        // Mirror angle: X, Y usually inverted, Z depending on humanoid bone orientation setup.
        // For standard Three.js skeletal orientations, mirroring space is reflected on sagittal axis (multiply by appropriate signs)
        return {
          ...joint,
          rotation: [rx, -ry, -rz] as [number, number, number] // reflect around sagittal plane
        };
      }
      return joint;
    });

    onUpdateJoints(nextJoints);
  };

  return (
    <div id="quick-poser-container" className="bg-[#0b121e]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3.5 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-850 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider">
          <Wand2 className="w-4 h-4 text-amber-500" />
          <span>姿态库 & 快捷手脚调姿</span>
        </div>
        <button
          onClick={resetAllJoints}
          className="text-[10px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700/80 px-2 py-1 rounded border border-slate-700/40 transition flex items-center gap-1 cursor-pointer"
          title="归零所有骨骼偏转角"
        >
          <RefreshCw className="w-3 h-3" />
          <span>重置站姿 (T-Pose)</span>
        </button>
      </div>

      {/* Manual Limb pose shorteners */}
      <div className="grid grid-cols-2 gap-3">
        {/* Left Hand Controls Box */}
        <div id="left-hand-controls" className="bg-slate-950/40 border border-slate-850/60 p-2.5 rounded-lg flex flex-col gap-1.5">
          <div className="text-[10px] text-slate-400 font-bold tracking-wider border-b border-slate-900 pb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span>左肢套件 (左手)</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => raiseHand('left')}
              className="flex-1 bg-sky-600/15 hover:bg-sky-600 text-sky-300 hover:text-white px-2 py-1 text-[11px] font-semibold border border-sky-500/20 rounded transition cursor-pointer"
            >
              抬起
            </button>
            <button
              onClick={() => lowerHand('left')}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 text-[11px] font-medium border border-slate-700/40 rounded transition cursor-pointer"
            >
              放回
            </button>
          </div>
        </div>

        {/* Right Hand Controls Box */}
        <div id="right-hand-controls" className="bg-slate-950/40 border border-slate-850/60 p-2.5 rounded-lg flex flex-col gap-1.5">
          <div className="text-[10px] text-slate-400 font-bold tracking-wider border-b border-slate-900 pb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            <span>右肢套件 (右手)</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => raiseHand('right')}
              className="flex-1 bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white px-2 py-1 text-[11px] font-semibold border border-violet-500/20 rounded transition cursor-pointer"
            >
              抬起
            </button>
            <button
              onClick={() => lowerHand('right')}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 text-[11px] font-medium border border-slate-700/40 rounded transition cursor-pointer"
            >
              放回
            </button>
          </div>
        </div>

        {/* Left Foot Controls Box */}
        <div id="left-foot-controls" className="bg-slate-950/40 border border-slate-850/60 p-2.5 rounded-lg flex flex-col gap-1.5">
          <div className="text-[10px] text-slate-400 font-bold tracking-wider border-b border-slate-900 pb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>左下肢架 (左腿)</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => raiseLeg('left')}
              className="flex-1 bg-indigo-600/15 hover:bg-indigo-600 text-indigo-300 hover:text-white px-2 py-1 text-[11px] font-semibold border border-indigo-500/20 rounded transition cursor-pointer"
            >
              抬脚
            </button>
            <button
              onClick={() => lowerLeg('left')}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 text-[11px] font-medium border border-slate-700/40 rounded transition cursor-pointer"
            >
              落地
            </button>
          </div>
        </div>

        {/* Right Foot Controls Box */}
        <div id="right-foot-controls" className="bg-slate-950/40 border border-slate-850/60 p-2.5 rounded-lg flex flex-col gap-1.5">
          <div className="text-[10px] text-slate-400 font-bold tracking-wider border-b border-slate-900 pb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>右下肢架 (右腿)</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => raiseLeg('right')}
              className="flex-1 bg-emerald-600/15 hover:bg-emerald-600 text-emerald-300 hover:text-white px-2 py-1 text-[11px] font-semibold border border-emerald-500/20 rounded transition cursor-pointer"
            >
              抬脚
            </button>
            <button
              onClick={() => lowerLeg('right')}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 text-[11px] font-medium border border-slate-700/40 rounded transition cursor-pointer"
            >
              落地
            </button>
          </div>
        </div>
      </div>

      {/* Symmetrical Mirror helper tool */}
      <div className="bg-slate-950/30 border border-amber-500/10 rounded-lg p-3 text-[11px] text-slate-400 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-slate-300">
            <Accessibility className="w-3.5 h-3.5 text-amber-500" />
            镜像对称调姿工具
          </span>
          {selectedJointId ? (
            <button
              onClick={mirrorSelectedJoint}
              className="text-[10px] text-amber-400 hover:text-white bg-amber-500/10 hover:bg-amber-600 px-2 py-1 rounded font-semibold border border-amber-500/20 transition cursor-pointer"
              title="将当前选中的关节角度水平镜像映射到对侧骨骼上"
            >
              镜像映射到对侧骨骼
            </button>
          ) : (
            <span className="text-[10px] text-slate-550 italic">（先选中一个关节）</span>
          )}
        </div>
        <p className="leading-relaxed">
          先选择单侧骨骼（如左肩或右大腿）调节角度，再点击 <strong>镜像映射</strong> 按钮，即可将偏转角通过矢状面一键投射至对称侧！
        </p>
      </div>

      {/* 🎯 逆向运动学 (Inverse Kinematics) 核心控制面板 */}
      <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3 flex flex-col gap-3">
        <div 
          onClick={() => setShowIKConfig(!showIKConfig)}
          className="flex items-center justify-between border-b border-slate-900 pb-2 cursor-pointer select-none group"
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
              <Target className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition">3D 逆向动力学 (IK) 动作生成</span>
              <span className="text-[9px] text-slate-550">CCD-IK 算法驱动 · 一键实时控制肢体动作</span>
            </div>
          </div>
          <span className="text-[10px] text-indigo-400 font-semibold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
            {showIKConfig ? '折叠面板' : '点击展开'}
          </span>
        </div>

        {showIKConfig && (
          <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* 1. 肢体链选择卡 */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">第一步: 选择效应肢体</span>
              <div className="grid grid-cols-4 gap-1">
                {(['left-arm', 'right-arm', 'left-leg', 'right-leg'] as const).map((limb) => {
                  let label = '右手';
                  if (limb === 'left-arm') label = '左手';
                  if (limb === 'left-leg') label = '左脚';
                  if (limb === 'right-leg') label = '右脚';
                  const isActive = ikLimb === limb;
                  return (
                    <button
                      key={limb}
                      onClick={() => setIkLimb(limb)}
                      className={`py-1 px-1.5 rounded text-[10px] font-bold text-center border cursor-pointer transition ${
                        isActive
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. 坐标调节滑块 */}
            <div className="flex flex-col gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-900">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold border-b border-slate-900 pb-1.5">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  效应器终端坐标 (世界空间)
                </span>
                <button
                  onClick={() => syncIKTargetToEffector(ikLimb)}
                  className="text-[9px] text-amber-500 hover:text-white bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25 cursor-pointer transition flex items-center gap-1 font-semibold"
                  title="拉取当前骨架位置重设滑块，使其完美合一"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  对齐骨骼
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-400 font-sans">横向偏移 X (左/右)</span>
                    <span className="text-slate-200 font-mono font-bold">{ikTarget.x.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={ikLimb.includes('arm') ? -2.2 : -1.5}
                    max={ikLimb.includes('arm') ? 2.2 : 1.5}
                    step="0.05"
                    value={ikTarget.x}
                    onChange={(e) => handleIKTargetChange('x', parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-400 font-sans">高度偏移 Y (上/下)</span>
                    <span className="text-slate-200 font-mono font-bold">{ikTarget.y.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={ikLimb.includes('leg') ? -2.5 : -0.5}
                    max={ikLimb.includes('leg') ? 0.2 : 2.5}
                    step="0.05"
                    value={ikTarget.y}
                    onChange={(e) => handleIKTargetChange('y', parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-400 font-sans">纵深偏移 Z (前/后)</span>
                    <span className="text-slate-200 font-mono font-bold">{ikTarget.z.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="-1.8"
                    max="1.8"
                    step="0.05"
                    value={ikTarget.z}
                    onChange={(e) => handleIKTargetChange('z', parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 3. 智能 IK 姿势驱动宏 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">第二步: 快捷 IK 空间姿态生成</span>
              
              {ikLimb === 'left-arm' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => applyIKPreset(-0.3, 1.6, -0.2)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👋 左手招手 (Wave)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-1.2, 1.3, -0.8)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👉 左手前指 (Point)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-0.4, 2.1, 0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🙆 左举双手 (Overhead)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-0.1, 1.2, -0.4)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🛡️ 左肘护胸 (Defend)
                  </button>
                </div>
              )}

              {ikLimb === 'right-arm' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => applyIKPreset(0.3, 1.6, -0.2)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👋 右手招手 (Wave)
                  </button>
                  <button
                    onClick={() => applyIKPreset(1.2, 1.3, -0.8)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👉 右手前指 (Point)
                  </button>
                  <button
                    onClick={() => applyIKPreset(0.4, 2.1, 0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🙆 右举双手 (Overhead)
                  </button>
                  <button
                    onClick={() => applyIKPreset(0.1, 1.2, -0.4)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🛡️ 右肘护胸 (Defend)
                  </button>
                </div>
              )}

              {ikLimb === 'left-leg' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => applyIKPreset(-0.4, -0.8, -0.8)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🥋 左膝高抬 (Lift Leg)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-0.4, -1.8, 1.0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👟 左腿后蹬 (Back Kick)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-0.1, -1.0, -0.2)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🧘 左膝盘起 (Flex Knee)
                  </button>
                  <button
                    onClick={() => applyIKPreset(-0.9, -1.7, 0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🤸 左弓箭步 (Lunge)
                  </button>
                </div>
              )}

              {ikLimb === 'right-leg' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => applyIKPreset(0.4, -0.8, -0.8)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🥋 右膝高抬 (Lift Leg)
                  </button>
                  <button
                    onClick={() => applyIKPreset(0.4, -1.8, 1.0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    👟 右腿后蹬 (Back Kick)
                  </button>
                  <button
                    onClick={() => applyIKPreset(0.1, -1.0, -0.2)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🧘 右膝盘起 (Flex Knee)
                  </button>
                  <button
                    onClick={() => applyIKPreset(0.9, -1.7, 0)}
                    className="bg-slate-900 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-white py-1 px-1.5 rounded text-[10px] font-medium cursor-pointer transition"
                  >
                    🤸 右弓箭步 (Lunge)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Structured Holistic Pose Templates Section */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          多关节一键姿态模板 (配合关键帧录入)
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          <button
            onClick={() => applyMacroPose('greeting')}
            className="bg-slate-850 hover:bg-slate-750 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/30 py-1.5 px-2 rounded text-[11px] font-medium transition text-center cursor-pointer"
          >
            👋 招手示意 pose
          </button>
          <button
            onClick={() => applyMacroPose('prayer')}
            className="bg-slate-850 hover:bg-slate-750 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/30 py-1.5 px-2 rounded text-[11px] font-medium transition text-center cursor-pointer"
          >
            🙏 双手合十 pose
          </button>
          <button
            onClick={() => applyMacroPose('bow')}
            className="bg-slate-850 hover:bg-slate-750 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/30 py-1.5 px-2 rounded text-[11px] font-medium transition text-center cursor-pointer"
          >
            🙇 谦逊鞠躬 pose
          </button>
          <button
            onClick={() => applyMacroPose('balance')}
            className="bg-slate-850 hover:bg-slate-750 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/30 py-1.5 px-2 rounded text-[11px] font-medium transition text-center cursor-pointer"
          >
            🧘 金鸡独立 pose
          </button>
          <button
            onClick={() => applyMacroPose('kick')}
            className="bg-slate-850 hover:bg-slate-750 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/30 py-1.5 px-2 rounded text-[11px] font-medium transition text-center cursor-pointer"
          >
            🥋 侧踹横踢 pose
          </button>
          <button
            onClick={resetAllJoints}
            className="bg-indigo-950/40 hover:bg-indigo-900/60 text-indigo-300 hover:text-white border border-indigo-900 py-1.5 px-2 rounded text-[11px] font-semibold transition text-center cursor-pointer animate-pulse"
          >
            🧍 恢复标准 T-Pose
          </button>
        </div>
      </div>
    </div>
  );
}
