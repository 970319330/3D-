/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { EditorMode, JointNode, WeightBrushSettings, KeyframeData, EmotionState, EmotionImpact, BehaviorIntent, NeedState, NeedType, MoodPromptContext, AbandonmentTier, GamePrompt, GameResult } from './types';
import { getPresetSkeletons } from './utils/rigging';
import { MoodEngine } from './utils/moodEngine';
import Viewport from './components/Viewport';
import PresetSelector from './components/PresetSelector';
import SkeletonTree from './components/SkeletonTree';
import WeightPainterPanel from './components/WeightPainterPanel';
import Timeline from './components/Timeline';
import LLMCompanion from './components/LLMCompanion';
import QuickPoser from './components/QuickPoser';
import { Box, Workflow, Paintbrush, Play, Layers3, Flame, HelpCircle, Bot } from 'lucide-react';

export default function App() {
  // Main State Configuration
  const [editorMode, setEditorMode] = useState<EditorMode>('edit-model');
  const [activeModelType, setActiveModelType] = useState<'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf'>('gltf');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customTextureFile, setCustomTextureFile] = useState<File | null>(null);

  // Dynamic LLM animations state
  const [detectedClips, setDetectedClips] = useState<string[]>([]);
  const [externalActiveClipName, setExternalActiveClipName] = useState<string | null>(null);
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

  // Mood system state — v2: 性格→需求→情绪 三层架构
  const moodEngineRef = useRef<MoodEngine>(new MoodEngine());
  const [emotion, setEmotion] = useState<EmotionState>(moodEngineRef.current.getEmotion());
  const [needs, setNeeds] = useState<Record<NeedType, NeedState>>(moodEngineRef.current.getNeeds());
  const [intent, setIntent] = useState<BehaviorIntent | null>(null);
  const [promptContext, setPromptContext] = useState<MoodPromptContext>(moodEngineRef.current.getPromptContext());
  const [moodEventTrigger, setMoodEventTrigger] = useState<number>(0);

  // Abandonment system
  const [abandonment, setAbandonment] = useState<number>(0);
  const [abandonmentTier, setAbandonmentTier] = useState<AbandonmentTier>('none');
  const [activeGame, setActiveGame] = useState<GamePrompt | null>(null);

  // Mood tick timer — runs every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      const engine = moodEngineRef.current;
      const result = engine.tick(1000);
      setEmotion(engine.getEmotion());
      setNeeds(engine.getNeeds());
      setAbandonment(engine.getAbandonment());
      const newTier = engine.getAbandonmentTier();
      setAbandonmentTier((prev: AbandonmentTier) => prev !== newTier ? newTier : prev);

      // Signal LLMCompanion when behavior intent emerges
      if (result.hasBehaviorIntent && result.intent) {
        setIntent(result.intent);
        setPromptContext(engine.getPromptContext());
        setMoodEventTrigger((prev: number) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  /** 用户发送消息 → 满足需求、影响情绪 */
  const handleUserMessage = (text: string) => {
    const engine = moodEngineRef.current;
    engine.onUserMessage(text);
    setEmotion(engine.getEmotion());
    setNeeds(engine.getNeeds());
    setAbandonment(engine.getAbandonment());
    setAbandonmentTier(engine.getAbandonmentTier());
  };

  /** AI 发送主动消息 → 记录 */
  const handleProactiveSent = (snippet: string = '') => {
    const engine = moodEngineRef.current;
    engine.onProactiveSent(snippet);
    setNeeds(engine.getNeeds());
    setAbandonment(engine.getAbandonment());
    setAbandonmentTier(engine.getAbandonmentTier());
  };

  // Reset mood engine to fresh state
  const handleResetMood = () => {
    const engine = new MoodEngine();
    moodEngineRef.current = engine;
    setEmotion(engine.getEmotion());
    setNeeds(engine.getNeeds());
    setIntent(null);
    setPromptContext(engine.getPromptContext());
    setAbandonment(0);
    setAbandonmentTier('none');
    setActiveGame(null);
  };

  // Game complete — apply emotion impact, clear game state
  const handleGameComplete = (result: GameResult) => {
    if (result.emotionImpact) {
      moodEngineRef.current.applyImpact(result.emotionImpact);
      setEmotion(moodEngineRef.current.getEmotion());
    }
    setActiveGame(null);
  };

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
          <div className="grid grid-cols-5 border-b border-slate-800/70 p-2 gap-1 bg-[#0b121f]/50 select-none">
            <button
              onClick={() => {
                setEditorMode('edit-model');
                setIsPaintingActive(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                editorMode === 'edit-model'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span className="text-[9px] font-semibold text-center leading-3">1. 模型</span>
            </button>

            <button
              onClick={() => {
                setEditorMode('edit-skeleton');
                setIsPaintingActive(false);
                setSelectedJointId(null);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                editorMode === 'edit-skeleton'
                  ? 'bg-[#10b981] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              <span className="text-[9px] font-semibold text-center leading-3">2. 骨骼</span>
            </button>

            <button
              onClick={() => {
                setEditorMode('rigging');
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                editorMode === 'rigging'
                  ? 'bg-indigo-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span className="text-[9px] font-semibold text-center leading-3">3. 绑定</span>
            </button>

            <button
              onClick={() => {
                setEditorMode('animate');
                setIsPaintingActive(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                editorMode === 'animate'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span className="text-[9px] font-semibold text-center leading-3">4. 动作</span>
            </button>

            <button
              onClick={() => {
                setEditorMode('ai-companion');
                setIsPaintingActive(false);
              }}
              className={`py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
                editorMode === 'ai-companion'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-indigo-400'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="text-[9px] font-semibold text-center leading-3">5. AI伴侣</span>
            </button>
          </div>

          {/* Tab active panel contents rendering scroll pool */}
          {editorMode === 'ai-companion' ? (
            <div className="flex-1 flex flex-col min-h-0 p-4 bg-[#090f19]">
              <LLMCompanion
                detectedClips={detectedClips}
                onTriggerAnimation={setExternalActiveClipName}
                emotion={emotion}
                needs={needs}
                intent={intent}
                promptContext={promptContext}
                moodEventTrigger={moodEventTrigger}
                joints={joints}
                onMotionGenerated={(kfs) => {
                  setKeyframes(kfs);
                  setEditorMode('animate');
                }}
                isPlaying={isPlaying}
                onSetPlaying={setIsPlaying}
                abandonment={abandonment}
                abandonmentTier={abandonmentTier}
                activeGame={activeGame}
                onUserMessage={handleUserMessage}
                onProactiveSent={handleProactiveSent}
                onGameStart={(game: GamePrompt) => setActiveGame(game)}
                onGameComplete={handleGameComplete}
                onResetMood={handleResetMood}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 custom-scrollbar bg-[#090f19]">
              
              {/* Mode 1: Selection & Imported models presets */}
              {editorMode === 'edit-model' && (
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
              )}

              {/* Mode 2: Skeletal bones configuration */}
              {editorMode === 'edit-skeleton' && (
                <SkeletonTree
                  joints={joints}
                  selectedJointId={selectedJointId}
                  onSelectJoint={setSelectedJointId}
                  onUpdateJoints={setJoints}
                  editorMode={editorMode}
                />
              )}

              {/* Mode 3: Dynamic proximity rigging tool panel */}
              {editorMode === 'rigging' && (
                <div className="flex flex-col gap-5">
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
                  
                  {/* Embedded tree at bottom for quick paints target changes */}
                  <SkeletonTree
                    joints={joints}
                    selectedJointId={selectedJointId}
                    onSelectJoint={setSelectedJointId}
                    onUpdateJoints={setJoints}
                    editorMode={editorMode}
                  />
                </div>
              )}

              {/* Mode 4: Static posing sliders and action guidelines */}
              {editorMode === 'animate' && (
                <div className="flex flex-col gap-5">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex flex-col gap-2.5">
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider">
                      <Flame className="w-4 h-4" />
                      <span>运动轨迹捕捉设计</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      您已进入 <strong>多帧动作设计模式</strong>！在下方时间轴上滑动帧号、使用旋转条捏出帅气的 pose，然后点击右侧的「录入关键帧」保存该帧。
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      系统会自动对关键帧之间的骨骼偏转系数进行 <strong>四元数插值插补 (SLERP)</strong> 运算，使整个关节在连续循环律动时极其自然且不卡顿。
                    </p>
                  </div>

                  <hr className="border-slate-800/80 my-1" />

                  <QuickPoser
                    joints={joints}
                    onUpdateJoints={setJoints}
                    selectedJointId={selectedJointId}
                    onSelectJoint={setSelectedJointId}
                  />

                  <hr className="border-slate-800/80 my-1" />

                  <SkeletonTree
                    joints={joints}
                    selectedJointId={selectedJointId}
                    onSelectJoint={setSelectedJointId}
                    onUpdateJoints={setJoints}
                    editorMode={editorMode}
                  />
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Right Side: Viewport rendering segment + animation timeline bar */}
        <main className="flex-1 relative bg-[#070b13] overflow-hidden">

          {/* Main Visual interactive area — fills entire main */}
          <div className="absolute inset-0 border-b border-slate-800/40">
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
            />
          </div>

          {/* Timeline overlaid at bottom — only in animate mode */}
          {editorMode === 'animate' && (
            <div className="absolute bottom-0 left-0 right-0 z-10">
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
