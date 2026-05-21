import React, { useState } from 'react';
import { JointNode, EditorMode } from '../types';
import { Plus, Trash2, Edit2, Check, ArrowRight, Anchor, Hash } from 'lucide-react';

interface SkeletonTreeProps {
  joints: JointNode[];
  selectedJointId: string | null;
  onSelectJoint: (id: string | null) => void;
  onUpdateJoints: (newJoints: JointNode[]) => void;
  editorMode: EditorMode;
}

export default function SkeletonTree({
  joints,
  selectedJointId,
  onSelectJoint,
  onUpdateJoints,
  editorMode
}: SkeletonTreeProps) {
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState<string>('');

  const selectedJoint = joints.find((j) => j.id === selectedJointId);

  // Helper to structure joints recursively into a nested visual UI
  const buildTree = (parentId: string | null): JointNode[] => {
    return joints.filter((j) => j.parentId === parentId);
  };

  // Add child to active joint or as root if nothing is selected
  const handleAddJoint = () => {
    const parentId = selectedJointId;
    const sameParentCount = joints.filter((j) => j.parentId === parentId).length;
    
    // Choose appropriate default coordinates
    let targetPos: [number, number, number] = [0, 0, 0];
    let candidateName = 'Root Bone';

    if (parentId) {
      const parentJoint = joints.find((j) => j.id === parentId);
      if (parentJoint) {
        // Offset standard height (Y) slightly, or X slightly so it stands out
        targetPos = [
          parentJoint.position[0],
          parentJoint.position[1] + 0.6,
          parentJoint.position[2]
        ];
        candidateName = `${parentJoint.name}_Branch_${sameParentCount + 1}`;
      }
    } else {
      // If creating a root bone and one already exists, offset it slightly
      if (joints.length > 0) {
        targetPos = [0, 0, 0];
        candidateName = `Extra_Root_${joints.length + 1}`;
      } else {
        targetPos = [0, -1.5, 0];
        candidateName = 'Base Root';
      }
    }

    const newId = `joint_${Date.now()}`;
    const newJoint: JointNode = {
      id: newId,
      name: candidateName,
      parentId,
      position: targetPos,
      rotation: [0, 0, 0]
    };

    onUpdateJoints([...joints, newJoint]);
    onSelectJoint(newId);
  };

  const handleDeleteJoint = (id: string) => {
    // Delete joint. Any child nodes will be reparented to the deleted joint's parent
    const targetJoint = joints.find(j => j.id === id);
    if (!targetJoint) return;

    const remaining = joints.filter(j => j.id !== id).map(j => {
      if (j.parentId === id) {
        return { ...j, parentId: targetJoint.parentId };
      }
      return j;
    });

    onUpdateJoints(remaining);
    onSelectJoint(null);
  };

  const handleStartRename = (joint: JointNode) => {
    setEditingNameId(joint.id);
    setTempName(joint.name);
  };

  const handleFinishRename = (id: string) => {
    if (!tempName.trim()) return;
    const updated = joints.map(j => j.id === id ? { ...j, name: tempName.trim() } : j);
    onUpdateJoints(updated);
    setEditingNameId(null);
  };

  const handlePositionChange = (axis: 0 | 1 | 2, val: string) => {
    if (!selectedJointId) return;
    const numeric = parseFloat(val);
    if (isNaN(numeric)) return;

    const updated = joints.map(j => {
      if (j.id === selectedJointId) {
        const nextPos = [...j.position] as [number, number, number];
        nextPos[axis] = numeric;
        return { ...j, position: nextPos };
      }
      return j;
    });
    onUpdateJoints(updated);
  };

  const handleRotationChange = (axis: 0 | 1 | 2, degVal: number) => {
    if (!selectedJointId) return;
    // Deg to Rad
    const rad = (degVal * Math.PI) / 180;

    const updated = joints.map(j => {
      if (j.id === selectedJointId) {
        const nextRot = [...j.rotation] as [number, number, number];
        nextRot[axis] = rad;
        return { ...j, rotation: nextRot };
      }
      return j;
    });
    onUpdateJoints(updated);
  };

  // Inline recursive layout rendering function
  const renderNode = (node: JointNode, depth = 0) => {
    const children = buildTree(node.id);
    const isSelected = node.id === selectedJointId;

    return (
      <div key={node.id} className="flex flex-col select-none">
        <div
          onClick={() => onSelectJoint(node.id)}
          className={`flex items-center justify-between py-1.5 px-2.5 rounded-md cursor-pointer transition-colors duration-150 ${
            isSelected
              ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
              : 'hover:bg-slate-800/60 text-slate-300'
          }`}
          style={{ marginLeft: `${depth * 14}px` }}
        >
          <div className="flex items-center gap-2 overflow-hidden mr-1">
            <span className="text-slate-500 font-mono text-[10px]">
              {depth > 0 ? '└─' : '•'}
            </span>
            {editingNameId === node.id ? (
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={() => handleFinishRename(node.id)}
                onKeyDown={(e) => e.key === 'Enter' && handleFinishRename(node.id)}
                className="bg-slate-900 border border-slate-700 rounded text-slate-100 px-1 py-0.5 text-xs w-32 focus:outline-none focus:border-indigo-500"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-xs truncate font-medium">{node.name}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 opacity-40 hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {editingNameId !== node.id && (
              <button
                onClick={() => handleStartRename(node)}
                className="p-1 hover:text-slate-100 hover:bg-slate-700/80 rounded transition"
                title="重命名"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => handleDeleteJoint(node.id)}
              className="p-1 hover:text-red-400 hover:bg-slate-700/80 rounded transition"
              title="删除此关节"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const rootNodes = joints.filter((j) => j.parentId === null);

  return (
    <div className="flex flex-col gap-4 flex-1 overflow-hidden">
      {/* Structural Mode Indicator */}
      {editorMode !== 'edit-skeleton' && editorMode !== 'animate' && (
        <div className="bg-slate-900/60 rounded-lg p-3 text-xs text-slate-400 flex flex-col gap-1 border border-slate-800/40">
          <p>请点击左侧 <strong className="text-indigo-400">“编辑骨骼”</strong> 模式对骨骼体系进行拓扑管理；或者切换到 <strong className="text-amber-400">“动作设计”</strong> 模式对骨骼角度进行姿态操作。</p>
        </div>
      )}

      {/* Mixamo Shortcut Helper Tipp Box */}
      <div className="bg-gradient-to-br from-indigo-950/30 to-slate-900/60 rounded-lg p-3 text-[11px] text-slate-300 flex flex-col gap-1.5 border border-indigo-950/40 shadow-sm">
        <p className="font-semibold text-indigo-300 flex items-center gap-1.5 leading-snug">
          <span>🤖 Mixamo 2D 骨骼快速对齐已就绪！</span>
        </p>
        <p className="text-slate-400 leading-normal">
          现在您可以在右侧 3D 视图右上角点击 <span className="text-indigo-300 font-semibold bg-indigo-500/10 px-1 py-0.5 rounded border border-indigo-500/20">🤖 Mixamo 风格平面骨骼对齐</span> 按钮，开启全图形化拖拽定位！支持<strong>水平镜像对称</strong>与<strong>一键更新蒙皮</strong>，10 秒内轻松贴合骨架。
        </p>
      </div>

      {/* Controller of Bones */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">骨骼树状层级</h3>
          {(editorMode === 'edit-skeleton') && (
            <button
              onClick={handleAddJoint}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2.5 py-1 text-xs font-medium cursor-pointer shadow-indigo-600/20 shadow-md transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{selectedJoint ? '添加子关节' : '新建根骨骼'}</span>
            </button>
          )}
        </div>

        {joints.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-lg py-6 text-center text-xs text-slate-500">
            暂无骨骼。请新建根骨骼节点
          </div>
        ) : (
          <div className="bg-slate-900/40 border border-slate-800/70 rounded-lg p-2.5 flex flex-col gap-1 max-h-[160px] overflow-y-auto custom-scrollbar">
            {rootNodes.map((root) => renderNode(root))}
          </div>
        )}
      </div>

      {/* Selected Bone Parameters Controls */}
      {selectedJoint ? (
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs text-slate-400">当前选中关节: </span>
              <span className="text-xs text-amber-200 font-semibold truncate max-w-[120px]">{selectedJoint.name}</span>
            </div>
            {selectedJoint.parentId && (
              <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                <span>父节点Id:</span>
                <span className="bg-slate-800 px-1 rounded truncate max-w-[60px]">{joints.find(p => p.id === selectedJoint.parentId)?.name || '未知'}</span>
              </div>
            )}
          </div>

          {/* Edit Mode: Modify positions */}
          {editorMode === 'edit-skeleton' ? (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase flex items-center gap-1">
                <Anchor className="w-3 h-3 text-sky-400" /> 关节世界坐标 (X, Y, Z)
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">X 维度</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedJoint.position[0]}
                    onChange={(e) => handlePositionChange(0, e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 p-2 w-full text-center focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Y 高度</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedJoint.position[1]}
                    onChange={(e) => handlePositionChange(1, e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 p-2 w-full text-center focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Z 深度</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedJoint.position[2]}
                    onChange={(e) => handlePositionChange(2, e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 p-2 w-full text-center focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">坐标单位为米。调节后，关联连接该关节的所有外部多边形在绑定后都会同步旋转变形。</p>
            </div>
          ) : (
            /* Animation / Posing Mode: Modify Pitch/Yaw/Roll rotations */
            <div className="flex flex-col gap-3">
              <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase flex items-center gap-1">
                <ArrowRight className="w-3 h-3 text-amber-400" /> 当前关节旋转 pose
              </span>
              <div className="flex flex-col gap-2.5">
                <div>
                  <div className="flex justify-between text-[10px] px-1 text-slate-400 mb-1">
                    <span>X 轴偏转 (Pitch)</span>
                    <span className="text-amber-300 font-mono">
                      {Math.round((selectedJoint.rotation[0] * 180) / Math.PI)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={Math.round((selectedJoint.rotation[0] * 180) / Math.PI)}
                    onChange={(e) => handleRotationChange(0, parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
                
                <div>
                  <div className="flex justify-between text-[10px] px-1 text-slate-400 mb-1">
                    <span>Y 轴偏转 (Yaw)</span>
                    <span className="text-amber-300 font-mono">
                      {Math.round((selectedJoint.rotation[1] * 180) / Math.PI)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={Math.round((selectedJoint.rotation[1] * 180) / Math.PI)}
                    onChange={(e) => handleRotationChange(1, parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] px-1 text-slate-400 mb-1">
                    <span>Z 轴偏转 (Roll)</span>
                    <span className="text-amber-300 font-mono">
                      {Math.round((selectedJoint.rotation[2] * 180) / Math.PI)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={Math.round((selectedJoint.rotation[2] * 180) / Math.PI)}
                    onChange={(e) => handleRotationChange(2, parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  const updated = joints.map(j => j.id === selectedJointId ? { ...j, rotation: [0, 0, 0] as [number, number, number] } : j);
                  onUpdateJoints(updated);
                }}
                className="text-[10px] text-center bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white rounded py-1 px-2.5 text-slate-300 transition"
              >
                重置关节角度 (归零)
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="border border-slate-800/80 bg-slate-900/10 rounded-xl p-4 text-center text-xs text-slate-500 select-none">
          💡 在下方层级列表或右侧 3D Viewport 直接点击骨骼关节进行定向调姿。
        </div>
      )}
    </div>
  );
}
