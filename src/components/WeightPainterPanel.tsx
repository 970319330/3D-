import React from 'react';
import { WeightBrushSettings, JointNode } from '../types';
import { Paintbrush, Hammer, Info, HelpCircle } from 'lucide-react';

interface WeightPainterPanelProps {
  weightBrush: WeightBrushSettings;
  onBrushUpdate: (brush: WeightBrushSettings) => void;
  isPaintingActive: boolean;
  onTogglePainting: (active: boolean) => void;
  joints: JointNode[];
  selectedJointId: string | null;
  onAutoRig: () => void;
  hasSkinWeight: boolean;
}

export default function WeightPainterPanel({
  weightBrush,
  onBrushUpdate,
  isPaintingActive,
  onTogglePainting,
  joints,
  selectedJointId,
  onAutoRig,
  hasSkinWeight
}: WeightPainterPanelProps) {
  const selectedJoint = joints.find((j) => j.id === selectedJointId);

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Auto-Rig trigger box */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-1.5 text-indigo-300 font-semibold text-xs uppercase tracking-wider">
          <Hammer className="w-4 h-4" />
          <span>算法智能绑定 (蒙皮)</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          点击下方按钮将自动执行「骨骼权重计算」，依据顶点与各关节骨条段的欧几里得距离在三维空间中拟合分配权重归属。整个过程耗时极短。
        </p>
        <button
          onClick={onAutoRig}
          className="w-full text-center bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-lg text-xs shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20 transition cursor-pointer"
        >
          ✨ 自动绑定权重 (Auto-Rig)
        </button>
        {hasSkinWeight ? (
          <div className="border border-emerald-900 bg-emerald-950/20 text-emerald-400 text-[10px] px-2.5 py-1.5 rounded-md flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>网格已与骨骼绑定。可在「动作模式」下直接查看弯曲效果！</span>
          </div>
        ) : (
          <div className="border border-slate-800 bg-slate-950/40 text-slate-500 text-[10px] px-2.5 py-1.5 rounded-md flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
            <span>网格目前尚未绑定骨皮，受力形变在操作时无效。</span>
          </div>
        )}
      </div>

      {/* Beginner Friendly Helper block */}
      <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900/60 border border-indigo-500/20 rounded-xl p-4 flex flex-col gap-3 select-none">
        <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs uppercase tracking-wide">
          <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>🐣 骨骼绑定极速上手指南</span>
        </div>
        <div className="flex flex-col gap-2.5 text-[11px] text-slate-350 leading-relaxed font-sans">
          <div className="flex gap-2">
            <span className="bg-indigo-600/30 text-indigo-300 font-bold px-1.5 py-0.5 h-4 text-[9px] rounded flex items-center justify-center shrink-0">1</span>
            <p>
              <strong>骨骼对齐模型</strong>：先切换至左上角 <span className="text-indigo-400 font-medium">“1. 编辑骨骼”</span> 模式，微调关节，使骨干整体<strong>像人体骨椎四肢一样居中埋在模型内部</strong>。
            </p>
          </div>
          <div className="flex gap-2">
            <span className="bg-indigo-600/30 text-indigo-300 font-bold px-1.5 py-0.5 h-4 text-[9px] rounded flex items-center justify-center shrink-0">2</span>
            <p>
              <strong>自动蒙皮绑定</strong>：在当前页面点击上方 <span className="text-indigo-400 font-medium">“✨ 自动绑定权重”</span>，全新引入的双重邻接 Laplacian 算法将自动吸附柔化骨骼，抗撕裂形变。
            </p>
          </div>
          <div className="flex gap-2">
            <span className="bg-indigo-600/30 text-indigo-300 font-bold px-1.5 py-0.5 h-4 text-[9px] rounded flex items-center justify-center shrink-0">3</span>
            <p>
              <strong>抚平关节弯曲</strong>：如果动作折弯时发现局部出现尖锐突刺或拧毛巾扭曲，先点击选中骨骼，开启下方的 <strong>“手动权重画笔”</strong> 并切换到 <strong>“抚平模糊”</strong>，在接缝接合部刷几下即可一秒修复！
            </p>
          </div>
        </div>
      </div>

      {/* Manual weights painter brush settings */}
      <div className="bg-slate-900/40 border border-slate-800/70 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold uppercase tracking-wider">
            <Paintbrush className="w-4 h-4 text-amber-400" />
            <span>手动权重画笔</span>
          </div>

          <button
            onClick={() => onTogglePainting(!isPaintingActive)}
            disabled={!selectedJointId}
            className={`px-3 py-1 rounded-md text-xs font-semibold select-none cursor-pointer transition ${
              !selectedJointId
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : isPaintingActive
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            {isPaintingActive ? '激活中: 关闭画笔' : '开启画笔工具'}
          </button>
        </div>

        {!selectedJointId && (
          <div className="bg-amber-950/10 border border-amber-900/30 rounded-lg p-3 text-[11px] text-amber-400 flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <p>请先在上方骨骼分支里选择一个「骨骼节点」，才可以激活权重画笔对其顶点响应范围进行手动补光粉刷。</p>
          </div>
        )}

        {selectedJointId && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[11px] text-slate-400">粉刷目标骨骼:</span>
              <span className="text-xs text-amber-300 font-mono font-bold">{selectedJoint?.name}</span>
            </div>

            {/* Brush Mode options */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">画笔涂抹机制</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['add', 'subtract', 'smooth'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => onBrushUpdate({ ...weightBrush, mode: m })}
                    className={`py-1 text-xs rounded transition-colors duration-150 font-medium ${
                      weightBrush.mode === m
                        ? 'bg-indigo-600 border border-indigo-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700/80 hover:text-slate-200'
                    }`}
                  >
                    {m === 'add' ? '增加权重' : m === 'subtract' ? '削减权重' : '抚平模糊'}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>画笔尺寸 (半径)</span>
                <span className="text-sky-400 font-mono">{weightBrush.size.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.05"
                value={weightBrush.size}
                onChange={(e) => onBrushUpdate({ ...weightBrush, size: parseFloat(e.target.value) })}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Strength Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>画笔涂抹强度</span>
                <span className="text-sky-400 font-mono">{Math.round(weightBrush.strength * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={weightBrush.strength}
                onChange={(e) => onBrushUpdate({ ...weightBrush, strength: parseFloat(e.target.value) })}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Heatmap spectrum indicator */}
      <div className="bg-slate-900/30 border border-slate-800/70 rounded-xl p-4 flex flex-col gap-2">
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <HelpCircle className="w-3.5 h-3.5" /> 权重热像谱图说明 (Heatmap Spectrum)
        </span>
        <div className="h-3.5 w-full rounded-md bg-gradient-to-r from-blue-600 via-green-500 to-red-600 mt-1" />
        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
          <span>无控制关联 (0.0)</span>
          <span>中间关联 (0.5)</span>
          <span>全权支配 (1.0)</span>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
          热像中呈红色的顶点将被该关节重度牵引折弯；绿黄则是二等交叉牵拉；蓝色说明顶点不受该关节动能改变的影响。
        </p>
      </div>
    </div>
  );
}
