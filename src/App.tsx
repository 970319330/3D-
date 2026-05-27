/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EditorMode, JointNode, WeightBrushSettings, KeyframeData, MoodState, MoodDelta } from './types';
import { getPresetSkeletons } from './utils/rigging';
import { MoodEngine } from './utils/moodEngine';
import Viewport from './components/Viewport';
import PresetSelector from './components/PresetSelector';
import SkeletonTree from './components/SkeletonTree';
import WeightPainterPanel from './components/WeightPainterPanel';
import Timeline from './components/Timeline';
import LLMCompanion from './components/LLMCompanion';
import QuickPoser from './components/QuickPoser';
import SkeletonImporter from './components/SkeletonImporter';
import { Box, Workflow, Paintbrush, Play, Layers3, Flame, HelpCircle, Bot, X, Wand2, Zap } from 'lucide-react';

export default function App() {
  // Main State Configuration
  const [editorMode, setEditorMode] = useState<EditorMode>('edit-model');
  const [sidebarTab, setSidebarTab] = useState<'model' | 'motion-sync' | 'ai-companion'>('model');

  // Popup Modal States
  const [isSkeletonModalOpen, setIsSkeletonModalOpen] = useState<boolean>(false);
  const [isRiggingModalOpen, setIsRiggingModalOpen] = useState<boolean>(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState<boolean>(false);

  const [activeModelType, setActiveModelType] = useState<'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf'>('gltf');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customTextureFile, setCustomTextureFile] = useState<File | null>(null);

  // Dynamic LLM animations state
  const [detectedClips, setDetectedClips] = useState<string[]>([]);
  const [externalActiveClipName, setExternalActiveClipName] = useState<string | null>(null);
  const [importedClips, setImportedClips] = useState<THREE.AnimationClip[]>([]);
  const [customMtlFile, setCustomMtlFile] = useState<File | null>(null);
  const [customTextureFiles, setCustomTextureFiles] = useState<File[]>([]);

  // Skeletal Bones state (Default start with empty state waiting for upload)
  const [joints, setJoints] = useState<JointNode[]>([]);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);

  // Manual Rigging Weights settings
  const [weightBrush, setWeightBrush] = useState<WeightBrushSettings>({
    size: 0.6,
    strength: 0.4,
    mode: 'add'
  });
  const [isPaintingActive, setIsPaintingActive] = useState<boolean>(false);
  const [hasSkinWeight, setHasSkinWeight] = useState<boolean>(false);

  // Real-time animation keyframes pool
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [keyframes, setKeyframes] = useState<KeyframeData[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Auto-rig execution counter
  const [autoRigTrigger, setAutoRigTrigger] = useState<number>(0);

  // Mood system state
  const moodEngineRef = useRef<MoodEngine>(new MoodEngine());
  const [moodState, setMoodState] = useState<MoodState>(moodEngineRef.current.getState());
  const [moodEventTrigger, setMoodEventTrigger] = useState<number>(0); // increment on each threshold event

  // Mood tick timer — runs every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      const engine = moodEngineRef.current;
      const events = engine.tick(1000);
      setMoodState(engine.getState());

      // Signal LLMCompanion to immediately check for proactive chat
      if (events.length > 0) {
        setMoodEventTrigger((prev: number) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMoodDelta = (delta: import('./types').MoodDelta) => {
    moodEngineRef.current.applyDelta(delta);
    setMoodState(moodEngineRef.current.getState());
  };

  // Synchronously update 3D Viewport editorMode whenever modals or tabs change
  useEffect(() => {
    if (isSkeletonModalOpen) {
      setEditorMode('edit-skeleton');
    } else if (isRiggingModalOpen) {
      setEditorMode('rigging');
    } else if (isActionModalOpen) {
      setEditorMode('animate');
    } else if (sidebarTab === 'ai-companion') {
      setEditorMode('ai-companion');
    } else {
      setEditorMode('edit-model');
      setIsPaintingActive(false); // Make sure brush state is turned off on exit
    }
  }, [isSkeletonModalOpen, isRiggingModalOpen, isActionModalOpen, sidebarTab]);

  // Clean skin index & skin weight buffers updated by WebGL Viewport
  const [skinBuffers, setSkinBuffers] = useState<{ indices: Float32Array; weights: Float32Array } | null>(null);

  // Synchronously update preset structure upon change
  const handleSelectPreset = (preset: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf') => {
    setActiveModelType(preset);
    setSelectedJointId(null);
    setIsPaintingActive(false);
    setKeyframes([]);
    setHasSkinWeight(false);
    setSkinBuffers(null);

    if (preset !== 'gltf') {
      setCustomFile(null);
      setCustomTextureFile(null);
      setCustomMtlFile(null);
      setCustomTextureFiles([]);
      const defaultSkel = getPresetSkeletons(preset);
      setJoints(defaultSkel);
    } else {
      // Custom loaded models start with an initial root hub bone
      setJoints([
        { id: 'root', name: 'Root Hub', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] }
      ]);
    }
  };

  const handleCustomFileLoaded = (file: File) => {
    setCustomFile(file);
    handleSelectPreset('gltf');
  };

  const handleUpdateSkinWeights = (indices: Float32Array, weights: Float32Array) => {
    setSkinBuffers({ indices, weights });
    
    // Check if weights are bound (meaning they contain non-zero influence coefficients)
    let nonZero = false;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > 0.01) {
        nonZero = true;
        break;
      }
    }
    setHasSkinWeight(nonZero);
  };

  const triggerAutoRig = () => {
    setAutoRigTrigger(prev => prev + 1);
  };

  // Unload model: clear everything and show empty scene
  const handleUnloadModel = () => {
    setActiveModelType('gltf');
    setCustomFile(null);
    setCustomTextureFile(null);
    setCustomMtlFile(null);
    setCustomTextureFiles([]);
    setSelectedJointId(null);
    setIsPaintingActive(false);
    setKeyframes([]);
    setHasSkinWeight(false);
    setSkinBuffers(null);
    setJoints([
      { id: 'root', name: 'Root Hub', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] }
    ]);
  };

  // Turn painting active/inactive
  const handleTogglePainting = (active: boolean) => {
    setIsPaintingActive(active);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#060a11] text-slate-100 overflow-hidden font-sans">
      {/* Top Header navbar panel */}
      <header className="bg-[#0b121e] border-b border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-600/20">
            <Layers3 className="w-5 h-5 text-indigo-50" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold tracking-wide text-slate-200 uppercase">AUTGO3D</h1>
            <p className="text-[10px] text-slate-500 font-mono">Interactive Web 3D Joint, Rigging & Animation Studio</p>
          </div>
        </div>

        {/* Status Indicators of active rigged mesh */}
        <div className="flex items-center gap-3">
          {hasSkinWeight ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full text-xs text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>骨骼已绑定蒙皮</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 px-3 py-1.5 rounded-full text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>待绑定骨皮 (网格静态)</span>
            </div>
          )}
          <span className="text-[10px] bg-slate-800/80 px-2.5 py-1.5 rounded border border-slate-700/40 font-mono text-slate-500">
            WebGL 2.0 Ready
          </span>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Side: Step-by-Step Rigging Editors */}
        <aside className="w-[360px] bg-[#090f19] border-r border-slate-800/80 flex flex-col shrink-0 overflow-hidden">
          
          {/* Mode Tabs Selector */}
          <div className="grid grid-cols-3 border-b border-slate-800/70 p-2 gap-1 bg-[#0b121f]/50 select-none">
            <button
              onClick={() => {
                setSidebarTab('model');
                // Auto-close open modals on manual sidebar tab switch for clean state layout
                setIsSkeletonModalOpen(false);
                setIsRiggingModalOpen(false);
                setIsActionModalOpen(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                sidebarTab === 'model'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold text-center leading-3">1. 模型配置</span>
            </button>

            <button
              onClick={() => {
                setSidebarTab('motion-sync');
                setIsSkeletonModalOpen(false);
                setIsRiggingModalOpen(false);
                setIsActionModalOpen(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                sidebarTab === 'motion-sync'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold text-center leading-3">2. 动作同步</span>
            </button>

            <button
              onClick={() => {
                setSidebarTab('ai-companion');
                setIsSkeletonModalOpen(false);
                setIsRiggingModalOpen(false);
                setIsActionModalOpen(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                sidebarTab === 'ai-companion'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-indigo-400'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold text-center leading-3">3. AI伴侣</span>
            </button>
          </div>

          {/* Tab active panel contents rendering scroll pool */}
          {sidebarTab === 'ai-companion' ? (
            <div className="flex-1 flex flex-col min-h-0 p-4 bg-[#090f19]">
              <LLMCompanion
                detectedClips={detectedClips}
                onTriggerAnimation={setExternalActiveClipName}
                moodState={moodState}
                onMoodDelta={handleMoodDelta}
                moodEventTrigger={moodEventTrigger}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 custom-scrollbar bg-[#090f19]">
              
              {/* Tab 1: Selection & Imported models presets */}
              {sidebarTab === 'model' && (
                <div className="flex flex-col gap-5">
                  <PresetSelector
                    activeModelType={activeModelType}
                    onSelectPreset={handleSelectPreset}
                    onCustomFileLoaded={handleCustomFileLoaded}
                    customFile={customFile}
                    customTextureFile={customTextureFile}
                    onCustomTextureLoaded={setCustomTextureFile}
                    customMtlFile={customMtlFile}
                    onCustomMtlLoaded={setCustomMtlFile}
                    customTextureFiles={customTextureFiles}
                    onCustomTextureFilesLoaded={setCustomTextureFiles}
                    onUnloadModel={handleUnloadModel}
                  />

                  <hr className="border-slate-800/80 my-1" />

                  {/* Gorgeous new Toolbox row of buttons to launch popups */}
                  <div className="bg-indigo-950/10 border border-indigo-500/10 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-bold uppercase tracking-wider">
                      <Workflow className="w-4 h-4 text-emerald-400" />
                      <span>3D 骨架与蒙皮工作箱</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      将外部 3D 模型加载就绪后，点击下方工作台弹出窗，即可开始精确对准、布置骨骼、蒙皮重力与重力刷图涂抹。
                    </p>
                    
                    <div className="grid grid-cols-1 gap-2 mt-1">
                      <button
                        onClick={() => {
                          setIsSkeletonModalOpen(true);
                          setIsRiggingModalOpen(false);
                          setIsActionModalOpen(false);
                        }}
                        className={`w-full py-2 px-3 rounded-lg flex items-center justify-between transition cursor-pointer text-xs font-semibold ${
                          isSkeletonModalOpen
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/10'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-755'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="w-3.5 h-3.5 text-emerald-400" />
                          <span>🦴 骨骼结构配置中心</span>
                        </div>
                        <span className="text-[10px] bg-slate-900/50 px-1.5 py-0.5 rounded text-slate-400 font-mono">打开弹窗</span>
                      </button>

                      <button
                        onClick={() => {
                          setIsRiggingModalOpen(true);
                          setIsSkeletonModalOpen(false);
                          setIsActionModalOpen(false);
                        }}
                        className={`w-full py-2 px-3 rounded-lg flex items-center justify-between transition cursor-pointer text-xs font-semibold ${
                          isRiggingModalOpen
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-755'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Paintbrush className="w-3.5 h-3.5 text-indigo-400" />
                          <span>🎨 权重绘制与自动绑定</span>
                        </div>
                        <span className="text-[10px] bg-slate-900/50 px-1.5 py-0.5 rounded text-slate-400 font-mono">打开弹窗</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Action / Motion Sync Importer Only */}
              {sidebarTab === 'motion-sync' && (
                <div className="flex flex-col gap-5">
                  <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider">
                      <Flame className="w-4 h-4 text-amber-500" />
                      <span>自定义多帧动画工房</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      希望亲自设计姿态？点击下方按钮开启精细多帧姿态编辑器。配备完全独立的关节控制、骨骼滑槽、IK 逆动力学生成器、以及 60 帧时间轴！
                    </p>
                    <button
                      onClick={() => {
                        setIsActionModalOpen(true);
                        setIsSkeletonModalOpen(false);
                        setIsRiggingModalOpen(false);
                      }}
                      className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer text-xs font-bold ${
                        isActionModalOpen
                          ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/15'
                          : 'bg-amber-500/10 hover:bg-amber-500 border border-amber-500/20 text-amber-300 hover:text-slate-950'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>🎬 启动自定义动作设计工作台 (弹窗)</span>
                    </button>
                  </div>

                  <hr className="border-slate-800/80 my-1" />

                  {/* Keep ONLY SkeletonImporter in tab according to user requirement */}
                  <SkeletonImporter
                    joints={joints}
                    onUpdateJoints={setJoints}
                    keyframes={keyframes}
                    onKeyframesUpdate={setKeyframes}
                    currentFrame={currentFrame}
                    onFrameChange={setCurrentFrame}
                    onPlayToggle={setIsPlaying}
                    onTriggerAutoRig={triggerAutoRig}
                    activeModelType={activeModelType}
                    onImportClips={(clips) => setImportedClips(prev => [...prev, ...clips])}
                  />
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Right Side: Viewport rendering segment + animation timeline bar */}
        <main className="flex-1 relative bg-[#070b13] overflow-hidden">

          {/* Main Visual interactive area — fills entire main */}
          <div className="absolute inset-0">
            <Viewport
              joints={joints}
              selectedJointId={selectedJointId}
              editorMode={editorMode}
              activeModelType={activeModelType}
              customModelFile={customFile}
              customTextureFile={customTextureFile}
              customMtlFile={customMtlFile}
              customTextureFiles={customTextureFiles}
              onSelectJoint={setSelectedJointId}
              onUpdateJoints={setJoints}
              weightBrush={weightBrush}
              isPaintingActive={isPaintingActive}
              currentFrame={currentFrame}
              keyframes={keyframes}
              onUpdateSkinWeights={handleUpdateSkinWeights}
              autoRigTrigger={autoRigTrigger}
              onGltfClipsLoaded={setDetectedClips}
              externalActiveClipName={externalActiveClipName}
              onExternalClipPlayed={() => setExternalActiveClipName(null)}
              moodState={moodState}
              onMoodDelta={handleMoodDelta}
              importedClips={importedClips}
            />
          </div>

          {/* Floating Workspace Quick Action Dock over Viewport */}
          <div className="absolute top-4 left-4 z-30 flex items-center gap-1 p-1 bg-[#0b121e]/90 backdrop-blur border border-slate-800/80 rounded-xl shadow-xl select-none">
            <button
              onClick={() => {
                setIsSkeletonModalOpen(prev => !prev);
                setIsRiggingModalOpen(false);
                setIsActionModalOpen(false);
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                isSkeletonModalOpen
                  ? 'bg-emerald-600 text-white shadow shadow-emerald-500/20'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title="配置核心骨骼关节体系与树目录"
            >
              <Workflow className="w-3.5 h-3.5" />
              <span>🦴 骨骼配置</span>
            </button>

            <button
              onClick={() => {
                setIsRiggingModalOpen(prev => !prev);
                setIsSkeletonModalOpen(false);
                setIsActionModalOpen(false);
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                isRiggingModalOpen
                  ? 'bg-indigo-600 text-white shadow shadow-indigo-500/20'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title="在模型各表面区域微调受力蒙皮画刷权重"
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span>🎨 绑定画刷</span>
            </button>

            <button
              onClick={() => {
                setIsActionModalOpen(prev => !prev);
                setIsSkeletonModalOpen(false);
                setIsRiggingModalOpen(false);
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                isActionModalOpen
                  ? 'bg-amber-500 text-slate-950 font-bold shadow shadow-amber-500/20'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title="启动自定义循环关键帧多帧设计与时间轴设计器"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>🎬 动作设计</span>
            </button>
          </div>

          {/* POPUP 1: Skeleton Structure Configulator Modal */}
          {isSkeletonModalOpen && (
            <div className="absolute top-16 right-4 z-40 bg-[#090f19]/95 backdrop-blur-md border border-indigo-500/30 rounded-2xl shadow-2xl w-[380px] max-h-[80%] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">核心骨骼配置面板</span>
                </div>
                <button
                  onClick={() => setIsSkeletonModalOpen(false)}
                  className="text-slate-400 hover:text-white transition cursor-pointer p-1 rounded-md hover:bg-slate-800/50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <p className="text-[11px] text-slate-400 leading-relaxed mb-4">
                  请在此面板中调整骨架关节偏置位置或上下层级链接。选中关节节点后，可在3D视口中拖拉直接调整关节对齐度。
                </p>
                <SkeletonTree
                  joints={joints}
                  selectedJointId={selectedJointId}
                  onSelectJoint={setSelectedJointId}
                  onUpdateJoints={setJoints}
                  editorMode={editorMode}
                />
              </div>
              <div className="p-3 border-t border-slate-800/85 bg-slate-950/30 shrink-0 flex justify-end">
                <button
                  onClick={() => setIsSkeletonModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition select-none"
                >
                  完成并退出
                </button>
              </div>
            </div>
          )}

          {/* POPUP 2: Weight Painter & Skinning Modal */}
          {isRiggingModalOpen && (
            <div className="absolute top-16 right-4 z-40 bg-[#090f19]/95 backdrop-blur-md border border-indigo-500/30 rounded-2xl shadow-2xl w-[380px] max-h-[80%] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <Paintbrush className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">3D 自动蒙皮与刷权重</span>
                </div>
                <button
                  onClick={() => setIsRiggingModalOpen(false)}
                  className="text-slate-400 hover:text-white transition cursor-pointer p-1 rounded-md hover:bg-slate-800/50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-5">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  请在此开启重力画刷画上不同关节的受力范围，或直接点击 <strong>“一键自动解算蒙皮 (Auto-Rig)”</strong> 给全骨骼自动贴合骨皮受力。
                </p>
                
                <WeightPainterPanel
                  weightBrush={weightBrush}
                  onBrushUpdate={setWeightBrush}
                  isPaintingActive={isPaintingActive}
                  onTogglePainting={handleTogglePainting}
                  joints={joints}
                  selectedJointId={selectedJointId}
                  onAutoRig={triggerAutoRig}
                  hasSkinWeight={hasSkinWeight}
                />
                
                <hr className="border-slate-800/80 my-1" />
                
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">切换当前画刷受力对象:</span>
                  <SkeletonTree
                    joints={joints}
                    selectedJointId={selectedJointId}
                    onSelectJoint={setSelectedJointId}
                    onUpdateJoints={setJoints}
                    editorMode={editorMode}
                  />
                </div>
              </div>
              
              <div className="p-3 border-t border-slate-800/85 bg-slate-950/30 shrink-0 flex justify-end">
                <button
                  onClick={() => setIsRiggingModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition select-none"
                >
                  退出绑定画笔
                </button>
              </div>
            </div>
          )}

          {/* POPUP 3: Animation timeline and quick posing workspace dock */}
          {isActionModalOpen && (
            <div className="absolute bottom-4 left-4 right-4 z-40 bg-[#090f19]/96 backdrop-blur-md border border-amber-500/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[380px] select-none animate-in slide-in-from-bottom-5 duration-150">
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800/80 bg-slate-950/40 shrink-0">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-amber-400 fill-current" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">精细多帧姿态律动编辑器</span>
                  <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-amber-300 font-mono">
                    Timeframe & Pose Lab
                  </span>
                </div>
                <button
                  onClick={() => setIsActionModalOpen(false)}
                  className="text-slate-400 hover:text-white transition cursor-pointer p-1 rounded-md hover:bg-slate-800/50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              {/* Workspace Split Layout */}
              <div className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Sliders Container Column */}
                <div className="lg:col-span-4 bg-slate-950/30 border border-slate-800/60 p-3 rounded-xl flex flex-col gap-3 min-h-0">
                  <span className="text-[11px] font-bold text-slate-300 border-b border-slate-850 pb-1.5">
                    1. 骨骼关节偏置角度微调 (Rotation Sliders)
                  </span>
                  <div className="flex-1 overflow-y-auto max-h-[200px] scrollbar-thin pr-1">
                    <QuickPoser
                      joints={joints}
                      onUpdateJoints={setJoints}
                      selectedJointId={selectedJointId}
                      onSelectJoint={setSelectedJointId}
                    />
                  </div>
                </div>

                {/* Info and Timeline Controller Column */}
                <div className="lg:col-span-8 flex flex-col gap-4 justify-between min-h-0">
                  <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 text-[11px] leading-relaxed">
                    <p className="text-slate-300">
                      并在下方时间轴中<strong>任意帧</strong>点击选中，调节左侧旋转关节，即可微调当前姿势。全部设计完即可点击 <strong>「播放动作」</strong> 查看 <strong>四元数插值插补 (SLERP)</strong> 连贯律动环。
                    </p>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-end min-h-0">
                    <Timeline
                      currentFrame={currentFrame}
                      keyframes={keyframes}
                      isPlaying={isPlaying}
                      onFrameChange={setCurrentFrame}
                      onPlayToggle={setIsPlaying}
                      onKeyframesUpdate={setKeyframes}
                      joints={joints}
                      onJointsUpdate={setJoints}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Decorative quick helper guide bar */}
      <footer className="bg-[#090f19] border-t border-slate-800 px-6 py-2.5 flex items-center justify-between text-[11px] text-slate-500 select-none">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5 text-slate-650" />
          <span>支持多点拖拽。遇到模型无法折弯？先进行 <strong>“3. 绑定模式“</strong> 中的 <strong>自动绑定</strong> 计算。</span>
        </div>
        <span>三维几何折弯物理骨络微构编辑器 v1.0.0</span>
      </footer>
    </div>
  );
}
