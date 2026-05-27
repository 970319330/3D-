import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { JointNode, KeyframeData } from '../types';
import { getPresetSkeletons } from '../utils/rigging';
import { Upload, FileArchive, Check, AlertCircle, RefreshCw, Layers, Film, Wand2, ShieldAlert, Zap } from 'lucide-react';

interface SkeletonImporterProps {
  joints: JointNode[];
  onUpdateJoints: (newJoints: JointNode[]) => void;
  keyframes: KeyframeData[];
  onKeyframesUpdate: (keyframes: KeyframeData[]) => void;
  currentFrame: number;
  onFrameChange: (frame: number) => void;
  onPlayToggle: (playing: boolean) => void;
  onTriggerAutoRig?: () => void;
  activeModelType: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf';
  onImportClips?: (clips: THREE.AnimationClip[]) => void;
}

// Map FBX bone names to our workspace standard humanoid joint IDs (used in Timeline/Editor mapping mode)
const mapFBXBoneToJointId = (boneName: string): string | null => {
  const nameL = boneName.toLowerCase();
  
  // Pelvis / Hips / Root
  if (nameL.includes('pelvis') || nameL.includes('hips') || nameL.includes('root') || nameL.includes('body')) {
    return 'root';
  }
  // Spine
  if (nameL.includes('spine') || nameL.includes('chest') || nameL.includes('torso') || nameL.includes('spine1') || nameL.includes('spine_01') || nameL.includes('spine_02')) {
    return 'spine';
  }
  // Neck / Head
  if (nameL.includes('neck') || nameL.includes('head')) {
    return 'neck';
  }
  
  // Left Arm (Shoulder & Elbow)
  const isLeft = nameL.includes('left') || nameL.includes('l_') || nameL.startsWith('l');
  const isRight = nameL.includes('right') || nameL.includes('r_') || nameL.startsWith('r');

  if (isLeft) {
    if ((nameL.includes('shoulder') || nameL.includes('arm') || nameL.includes('uparm') || nameL.includes('clavicle')) && 
        !nameL.includes('elbow') && !nameL.includes('forearm')) {
      return 'l_shoulder';
    }
    if (nameL.includes('elbow') || nameL.includes('forearm') || nameL.includes('arm') || nameL.includes('hand') || nameL.includes('wrist')) {
      if (nameL.includes('forearm') || nameL.includes('elbow') || nameL.includes('wrist')) {
        return 'l_elbow';
      }
    }
  }

  // Right Arm (Shoulder & Elbow)
  if (isRight) {
    if ((nameL.includes('shoulder') || nameL.includes('arm') || nameL.includes('uparm') || nameL.includes('clavicle')) && 
        !nameL.includes('elbow') && !nameL.includes('forearm')) {
      return 'r_shoulder';
    }
    if (nameL.includes('elbow') || nameL.includes('forearm') || nameL.includes('arm') || nameL.includes('hand') || nameL.includes('wrist')) {
      if (nameL.includes('forearm') || nameL.includes('elbow') || nameL.includes('wrist')) {
        return 'r_elbow';
      }
    }
  }

  // Left Leg (Hip, Knee, Foot)
  if (isLeft) {
    if (nameL.includes('hip') || nameL.includes('thigh') || nameL.includes('upleg')) {
      return 'l_hip';
    }
    if ((nameL.includes('knee') || nameL.includes('leg') || nameL.includes('calf') || nameL.includes('shin')) && 
        !nameL.includes('hip') && !nameL.includes('foot')) {
      return 'l_knee';
    }
    if (nameL.includes('foot') || nameL.includes('ankle') || nameL.includes('toe')) {
      return 'l_foot';
    }
  }

  // Right Leg (Hip, Knee, Foot)
  if (isRight) {
    if (nameL.includes('hip') || nameL.includes('thigh') || nameL.includes('upleg')) {
      return 'r_hip';
    }
    if ((nameL.includes('knee') || nameL.includes('leg') || nameL.includes('calf') || nameL.includes('shin')) && 
        !nameL.includes('hip') && !nameL.includes('foot')) {
      return 'r_knee';
    }
    if (nameL.includes('foot') || nameL.includes('ankle') || nameL.includes('toe')) {
      return 'r_foot';
    }
  }

  return null;
};

export default function SkeletonImporter({
  joints,
  onUpdateJoints,
  keyframes,
  onKeyframesUpdate,
  currentFrame,
  onFrameChange,
  onPlayToggle,
  onTriggerAutoRig,
  activeModelType,
  onImportClips
}: SkeletonImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mappingReport, setMappingReport] = useState<{ original: string; mapped: string }[]>([]);
  const [clipDetails, setClipDetails] = useState<{ name: string; duration: number; frames: number } | null>(null);
  const [syncMode, setSyncMode] = useState<'direct_bone' | 'editor_timeline'>('direct_bone');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    setMappingReport([]);
    setClipDetails(null);

    const loader = new FBXLoader();
    const url = URL.createObjectURL(file);

    loader.load(
      url,
      (fbxGroup) => {
        try {
          const animations = fbxGroup.animations || [];

          // MODE A: Direct native skeleton synchronization
          if (syncMode === 'direct_bone') {
            if (activeModelType !== 'gltf') {
              throw new Error('当前不是 3D 自定义模型 (`gltf` 模式)。直接骨骼动作同步仅在您在【1. 选择模型】中上传/加载了自定义人物 FBX/GLTF 模型时生效，这样才可以直接驱动模型原有的骨骼。');
            }

            if (animations.length === 0) {
              throw new Error('此 FBX 文件未包含任何有效的骨骼动画轨道(Animation Clip)。如果是需要同步静态肢体动作，请切换至【映射到60帧时间轴】模式。');
            }

            // Extract, rename and cleanse imported animations to prevent empty/clashing tracks
            const cleanedAnimations = animations.map((clip, idx) => {
              const baseName = file.name.replace(/\.[^/.]+$/, "");
              const clipName = clip.name && clip.name !== 'mixamo.com' && clip.name !== 'Take 001'
                ? clip.name
                : `imported_${idx + 1}`;
              
              const cloned = clip.clone();
              cloned.name = `[数据同步] ${baseName} (${clipName})`;
              return cloned;
            });

            // Extract and show information
            const firstClip = cleanedAnimations[0];
            setClipDetails({
              name: firstClip.name,
              duration: parseFloat(firstClip.duration.toFixed(2)),
              frames: Math.round(firstClip.duration * 30) // estimated 30fps frames
            });

            if (onImportClips) {
              onImportClips(cleanedAnimations);
            }

            setSuccessMsg(`🎉 成功提取出这组骨骼专属动画！已直接 1:1 零篡改注入当前加载的模型中，完美匹配模型原有蒙皮，可在右侧 3D 展厅的【检测到内置动画】下拉中直接点选并播放！`);
            setIsLoading(false);
            URL.revokeObjectURL(url);
            return;
          }

          // MODE B: Standard 13-joint timeline baking (Original mapping mode)
          const matchedNodes: { original: string; mapped: string; node: THREE.Object3D }[] = [];
          const standardHumanoidJoints = getPresetSkeletons('humanoid');
          
          fbxGroup.traverse((child) => {
            const mappedId = mapFBXBoneToJointId(child.name);
            if (mappedId) {
              const standardJoint = standardHumanoidJoints.find(j => j.id === mappedId);
              if (standardJoint) {
                const alreadyMatched = matchedNodes.some(m => mapFBXBoneToJointId(m.original) === mappedId);
                if (!alreadyMatched) {
                  matchedNodes.push({
                    original: child.name,
                    mapped: standardJoint.name,
                    node: child
                  });
                }
              }
            }
          });

          if (matchedNodes.length === 0) {
            throw new Error('未能在该 FBX 骨骼中匹配到任何标准人体关节点名（如 Mixamo/Rigify 等结构）。请选择“直接骨骼同步”模式，或确认 FBX 骨骼为标准人体格式。');
          }

          setMappingReport(matchedNodes.map(m => ({ original: m.original, mapped: m.mapped })));

          let targetSkeleton = [...joints];
          let didUpgradeSkeleton = false;
          if (joints.length < 13) {
            targetSkeleton = standardHumanoidJoints;
            didUpgradeSkeleton = true;
          }

          if (animations.length > 0) {
            const clip = animations[0];
            const duration = clip.duration;
            const maxFrames = 60;
            
            setClipDetails({
              name: clip.name || '骨骼动作轨道',
              duration: parseFloat(duration.toFixed(2)),
              frames: maxFrames
            });

            const mixer = new THREE.AnimationMixer(fbxGroup);
            const action = mixer.clipAction(clip);
            action.setEffectiveWeight(1.0);
            action.play();

            const sampledKeyframes: KeyframeData[] = [];

            for (let f = 0; f < maxFrames; f++) {
              const sampleTime = (f / (maxFrames - 1)) * duration;
              mixer.setTime(sampleTime);
              fbxGroup.updateMatrixWorld(true);

              const rotationsMap: Record<string, [number, number, number]> = {};

              matchedNodes.forEach(({ original, node }) => {
                const mappedId = mapFBXBoneToJointId(original)!;
                const euler = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
                rotationsMap[mappedId] = [euler.x, euler.y, euler.z];
              });

              sampledKeyframes.push({
                frame: f,
                rotations: rotationsMap
              });
            }

            onKeyframesUpdate(sampledKeyframes);
            onPlayToggle(false);
            onFrameChange(0);

            if (sampledKeyframes.length > 0) {
              const f0 = sampledKeyframes[0];
              const nextJoints = targetSkeleton.map(joint => {
                const rot = f0.rotations[joint.id];
                if (rot) {
                  return { ...joint, rotation: [...rot] as [number, number, number] };
                }
                return joint;
              });
              onUpdateJoints(nextJoints);
            }

            let successStr = `成功解析纯骨骨架动画！已将动作「${clip.name || 'Mixamo动画'}」采样烘焙至 60 帧时间轴中。`;
            if (didUpgradeSkeleton) {
              successStr += ` 已自动升级至 13 关节点标准双足人体骨骼，并已触发模型【自动蒙皮 (Auto-Rig)】！`;
              if (onTriggerAutoRig) {
                setTimeout(() => onTriggerAutoRig(), 350);
              }
            } else {
              successStr += ` 已同步到当前模型关节。`;
            }
            setSuccessMsg(successStr);
          } else {
            const nextJoints = targetSkeleton.map(joint => {
              const match = matchedNodes.find(m => mapFBXBoneToJointId(m.original) === joint.id);
              if (match) {
                const euler = new THREE.Euler().setFromQuaternion(match.node.quaternion, 'XYZ');
                return {
                  ...joint,
                  rotation: [euler.x, euler.y, euler.z] as [number, number, number]
                };
              }
              return joint;
            });

            onUpdateJoints(nextJoints);

            let successStr = `成功同步骨骼静态姿势！配对到标准骨骼：${matchedNodes.length}个。`;
            if (didUpgradeSkeleton) {
              successStr += ` 已自动升级至 13 关节点标准双足人体骨骼，并已触发模型【自动蒙皮 (Auto-Rig)】！`;
              if (onTriggerAutoRig) {
                setTimeout(() => onTriggerAutoRig(), 350);
              }
            } else {
              successStr += `已实时同步到模型关节偏角。`;
            }
            setSuccessMsg(successStr);
          }

        } catch (err: any) {
          setErrorMsg(err?.message || '解析骨骼数据时发生未知错误。');
        } finally {
          setIsLoading(false);
          URL.revokeObjectURL(url);
        }
      },
      undefined,
      (err) => {
        setErrorMsg('FBX 骨骼文件加载失败，请确保格式正确并不损坏。');
        setIsLoading(false);
        URL.revokeObjectURL(url);
      }
    );
  };

  return (
    <div className="bg-[#0b121e]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-850 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span>导入 FBX 骨骼/动作同步工具</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">Precision Sync</span>
      </div>

      <div className="text-[11px] text-slate-400 leading-relaxed">
        有些导出的 FBX 文件 <strong>仅包含骨架和动作曲线（不含网格 Mesh）</strong>。为了让您在导入动作时不破坏、不错乱您已加载模型的精细骨网络，请选择您最契合的同步模式：
      </div>

      {/* Sync Mode Toggle Switch */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-900">
        <button
          type="button"
          onClick={() => {
            setSyncMode('direct_bone');
            setSuccessMsg(null);
            setErrorMsg(null);
          }}
          className={`py-1.5 px-2 text-[10px] sm:text-[11px] font-bold rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
            syncMode === 'direct_bone'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>原木1:1直接同步 (推荐)</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSyncMode('editor_timeline');
            setSuccessMsg(null);
            setErrorMsg(null);
          }}
          className={`py-1.5 px-2 text-[10px] sm:text-[11px] font-bold rounded-md flex items-center justify-center gap-1 cursor-pointer transition ${
            syncMode === 'editor_timeline'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>映射到标准时间轴</span>
        </button>
      </div>

      <div className="text-[10px] bg-slate-950/40 border border-slate-900/60 p-2 rounded text-slate-400">
        {syncMode === 'direct_bone' ? (
          <span><strong>推荐用于自定义 FBX 模型：</strong> 将骨架内携带的动画轨迹完美无损注入到当前载入的模型中，零修改、完美支持多段原装蒙皮播放，保留原模型精度。</span>
        ) : (
          <span><strong>推荐用于标准人形/编辑：</strong> 提取骨架各帧角度，通过通用标准规则将其绑定至当前包含的 13 个可调整关节点中，以便您在时间轴进行二次精细修改。</span>
        )}
      </div>

      {/* Mode check warning context */}
      {syncMode === 'direct_bone' && activeModelType !== 'gltf' && (
        <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-1.5 text-[10px] text-amber-300">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>检测到您当前使用的并非【自定义3D模型】。请先至第一张卡片中切换或加载您的自定义 FBX/GLTF 人物。</span>
        </div>
      )}

      {/* Upload Drag/Click Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dashed rounded-lg p-3.5 text-center cursor-pointer transition duration-150 flex flex-col items-center justify-center gap-1.5 ${
          isLoading
            ? 'border-indigo-500 bg-indigo-500/5 text-indigo-300'
            : 'border-slate-800 bg-slate-900/10 text-slate-400 hover:border-slate-700 hover:bg-slate-900/30'
        }`}
      >
        {isLoading ? (
          <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
        ) : (
          <Upload className="w-5 h-5 text-slate-500" />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold">
            {isLoading ? '正在解析骨架与时间曲线...' : '选择或拖入纯骨骼 FBX 文件'}
          </span>
          <span className="text-[10px] text-slate-500">
            {syncMode === 'direct_bone' ? '完美保留原始肢骨与几何网格' : '智能解算并映射 13 个控制关节点'}
          </span>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".fbx"
          className="hidden"
          disabled={isLoading}
        />
      </div>

      {/* Success Details / Error Alerts */}
      {errorMsg && (
        <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-[11px] text-red-350">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">配对导入失败</span>
            <span>{errorMsg}</span>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-2 text-[11px] text-emerald-350">
          <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5 whitespace-pre-line leading-relaxed">
            <span className="font-semibold text-emerald-300">骨骼数据同步成功</span>
            <span>{successMsg}</span>
          </div>
        </div>
      )}

      {/* Animation Track Info */}
      {clipDetails && (
        <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-900 text-[11px] flex flex-col gap-1">
          <span className="text-slate-400 font-semibold flex items-center gap-1">
            <Film className="w-3.5 h-3.5 text-amber-500" />
            动作包详情:
          </span>
          <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-300 font-mono mt-0.5 pl-4.5">
            <div>轨道名: <span className="text-indigo-400">{clipDetails.name}</span></div>
            <div className="flex gap-4">
              <div>总时长: <span className="text-indigo-400">{clipDetails.duration}s</span></div>
              <div>总帧数: <span className="text-indigo-400">{clipDetails.frames} 帧</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Mapping Report Card foldouts */}
      {mappingReport.length > 0 && syncMode === 'editor_timeline' && (
        <div className="bg-slate-950/20 border border-slate-850/60 p-2.5 rounded-lg flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
              智能人体骨骼配对报告 ({mappingReport.length}对)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono max-h-[100px] overflow-y-auto custom-scrollbar bg-slate-950/50 p-1.5 rounded">
            {mappingReport.map((m, idx) => (
              <div key={idx} className="flex justify-between border-b border-slate-900/40 py-0.5 text-slate-400">
                <span className="truncate max-w-[80px]" title={m.original}>{m.original}</span>
                <span className="text-slate-500">→</span>
                <span className="text-emerald-400 text-right">{m.mapped}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
