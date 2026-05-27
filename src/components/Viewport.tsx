import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { JointNode, EditorMode, WeightBrushSettings, KeyframeData, MoodState, MoodDelta } from '../types';
import { calculateAutoWeights, getPresetSkeletons } from '../utils/rigging';
import { Sparkles, Move3d, Paintbrush, RotateCw, Film, Play, Pause, Sun, Lightbulb, Sliders, UploadCloud, Camera } from 'lucide-react';

interface ViewportProps {
  joints: JointNode[];
  selectedJointId: string | null;
  editorMode: EditorMode;
  activeModelType: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf';
  customModelFile: File | null;
  customTextureFile?: File | null;
  customMtlFile?: File | null;
  customTextureFiles?: File[];
  onSelectJoint: (id: string | null) => void;
  onUpdateJoints: (newJoints: JointNode[]) => void;
  weightBrush: WeightBrushSettings;
  isPaintingActive: boolean;
  currentFrame: number;
  keyframes: KeyframeData[];
  onUpdateSkinWeights: (indices: Float32Array, weights: Float32Array) => void;
  autoRigTrigger: number;
  onGltfClipsLoaded?: (clips: string[]) => void;
  externalActiveClipName?: string | null;
  onExternalClipPlayed?: () => void;
  moodState?: MoodState;
  onMoodDelta?: (delta: MoodDelta) => void;
  importedClips?: THREE.AnimationClip[];
}

function findStandbyClipName(clips: THREE.AnimationClip[]): string {
  const names = clips.map(c => c.name.toLowerCase());
  const priorities = ['idle', 'stand', 'stay', 'pose', 'wait', 'loop', 'default', '待机', 'poses'];
  for (const keyword of priorities) {
    const idx = names.findIndex(name => name.includes(keyword));
    if (idx !== -1) {
      return clips[idx].name;
    }
  }
  if (clips.length > 0) return clips[0].name;
  return '';
}

/**
 * Projects a 3D joint coordinate to 2D screen coordinate in the viewport container.
 */
function projectJointToScreen(pos: [number, number, number], camera: THREE.Camera, rect: DOMRect) {
  const v = new THREE.Vector3(pos[0], pos[1], pos[2]);
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-(v.y * 0.5) + 0.5) * rect.height;
  return { x, y };
}

/**
 * Ensures all items in an array of animation clips have unique names.
 * If a name collision occurs, it appends a distinct numerical suffix to a cloned clip.
 */
function ensureUniqueClipNames(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const seen = new Set<string>();
  return clips.map(clip => {
    let name = clip.name || 'unnamed_clip';
    if (seen.has(name)) {
      let counter = 1;
      let newName = `${name} (${counter})`;
      while (seen.has(newName)) {
        counter++;
        newName = `${name} (${counter})`;
      }
      name = newName;
      const cloned = clip.clone();
      cloned.name = name;
      seen.add(name);
      return cloned;
    } else {
      seen.add(name);
      return clip;
    }
  });
}

export default function Viewport({
  joints,
  selectedJointId,
  editorMode,
  activeModelType,
  customModelFile,
  customTextureFile,
  customMtlFile = null,
  customTextureFiles = [],
  onSelectJoint,
  onUpdateJoints,
  weightBrush,
  isPaintingActive,
  currentFrame,
  keyframes,
  onUpdateSkinWeights,
  autoRigTrigger,
  onGltfClipsLoaded,
  externalActiveClipName,
  onExternalClipPlayed,
  moodState,
  onMoodDelta,
  importedClips
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Cinematic Camera State & Ref
  const [isCinematicCollapsed, setIsCinematicCollapsed] = useState<boolean>(false);
  
  const cinematicRef = useRef({
    active: false,
    transitioningOut: false,
    progress: 0,
    moodType: 'none' as 'none' | 'joy' | 'sadness' | 'anger' | 'surprised',
    startTime: 0,
    durationMs: 5000,
    extraAngle: 0,
    backedUp: false,
    backupPos: new THREE.Vector3(),
    backupTarget: new THREE.Vector3(),
  });

  const prevMoodRef = useRef<MoodState | null>(null);

  // State for original GLTF model animations & showroom mode
  const [gltfClips, setGltfClips] = useState<THREE.AnimationClip[]>([]);
  const [activeClipName, setActiveClipName] = useState<string>('');
  const [isShowroomActive, setIsShowroomActive] = useState<boolean>(false);
  const [isGltfAnimating, setIsGltfAnimating] = useState<boolean>(true);
  const [showroomSpeed, setShowroomSpeed] = useState<number>(1.0);

  // Light Settings
  const [lightPreset, setLightPreset] = useState<'studio' | 'daylight' | 'cyber' | 'gallery'>('studio');
  const [ambientIntensity, setAmbientIntensity] = useState<number>(0.6);
  const [keyLightIntensity, setKeyLightIntensity] = useState<number>(1.0);
  const [toneExposure, setToneExposure] = useState<number>(1.1);

  // HDR Environment Mapping settings
  const [hdrPreset, setHdrPreset] = useState<'none' | 'studio' | 'sunset' | 'cyber' | 'gallery'>('studio');
  const [customHdrFile, setCustomHdrFile] = useState<File | null>(null);
  const [useHdrAsBackground, setUseHdrAsBackground] = useState<boolean>(false);
  const [isHdrLoading, setIsHdrLoading] = useState<boolean>(false);

  // Keep references for animation loop and handlers
  const stateRef = useRef({
    joints,
    selectedJointId,
    editorMode,
    activeModelType,
    customModelFile,
    weightBrush,
    isPaintingActive,
    currentFrame,
    keyframes,
    isShowroomActive,
    isGltfAnimating,
    showroomSpeed,
    hdrPreset,
    customHdrFile,
    useHdrAsBackground,
    showSkeleton: true
  });

  // Track if we need to rebuild the geometry or hierarchy
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [modelStats, setModelStats] = useState({ vertices: 0, faces: 0, bones: 0 });

  // Mixamo configuration & alignment state
  const [isMixamoActive, setIsMixamoActive] = useState<boolean>(false);
  const [isSymmetryMode, setIsSymmetryMode] = useState<boolean>(true);
  const [activeDragJointId, setActiveDragJointId] = useState<string | null>(null);

  // Collapsible panel states (default collapsed!)
  const [isShowroomCollapsed, setIsShowroomCollapsed] = useState<boolean>(true);
  const [isNavCollapsed, setIsNavCollapsed] = useState<boolean>(true);

  // Show/Hide 3D Skeleton Visualizers
  const [showSkeleton, setShowSkeleton] = useState<boolean>(true);

  // Update mutables to bypass useEffect re-binding latency in high-freq canvas interaction
  useEffect(() => {
    stateRef.current = {
      joints,
      selectedJointId,
      editorMode,
      activeModelType,
      customModelFile,
      weightBrush,
      isPaintingActive,
      currentFrame,
      keyframes,
      isShowroomActive,
      isGltfAnimating,
      showroomSpeed,
      hdrPreset,
      customHdrFile,
      useHdrAsBackground,
      showSkeleton
    };
  }, [joints, selectedJointId, editorMode, activeModelType, customModelFile, weightBrush, isPaintingActive, currentFrame, keyframes, isShowroomActive, isGltfAnimating, showroomSpeed, hdrPreset, customHdrFile, useHdrAsBackground, showSkeleton]);

  // Handle auto-rig execution from props
  useEffect(() => {
    if (autoRigTrigger > 0) {
      triggerAutoRigging();
    }
  }, [autoRigTrigger]);

  // Get dynamic model height metric to scale cinematography proportionally
  const getModelHeight = useCallback((): number => {
    const t = threeRef.current;
    if (!t) return 1.8;
    const activeMesh = t.loadedGltfScene || t.mainMesh;
    if (activeMesh && activeMesh.visible) {
      const box = new THREE.Box3().setFromObject(activeMesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 0.1) return size.y;
    }
    return 1.8;
  }, []);

  // Calculate dynamic front facing vector of character model
  const getModelFacingDirection = useCallback((): THREE.Vector3 => {
    const t = threeRef.current;
    const forward = new THREE.Vector3(0, 0, 1); // default forward/look direction

    if (!t) return forward;

    // 1. Try to find Head bone and Face features hierarchy
    let headBone: THREE.Object3D | null = null;
    let faceFeatureBone: THREE.Object3D | null = null;

    if (t.threeBones && t.threeBones.length > 0) {
      headBone = t.threeBones.find(b => {
        const name = b.name.toLowerCase();
        return name.includes('head');
      }) || null;

      if (!headBone) {
        headBone = t.threeBones.find(b => {
          const name = b.name.toLowerCase();
          return name.includes('neck');
        }) || null;
      }

      // Try searching for sensory/facial joints like eyes, nose, mouth, jaw in bones list
      faceFeatureBone = t.threeBones.find(b => {
        const name = b.name.toLowerCase();
        return (name.includes('eye') || name.includes('nose') || name.includes('jaw') || name.includes('mouth') || name.includes('face') || name.includes('head_end')) && !name.includes('eyebrow');
      }) || null;
    }

    // 2. Traversal scan of scene components to identify face indicators
    if (t.loadedGltfScene) {
      if (!headBone) {
        t.loadedGltfScene.traverse(child => {
          const name = child.name.toLowerCase();
          if (!headBone && (name.includes('head') || name.includes('neck'))) {
            headBone = child;
          }
        });
      }
      t.loadedGltfScene.traverse(child => {
        const name = child.name.toLowerCase();
        if (!faceFeatureBone && (name.includes('eye') || name.includes('nose') || name.includes('jaw') || name.includes('mouth') || name.includes('face')) && !name.includes('eyebrow') && child !== headBone) {
          faceFeatureBone = child;
        }
      });
    }

    // Calculate facing offset
    if (headBone && faceFeatureBone) {
      const headPos = new THREE.Vector3();
      const featurePos = new THREE.Vector3();
      headBone.getWorldPosition(headPos);
      faceFeatureBone.getWorldPosition(featurePos);

      const dir = new THREE.Vector3().subVectors(featurePos, headPos);
      dir.y = 0; // lock to horizontal plane
      if (dir.lengthSq() > 0.0001) {
        dir.normalize();
        return dir;
      }
    }

    // 3. Fallback to Shoulder-span orthogonal coordinate projection
    let leftArm: THREE.Object3D | null = null;
    let rightArm: THREE.Object3D | null = null;

    const findBone = (filter: (n: string) => boolean) => {
      if (t.threeBones) {
        const b = t.threeBones.find(x => filter(x.name.toLowerCase()));
        if (b) return b;
      }
      let found: THREE.Object3D | null = null;
      if (t.loadedGltfScene) {
        t.loadedGltfScene.traverse(c => {
          if (!found && filter(c.name.toLowerCase())) found = c;
        });
      }
      return found;
    };

    leftArm = findBone(n => (n.includes('leftshoulder') || n.includes('l_shoulder') || n.includes('leftarm') || n.includes('l_arm') || n.includes('leftclavicle')) && !n.includes('forearm'));
    rightArm = findBone(n => (n.includes('rightshoulder') || n.includes('r_shoulder') || n.includes('rightarm') || n.includes('r_arm') || n.includes('rightclavicle')) && !n.includes('forearm'));

    if (leftArm && rightArm) {
      const posL = new THREE.Vector3();
      const posR = new THREE.Vector3();
      leftArm.getWorldPosition(posL);
      rightArm.getWorldPosition(posR);

      const lateral = new THREE.Vector3().subVectors(posR, posL);
      lateral.y = 0;
      if (lateral.lengthSq() > 0.001) {
        lateral.normalize();
        const upVec = new THREE.Vector3(0, 1, 0);
        const faceDir = new THREE.Vector3().crossVectors(lateral, upVec).normalize();
        return faceDir;
      }
    }

    return forward;
  }, []);

  // Dynamic Head Position Tracking (for facial or close-up focus based on bones or bounding boxes)
  const getHeadWorldPosition = useCallback((): THREE.Vector3 => {
    const t = threeRef.current;
    if (!t) return new THREE.Vector3(0, 1.5, 0);

    const targetPos = new THREE.Vector3();

    // 1. Try to find a bone with name containing 'head', 'neck', or 'face'
    let headBone: THREE.Bone | null = null;
    if (t.threeBones && t.threeBones.length > 0) {
      headBone = t.threeBones.find(b => {
        const name = b.name.toLowerCase();
        return name.includes('head') || name.includes('neck') || name.includes('face');
      }) || null;
    }

    if (headBone) {
      headBone.getWorldPosition(targetPos);
      return targetPos;
    }

    // 2. Fallback to bounding box calculations of the visible mesh
    const activeMesh = t.loadedGltfScene || t.mainMesh;
    if (activeMesh && activeMesh.visible) {
      const box = new THREE.Box3().setFromObject(activeMesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      
      if (size.y > 0.1) {
        // Face is roughly at top 15% height of the bounding box
        targetPos.set(center.x, box.max.y - size.y * 0.15, center.z);
        return targetPos;
      }
    }

    // 3. Fallback to constant height relative to standard joints
    const jointsState = joints;
    const neckNode = jointsState.find(j => j.id === 'neck' || j.name.toLowerCase().includes('neck') || j.name.toLowerCase().includes('head'));
    if (neckNode) {
      targetPos.set(neckNode.position[0], neckNode.position[1] + 0.15, neckNode.position[2]);
      return targetPos;
    }

    return new THREE.Vector3(0, 1.6, 0);
  }, [joints]);

  // Activate cinematic camera transition
  const triggerCinematicCloseUp = useCallback((moodType: 'joy' | 'sadness' | 'anger' | 'surprised' | 'none') => {
    const cin = cinematicRef.current;
    const t = threeRef.current;
    if (!t || !t.camera || !t.controls) return;

    cin.active = true;
    cin.transitioningOut = false;
    cin.moodType = moodType;
    cin.startTime = Date.now();
    cin.durationMs = moodType === 'anger' ? 4000 : 5500; // anger focuses shorter/sharper
    cin.extraAngle = 0;
    
    // Backup camera state
    if (!cin.backedUp) {
      cin.backupPos.copy(t.camera.position);
      cin.backupTarget.copy(t.controls.target);
      cin.backedUp = true;
    }

    // Lock OrbitControls rotation so user drags don't fight the camera anim
    t.controls.enableRotate = false;
    
    console.log(`[AI智能运镜] 心情特写启动: ${moodType}`);
  }, []);

  // Trigger manual test which also injects delta directly in parent state
  const handleManualMoodTrigger = useCallback((moodType: 'joy' | 'anger' | 'sadness') => {
    let delta: MoodDelta = {};
    if (moodType === 'joy') {
      delta = { happiness: 45, energy: 20, anger: -10, sadness: -20 };
    } else if (moodType === 'anger') {
      delta = { anger: 50, happiness: -20, energy: 25, sadness: -5 };
    } else if (moodType === 'sadness') {
      delta = { sadness: 45, happiness: -25, energy: -20, anger: -5 };
    }
    
    if (onMoodDelta) {
      onMoodDelta(delta);
    }
    
    triggerCinematicCloseUp(moodType);
  }, [onMoodDelta, triggerCinematicCloseUp]);

  // Smart transition/fluctuation watcher for mood changes
  useEffect(() => {
    if (!moodState) return;
    
    if (prevMoodRef.current) {
      const prev = prevMoodRef.current;
      const diffs = {
        happiness: moodState.happiness - prev.happiness,
        energy: moodState.energy - prev.energy,
        anger: moodState.anger - prev.anger,
        sadness: moodState.sadness - prev.sadness,
      };

      // Sum of absolute changes to evaluate "fluctuation" waves
      const totalDelta = Math.abs(diffs.happiness) + Math.abs(diffs.energy) + Math.abs(diffs.anger) + Math.abs(diffs.sadness);

      // Trigger if aggregate change exceeds 8, OR if any single dimension transitions by >= 5 points (avoiding micro noise)
      const isSignificantChange = totalDelta >= 8.0 || 
                                  Math.abs(diffs.happiness) >= 5.0 || 
                                  Math.abs(diffs.anger) >= 5.0 || 
                                  Math.abs(diffs.sadness) >= 5.0;

      if (isSignificantChange) {
        let dominantMood: 'joy' | 'sadness' | 'anger' | 'none' = 'none';
        
        // Target which mood went up or changed most
        const maxDelta = Math.max(
          Math.abs(diffs.happiness),
          Math.abs(diffs.sadness),
          Math.abs(diffs.anger)
        );

        if (maxDelta === Math.abs(diffs.happiness) && moodState.happiness > 50) {
          dominantMood = 'joy';
        } else if (maxDelta === Math.abs(diffs.sadness) && moodState.sadness > 40) {
          dominantMood = 'sadness';
        } else if (maxDelta === Math.abs(diffs.anger) && moodState.anger > 40) {
          dominantMood = 'anger';
        }

        if (dominantMood !== 'none') {
          triggerCinematicCloseUp(dominantMood);
        }
      }
    }
    
    prevMoodRef.current = { ...moodState };
  }, [moodState, triggerCinematicCloseUp]);

  // Synchronize custom lighting options & presets
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    // Apply tone mapping exposure
    if (t.renderer) {
      t.renderer.toneMappingExposure = toneExposure;
    }

    // Determine colors and coefficients based on the selected lightPreset
    if (lightPreset === 'studio') {
      if (t.ambientLight) {
        t.ambientLight.color.set('#ffffff');
        t.ambientLight.intensity = ambientIntensity;
      }
      if (t.dirLight) {
        t.dirLight.color.set('#ffffff');
        t.dirLight.intensity = keyLightIntensity;
      }
      if (t.fillLight) {
        t.fillLight.color.set('#4338ca');
        t.fillLight.intensity = 0.4;
      }
      if (t.hemLight) {
        t.hemLight.color.set('#818cf8');
        t.hemLight.groundColor.set('#0f172a');
        t.hemLight.intensity = 0.3;
      }
    } else if (lightPreset === 'daylight') {
      if (t.ambientLight) {
        t.ambientLight.color.set('#fef08a'); // Warm yellow ambient
        t.ambientLight.intensity = ambientIntensity * 1.25;
      }
      if (t.dirLight) {
        t.dirLight.color.set('#ffffff'); // High white sun
        t.dirLight.intensity = keyLightIntensity * 1.5;
      }
      if (t.fillLight) {
        t.fillLight.color.set('#f0fdf4'); // Soft white-green bounce
        t.fillLight.intensity = 0.35;
      }
      if (t.hemLight) {
        t.hemLight.color.set('#bae6fd'); // Blue sky
        t.hemLight.groundColor.set('#78350f'); // Clay ground
        t.hemLight.intensity = 0.5;
      }
    } else if (lightPreset === 'cyber') {
      if (t.ambientLight) {
        t.ambientLight.color.set('#1e1b4b'); // Cyber purple background ambient
        t.ambientLight.intensity = ambientIntensity * 0.8;
      }
      if (t.dirLight) {
        t.dirLight.color.set('#ec4899'); // Neon Pink key
        t.dirLight.intensity = keyLightIntensity * 1.3;
      }
      if (t.fillLight) {
        t.fillLight.color.set('#06b6d4'); // Cyan neon fill
        t.fillLight.intensity = 0.95;
      }
      if (t.hemLight) {
        t.hemLight.color.set('#a855f7'); // Light purple hem
        t.hemLight.groundColor.set('#030712'); // Pitch black bottom
        t.hemLight.intensity = 0.6;
      }
    } else if (lightPreset === 'gallery') {
      if (t.ambientLight) {
        t.ambientLight.color.set('#ffedd5'); // Warm candle light
        t.ambientLight.intensity = ambientIntensity * 1.1;
      }
      if (t.dirLight) {
        t.dirLight.color.set('#fcd34d'); // Amber-gold spotlight
        t.dirLight.intensity = keyLightIntensity * 1.4;
      }
      if (t.fillLight) {
        t.fillLight.color.set('#fdba74'); // Honey-fill
        t.fillLight.intensity = 0.55;
      }
      if (t.hemLight) {
        t.hemLight.color.set('#fed7aa'); 
        t.hemLight.groundColor.set('#1c1917');
        t.hemLight.intensity = 0.4;
      }
    }
  }, [lightPreset, ambientIntensity, keyLightIntensity, toneExposure, joints, activeModelType]);

  // Synchronize HDR environment map setup (procedural or loaded)
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    // Discard any previous scene environment
    const resetEnvironment = () => {
      if (t.scene.environment) {
        t.scene.environment = null;
      }
      t.scene.background = new THREE.Color('#0b0f19');
    };

    if (hdrPreset === 'none') {
      resetEnvironment();
      return;
    }

    setIsHdrLoading(true);
    const pmremGenerator = new THREE.PMREMGenerator(t.renderer);
    pmremGenerator.compileEquirectangularShader();

    const applyEnvironment = (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const envRenderTarget = pmremGenerator.fromEquirectangular(texture);
      const envMap = envRenderTarget.texture;
      
      t.scene.environment = envMap;
      if (useHdrAsBackground) {
        t.scene.background = envMap;
      } else {
        t.scene.background = new THREE.Color('#0b0f19');
      }

      texture.dispose();
      pmremGenerator.dispose();
      setIsHdrLoading(false);
    };

    if (hdrPreset === 'custom' && customHdrFile) {
      const url = URL.createObjectURL(customHdrFile);
      const isExr = customHdrFile.name.toLowerCase().endsWith('.exr');
      const loader = isExr ? new EXRLoader() : new RGBELoader();

      loader.load(
        url,
        (hdrTexture: THREE.Texture) => {
          applyEnvironment(hdrTexture);
          URL.revokeObjectURL(url);
        },
        undefined,
        (err: unknown) => {
          console.error(`加载自定义 ${isExr ? 'EXR' : 'HDR'} 贴图失败: `, err);
          setIsHdrLoading(false);
          URL.revokeObjectURL(url);
          // Auto revert to studio if custom fails
          setHdrPreset('studio');
        }
      );
    } else {
      // Procedurally generate highly reactive, high-contrast studio gradients
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        
        if (hdrPreset === 'studio') {
          gradient.addColorStop(0, '#ffffff'); // bright top sky
          gradient.addColorStop(0.35, '#94a3b8'); // diffuse metal gray
          gradient.addColorStop(0.7, '#1e293b'); // dark floor
          gradient.addColorStop(1, '#020617');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Render overhead high-intensity key softbox lights
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(300, 150, 140, 60, Math.PI / 10, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(750, 200, 120, 45, -Math.PI / 12, 0, Math.PI * 2);
          ctx.fill();
        } else if (hdrPreset === 'sunset') {
          gradient.addColorStop(0, '#ffedd5'); // peach-gold top sky
          gradient.addColorStop(0.4, '#f97316'); // hot sunset orange
          gradient.addColorStop(0.8, '#451a03'); // deep brown reflection
          gradient.addColorStop(1, '#0c0a09');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Giant burning solar core spotlight
          const sunGlow = ctx.createRadialGradient(512, 256, 12, 512, 256, 240);
          sunGlow.addColorStop(0, '#ffffff');
          sunGlow.addColorStop(0.25, '#fef08a');
          sunGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
          ctx.fillStyle = sunGlow;
          ctx.beginPath();
          ctx.arc(512, 256, 240, 0, Math.PI * 2);
          ctx.fill();
        } else if (hdrPreset === 'cyber') {
          gradient.addColorStop(0, '#d946ef'); // vibrant magenta sky
          gradient.addColorStop(0.5, '#1e1b4b'); // deep synthwave violet
          gradient.addColorStop(1, '#030712'); // obsidian void
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Hot cyan laser panels on the sides
          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(120, 0, 60, canvas.height);

          // neon emerald ring glow
          const ringGlow = ctx.createRadialGradient(820, 180, 10, 820, 180, 150);
          ringGlow.addColorStop(0, '#10b981');
          ringGlow.addColorStop(1, 'rgba(16, 185, 129, 0)');
          ctx.fillStyle = ringGlow;
          ctx.beginPath();
          ctx.arc(820, 180, 150, 0, Math.PI * 2);
          ctx.fill();
        } else if (hdrPreset === 'gallery') {
          gradient.addColorStop(0, '#fef3c7'); // luxury warm gold sky
          gradient.addColorStop(0.35, '#fbbf24'); // soft amber glow
          gradient.addColorStop(0.75, '#1f1607'); // deep golden-timber ground
          gradient.addColorStop(1, '#0c0a09');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Spotlights
          ctx.fillStyle = '#fffbeb';
          ctx.beginPath();
          ctx.ellipse(320, 120, 80, 80, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(720, 140, 110, 40, Math.PI / 10, 0, Math.PI * 2);
          ctx.fill();
        }

        const canvasTexture = new THREE.CanvasTexture(canvas);
        applyEnvironment(canvasTexture);
      } else {
        pmremGenerator.dispose();
        setIsHdrLoading(false);
      }
    }
  }, [hdrPreset, customHdrFile, useHdrAsBackground]);

  // Synchronize Showroom Mode status inside THREE scene
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    if (isShowroomActive && t.loadedGltfScene) {
      // Add loaded original GLTF scene to the context scene if not already added
      if (!t.scene.children.includes(t.loadedGltfScene)) {
        t.scene.add(t.loadedGltfScene);
      }
      t.loadedGltfScene.visible = true;

      // Disable manual skinned mesh and helpers
      if (t.mainMesh) {
        t.mainMesh.visible = false;
      }
      if (t.jointVisualizersGroup) t.jointVisualizersGroup.visible = false;
      if (t.boneVisualizersGroup) t.boneVisualizersGroup.visible = false;
    } else {
      // Hide native GLTF scene
      if (t.loadedGltfScene) {
        t.loadedGltfScene.visible = false;
      }

      // Re-enable manual skinnings
      if (t.mainMesh) {
        t.mainMesh.visible = true;
      }
      
      // Make skeletons visible if we list any joints and we enable skeleton display
      if (t.jointVisualizersGroup) t.jointVisualizersGroup.visible = showSkeleton;
      if (t.boneVisualizersGroup) t.boneVisualizersGroup.visible = showSkeleton;
    }
  }, [isShowroomActive, activeModelType, joints, showSkeleton]);

  // Directly play a clip on the mixer, bypassing React state for immediate transition.
  // Used by the 'finished' event handler to avoid the 1-2 frame delay of setState + re-render.
  const playClipDirect = useCallback((clipName: string, mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[], standbyName: string) => {
    const clip = clips.find(c => c.name === clipName);
    if (!clip) return;

    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.stop();      // ensure fully stopped so reset() works from a clean state
    action.reset();     // time=0, weight=1, enabled=true
    action.time = 0;    // explicit guard: force time to 0
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(isGltfAnimating ? showroomSpeed : 0);

    if (clipName !== standbyName) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
    action.play();
  }, [isGltfAnimating, showroomSpeed]);

  // Synchronize animation clip playing transitions inside GLTF Animation Mixer
  useEffect(() => {
    const t = threeRef.current;
    if (!t || !t.gltfMixer || !t.gltfClips) return;

    if (!isShowroomActive) {
      t.gltfMixer.stopAllAction();
      return;
    }

    const standbyClipName = findStandbyClipName(t.gltfClips);
    playClipDirect(activeClipName, t.gltfMixer, t.gltfClips, standbyClipName);

    // Set up finished event listener to restore to standby animation
    const onFinished = (e: any) => {
      const standbyName = findStandbyClipName(t.gltfClips || []);
      if (standbyName && activeClipName !== standbyName) {
        // Directly play standby animation on the mixer WITHOUT going through React state
        // This avoids the delay between setState -> re-render -> effect running.
        playClipDirect(standbyName, t.gltfMixer!, t.gltfClips!, standbyName);
        // Also update the React state for UI consistency (e.g. clip name display)
        setActiveClipName(standbyName);
      }
    };

    t.gltfMixer.addEventListener('finished', onFinished);
    return () => {
      t.gltfMixer?.removeEventListener('finished', onFinished);
    };
  }, [activeClipName, isShowroomActive, isGltfAnimating, showroomSpeed, playClipDirect]);

  // Notify parent of loaded clips list
  useEffect(() => {
    if (onGltfClipsLoaded) {
      onGltfClipsLoaded(gltfClips.map(c => c.name));
    }
  }, [gltfClips, onGltfClipsLoaded]);

  // Synchronize externally loaded skeleton animation clips to the active model
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    if (importedClips && importedClips.length > 0) {
      console.log("Detecting new imported animation clips:", importedClips.map(c => c.name));
      
      // Filter out duplicate names from t.gltfClips or combined list to prevent double appends
      const existingNames = new Set((t.gltfClips || []).map(c => c.name));
      const freshClips = importedClips.filter(c => !existingNames.has(c.name));
      
      if (freshClips.length > 0) {
        const combined = [...(t.gltfClips || []), ...freshClips];
        const uniqueCombined = ensureUniqueClipNames(combined);
        t.gltfClips = uniqueCombined;
        setGltfClips(uniqueCombined);
        
        // Auto-play the newly imported clip if it's the latest
        const latestClip = uniqueCombined[uniqueCombined.length - 1];
        setActiveClipName(latestClip.name);
        setIsShowroomActive(true); // Switch to 3D showroom to play it directly!
        setIsGltfAnimating(true);
        
        if (t.gltfMixer) {
          t.gltfMixer.stopAllAction();
          const action = t.gltfMixer.clipAction(latestClip);
          action.reset().fadeIn(0.25).play();
        }
      }
    }
  }, [importedClips]);

  // Play animation clip command from parent
  useEffect(() => {
    if (externalActiveClipName) {
      setActiveClipName(externalActiveClipName);
      if (onExternalClipPlayed) {
        onExternalClipPlayed();
      }
    }
  }, [externalActiveClipName, onExternalClipPlayed]);

  // THREE.js Scene variables held in ref
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    mainMesh: THREE.SkinnedMesh | THREE.Mesh | null;
    rawGeometry: THREE.BufferGeometry | null; // Keep rest geometry
    skeleton: THREE.Skeleton | null;
    threeBones: THREE.Bone[];
    jointVisualizersGroup: THREE.Group;
    boneVisualizersGroup: THREE.Group;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    brushSphere: THREE.Mesh | null;
    cameraBackupPosition?: THREE.Vector3;
    cameraBackupTarget?: THREE.Vector3;
    loadedTexture?: THREE.Texture | null;
    loadedMaterials?: THREE.Material[] | null;
    loadedGltfScene?: THREE.Group | null;
    gltfMixer?: THREE.AnimationMixer | null;
    gltfClips?: THREE.AnimationClip[];
  } | null>(null);

  // Track object URLs for local File memory recycling
  const objectUrlsRef = useRef<string[]>([]);

  // Initialize Scene, Camera, Lights, OrbitControls
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0f19'); // Elegant deep dark blue slate background

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100
    );
    camera.position.set(2, 3, 6);

    // Renderer with shadow config
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1; // Limit panning under ground slightly

    // Lights
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 0.9);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight('#4338ca', 0.4); // Subtle indigo glow
    fillLight.position.set(-5, 2, -5);
    scene.add(fillLight);

    const hemLight = new THREE.HemisphereLight('#818cf8', '#0f172a', 0.3); // Sky to ground lighting
    scene.add(hemLight);

    // Dynamic Helpers
    const gridHelper = new THREE.GridHelper(12, 24, '#3b82f6', '#1e293b');
    gridHelper.position.y = -2;
    scene.add(gridHelper);

    // Groups for visualizers
    const jointVisualizersGroup = new THREE.Group();
    const boneVisualizersGroup = new THREE.Group();
    scene.add(jointVisualizersGroup);
    scene.add(boneVisualizersGroup);

    // Brush Mesh helper for rigging mode
    const brushGeo = new THREE.SphereGeometry(1, 16, 16);
    const brushMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
      depthWrite: false
    });
    const brushSphere = new THREE.Mesh(brushGeo, brushMat);
    brushSphere.visible = false;
    scene.add(brushSphere);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      mainMesh: null,
      rawGeometry: null,
      skeleton: null,
      threeBones: [],
      jointVisualizersGroup,
      boneVisualizersGroup,
      raycaster,
      mouse,
      brushSphere,
      ambientLight,
      dirLight,
      fillLight,
      hemLight
    };

    // Responsive Canvas Resizer using ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width && height && threeRef.current) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(containerRef.current);

    // Animation loop
    const clock = new THREE.Clock();
    let animationFrameId: number;
    const animateLoop = () => {
      animationFrameId = requestAnimationFrame(animateLoop);

      const state = stateRef.current;
      const t = threeRef.current;

      if (t) {
        const delta = clock.getDelta();

        // If showroom mode is running, keep original animations tick-updating inside mixer
        if (state.isShowroomActive && t.gltfMixer) {
          t.gltfMixer.update(delta * (state.isGltfAnimating ? state.showroomSpeed : 0));
        }

        if (!state.isShowroomActive) {
          // Apply manual rigging and bone transforms
          applyBoneTransforms();

          // Update skeleton visualizers to follow bones
          updateSkeletonVisualizers();

          // Maintain user skeleton visibility preference
          if (t.jointVisualizersGroup) t.jointVisualizersGroup.visible = state.showSkeleton;
          if (t.boneVisualizersGroup) t.boneVisualizersGroup.visible = state.showSkeleton;
        } else {
          // Suppress visualizer groups so we see native model clearly
          if (t.jointVisualizersGroup) t.jointVisualizersGroup.visible = false;
          if (t.boneVisualizersGroup) t.boneVisualizersGroup.visible = false;
        }

        // Cinematic Camera Solver (Updates target & position with easing, shake, and orbital panning)
        const cin = cinematicRef.current;
        if (cin.active) {
          const targetProgress = cin.transitioningOut ? 0 : 1;
          cin.progress += (targetProgress - cin.progress) * 0.086; // smooth lerp progress
          cin.extraAngle += delta * 0.35; // slow circular orbital pan (运镜)

          if (cin.progress > 0.005) {
            const headPos = getHeadWorldPosition();
            
            // 1. Shrink dynamic camera near clip plane during closeup shots to prevent near-plane mesh clipping (穿模)
            if (t.camera.near !== 0.02) {
              t.camera.near = 0.02;
              t.camera.updateProjectionMatrix();
            }

            // 2. Resolve model orientation vectors to translate local camera coordinates to world coordinates
            const forwardDir = getModelFacingDirection();
            const upDir = new THREE.Vector3(0, 1, 0);
            const rightDir = new THREE.Vector3().crossVectors(upDir, forwardDir).normalize();

            // 3. Resolve dynamic scale factor (proportional to model height) to lock down correct shot size & avoid mesh penetration
            const mHeight = getModelHeight();
            const scaleF = Math.max(0.3, Math.min(2.5, mHeight / 1.8));

            let localX = 0.2;
            let localY = 0.1;
            let localZ = 1.15;

            if (cin.moodType === 'anger') {
              // Shaking close-up camera on anger wave
              const shakeScale = 0.02 * cin.progress;
              const shakeX = (Math.random() - 0.5) * shakeScale;
              const shakeY = (Math.random() - 0.5) * shakeScale;
              localX = shakeX;
              localY = 0.12 + shakeY;
              localZ = 0.82; // Intense close-up depth
            } else if (cin.moodType === 'sadness') {
              // Melancholic cinematic looking slightly from the side (3/4 face profile)
              localX = 0.42;
              localY = 0.25;
              localZ = 1.25;
            } else if (cin.moodType === 'joy') {
              // Celebratory slow circular orbit orbit pan
              const orbitR = 1.3;
              const theta = cin.extraAngle;
              localX = Math.sin(theta) * 0.6;
              localY = 0.15;
              localZ = Math.cos(theta) * orbitR;
            }

            // Multiply local offset coordinates by proportional scale factor
            const worldOffset = new THREE.Vector3()
              .addScaledVector(rightDir, localX * scaleF)
              .addScaledVector(upDir, localY * scaleF)
              .addScaledVector(forwardDir, localZ * scaleF);

            const desiredTarget = headPos.clone();
            const desiredCameraPos = headPos.clone().add(worldOffset);

            // Interpolate controls target and camera position in world space
            t.controls.target.lerp(desiredTarget, cin.progress);
            t.camera.position.lerp(desiredCameraPos, cin.progress);

            // 4. Hard collision bubble safeguard (stops camera from plunging into head/chest boundary)
            const currentDist = t.camera.position.distanceTo(headPos);
            const absoluteMinDist = 0.32 * scaleF;
            if (currentDist < absoluteMinDist) {
              const pushDir = new THREE.Vector3().subVectors(t.camera.position, headPos).normalize();
              if (pushDir.lengthSq() < 0.01) {
                pushDir.copy(forwardDir);
              }
              t.camera.position.copy(headPos).addScaledVector(pushDir, absoluteMinDist);
            }
          }

          // Timeout check
          if (Date.now() - cin.startTime > cin.durationMs && !cin.transitioningOut) {
            cin.transitioningOut = true;
          }

          // Return transition complete
          if (cin.transitioningOut && cin.progress < 0.01) {
            cin.active = false;
            cin.transitioningOut = false;
            cin.backedUp = false;
            t.controls.enableRotate = true; // Unlock controls rotation
            
            // Restore standard camera near clip plane properties
            if (t.camera.near !== 0.1) {
              t.camera.near = 0.1;
              t.camera.updateProjectionMatrix();
            }

            // Restore back to original backup
            t.camera.position.copy(cin.backupPos);
            t.controls.target.copy(cin.backupTarget);
          }
        }

        // Update OrbitControls
        t.controls.update();

        // Render scene
        t.renderer.render(t.scene, t.camera);

        // Real-time update SVG lines and HTML marker spots in Mixamo active state
        const mixamoOverlay = document.getElementById('mixamo-overlay-container');
        if (mixamoOverlay && containerRef.current && canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          state.joints.forEach(j => {
            const marker = document.getElementById(`marker-${j.id}`);
            if (marker) {
              const screenPos = projectJointToScreen(j.position, t.camera, rect);
              marker.style.left = `${screenPos.x}px`;
              marker.style.top = `${screenPos.y}px`;
            }

            // Connection lines
            if (j.parentId) {
              const line = document.getElementById(`line-${j.parentId}-${j.id}`);
              if (line) {
                const parentJoint = state.joints.find(p => p.id === j.parentId);
                if (parentJoint) {
                  const childPos = projectJointToScreen(j.position, t.camera, rect);
                  const parentPos = projectJointToScreen(parentJoint.position, t.camera, rect);
                  line.setAttribute('x1', String(parentPos.x));
                  line.setAttribute('y1', String(parentPos.y));
                  line.setAttribute('x2', String(childPos.x));
                  line.setAttribute('y2', String(childPos.y));
                }
              }
            }
          });
        }
      }
    };
    animateLoop();

    // Setup initial model model preset
    loadModelpreset();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (threeRef.current) {
        // Clean up geometries/materials
        threeRef.current.renderer.dispose();
      }
    };
  }, []);

  // Trigger rebuild whenever active preset or custom file changes
  useEffect(() => {
    loadModelpreset();
  }, [activeModelType, customModelFile, customMtlFile, customTextureFiles]);

  // Load custom texture images whenever uploaded
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    if (customTextureFile) {
      const textureUrl = URL.createObjectURL(customTextureFile);
      const loader = new THREE.TextureLoader();
      loader.load(
        textureUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          t.loadedTexture = texture;
          console.log('成功载入外部材质贴图:', customTextureFile.name);
          rebuildSkinnedMesh();
          URL.revokeObjectURL(textureUrl);
        },
        undefined,
        (err) => {
          console.error('加载材质图片贴图失败:', err);
          URL.revokeObjectURL(textureUrl);
        }
      );
    } else {
      // Clear manual texture if cleared and not using gltf fallback embedded
      if (activeModelType !== 'gltf') {
        t.loadedTexture = null;
        rebuildSkinnedMesh();
      }
    }
  }, [customTextureFile, activeModelType]);

  // Mixamo Camera Snapping and Control locking
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    if (isMixamoActive) {
      // Save original camera position/target so we can restore on exit
      t.cameraBackupPosition = t.camera.position.clone();
      t.cameraBackupTarget = t.controls.target.clone();

      // Configure a front orthographic-style flat alignment positioning
      t.camera.position.set(0, 0, 6.2);
      t.controls.target.set(0, 0, 0);
      t.camera.up.set(0, 1, 0);
      t.controls.enableRotate = false; // Disable 3D navigation rotation
      t.controls.update();

      // If active model is GLTF and has only a standalone root joint, initialize full humanoid to save user typing!
      if (joints.length === 1 && joints[0].id === 'root') {
        const standardHuman = getPresetSkeletons('humanoid');
        onUpdateJoints(standardHuman);
      }
    } else {
      // Restore controls rotation
      t.controls.enableRotate = true;

      // Restore camera backup if it exists
      if (t.cameraBackupPosition) {
        t.camera.position.copy(t.cameraBackupPosition);
        t.controls.target.copy(t.cameraBackupTarget);
        t.controls.update();
      }
    }
  }, [isMixamoActive]);

  // Re-run weights presentation coloring on selection/weights edit
  useEffect(() => {
    colorMeshByWeights();
  }, [selectedJointId, editorMode, joints]);

  // Apply bone animation rotations or slider poses in real time
  function applyBoneTransforms() {
    const state = stateRef.current;
    const t = threeRef.current;
    if (!t || t.threeBones.length === 0) return;

    if (state.editorMode === 'animate') {
      const frameCount = 60; // 0 to 59
      const frame = state.currentFrame;

      t.threeBones.forEach((bone) => {
        const jointNode = state.joints.find(j => j.name === bone.name);
        if (!jointNode) return;

        let rotX = jointNode.rotation[0];
        let rotY = jointNode.rotation[1];
        let rotZ = jointNode.rotation[2];

        if (state.keyframes.length > 0) {
          const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
          
          let prevKey = sorted[0];
          let nextKey = sorted[0];
          let factor = 0;

          const exactMatch = sorted.find(k => k.frame === frame);
          if (exactMatch) {
            prevKey = exactMatch;
            nextKey = exactMatch;
            factor = 0;
          } else {
            const before = [...sorted].reverse().find(k => k.frame < frame);
            const after = sorted.find(k => k.frame > frame);

            if (before && after) {
              prevKey = before;
              nextKey = after;
              factor = (frame - prevKey.frame) / (nextKey.frame - prevKey.frame);
            } else if (before && !after) {
              // Wrap around loop bounds: current frame is past the last keyframe
              prevKey = before;
              nextKey = sorted[0];
              const totalSpan = (frameCount - 1 - prevKey.frame) + nextKey.frame + 1;
              const elapsed = frame - prevKey.frame;
              factor = elapsed / totalSpan;
            } else if (!before && after) {
              // Wrap around loop bounds: current frame is before the first keyframe
              prevKey = sorted[sorted.length - 1];
              nextKey = after;
              const totalSpan = (frameCount - 1 - prevKey.frame) + nextKey.frame + 1;
              const elapsed = (frameCount - 1 - prevKey.frame) + frame + 1;
              factor = elapsed / totalSpan;
            }
          }

          if (prevKey && nextKey) {
            const rPrev = prevKey.rotations[jointNode.id];
            const rNext = nextKey.rotations[jointNode.id];

            if (rPrev && rNext) {
              if (prevKey.frame === nextKey.frame) {
                rotX = rPrev[0];
                rotY = rPrev[1];
                rotZ = rPrev[2];
              } else {
                // Apply a smooth cubic hermite (smoothstep) easing to replicate organic muscle acceleration/deceleration
                const easedFactor = factor * factor * (3.0 - 2.0 * factor);
                
                // Quaternion slerp interpolation is extremely smooth for 3D rotations!
                const qPrev = new THREE.Quaternion().setFromEuler(new THREE.Euler(rPrev[0], rPrev[1], rPrev[2]));
                const qNext = new THREE.Quaternion().setFromEuler(new THREE.Euler(rNext[0], rNext[1], rNext[2]));
                qPrev.slerp(qNext, easedFactor);

                const euler = new THREE.Euler().setFromQuaternion(qPrev);
                rotX = euler.x;
                rotY = euler.y;
                rotZ = euler.z;
              }
            } else if (rPrev) {
              rotX = rPrev[0];
              rotY = rPrev[1];
              rotZ = rPrev[2];
            }
          }
        }
        bone.rotation.set(rotX, rotY, rotZ);
      });
    } else {
      // In non-animate modes, apply local posing sliders directly for active editing feedback
      t.threeBones.forEach((bone) => {
        const jointNode = state.joints.find(j => j.name === bone.name);
        if (jointNode) {
          bone.rotation.set(jointNode.rotation[0], jointNode.rotation[1], jointNode.rotation[2]);
        }
      });
    }
  }

  // Auto-rig trigger handler
  function triggerAutoRigging() {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t || !t.mainMesh || !t.rawGeometry) return;

    setIsLoading(true);
    setTimeout(() => {
      try {
        const posAttr = t.rawGeometry!.attributes.position;
        const totalVerts = posAttr.count;
        const positions = posAttr.array as Float32Array;

        const indices = t.rawGeometry!.index ? (t.rawGeometry!.index.array as Uint16Array | Uint32Array) : null;

        // Perform spatial rigging weights auto-calculation
        const { skinIndices, skinWeights } = calculateAutoWeights(positions, state.joints, indices);

        onUpdateSkinWeights(skinIndices, skinWeights);

        // Bind attributes to the mesh geometry
        t.rawGeometry!.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
        t.rawGeometry!.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
        t.rawGeometry!.attributes.skinIndex.needsUpdate = true;
        t.rawGeometry!.attributes.skinWeight.needsUpdate = true;

        // Rebuild SkinnedMesh with custom layout
        rebuildSkinnedMesh();
        colorMeshByWeights();
      } catch (err: any) {
        setLoadingError('自动权重分配失败: ' + err.message);
      } finally {
        setIsLoading(false);
      }
    }, 100);
  }

  // Paint dynamic rigging weights color styles
  function colorMeshByWeights() {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t || !t.mainMesh || !t.rawGeometry) return;

    const geometry = t.rawGeometry;
    const count = geometry.attributes.position.count;

    // Check if rigging view mode is active, AND a joint is selected
    if (state.editorMode === 'rigging' && state.selectedJointId) {
      const skinIndexAttr = geometry.attributes.skinIndex;
      const skinWeightAttr = geometry.attributes.skinWeight;

      if (!skinIndexAttr || !skinWeightAttr) {
        // No skin attributes, default back
        colorMeshDefault();
        return;
      }

      // Find the index of the selected bone
      const selectedIndex = state.joints.findIndex(j => j.id === state.selectedJointId);
      if (selectedIndex === -1) {
        colorMeshDefault();
        return;
      }

      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        let weight = 0;
        // Search through 4 index positions
        for (let j = 0; j < 4; j++) {
          const idx = skinIndexAttr.getX(i * 4 + j); // Actually itemSize is 4, so offset is simple
          const currentBoneIdx = skinIndexAttr.array[i * 4 + j];
          const currentWeight = skinWeightAttr.array[i * 4 + j];
          if (currentBoneIdx === selectedIndex) {
            weight = currentWeight;
            break;
          }
        }

        // Generate high-contrast heatmap colors (Red: heavy, Green: mid, Blue: none)
        // Red (1,0,0) down to Green (0,1,0) to Blue (0,0,1)
        let r = 0, g = 0, b = 0;
        if (weight > 0.5) {
          const factor = (weight - 0.5) * 2; // [0, 1]
          r = factor;
          g = 1 - factor;
          b = 0;
        } else {
          const factor = weight * 2; // [0, 1]
          r = 0;
          g = factor;
          b = 1 - factor;
        }

        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.attributes.color.needsUpdate = true;

      // Update material
      if (Array.isArray(t.mainMesh.material)) {
        t.mainMesh.material.forEach(m => {
          (m as any).vertexColors = true;
          (m as any).needsUpdate = true;
        });
      } else if (t.mainMesh.material) {
        (t.mainMesh.material as any).vertexColors = true;
        (t.mainMesh.material as any).needsUpdate = true;
      }
    } else {
      // Default skin shader visualization (No heatmap)
      colorMeshDefault();
    }
  }

  function colorMeshDefault() {
    const t = threeRef.current;
    if (!t || !t.rawGeometry) return;
    const geometry = t.rawGeometry;
    if (geometry.attributes.color) {
      geometry.deleteAttribute('color');
    }
    if (t.mainMesh && t.mainMesh.material) {
      if (Array.isArray(t.mainMesh.material)) {
        t.mainMesh.material.forEach(m => {
          (m as any).vertexColors = false;
          (m as any).needsUpdate = true;
        });
      } else {
        (t.mainMesh.material as any).vertexColors = false;
        (t.mainMesh.material as any).needsUpdate = true;
      }
    }
  }

  // Re-creates skinned mesh and ties bones hierarchy dynamically
  // Re-creates skinned mesh and ties bones hierarchy dynamically
  function rebuildSkinnedMesh() {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t || !t.rawGeometry) return;

    // Remove and dispose of existing mainMesh and its custom bound resources
    if (t.mainMesh) {
      t.scene.remove(t.mainMesh);
      if (t.mainMesh.material) {
        const mats = Array.isArray(t.mainMesh.material) ? t.mainMesh.material : [t.mainMesh.material];
        mats.forEach((mat) => {
          const isPreloaded = t.loadedMaterials && t.loadedMaterials.includes(mat);
          if (!isPreloaded) {
            if (mat.map && mat.map !== t.loadedTexture) mat.map.dispose();
            if (mat.normalMap) mat.normalMap.dispose();
            if (mat.roughnessMap) mat.roughnessMap.dispose();
            if (mat.metalnessMap) mat.metalnessMap.dispose();
            if (mat.bumpMap) mat.bumpMap.dispose();
            mat.dispose();
          }
        });
      }
      t.mainMesh = null;
    }

    if (t.skeleton) {
      t.skeleton.dispose();
      t.skeleton = null;
    }

    // Remove old bones from scene to prevent childhood bones leaking in scene hierarchy
    if (t.threeBones && t.threeBones.length > 0) {
      t.threeBones.forEach((bone) => {
        if (bone.parent) {
          bone.parent.remove(bone);
        }
        t.scene.remove(bone);
      });
      t.threeBones = [];
    }

    // Material with elegant design
    let useMaterials: THREE.Material | THREE.Material[];
    if (t.loadedMaterials && t.loadedMaterials.length > 0) {
      if (t.loadedMaterials.length === 1) {
        useMaterials = t.loadedMaterials[0];
      } else {
        useMaterials = t.loadedMaterials;
      }
    } else {
      const hasTexture = !!t.loadedTexture;
      useMaterials = new THREE.MeshStandardMaterial({
        color: hasTexture ? '#ffffff' : '#4f46e5', // White if texture is loaded, else Royal Indigo
        map: t.loadedTexture || null,
        roughness: hasTexture ? 0.7 : 0.3,
        metalness: hasTexture ? 0.1 : 0.2,
        flatShading: !hasTexture,
        side: THREE.DoubleSide
      });
    }

    // Rebuild simple bones structure (THREE.Bone)
    t.threeBones = [];
    const boneMap = new Map<string, THREE.Bone>();

    // 1. Instantiate each bone
    state.joints.forEach((joint) => {
      const bone = new THREE.Bone();
      bone.name = joint.name;
      t.threeBones.push(bone);
      boneMap.set(joint.id, bone);
    });

    // 2. Align parent-child references and set rest positions
    state.joints.forEach((joint) => {
      const bone = boneMap.get(joint.id)!;
      if (joint.parentId) {
        const parentBone = boneMap.get(joint.parentId);
        if (parentBone) {
          parentBone.add(bone);
          // Standard skeleton joints are local offsets in rest pose
          const parentJoint = state.joints.find(j => j.id === joint.parentId)!;
          const lx = joint.position[0] - parentJoint.position[0];
          const ly = joint.position[1] - parentJoint.position[1];
          const lz = joint.position[2] - parentJoint.position[2];
          bone.position.set(lx, ly, lz);
        } else {
          // Fallback root
          bone.position.set(joint.position[0], joint.position[1], joint.position[2]);
          t.scene.add(bone);
        }
      } else {
        // Root bone
        bone.position.set(joint.position[0], joint.position[1], joint.position[2]);
        t.scene.add(bone);
      }
    });

    // Verify if geometry already has skinIndex and skinWeight. If not, compute blank ones
    const geo = t.rawGeometry;
    if (!geo.attributes.skinIndex || !geo.attributes.skinWeight) {
      const count = geo.attributes.position.count;
      const blankIndices = new Float32Array(count * 4);
      const blankWeights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        blankWeights[i * 4] = 1.0; // Bind 100% to root bone by default to avoid zero-scale collapse
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(blankIndices, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(blankWeights, 4));
    }

    // Generate Skinned Mesh
    const skinnedMesh = new THREE.SkinnedMesh(geo, useMaterials);
    skinnedMesh.castShadow = true;
    skinnedMesh.receiveShadow = true;

    // Attach root bone to skinnedMesh so they share coordinate spaces before binding
    if (t.threeBones.length > 0) {
      skinnedMesh.add(t.threeBones[0]);
    }

    // Force update world matrices on the skinned mesh and the entire bones hierarchy recursively.
    // This ensures THREE.Skeleton calculates correct inverse bind matrices rather than falling back to uninitialized/identity values.
    skinnedMesh.updateMatrixWorld(true);
    t.threeBones.forEach((bone) => {
      bone.updateMatrixWorld(true);
    });

    // Create Skeleton with fully resolved absolute rest positions
    const skeleton = new THREE.Skeleton(t.threeBones);
    skinnedMesh.bind(skeleton);

    t.scene.add(skinnedMesh);
    t.mainMesh = skinnedMesh;
    t.skeleton = skeleton;

    // Stats
    setModelStats({
      vertices: geo.attributes.position.count,
      faces: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3,
      bones: state.joints.length
    });
  }

  // Helper to merge all meshes in loaded object/scene into a single BufferGeometry applying hierarchical transformations
  function mergeMeshesToSingleGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
    const geometries: { geom: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
    const materialsArray: THREE.Material[] = [];
    const t = threeRef.current;
    if (!t) return null;

    // Reset loaded materials
    t.loadedMaterials = null;
    
    // Force world matrices to update so transform hierarchy is accurate
    root.updateMatrixWorld(true);
    
    console.log("开始解析3D模型节点结构，根节点：", root.name || 'Scene');
    root.traverse((child) => {
      const isMeshNode = child instanceof THREE.Mesh || (child as any).isMesh;
      if (isMeshNode) {
        const mesh = child as THREE.Mesh;
        console.log(` -> 发现有效的网格体[${mesh.name || 'UnnamedMesh'}], 属性:`, {
          type: mesh.type,
          visible: mesh.visible,
          vertices: mesh.geometry?.attributes?.position?.count || 0
        });

        // Flatten geometry indices into non-indexed layout mapping sequential vertices cleanly
        let geom = mesh.geometry;
        if (!geom) return;

        if (geom.index) {
          geom = geom.toNonIndexed();
        } else {
          geom = geom.clone();
        }
        mesh.updateMatrixWorld(true);
        geom.applyMatrix4(mesh.matrixWorld);
        
        // Ensure standard position/normal attributes exist
        if (geom.attributes.position && geom.attributes.position.count > 0) {
          geometries.push({ geom, material: mesh.material });
        }
      }
    });
    
    console.log(`网格体解析完毕，共提取出 ${geometries.length} 个有效的几何体组件`);
    if (geometries.length === 0) return null;

    // Construct flat array of materials
    geometries.forEach(({ material }) => {
      if (material) {
        if (Array.isArray(material)) {
          material.forEach(m => {
            if (materialsArray.indexOf(m) === -1) {
              materialsArray.push(m);
            }
          });
        } else {
          if (materialsArray.indexOf(material) === -1) {
            materialsArray.push(material);
          }
        }
      }
    });

    // Enforce DoubleSide and ensure we show properly
    materialsArray.forEach(m => {
      m.side = THREE.DoubleSide;
      // If a material has transparent or near-zero opacity, force to 1 so custom structures show up
      if ((m as any).opacity !== undefined && (m as any).opacity < 0.15) {
        (m as any).opacity = 1.0;
        (m as any).transparent = false;
      }

      // Fix OBJ/MTL black texture issue:
      // When diffuse color (Kd) is zero/black, Three.js multiplies it with the texture map,
      // resulting in a pure black rendering. We force the color to white if a texture map (map) is present
      // and the color is black or extremely dark.
      if ('color' in m && (m as any).color) {
        const c = (m as any).color as THREE.Color;
        const hasMap = !!(m as any).map;
        if (hasMap) {
          if (c.r < 0.15 && c.g < 0.15 && c.b < 0.15) {
            console.log(`[Material Auto-Fix] Diffuse color is too dark (${c.r.toFixed(2)}, ${c.g.toFixed(2)}, ${c.b.toFixed(2)}) for textured material "${m.name || ''}". Overriding to white to restore texture visibility.`);
            c.setRGB(1, 1, 1);
          }
        }
      }

      // Ensure that all loaded textures use sRGB color space to avoid dark/washed-out renderings
      if ((m as any).map) {
        const tex = (m as any).map;
        tex.colorSpace = THREE.SRGBColorSpace;
        if (tex.image && (tex.image.complete !== false || tex.image.width > 0)) {
          tex.needsUpdate = true;
        }
      }
    });

    // Save materialsArray on ref if we found any
    if (materialsArray.length > 0) {
      t.loadedMaterials = materialsArray;
    }
    
    if (geometries.length === 1) {
      const single = geometries[0].geom;
      // Strip any baked color attributes from GLTF to avoid overriding our custom paint visualization shader
      if (single.attributes.color) {
        single.deleteAttribute('color');
      }
      single.computeVertexNormals();
      return single;
    }
    
    // Manually merge all attributes
    const combinedPositions: number[] = [];
    const combinedNormals: number[] = [];
    const combinedUvs: number[] = [];
    
    let currentVertexOffset = 0;
    const groups: { start: number; count: number; materialIndex: number }[] = [];

    geometries.forEach(({ geom, material }) => {
      const posAttr = geom.attributes.position;
      const normAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      if (!posAttr) return;

      const count = posAttr.count;
      
      // Resolve material index
      let matIndex = 0;
      if (material) {
        const singleMat = Array.isArray(material) ? material[0] : material;
        matIndex = materialsArray.indexOf(singleMat);
        if (matIndex === -1) matIndex = 0;
      }

      groups.push({
        start: currentVertexOffset,
        count: count,
        materialIndex: matIndex
      });

      for (let i = 0; i < count; i++) {
        combinedPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        if (normAttr) {
          combinedNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        } else {
          combinedNormals.push(0, 1, 0);
        }
        if (uvAttr) {
          combinedUvs.push(uvAttr.getX(i), uvAttr.getY(i));
        } else {
          combinedUvs.push(0, 0);
        }
      }

      currentVertexOffset += count;
    });
    
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combinedPositions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(combinedNormals, 3));
    if (combinedUvs.length > 0) {
      merged.setAttribute('uv', new THREE.Float32BufferAttribute(combinedUvs, 2));
    }
    
    // Discard color attribute if any
    if (merged.attributes.color) {
      merged.deleteAttribute('color');
    }

    // Assign groups so that mult-material map works of SkinnedMesh
    groups.forEach(g => {
      merged.addGroup(g.start, g.count, g.materialIndex);
    });

    merged.computeVertexNormals();
    return merged;
  }

  // Load geometric default or upload templates
  function loadModelpreset() {
    const t = threeRef.current;
    if (!t) return;

    setLoadingError(null);
    setIsLoading(true);

    const presetType = activeModelType;

    if (presetType !== 'gltf') {
      t.loadedTexture = null;
      t.loadedMaterials = null;
    }

    const disposeHierarchy = (obj: THREE.Object3D) => {
      obj.traverse((child: any) => {
        if (child.isMesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if (mat.map) mat.map.dispose();
              if (mat.normalMap) mat.normalMap.dispose();
              if (mat.roughnessMap) mat.roughnessMap.dispose();
              if (mat.metalnessMap) mat.metalnessMap.dispose();
              if (mat.bumpMap) mat.bumpMap.dispose();
              mat.dispose();
            });
          }
        }
      });
    };

    // Dispose old skeleton bones & skeleton
    if (t.threeBones && t.threeBones.length > 0) {
      t.threeBones.forEach((bone) => {
        if (bone.parent) {
          bone.parent.remove(bone);
        }
        t.scene.remove(bone);
      });
      t.threeBones = [];
    }
    if (t.skeleton) {
      t.skeleton.dispose();
      t.skeleton = null;
    }

    // Dispose previous raw geometry to save geometry buffers
    if (t.rawGeometry) {
      t.rawGeometry.dispose();
      t.rawGeometry = null;
    }

    // Delete existing model and native gltf elements with proper hardware memory release
    if (t.mainMesh) {
      t.scene.remove(t.mainMesh);
      if (t.mainMesh.geometry) {
        t.mainMesh.geometry.dispose();
      }
      if (t.mainMesh.material) {
        const mats = Array.isArray(t.mainMesh.material) ? t.mainMesh.material : [t.mainMesh.material];
        mats.forEach((mat) => {
          if (mat.map && mat.map !== t.loadedTexture) mat.map.dispose();
          if (mat.normalMap) mat.normalMap.dispose();
          if (mat.roughnessMap) mat.roughnessMap.dispose();
          if (mat.metalnessMap) mat.metalnessMap.dispose();
          if (mat.bumpMap) mat.bumpMap.dispose();
          mat.dispose();
        });
      }
      t.mainMesh = null;
    }

    if (t.loadedGltfScene) {
      t.scene.remove(t.loadedGltfScene);
      disposeHierarchy(t.loadedGltfScene);
      t.loadedGltfScene = null;
    }

    // Dispose of any previously loaded isolated textures or materials
    if (t.loadedTexture) {
      t.loadedTexture.dispose();
      t.loadedTexture = null;
    }
    if (t.loadedMaterials) {
      t.loadedMaterials.forEach((mat) => {
        if (mat.map) mat.map.dispose();
        if (mat.normalMap) mat.normalMap.dispose();
        if (mat.roughnessMap) mat.roughnessMap.dispose();
        if (mat.metalnessMap) mat.metalnessMap.dispose();
        if (mat.bumpMap) mat.bumpMap.dispose();
        mat.dispose();
      });
      t.loadedMaterials = null;
    }

    if (t.gltfMixer) {
      t.gltfMixer.stopAllAction();
      t.gltfMixer = null;
    }
    t.gltfClips = [];

    // Reset local state fields cleanly to prevent transient state synchronization conflicts
    setGltfClips([]);
    setActiveClipName('');
    setIsShowroomActive(false);

    // Revoke previous object URLs
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    const createLocalUrl = (file: File) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      return url;
    };

    // Build visual shapes
    let geometry: THREE.BufferGeometry;

    if (presetType === 'gltf') {
      if (customModelFile) {
      const extension = customModelFile.name.split('.').pop()?.toLowerCase();
      
      const convertMaterialToPBR = (m: THREE.Material): THREE.Material => {
        if (!m) return m;
        if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
          const mAny = m as any;
          if (mAny.map && mAny.color && (mAny.color.r < 0.12 && mAny.color.g < 0.12 && mAny.color.b < 0.12)) {
            mAny.color.setRGB(1, 1, 1);
          }
          return m;
        }
        
        const old = m as any;
        const color = old.color ? old.color.clone() : new THREE.Color(0xffffff);
        if (old.map && (color.r < 0.12 && color.g < 0.12 && color.b < 0.12)) {
          color.setRGB(1, 1, 1);
        }

        const standard = new THREE.MeshStandardMaterial({
          name: old.name,
          color: color,
          map: old.map || null,
          normalMap: old.normalMap || null,
          normalScale: old.normalScale ? old.normalScale.clone() : new THREE.Vector2(1, 1),
          roughness: old.roughness !== undefined ? old.roughness : 0.5,
          metalness: old.metalness !== undefined ? old.metalness : 0.1,
          alphaMap: old.alphaMap || null,
          aoMap: old.aoMap || null,
          bumpMap: old.bumpMap || null,
          bumpScale: old.bumpScale !== undefined ? old.bumpScale : 1.0,
          emissive: old.emissive ? old.emissive.clone() : new THREE.Color(0x000000),
          emissiveMap: old.emissiveMap || null,
          emissiveIntensity: old.emissiveIntensity !== undefined ? old.emissiveIntensity : 1.0,
          opacity: old.opacity !== undefined ? old.opacity : 1.0,
          transparent: old.transparent || false,
          alphaTest: old.alphaTest || 0,
          vertexColors: old.vertexColors !== undefined ? old.vertexColors : false,
          side: old.side !== undefined ? old.side : THREE.DoubleSide,
          depthWrite: old.depthWrite !== undefined ? old.depthWrite : true,
          depthTest: old.depthTest !== undefined ? old.depthTest : true,
        });

        if (old.shininess !== undefined) {
          const convertedRoughness = Math.max(0.05, Math.min(0.95, 1.0 - Math.min(100, old.shininess) / 100.0));
          standard.roughness = convertedRoughness;
        } else if (old.specular && old.specular instanceof THREE.Color) {
          const specLuminance = (old.specular.r + old.specular.g + old.specular.b) / 3;
          standard.roughness = Math.max(0.1, Math.min(0.9, 1.0 - specLuminance));
        }
        
        if (typeof old.dispose === 'function') {
          old.dispose();
        }
        
        return standard;
      };

      const manager = new THREE.LoadingManager();
      manager.addHandler(/\.tga$/i, new TGALoader(manager));
      const fileUrls: Record<string, string> = {};
      const allUploadedFiles: { file: File; url: string; cleanName: string; webkitPath: string; segments: string[] }[] = [];
      const uploadedTextures: { file: File; url: string; cleanName: string; webkitPath: string; segments: string[] }[] = [];

      const registerFile = (f: File, isTexture = false) => {
        const url = createLocalUrl(f);
        fileUrls[f.name.toLowerCase()] = url;
        
        const webkitPath = (f.webkitRelativePath || '').replace(/\\/g, '/').toLowerCase();
        const cleanName = f.name.toLowerCase();
        const segments = webkitPath ? webkitPath.split('/') : [cleanName];

        const record = {
          file: f,
          url,
          cleanName,
          webkitPath,
          segments
        };
        allUploadedFiles.push(record);
        if (isTexture) {
          uploadedTextures.push(record);
        }
      };

      registerFile(customModelFile);
      
      if (customMtlFile) {
        registerFile(customMtlFile);
      }
      if (customTextureFiles) {
        customTextureFiles.forEach((f) => {
          registerFile(f, true);
        });
      }
      if (customTextureFile) {
        registerFile(customTextureFile, true);
      }

      manager.setURLModifier((url) => {
        if (!url || url.startsWith('data:')) {
          return url;
        }

        // If it's a blob url, only return early if it's one of our registered/uploaded files.
        // If it's an unresolved relative-resolved blob URL (e.g. blob:https://domain/Image0.png),
        // let it pass through to extract the filename and run our matching heuristics.
        if (url.startsWith('blob:')) {
          const isRegistered = allUploadedFiles.some((record) => record.url === url);
          if (isRegistered) {
            return url;
          }
        }

        // Decode the URL in case it includes percent-encoded characters like %20 for spaces
        let decodedUrl = url;
        try {
          decodedUrl = decodeURIComponent(url);
        } catch (e) {
          console.warn("解码 3D 资源链接失败: ", e);
        }
        
        // Remove trailing or preceding reference paths and standardize Windows backslashes
        const cleanUrl = decodedUrl.replace(/^(\.\/|\.\.\/)+/, '').replace(/\\/g, '/').toLowerCase();
        
        // Split the requested URL into segments
        const requestedSegments = cleanUrl.split('/');
        const fileName = requestedSegments[requestedSegments.length - 1] || '';
        
        const lastDotIdx = fileName.lastIndexOf('.');
        const fileBase = lastDotIdx !== -1 ? fileName.substring(0, lastDotIdx) : fileName;

        let bestMatch: typeof allUploadedFiles[0] | null = null;
        let maxScore = -1;

        allUploadedFiles.forEach((record) => {
          let score = 0;
          
          // Check for exact file name match (including extension)
          if (record.cleanName === fileName) {
            score += 300;
          } else {
            // Check for extension-independent base name match (e.g., skin.tga vs skin.png)
            const recLastDotIdx = record.cleanName.lastIndexOf('.');
            const recBase = recLastDotIdx !== -1 ? record.cleanName.substring(0, recLastDotIdx) : record.cleanName;
            
            if (recBase && fileBase && recBase === fileBase) {
              score += 150; // High score but lower than exact extension match
            } else if (fileBase && recBase && (fileBase.endsWith(recBase) || recBase.endsWith(fileBase))) {
              score += 80;
            }
          }

          // If there is any file name or base name similarity, apply path reference rules boosting
          if (score > 0) {
            // Perfect path suffix matching (e.g. webkitPath: "a/b/textures/face.png", cleanUrl: "textures/face.png")
            if (record.webkitPath && cleanUrl && (record.webkitPath.endsWith(cleanUrl) || cleanUrl.endsWith(record.webkitPath))) {
              score += 500;
            }

            // Folder hierarchy depth matching
            if (record.segments.length > 0 && requestedSegments.length > 0) {
              const fileSegs = record.segments;
              const reqSegs = requestedSegments;
              
              const minLen = Math.min(fileSegs.length, reqSegs.length);
              let folderBoost = 0;
              
              // Move backwards from the file extension / file name (index -1 is file name, index -2 is direct parent directory, etc.)
              for (let i = 1; i < minLen; i++) {
                const fileDir = fileSegs[fileSegs.length - 1 - i];
                const reqDir = reqSegs[reqSegs.length - 1 - i];
                
                if (fileDir && reqDir && fileDir === reqDir) {
                  folderBoost += 100; // Add 100 points for each matching parent directory segment
                } else {
                  break; // Stop matching folder hierarchy once a mismatch is found
                }
              }
              score += folderBoost;
            }
          }

          if (score > maxScore) {
            maxScore = score;
            bestMatch = record;
          }
        });

        if (bestMatch && maxScore > 0) {
          console.log(`[路径引用规则匹配成功] 原请求资源: "${url}" (解析为: "${cleanUrl}"), 智能匹配映射为: "${bestMatch.file.name}" | 路径: "${bestMatch.webkitPath || '无'}" | 匹配分值: ${maxScore}`);
          return bestMatch.url;
        }
        
        // --- TEXTURE HEURISTIC FALLBACKS (PREVENTS Failed to load resource ERR_FILE_NOT_FOUND) ---
        const isImage = /\.(png|jpg|jpeg|tga|bmp|gif|dds|exr|hdr|tiff?)$/i.test(fileName);
        if (isImage) {
          if (uploadedTextures.length > 0) {
            // A: Only 1 custom texture uploaded -> Map everything here
            if (uploadedTextures.length === 1) {
              console.log(`[路径引用规则-单贴图降级匹配] 未找到相似度匹配，但由于仅有一个本地贴图，将资源请求 "${url}" 自动映射为: "${uploadedTextures[0].file.name}"`);
              return uploadedTextures[0].url;
            }

            // B: Indices matching rule (e.g. Image0.png -> sortedTextures[0])
            const numMatch = fileName.match(/\d+/);
            if (numMatch) {
              const index = parseInt(numMatch[0], 10);
              const sortedTextures = [...uploadedTextures].sort((a, b) => a.cleanName.localeCompare(b.cleanName));
              if (index >= 0 && index < sortedTextures.length) {
                const matched = sortedTextures[index];
                console.log(`[路径引用规则-索引降级匹配] 未找到相似度匹配，根据数字索引 (${index}) 映射资源 "${url}" 为: "${matched.file.name}"`);
                return matched.url;
              }
            }

            // C: Sort alphabetically and take the first uploaded texture as fallback
            const sortedTextures = [...uploadedTextures].sort((a, b) => a.cleanName.localeCompare(b.cleanName));
            console.log(`[路径引用规则-首贴图降级匹配] 未找到相似度匹配，默认降级映射资源 "${url}" 至第一个本地贴图: "${sortedTextures[0].file.name}"`);
            return sortedTextures[0].url;
          } else {
            // D: No texture files uploaded at all -> return 1x1 transparent Base64 image data URL
            console.log(`[路径引用规则-防404防报错占位] 外部贴图请求未匹配到且未上传任何贴图: "${url}"。返回1x1透明图避免控制台 404/ERR_FILE_NOT_FOUND 报错`);
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
          }
        }
        
        return url;
      });

      if (extension === 'obj') {
        const loadObj = (materials: MTLLoader.MaterialCreator | null) => {
          const objLoader = new OBJLoader(manager);
          if (materials) {
            console.log("正在将解析到的 MTL 材质绑定到 OBJLoader...");
            objLoader.setMaterials(materials);
          }
          
          const objUrl = fileUrls[customModelFile.name.toLowerCase()];
          objLoader.load(
            objUrl,
            (obj) => {
              try {
                if (materials) {
                  t.loadedTexture = null;
                }
                const mergedGeo = mergeMeshesToSingleGeometry(obj);
                if (mergedGeo) {
                  setupImportedGeometry(mergedGeo);
                } else {
                  throw new Error('未在OBJ中找到任何有效的网格体几何组件');
                }
              } catch (err: any) {
                setLoadingError(err.message || 'OBJ网格体合并提取失败');
                setIsLoading(false);
              }
            },
            undefined,
            (err: any) => {
              setLoadingError('OBJ模型加载失败: ' + (err?.message || '未知错误'));
              setIsLoading(false);
            }
          );
        };

        if (customMtlFile) {
          const mtlLoader = new MTLLoader(manager);
          const mtlUrl = fileUrls[customMtlFile.name.toLowerCase()];
          mtlLoader.load(
            mtlUrl,
            (materials) => {
              console.log("成功解析 MTL 材质:", materials);
              materials.preload();
              loadObj(materials);
            },
            undefined,
            (err) => {
              console.warn("MTL 材质文件加载/解析失败，将尝试不加载材质继续载入模型: ", err);
              loadObj(null);
            }
          );
        } else {
          loadObj(null);
        }
      } else if (extension === 'fbx') {
        const loader = new FBXLoader(manager);
        const fbxUrl = fileUrls[customModelFile.name.toLowerCase()];
        loader.load(
          fbxUrl,
          (fbxGroup) => {
            try {
              // Convert materials to THREE.MeshStandardMaterial to support loaded standard/PBR textures & features properly
              fbxGroup.traverse((child) => {
                if (child instanceof THREE.Mesh || (child as any).isMesh) {
                  const meshChild = child as THREE.Mesh;
                  if (!meshChild.material) {
                    meshChild.material = new THREE.MeshStandardMaterial({
                      color: new THREE.Color(0xffffff),
                      side: THREE.DoubleSide
                    });
                  } else if (Array.isArray(meshChild.material)) {
                    meshChild.material = meshChild.material.map(m => convertMaterialToPBR(m));
                  } else {
                    meshChild.material = convertMaterialToPBR(meshChild.material);
                  }
                }
              });

              let foundTexture: THREE.Texture | null = null;
              fbxGroup.traverse((child) => {
                if (child instanceof THREE.Mesh || (child as any).isMesh) {
                  const meshChild = child as THREE.Mesh;
                  const mat = meshChild.material;
                  if (mat) {
                    if (Array.isArray(mat)) {
                      mat.forEach(m => {
                        if ((m as any).map) {
                          foundTexture = (m as any).map;
                        }
                      });
                    } else {
                      if ((mat as any).map) {
                        foundTexture = (mat as any).map;
                      }
                    }
                  }
                }
              });

              if (foundTexture) {
                console.log("成功解析并提取到FBX内置贴图:", foundTexture);
                t.loadedTexture = foundTexture;
                foundTexture.wrapS = THREE.RepeatWrapping;
                foundTexture.wrapT = THREE.RepeatWrapping;
              }

              // --- MULTI-TEXTURE INTUITIVE BINDING FOR FBX ---
              if (customTextureFiles && customTextureFiles.length > 0) {
                console.log("正在扫描并绑定用户上传的多贴图，数量:", customTextureFiles.length);
                fbxGroup.traverse((child) => {
                  if (child instanceof THREE.Mesh || (child as any).isMesh) {
                    const meshChild = child as THREE.Mesh;
                    const mats = Array.isArray(meshChild.material) ? meshChild.material : [meshChild.material];
                    mats.forEach((mat) => {
                      if (!mat) return;
                      const m = mat as any;
                      
                      // Support standard texture slots
                      const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap'];
                      slots.forEach((slot) => {
                        const existingTex = m[slot];
                        let matchedFile: File | undefined = undefined;

                        // Helper matching functions
                        const getBasePrefix = (name: string): string => {
                          let s = name.toLowerCase();
                          const lastDot = s.lastIndexOf('.');
                          if (lastDot !== -1) {
                            s = s.substring(0, lastDot);
                          }
                          s = s.replace(/(_|-)(diffuse|albedo|color|col|d|normal|nor|n|roughness|rough|r|metalness|metal|m|metallic|bump|b|height|h|ao|ambient|specular|s|spec|texture|tex)$/gi, '');
                          return s.trim();
                        };

                        const getTextureType = (name: string): string => {
                          const s = name.toLowerCase();
                          const baseName = s.substring(0, s.lastIndexOf('.')) || s;
                          if (/(?:_|\b)(normal|nor|n)(?:_|\b|\d|$)/i.test(baseName)) {
                            return 'normalMap';
                          }
                          if (/(?:_|\b)(roughness|rough|r)(?:_|\b|\d|$)/i.test(baseName)) {
                            return 'roughnessMap';
                          }
                          if (/(?:_|\b)(metalness|metal|metallic|m)(?:_|\b|\d|$)/i.test(baseName)) {
                            return 'metalnessMap';
                          }
                          if (/(?:_|\b)(bump|b|height|h)(?:_|\b|\d|$)/i.test(baseName)) {
                            return 'bumpMap';
                          }
                          if (/(?:_|\b)(diffuse|albedo|color|col|d)(?:_|\b|\d|$)/i.test(baseName)) {
                            return 'map';
                          }
                          return 'map';
                        };

                        // Score each file to find the best match for this slot of the current material
                        let maxScore = -1;

                        customTextureFiles.forEach((f) => {
                          const fType = getTextureType(f.name);
                          // Must match slot type (except we tolerate fallback or custom override if slot is map)
                          const isTypeMatch = (fType === slot);
                          if (!isTypeMatch) {
                            return;
                          }

                          let score = 0;
                          const fNameLower = f.name.toLowerCase();
                          const fBase = fNameLower.substring(0, fNameLower.lastIndexOf('.')) || fNameLower;
                          const fPrefix = getBasePrefix(f.name);

                          const mName = (m.name || '').toLowerCase();
                          const mPrefix = mName ? getBasePrefix(mName) : '';

                          const meshName = (meshChild.name || '').toLowerCase();
                          const meshPrefix = meshName ? getBasePrefix(meshName) : '';

                          // 1. Prefix matches
                          if (fPrefix) {
                            if (mPrefix && fPrefix === mPrefix) {
                              score += 150;
                            } else if (mPrefix && mPrefix.length >= 3 && fPrefix.length >= 3 && (fPrefix.includes(mPrefix) || mPrefix.includes(fPrefix))) {
                              score += 90;
                            }

                            if (meshPrefix && fPrefix === meshPrefix) {
                              score += 120;
                            } else if (meshPrefix && meshPrefix.length >= 3 && fPrefix.length >= 3 && (fPrefix.includes(meshPrefix) || meshPrefix.includes(fPrefix))) {
                              score += 80;
                            }
                          }

                          // 2. Substring matches with names
                          if (fBase && fBase.length >= 3) {
                            if (mName && (mName.includes(fBase) || fBase.includes(mName))) {
                              score += 70;
                            }
                            if (meshName && (meshName.includes(fBase) || fBase.includes(meshName))) {
                              score += 65;
                            }
                          }

                          // 3. Existing texture filename matches (e.g. if exporter generated dummy reference)
                          if (existingTex) {
                            const texName = (existingTex.name || '').toLowerCase();
                            const texUrl = (existingTex.image && existingTex.image.src ? existingTex.image.src.split('/').pop() || '' : '').toLowerCase();

                            const texNamePrefix = texName ? getBasePrefix(texName) : '';
                            const texUrlPrefix = texUrl ? getBasePrefix(texUrl) : '';

                            if (fPrefix) {
                              if (texNamePrefix && fPrefix === texNamePrefix) {
                                score += 200;
                              }
                              if (texUrlPrefix && fPrefix === texUrlPrefix) {
                                score += 200;
                              }
                            }

                            if (texName && fNameLower && (texName === fNameLower || texName.includes(fNameLower) || fNameLower.includes(texName))) {
                              score += 100;
                            }
                            if (texUrl && fNameLower && (texUrl === fNameLower || texUrl.includes(fNameLower) || fNameLower.includes(texUrl))) {
                              score += 100;
                            }
                          }

                          // 4. Semantic body part keyword overlap (this prevents face texture from going to body, body texture from going to face!)
                          const bodyParts = ['face', 'head', 'body', 'hair', 'eye', 'skin', 'glass', 'mouth', 'cloth', 'pants', 'shoe', 'hand', 'arm', 'leg', 'brow', 'lash'];
                          bodyParts.forEach((part) => {
                            if (fNameLower.includes(part)) {
                              const mHasPart = mName.includes(part) || (part === 'face' && mName.includes('head')) || (part === 'head' && mName.includes('face'));
                              const meshHasPart = meshName.includes(part) || (part === 'face' && meshName.includes('head')) || (part === 'head' && meshName.includes('face'));
                              
                              if (mHasPart || meshHasPart) {
                                score += 180; // Large boost for correct semantic targeting
                              } else {
                                // Negative penalty if we are matching a face texture to a material/mesh that is clearly named something else (e.g. "body")
                                const otherParts = bodyParts.filter(p => p !== part && p !== 'head' && p !== 'face');
                                const mHasOtherPart = otherParts.some(p => mName.includes(p));
                                const meshHasOtherPart = otherParts.some(p => meshName.includes(p));
                                if (mHasOtherPart || meshHasOtherPart) {
                                  score -= 100; // Large penalty for cross-contamination
                                }
                              }
                            }
                          });

                          if (score > maxScore) {
                            maxScore = score;
                            matchedFile = f;
                          }
                        });

                        // We only bind if we matched with a positive score (meaning some resemblance exists)
                        if (maxScore <= 0) {
                          matchedFile = undefined;
                        }

                        // Fallback: If no file prefix-matched, and there's only 1 texture file uploaded, we allow bind to 'map'
                        if (!matchedFile && slot === 'map' && customTextureFiles.length === 1 && !m.map) {
                          matchedFile = customTextureFiles[0];
                        }

                        // If a file was matched, load the texture and bind it to this slot
                        if (matchedFile) {
                          const textureUrl = fileUrls[matchedFile.name.toLowerCase()];
                          if (textureUrl) {
                            const isTga = matchedFile.name.toLowerCase().endsWith('.tga');
                            const texLoader = isTga ? new TGALoader(manager) : new THREE.TextureLoader();
                            const newTexture = texLoader.load(textureUrl);
                            
                            if (slot === 'map') {
                              newTexture.colorSpace = THREE.SRGBColorSpace;
                              
                              // If diffuse color is black or very dark, force to white so the assigned textures are visible
                              if (m.color && (m.color.r < 0.15 && m.color.g < 0.15 && m.color.b < 0.15)) {
                                console.log(`[FBX multi-texture auto-fix] Resetting dark diffuse color (${m.color.r.toFixed(2)}, ${m.color.g.toFixed(2)}, ${m.color.b.toFixed(2)}) for textured material "${m.name || ''}"`);
                                m.color.setRGB(1, 1, 1);
                              }

                              // Also populate the global loadedTexture so standard fallback shader can see it
                              if (!t.loadedTexture) {
                                t.loadedTexture = newTexture;
                              }
                            } else {
                              newTexture.colorSpace = THREE.NoColorSpace;
                            }
                            
                            newTexture.wrapS = THREE.RepeatWrapping;
                            newTexture.wrapT = THREE.RepeatWrapping;
                            newTexture.name = matchedFile.name;
                            
                            m[slot] = newTexture;
                            m.needsUpdate = true;
                            console.log(`[FBX多贴图成功] 自动配对 (TGA:${isTga}) [${matchedFile.name}] -> 材质 [${m.name || '无名'}].${slot}`);
                          }
                        }
                      });
                    });
                  }
                });
              }

              // --- SHOWROOM NATIVE SETUP ---
              t.loadedGltfScene = fbxGroup;
              const clips = fbxGroup.animations || [];
              t.gltfClips = clips;

              // Scale and center the original group so it perfectly grounds on the floor (Y bottom = -2.0)
              fbxGroup.updateMatrixWorld(true);
              const originalBox = new THREE.Box3().setFromObject(fbxGroup);
              const origCenter = new THREE.Vector3();
              originalBox.getCenter(origCenter);
              const origSize = new THREE.Vector3();
              originalBox.getSize(origSize);

              let maxOrigDim = Math.max(origSize.x, origSize.y, origSize.z);
              if (isNaN(maxOrigDim) || maxOrigDim <= 0) maxOrigDim = 1.0;
              const origTargetScale = 3.6 / maxOrigDim;

              fbxGroup.scale.set(origTargetScale, origTargetScale, origTargetScale);
              fbxGroup.updateMatrixWorld(true);

              // Position so min limits Y bottom to -2.0, and centered horizontally
              const scaledBox = new THREE.Box3().setFromObject(fbxGroup);
              const scaledMinY = scaledBox.min.y;
              const scaledCenterOfMass = new THREE.Vector3();
              scaledBox.getCenter(scaledCenterOfMass);

              const groundTransY = -scaledMinY - 2.0;
              fbxGroup.position.x = -scaledCenterOfMass.x;
              fbxGroup.position.y = isNaN(groundTransY) ? 0 : groundTransY;
              fbxGroup.position.z = -scaledCenterOfMass.z;

               // Ensure fully visible double sided materials and shadow parameters
              fbxGroup.traverse((child) => {
                if (child instanceof THREE.Mesh || (child as any).isMesh) {
                  const mesh = child as THREE.Mesh;
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                  const m = mesh.material;
                  if (m) {
                    const mats = Array.isArray(m) ? m : [m];
                    mats.forEach(mat => {
                      mat.side = THREE.DoubleSide;
                      if (mat.opacity < 0.15) {
                        mat.opacity = 1.0;
                        mat.transparent = false;
                      }
                      
                      // --- PBR TEXTURE EXPOSURE AUTO-FIX ---
                      // If the material has a diffuse texture (map) but has a pitch black or extremely dark body color,
                      // standard PBR will multiply the dark color with the texture, causing the texture to render as black.
                      // We must reset the diffuse multiplier back to pure white to reveal the texture maps.
                      const mAny = mat as any;
                      if (mAny.map && mAny.color && (mAny.color.r < 0.12 && mAny.color.g < 0.12 && mAny.color.b < 0.12)) {
                        console.log(`[FBX Loader Auto-Fix] Detected pitch black ambient/diffuse on textured material "${mAny.name || ''}". Resetting base color to white.`);
                        mAny.color.setRGB(1, 1, 1);
                      }
                    });
                  }
                }
              });

              // Create animation mixer on fbx
              const mixer = new THREE.AnimationMixer(fbxGroup);
              t.gltfMixer = mixer;

              if (clips.length > 0) {
                const uniqueClips = ensureUniqueClipNames(clips);
                console.log("检测到FBX模型中存在内置骨骼动画:", uniqueClips.map(c => c.name));
                setGltfClips(uniqueClips);
                setActiveClipName(uniqueClips[0].name);
                
                // Play it initially using our mixer
                const action = mixer.clipAction(uniqueClips[0]);
                action.reset().fadeIn(0.25).play();

                setIsShowroomActive(true);
              } else {
                setGltfClips([]);
                setActiveClipName('');
                setIsShowroomActive(false);
              }

              const loadedGeo = mergeMeshesToSingleGeometry(fbxGroup);

              if (loadedGeo) {
                setupImportedGeometry(loadedGeo);
              } else {
                throw new Error('无法在FBX文件中抽取有效的网格几何体，请确保文件包含网格(Mesh)结构');
              }
            } catch (err: any) {
              setLoadingError('FBX解析错误: ' + (err?.message || '未知错误'));
              setIsLoading(false);
            }
          },
          undefined,
          (error: any) => {
            setLoadingError('FBX模型加载失败: ' + (error?.message || '未知错误'));
            setIsLoading(false);
          }
        );
      } else {
        // GLTF/GLB loader
        // If there are companion files, use the manager with URL modifiers.
        // Otherwise, use a standard loader to bypass any setURLModifier prefix interference for self-contained files.
        const loader = (customTextureFiles && customTextureFiles.length > 0)
          ? new GLTFLoader(manager)
          : new GLTFLoader();
        const gltfUrl = fileUrls[customModelFile.name.toLowerCase()];
        loader.load(
          gltfUrl,
          (gltf) => {
            try {
              // Extract embedded texture if any
              let foundTexture: THREE.Texture | null = null;
              gltf.scene.traverse((child) => {
                if (child instanceof THREE.Mesh || (child as any).isMesh) {
                  const meshChild = child as THREE.Mesh;
                  const mat = meshChild.material;
                  if (mat) {
                    if (Array.isArray(mat)) {
                      mat.forEach(m => {
                        if ((m as any).map) {
                          foundTexture = (m as any).map;
                        }
                      });
                    } else {
                      if ((mat as any).map) {
                        foundTexture = (mat as any).map;
                      }
                    }
                  }
                }
              });

              if (foundTexture) {
                console.log("成功解析并提取到模型内置贴图:", foundTexture);
                t.loadedTexture = foundTexture;
                foundTexture.wrapS = THREE.RepeatWrapping;
                foundTexture.wrapT = THREE.RepeatWrapping;
              }

              // --- SHOWROOM NATIVE SETUP ---
              // Store references to the native gltf object, animations, and scene
              t.loadedGltfScene = gltf.scene;
              const clips = gltf.animations || [];
              t.gltfClips = clips;

              // Scale and center the original gltf.scene so it perfectly grounds on the floor (Y bottom = -2.0)
              gltf.scene.updateMatrixWorld(true);
              const originalBox = new THREE.Box3().setFromObject(gltf.scene);
              const origCenter = new THREE.Vector3();
              originalBox.getCenter(origCenter);
              const origSize = new THREE.Vector3();
              originalBox.getSize(origSize);

              let maxOrigDim = Math.max(origSize.x, origSize.y, origSize.z);
              if (isNaN(maxOrigDim) || maxOrigDim <= 0) maxOrigDim = 1.0;
              const origTargetScale = 3.6 / maxOrigDim;

              gltf.scene.scale.set(origTargetScale, origTargetScale, origTargetScale);
              gltf.scene.updateMatrixWorld(true);

              // Position so min limits Y bottom to -2.0, and centered horizontally
              const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
              const scaledMinY = scaledBox.min.y;
              const scaledCenterOfMass = new THREE.Vector3();
              scaledBox.getCenter(scaledCenterOfMass);

              const groundTransY = -scaledMinY - 2.0;
              gltf.scene.position.x = -scaledCenterOfMass.x;
              gltf.scene.position.y = isNaN(groundTransY) ? 0 : groundTransY;
              gltf.scene.position.z = -scaledCenterOfMass.z;

              // Ensure fully visible double sided materials and shadow parameters
              gltf.scene.traverse((child) => {
                if (child instanceof THREE.Mesh || (child as any).isMesh) {
                  const mesh = child as THREE.Mesh;
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                  const m = mesh.material;
                  if (m) {
                    if (Array.isArray(m)) {
                      m.forEach(mat => {
                        mat.side = THREE.DoubleSide;
                        if (mat.opacity < 0.15) {
                          mat.opacity = 1.0;
                          mat.transparent = false;
                        }
                      });
                    } else {
                      m.side = THREE.DoubleSide;
                      if (m.opacity < 0.15) {
                        m.opacity = 1.0;
                        m.transparent = false;
                      }
                    }
                  }
                }
              });

              // Create animation mixer on gltf.scene
              const mixer = new THREE.AnimationMixer(gltf.scene);
              t.gltfMixer = mixer;

              if (clips.length > 0) {
                const uniqueClips = ensureUniqueClipNames(clips);
                console.log("检测到模型中存在内置骨骼动画:", uniqueClips.map(c => c.name));
                setGltfClips(uniqueClips);
                setActiveClipName(uniqueClips[0].name);
                
                // Play it initially using our mixer
                const action = mixer.clipAction(uniqueClips[0]);
                action.reset().fadeIn(0.25).play();

                // Auto-toggle Showroom mode so animation auto-plays on load!
                setIsShowroomActive(true);
              } else {
                setGltfClips([]);
                setActiveClipName('');
                setIsShowroomActive(false); // Default to design if no animations, but allow manual toggle to showroom
              }
              // -----------------------------

              const loadedGeo = mergeMeshesToSingleGeometry(gltf.scene);

              if (loadedGeo) {
                setupImportedGeometry(loadedGeo);
              } else {
                throw new Error('无法在GLTF文件中抽取有效的网格几何体，请确保文件包含网格(Mesh)结构');
              }
            } catch (err: any) {
              setLoadingError('GLTF解析错误: ' + (err?.message || '未知错误'));
              setIsLoading(false);
            }
          },
          undefined,
          (error: any) => {
            setLoadingError('GLTF加载解析异常: ' + (error?.message || '文件损坏或不支持格式'));
            setIsLoading(false);
          }
        );
      }
    } else {
      // Safe Empty/Clean state if no model has been loaded yet or cleared
      t.rawGeometry = null;
      if (t.mainMesh) {
        t.scene.remove(t.mainMesh);
        t.mainMesh = null;
      }
      setIsLoading(false);
    }
  } else {
      // Procedural fallback presets
      if (presetType === 'cylinder') {
        geometry = new THREE.CylinderGeometry(0.6, 0.6, 4.0, 16, 32);
      } else if (presetType === 'capsule') {
        geometry = new THREE.CapsuleGeometry(0.5, 3.0, 16, 24);
      } else if (presetType === 'humanoid') {
        // Build a highly refined multi-box body for visual fun
        geometry = buildSimplifiedHumanoidGeometry();
      } else {
        geometry = new THREE.BoxGeometry(1.5, 2.5, 1.5, 8, 12, 8);
      }

      setupImportedGeometry(geometry);
    }
  }

  function setupImportedGeometry(geo: THREE.BufferGeometry) {
    const t = threeRef.current;
    if (!t) return;

    // Safety: Verify positions exist
    if (!geo.attributes.position || geo.attributes.position.count === 0) {
      setLoadingError('几何体位置属性为空或无顶点数据');
      setIsLoading(false);
      return;
    }

    console.log(`载入几何体顶点数: ${geo.attributes.position.count}`);

    // First center the geometry initially relative to the bounding box coordinate center
    geo.computeBoundingBox();
    const initialBox = geo.boundingBox!;
    const initialCenter = new THREE.Vector3();
    if (initialBox) {
      initialBox.getCenter(initialCenter);
    }
    
    // Guard against NaN
    if (isNaN(initialCenter.x) || isNaN(initialCenter.y) || isNaN(initialCenter.z)) {
      initialCenter.set(0, 0, 0);
    }
    
    console.log(` -> 原始中心点:`, [initialCenter.x, initialCenter.y, initialCenter.z]);
    geo.translate(-initialCenter.x, -initialCenter.y, -initialCenter.z);

    // Dynamic scale normalization to fit standard viewport boundaries (bounding scale factor around 3.6 units height)
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const size = new THREE.Vector3();
    if (box) {
      box.getSize(size);
    }
    
    let maxDim = Math.max(size.x, size.y, size.z);
    if (isNaN(maxDim) || maxDim <= 0) {
      maxDim = 1.0;
    }

    const targetScale = 3.6 / maxDim;
    console.log(` -> 原始尺寸: [${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)}]. 自动缩放系数: ${targetScale.toFixed(4)}`);
    geo.scale(targetScale, targetScale, targetScale);

    // Now offset upward cleanly so that the bottom of the geometry sits on the grid plane (Y = -2)
    geo.computeBoundingBox();
    const finalBox = geo.boundingBox!;
    const finalCenter = new THREE.Vector3();
    if (finalBox) {
      finalBox.getCenter(finalCenter);
    }
    
    if (isNaN(finalCenter.x) || isNaN(finalCenter.y) || isNaN(finalCenter.z)) {
      finalCenter.set(0, 0, 0);
    }
    
    const minY = finalBox ? finalBox.min.y : -1.8;
    const transY = -minY - 2.0;
    
    console.log(` -> 居中平移对齐, Y底部平移量: ${transY.toFixed(4)}`);
    geo.translate(-finalCenter.x, isNaN(transY) ? 0 : transY, -finalCenter.z);

    t.rawGeometry = geo;

    // Reset weights (initially bind 100% to root bone at index 0 to avoid zero-scale collapse)
    const count = geo.attributes.position.count;
    const skinIndices = new Float32Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      skinWeights[i * 4] = 1.0;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));

    onUpdateSkinWeights(skinIndices, skinWeights);

    // Initial skinned mesh binding
    rebuildSkinnedMesh();
    setIsLoading(false);
  }

  // Generates a nice segmented Humanoid box geometry
  function buildSimplifiedHumanoidGeometry(): THREE.BufferGeometry {
    const group = new THREE.Group();

    // Torso Segment
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.6, 4, 6, 2));
    torso.position.set(0, 0.8, 0);
    group.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12));
    head.position.set(0, 2.0, 0);
    group.add(head);

    // Left Arm
    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3, 2, 6, 2));
    lArm.position.set(-0.9, 1.1, 0);
    group.add(lArm);

    // Right Arm
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3, 2, 6, 2));
    rArm.position.set(0.9, 1.1, 0);
    group.add(rArm);

    // Left Leg
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.35, 2, 8, 2));
    lLeg.position.set(-0.4, -0.9, 0);
    group.add(lLeg);

    // Right Leg
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.35, 2, 8, 2));
    rLeg.position.set(0.4, -0.9, 0);
    group.add(rLeg);

    // Merge geometries
    const geometries: THREE.BufferGeometry[] = [];
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const clonedGeom = node.geometry.clone();
        clonedGeom.translate(node.position.x, node.position.y, node.position.z);
        geometries.push(clonedGeom);
      }
    });

    // Simple procedural box merging
    const mergedPositions: number[] = [];
    const mergedNormals: number[] = [];
    
    geometries.forEach(g => {
      const pos = g.attributes.position.array;
      const norm = g.attributes.normal.array;
      for (let i = 0; i < pos.length; i++) {
        mergedPositions.push(pos[i]);
        mergedNormals.push(norm[i]);
      }
    });

    const finalGeom = new THREE.BufferGeometry();
    finalGeom.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
    finalGeom.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
    finalGeom.computeVertexNormals();

    return finalGeom;
  }

  // Draw golden/blue spheres for bones and cylinders for connections
  function updateSkeletonVisualizers() {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t) return;

    // Clear previous drawing
    while (t.jointVisualizersGroup.children.length > 0) {
      const child = t.jointVisualizersGroup.children[0];
      t.jointVisualizersGroup.remove(child);
    }
    while (t.boneVisualizersGroup.children.length > 0) {
      const child = t.boneVisualizersGroup.children[0];
      t.boneVisualizersGroup.remove(child);
    }

    // Only draw skeletal guides in designated structural modes
    if (state.editorMode === 'edit-model') {
      return;
    }

    // Material definitions for skeleton
    const jointGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const selectedJointGeo = new THREE.SphereGeometry(0.16, 16, 16);

    const normalJointMat = new THREE.MeshBasicMaterial({ color: '#10b981', depthTest: false, transparent: true, opacity: 0.95 }); // Emerald
    const selectedJointMat = new THREE.MeshBasicMaterial({ color: '#f59e0b', depthTest: false, transparent: true, opacity: 0.95 }); // Gold-Amber
    const boneSegmentMat = new THREE.MeshBasicMaterial({ color: '#6366f1', depthTest: false, transparent: true, opacity: 0.7 }); // Visual Blue Bone

    // Temporary map of global world coordinates
    const jointWorldPositions = new Map<string, THREE.Vector3>();

    // Compute active world positions from threeBones
    t.threeBones.forEach((bone) => {
      const jointNode = state.joints.find(j => j.name === bone.name);
      if (!jointNode) return;

      const v = new THREE.Vector3();
      bone.getWorldPosition(v);
      jointWorldPositions.set(jointNode.id, v);

      // Draw bone sphere joint at position
      const isSelected = jointNode.id === state.selectedJointId;
      const sphere = new THREE.Mesh(
        isSelected ? selectedJointGeo : jointGeo,
        isSelected ? selectedJointMat : normalJointMat
      );
      sphere.position.copy(v);
      sphere.userData = { jointId: jointNode.id };
      t.jointVisualizersGroup.add(sphere);
    });

    // Draw cylindrical bridge lines connecting children bones to parents
    state.joints.forEach((joint) => {
      if (!joint.parentId) return;
      const childPos = jointWorldPositions.get(joint.id);
      const parentPos = jointWorldPositions.get(joint.parentId);

      if (childPos && parentPos) {
        // Draw elegant cylinder connecting them
        const distance = parentPos.distanceTo(childPos);
        if (distance > 0.05) {
          const cylinderGeo = new THREE.CylinderGeometry(0.04, 0.04, distance, 6);
          // Re-orient cylinder to align with segment vector
          cylinderGeo.translate(0, distance / 2, 0);
          const segmentMesh = new THREE.Mesh(cylinderGeo, boneSegmentMat);
          segmentMesh.position.copy(parentPos);
          segmentMesh.lookAt(childPos);
          segmentMesh.rotateX(Math.PI / 2);
          t.boneVisualizersGroup.add(segmentMesh);
        }
      }
    });
  }

  // Handle click events inside viewport to paint weights, select bones
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t) return;

    // Grab canvas bounds
    const rect = canvasRef.current!.getBoundingClientRect();
    t.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    t.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    t.raycaster.setFromCamera(t.mouse, t.camera);

    // Case 1: Weight Brush Painting mode active
    if (state.editorMode === 'rigging' && state.isPaintingActive && state.selectedJointId && t.mainMesh) {
      // Disable orbit constraints while printing is taking place
      t.controls.enabled = false;
      document.addEventListener('pointerup', handlePointerUp);
      paintWeightAtRaycast();
      return;
    }

    // Case 2: Click to select bone joint node directly in 3D workspace
    const jointHits = t.raycaster.intersectObjects(t.jointVisualizersGroup.children);
    if (jointHits.length > 0) {
      const indexObj = jointHits[0].object;
      const clickedId = indexObj.userData.jointId;
      if (clickedId) {
        onSelectJoint(clickedId);
        return;
      }
    }

    // Click background to deselect joint if not casting ray anywhere
    const hitsMain = t.raycaster.intersectObjects(t.scene.children, true);
    // If we click nothing substantial, reset selection focus
    const skeletonObjects = [...t.jointVisualizersGroup.children, ...t.boneVisualizersGroup.children];
    const userHitsSkeleton = t.raycaster.intersectObjects(skeletonObjects).length > 0;
    const userHitsMainMesh = t.mainMesh ? t.raycaster.intersectObject(t.mainMesh).length > 0 : false;

    if (!userHitsSkeleton && !userHitsMainMesh) {
      onSelectJoint(null);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    t.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    t.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    t.raycaster.setFromCamera(t.mouse, t.camera);

    // Highlight brush size in viewport real-time
    if (state.editorMode === 'rigging' && state.isPaintingActive && state.selectedJointId && t.mainMesh) {
      const hits = t.raycaster.intersectObject(t.mainMesh);
      if (hits.length > 0) {
        t.brushSphere!.visible = true;
        t.brushSphere!.position.copy(hits[0].point);
        t.brushSphere!.scale.setScalar(state.weightBrush.size);
        
        // If clicking and dragging (holding pointer down)
        if (event.buttons === 1) {
          paintWeightAtRaycast();
        }
      } else {
        t.brushSphere!.visible = false;
      }
    } else {
      t.brushSphere!.visible = false;
    }
  };

  const handlePointerUp = () => {
    const t = threeRef.current;
    if (t) {
      t.controls.enabled = true;
    }
    document.removeEventListener('pointerup', handlePointerUp);
  };

  // Rigging weights real-time vertex brush calculations
  function paintWeightAtRaycast() {
    const t = threeRef.current;
    const state = stateRef.current;
    if (!t || !t.mainMesh || !t.rawGeometry || !state.selectedJointId) return;

    const hits = t.raycaster.intersectObject(t.mainMesh);
    if (hits.length === 0) return;

    const hitPointLocal = t.mainMesh.worldToLocal(hits[0].point.clone());
    const geom = t.rawGeometry;
    const posAttr = geom.attributes.position;
    const count = posAttr.count;

    const skinIndexAttr = geom.attributes.skinIndex;
    const skinWeightAttr = geom.attributes.skinWeight;

    if (!skinIndexAttr || !skinWeightAttr) return;

    const bSize = state.weightBrush.size;
    const bStrength = state.weightBrush.strength;
    const bMode = state.weightBrush.mode;

    // Find the state-index of selected bone
    const selectedBoneIndex = state.joints.findIndex(j => j.id === state.selectedJointId);
    if (selectedBoneIndex === -1) return;

    // Mutate geometries attributes directly
    const indicesBuffer = skinIndexAttr.array as Float32Array;
    const weightsBuffer = skinWeightAttr.array as Float32Array;

    const skinIndicesCopy = new Float32Array(indicesBuffer);
    const skinWeightsCopy = new Float32Array(weightsBuffer);

    let changedAny = false;

    for (let i = 0; i < count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);

      // Distance to brush center
      const dx = vx - hitPointLocal.x;
      const dy = vy - hitPointLocal.y;
      const dz = vz - hitPointLocal.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < bSize) {
        // Falloff calculation
        const falloff = 1 - (dist / bSize);
        const delta = bStrength * falloff * 0.1; // Smooth dampening

        const idxOffset = i * 4;
        
        // 1. Check if selectedBone is already in the vertex's bone list
        let slotIndex = -1;
        for (let j = 0; j < 4; j++) {
          if (skinIndicesCopy[idxOffset + j] === selectedBoneIndex) {
            slotIndex = j;
            break;
          }
        }

        // If not in listing, find slot to push or overwrite smallest weight
        if (slotIndex === -1) {
          let minWeightIdx = 0;
          let minWeightVal = skinWeightsCopy[idxOffset];
          for (let j = 1; j < 4; j++) {
            if (skinWeightsCopy[idxOffset + j] < minWeightVal) {
              minWeightVal = skinWeightsCopy[idxOffset + j];
              minWeightIdx = j;
            }
          }
          slotIndex = minWeightIdx;
          skinIndicesCopy[idxOffset + slotIndex] = selectedBoneIndex;
          skinWeightsCopy[idxOffset + slotIndex] = 0.0;
        }

        // Apply mode transformation
        let targetWeight = skinWeightsCopy[idxOffset + slotIndex];
        if (bMode === 'add') {
          targetWeight = Math.min(1.0, targetWeight + delta);
        } else if (bMode === 'subtract') {
          targetWeight = Math.max(0.0, targetWeight - delta);
        } else {
          // Smooth blends weight slightly closer to 0.5 center average of neighboring bone index allocations
          targetWeight = targetWeight * 0.8 + 0.1;
        }

        changedAny = true;
        skinWeightsCopy[idxOffset + slotIndex] = targetWeight;

        // Re-normalize top 4 weights to sum exactly to 1.0
        let otherTotal = 0;
        for (let j = 0; j < 4; j++) {
          if (j !== slotIndex) {
            otherTotal += skinWeightsCopy[idxOffset + j];
          }
        }

        const remaining = 1.0 - targetWeight;
        if (remaining <= 0) {
          // Absolute capture by single bone
          for (let j = 0; j < 4; j++) {
            if (j !== slotIndex) {
              skinWeightsCopy[idxOffset + j] = 0;
            }
          }
        } else {
          if (otherTotal > 0) {
            // Distribute remaining proportional to existing allocations
            for (let j = 0; j < 4; j++) {
              if (j !== slotIndex) {
                skinWeightsCopy[idxOffset + j] = (skinWeightsCopy[idxOffset + j] / otherTotal) * remaining;
              }
            }
          } else {
            // Spread equally if no other bones have weights
            const shareCount = 3;
            for (let j = 0; j < 4; j++) {
              if (j !== slotIndex) {
                skinWeightsCopy[idxOffset + j] = remaining / shareCount;
              }
            }
          }
        }
      }
    }

    if (changedAny) {
      geom.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndicesCopy, 4));
      geom.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeightsCopy, 4));
      geom.attributes.skinIndex.needsUpdate = true;
      geom.attributes.skinWeight.needsUpdate = true;

      onUpdateSkinWeights(skinIndicesCopy, skinWeightsCopy);
      colorMeshByWeights();
    }
  }

  // Handle start dragging individual joint flat markers
  const handleMarkerDragStart = (e: React.PointerEvent<HTMLDivElement>, joint: JointNode) => {
    e.preventDefault();
    e.stopPropagation();

    setActiveDragJointId(joint.id);
    onSelectJoint(joint.id);

    const handleMarkerDragMove = (moveEvent: PointerEvent) => {
      const t = threeRef.current;
      if (!t || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const ndcX = ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1;

      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
      vec.unproject(t.camera);
      vec.sub(t.camera.position).normalize();

      let distance = 0;
      if (Math.abs(vec.z) > 0.0001) {
        distance = -t.camera.position.z / vec.z;
      }
      const pos3D = t.camera.position.clone().add(vec.multiplyScalar(distance));

      const updatedX = Number(pos3D.x.toFixed(3));
      const updatedY = Number(pos3D.y.toFixed(3));

      const newJoints = joints.map(j => {
        if (j.id === joint.id) {
          return {
            ...j,
            position: [updatedX, updatedY, j.position[2]] as [number, number, number]
          };
        }

        if (isSymmetryMode) {
          const lowerId = joint.id.toLowerCase();
          const targetLowerId = j.id.toLowerCase();

          let isPair = false;
          // Substring matching l_ and r_ prefixes
          if (lowerId.startsWith('l_') && targetLowerId === 'r_' + lowerId.substring(2)) isPair = true;
          else if (lowerId.startsWith('r_') && targetLowerId === 'l_' + lowerId.substring(2)) isPair = true;

          if (isPair) {
            return {
              ...j,
              // Mirror X position across origin, preserve Y position
              position: [-updatedX, updatedY, j.position[2]] as [number, number, number]
            };
          }
        }

        return j;
      });

      onUpdateJoints(newJoints);
    };

    const handleMarkerDragEnd = () => {
      setActiveDragJointId(null);
      document.removeEventListener('pointermove', handleMarkerDragMove);
      document.removeEventListener('pointerup', handleMarkerDragEnd);
    };

    document.addEventListener('pointermove', handleMarkerDragMove);
    document.addEventListener('pointerup', handleMarkerDragEnd);
  };

  return (
    <div className="relative w-full h-full bg-[#070b12]" ref={containerRef}>
      {/* 3D Canvas element */}
      <canvas
        className="w-full h-full cursor-crosshair block"
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      />

      {/* 📂 Empty Model State Placeholder Visual Overlay */}
      {activeModelType === 'gltf' && !customModelFile && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/45 backdrop-blur-[2px] p-6 z-10 pointer-events-none select-none animate-in fade-in duration-300">
          <div className="max-w-md bg-slate-900/95 border border-slate-800/80 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center gap-4 pointer-events-auto">
            <div className="w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <UploadCloud className="w-7 h-7" />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <h2 className="text-sm font-extrabold text-slate-100 tracking-wide uppercase">导入您的 3D 专属模型</h2>
              <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                形体预设已移出。请在左侧<strong>「导入外部3D模型」</strong>面板中上传您自己的 3D 角色网格体。
              </p>
            </div>

            <div className="w-full grid grid-cols-4 gap-1 bg-slate-950 p-2 rounded-xl text-[10px] font-mono border border-slate-850">
              <div className="flex flex-col items-center py-1.5 rounded bg-slate-900/50">
                <span className="text-indigo-300 font-bold text-xs font-sans">.glb</span>
                <span className="text-slate-500 text-[8px] mt-0.5 scale-90">二进制</span>
              </div>
              <div className="flex flex-col items-center py-1.5 rounded bg-slate-900/50">
                <span className="text-indigo-300 font-bold text-xs font-sans">.gltf</span>
                <span className="text-slate-500 text-[8px] mt-0.5 scale-90">JSON</span>
              </div>
              <div className="flex flex-col items-center py-1.5 rounded bg-slate-900/50">
                <span className="text-indigo-300 font-bold text-xs font-sans">.fbx</span>
                <span className="text-slate-500 text-[8px] mt-0.5 scale-90">经典动画</span>
              </div>
              <div className="flex flex-col items-center py-1.5 rounded bg-slate-900/50">
                <span className="text-indigo-300 font-bold text-xs font-sans">.obj</span>
                <span className="text-slate-500 text-[8px] mt-0.5 scale-90">静态网格</span>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 max-w-[320px] leading-relaxed">
              支持一并拖入贴图或 <code>.mtl</code> 材质文件。载入后即可自由放置关节节点，进行蒙皮、K帧与设计炫酷的 3D 舞蹈喔！
            </p>
          </div>
        </div>
      )}

      {/* Mixamo 2D Flat Assembly SVG/HTML Layer */}
      {isMixamoActive && (
        <div id="mixamo-overlay-container" className="absolute inset-0 select-none overflow-hidden" style={{ pointerEvents: 'none' }}>
          {/* Draggable Markers SVG Line Connections */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
              </linearGradient>
              <filter id="glowFilt" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Connection rods (glowing stick figures skeleton rods) */}
            {joints.map(j => {
              if (j.parentId) {
                return (
                  <line
                    key={`line-${j.parentId}-${j.id}`}
                    id={`line-${j.parentId}-${j.id}`}
                    stroke="url(#glowGrad)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    opacity="0.85"
                    filter="url(#glowFilt)"
                  />
                );
              }
              return null;
            })}
          </svg>

          {/* Floating Draggable Dots */}
          {joints.map(j => {
            // Custom colors for different bones to make it look highly polished and premium
            let dotColor = 'bg-sky-500 shadow-sky-500/50 border-sky-300';
            let labelName = j.name;

            const lowerName = j.name.toLowerCase();
            const lowerId = j.id.toLowerCase();

            if (lowerId.includes('root') || lowerId.includes('pelvis') || lowerName.includes('pelvis')) {
              dotColor = 'bg-gradient-to-br from-pink-500 to-rose-600 shadow-pink-500/60 border-pink-300';
              labelName = '盆骨/重心 (Pelvis)';
            } else if (lowerId.includes('spine') || lowerName.includes('spine')) {
              dotColor = 'bg-gradient-to-br from-orange-400 to-amber-500 shadow-orange-500/60 border-orange-300';
              labelName = '脊椎 (Spine)';
            } else if (lowerId.includes('neck') || lowerId.includes('head') || lowerName.includes('neck') || lowerName.includes('head')) {
              dotColor = 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-yellow-500/60 border-yellow-300';
              labelName = '下巴/脖子 (Chin/Neck)';
            } else if (lowerId.includes('shoulder')) {
              dotColor = 'bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-indigo-500/60 border-indigo-300';
              labelName = lowerId.startsWith('l_') ? '左肩胛 (L Shoulder)' : '右肩胛 (R Shoulder)';
            } else if (lowerId.includes('elbow')) {
              dotColor = 'bg-gradient-to-br from-violet-500 to-purple-600 shadow-purple-500/60 border-purple-300';
              labelName = lowerId.startsWith('l_') ? '左手肘 (L Elbow)' : '右手肘 (R Elbow)';
            } else if (lowerId.includes('hip')) {
              dotColor = 'bg-gradient-to-br from-teal-500 to-emerald-600 shadow-teal-500/60 border-teal-300';
              labelName = lowerId.startsWith('l_') ? '左大腿根 (L Hip)' : '右大腿根 (R Hip)';
            } else if (lowerId.includes('knee')) {
              dotColor = 'bg-gradient-to-br from-emerald-500 to-green-600 shadow-emerald-500/60 border-emerald-300';
              labelName = lowerId.startsWith('l_') ? '左膝盖 (L Knee)' : '右膝盖 (R Knee)';
            } else if (lowerId.includes('foot') || lowerId.includes('ankle')) {
              dotColor = 'bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/60 border-red-300';
              labelName = lowerId.startsWith('l_') ? '左脚踝 (L Foot)' : '右脚踝 (R Foot)';
            } else if (lowerId.includes('base') || lowerId.includes('bone_0')) {
              dotColor = 'bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sky-500/60 border-sky-300';
              labelName = '根节点支撑 (Base)';
            } else if (lowerId.includes('mid') || lowerId.includes('bone_1')) {
              dotColor = 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/60 border-emerald-300';
              labelName = '中间关节 (Mid Joint)';
            } else if (lowerId.includes('top') || lowerId.includes('bone_2')) {
              dotColor = 'bg-gradient-to-br from-yellow-500 to-amber-600 shadow-yellow-500/60 border-yellow-300';
              labelName = '顶部端点 (Top Tip)';
            }

            const isSelected = selectedJointId === j.id;

            return (
              <div
                key={`marker-${j.id}`}
                id={`marker-${j.id}`}
                className={`absolute w-[22px] h-[22px] rounded-full flex items-center justify-center pointer-events-auto cursor-grab active:cursor-grabbing transform -translate-x-1/2 -translate-y-1/2 hover:scale-[1.3] z-10 group transition-all duration-150 border ${
                  isSelected ? 'border-amber-400 bg-amber-400/25 ring-2 ring-amber-400/50' : 'border-slate-800 bg-slate-900/40'
                }`}
                onPointerDown={(e) => handleMarkerDragStart(e, j)}
              >
                {/* Visual marker core dot */}
                <div className={`w-3.5 h-3.5 rounded-full ${dotColor} border border-white`} />

                {/* Highly readable floating label name tooltip */}
                <span className="absolute left-1/2 -translate-x-1/2 top-[24px] bg-slate-950 text-slate-100 border border-slate-800 text-[10px] font-sans px-2 py-0.5 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-medium whitespace-nowrap z-20 pointer-events-none">
                  {labelName}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Right side controls panel: Mixamo mode activator */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 z-10">
        <button
          onClick={() => setIsMixamoActive(prev => !prev)}
          className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 text-xs font-semibold cursor-pointer transition shadow-xl ${
            isMixamoActive
              ? 'bg-indigo-600 border-indigo-400 text-white shadow-indigo-600/30 font-sans'
              : 'bg-slate-900 border-slate-700/80 text-indigo-300 hover:text-white hover:bg-slate-800 font-sans'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${isMixamoActive ? 'animate-spin' : ''}`} />
          <span>{isMixamoActive ? '退出 Mixamo 对齐' : '🤖 Mixamo 风格平面骨骼对齐'}</span>
        </button>
        
        {isMixamoActive && (
          <div className="bg-slate-900/95 backdrop-blur border border-slate-700/80 rounded-xl p-4 w-[240px] shadow-2xl flex flex-col gap-3 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
             <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span className="font-bold text-slate-200">2D 标记骨骼对齐</span>
                <span className="text-[9px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono">Mixamo Rigger</span>
             </div>
             
             <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
             请拖拽模型上的彩色指示点，对齐模型的下巴、手肘、膝盖及盆骨等关键部位。
             </p>
             
             <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded-lg border border-slate-800/40">
                <span className="text-slate-300">水平镜像对称</span>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                   <input
                      type="checkbox"
                      checked={isSymmetryMode}
                      onChange={(e) => setIsSymmetryMode(e.target.checked)}
                      className="sr-only peer"
                   />
                   <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-300 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white" />
                </label>
             </div>
             
             <div className="flex flex-col gap-1.5 mt-1">
                <button
                   onClick={() => {
                      triggerAutoRigging();
                   }}
                   className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold font-sans cursor-pointer shadow-lg shadow-emerald-600/10 transition active:scale-[0.98] flex items-center justify-center gap-1.5 animate-pulse"
                >
                   <RotateCw className="w-3.5 h-3.5" />
                   <span>🧠 一键更新蒙皮计算</span>
                </button>
                
                <button
                   onClick={() => {
                      if (activeModelType !== 'gltf') {
                         const standard = getPresetSkeletons(activeModelType);
                         onUpdateJoints(standard);
                      } else {
                         const standardHuman = getPresetSkeletons('humanoid');
                         onUpdateJoints(standardHuman);
                      }
                   }}
                   className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium cursor-pointer transition flex items-center justify-center gap-1"
                >
                   <span>重置为国标比例姿态</span>
                </button>
             </div>
          </div>
        )}
      </div>

      {/* 3D Model Playback & Showroom Panel */}
      {activeModelType === 'gltf' && (
        <div className="absolute top-[80px] right-4 bg-slate-900/95 backdrop-blur border border-slate-700/80 rounded-xl p-4 w-[280px] shadow-2xl flex flex-col gap-3 text-xs z-10 animate-in fade-in slide-in-from-right-4 duration-200">
          <div 
            onClick={() => setIsShowroomCollapsed(!isShowroomCollapsed)}
            className="flex items-center justify-between border-b border-indigo-500/20 pb-2 cursor-pointer select-none group"
          >
            <div className="flex items-center gap-1.5 text-slate-100 font-bold group-hover:text-amber-400 transition">
              <Film className="w-4 h-4 text-emerald-400" />
              <span>🎨 3D 原生模型展厅</span>
            </div>
            <span className="text-[10px] text-indigo-400 font-semibold font-mono hover:text-indigo-200 transition">
              {isShowroomCollapsed ? '展开 ↗' : '收起 ↘'}
            </span>
          </div>

          {!isShowroomCollapsed && (
            <div className="flex flex-col gap-3 pt-1 animate-in fade-in duration-200">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-slate-400 font-semibold tracking-wider font-sans">视图操控模式 :</span>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setIsShowroomActive(false)}
                    className={`py-1.5 rounded-md text-center font-bold transition flex items-center justify-center gap-1 cursor-pointer text-[11px] ${
                      !isShowroomActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>🛠️ 绑定设计</span>
                  </button>
                  <button
                    onClick={() => setIsShowroomActive(true)}
                    className={`py-1.5 rounded-md text-center font-bold transition flex items-center justify-center gap-1 cursor-pointer text-[11px] ${
                      isShowroomActive
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>✨ 3D 展厅</span>
                  </button>
                </div>
              </div>

          {isShowroomActive && (
            <div className="flex flex-col gap-3.5 border-t border-slate-800 pt-3.5">
              {gltfClips.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-bold text-[11px] font-sans">🎯 检测到内置动画:</span>
                    <span className="text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 px-1.5 py-0.5 rounded-md font-mono">
                      {gltfClips.length} 个动作
                    </span>
                  </div>

                  <select
                    value={activeClipName}
                    onChange={(e) => setActiveClipName(e.target.value)}
                    className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-lg py-1.5 px-2.5 text-xs font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {gltfClips.map((clip) => (
                      <option key={clip.name} value={clip.name}>
                        🏃‍♂️ {clip.name}
                      </option>
                    ))}
                  </select>

                  <hr className="border-slate-800/60 my-0.5" />

                  {/* Playback Controls */}
                  <div className="flex items-center gap-3 bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setIsGltfAnimating(!isGltfAnimating)}
                      className={`p-2 rounded-lg flex items-center justify-center transition cursor-pointer ${
                        isGltfAnimating
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/15'
                          : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                      }`}
                    >
                      {isGltfAnimating ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="flex-1 flex flex-col justify-center">
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span className="font-sans">播放控制</span>
                        <span className={isGltfAnimating ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                          {isGltfAnimating ? "演示中" : "已暂停"}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div 
                          className={`h-full bg-emerald-500 rounded-full transition-all duration-300 ${isGltfAnimating ? "animate-pulse" : ""}`} 
                          style={{ width: isGltfAnimating ? "100%" : "0%" }} 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Play Speed Control Slider */}
                  <div className="flex flex-col gap-1.5 bg-slate-950/40 p-2 rounded-lg border border-slate-800/45">
                    <div className="flex justify-between text-[10px] text-slate-400 font-sans">
                      <span>播放速率 (Speed)</span>
                      <span className="text-emerald-400 font-mono font-bold">{showroomSpeed.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3.0"
                      step="0.05"
                      value={showroomSpeed}
                      onChange={(e) => setShowroomSpeed(parseFloat(e.target.value))}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 text-slate-400 rounded-lg p-3 text-center border border-dashed border-slate-800 text-[11px] leading-relaxed font-sans">
                  📢 此模型未检测到内置骨骼动画。
                  <br />
                  <span className="text-slate-500 text-[10px] mt-1 block">
                    您可以点击切换至 <strong>✨ 3D 展厅</strong> 观察高精度原始多材质与网格。
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 💡 灯光与环境设定 (Lights & Atmosphere) */}
          <div className="flex flex-col gap-2.5 border-t border-slate-800/80 pt-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-200 font-bold">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>🌞 展厅环境与数字曝光</span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-850">
              {(['studio', 'daylight', 'cyber', 'gallery'] as const).map((preset) => {
                const labels = {
                  studio: '标准',
                  daylight: '日光',
                  cyber: '赛博',
                  gallery: '黄金'
                };
                return (
                  <button
                    key={preset}
                    onClick={() => setLightPreset(preset)}
                    className={`py-1 rounded text-[10px] font-bold text-center transition cursor-pointer select-none ${
                      lightPreset === preset
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 font-extrabold'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-900/40 border border-transparent'
                    }`}
                  >
                    {labels[preset]}
                  </button>
                );
              })}
            </div>

            {/* Exposure Slider */}
            <div className="flex flex-col gap-1.5 bg-slate-950/40 p-2 rounded-lg border border-slate-800/40">
              <div className="flex justify-between text-[10px] text-slate-400 font-sans">
                <span>渲染明暗曝光 (Exposure)</span>
                <span className="text-amber-400 font-mono font-bold">{toneExposure.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.5"
                step="0.05"
                value={toneExposure}
                onChange={(e) => setToneExposure(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
              />
            </div>

            {/* Ambient Intensity Slider */}
            <div className="flex flex-col gap-1.5 bg-slate-950/40 p-2 rounded-lg border border-slate-800/40">
              <div className="flex justify-between text-[10px] text-slate-400 font-sans">
                <span>环境漫反射 (Ambient)</span>
                <span className="text-amber-400 font-mono font-bold">{ambientIntensity.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="2.5"
                step="0.05"
                value={ambientIntensity}
                onChange={(e) => setAmbientIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
              />
            </div>

            {/* Dir Light Intensity Slider */}
            <div className="flex flex-col gap-1.5 bg-slate-950/40 p-2 rounded-lg border border-slate-800/40">
              <div className="flex justify-between text-[10px] text-slate-400 font-sans">
                <span>主射光源 (Key Light)</span>
                <span className="text-amber-400 font-mono font-bold">{keyLightIntensity.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.05"
                value={keyLightIntensity}
                onChange={(e) => setKeyLightIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
              />
            </div>

            {/* 🎨 PBR IBL 环绕贴图 (HDRI) Section */}
            <div className="border-t border-slate-800/80 pt-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                <span>🎨 PBR 环境贴图 (HDRI)</span>
                {isHdrLoading && (
                  <span className="text-amber-500 text-[10px] animate-pulse">正在渲染贴图...</span>
                )}
              </div>

              {/* HDR Preset Selector Selector */}
              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-850">
                {([
                  { id: 'none', label: '无环绕' },
                  { id: 'studio', label: '摄影棚' },
                  { id: 'sunset', label: '落日' },
                  { id: 'cyber', label: '赛博' },
                  { id: 'gallery', label: '黄金厅' },
                  { id: 'custom', label: '自定 HDR' }
                ] as const).map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setHdrPreset(preset.id);
                    }}
                    className={`py-1 rounded text-[9px] font-bold text-center transition cursor-pointer select-none ${
                      hdrPreset === preset.id
                        ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-900/40 border border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Show Custom File Picker if Custom choice is active */}
              {hdrPreset === 'custom' && (
                <div className="flex flex-col gap-1.5 p-2 bg-slate-950/80 border border-slate-850 rounded-lg">
                  <label className="flex items-center gap-1.5 justify-center py-1 rounded bg-slate-800 hover:bg-slate-700/85 text-slate-200 text-[10px] font-bold cursor-pointer transition select-none">
                    <UploadCloud className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="truncate max-w-[180px]">
                      {customHdrFile ? customHdrFile.name : '上传本地 .hdr/.exr 贴图'}
                    </span>
                    <input
                      type="file"
                      accept=".hdr,.exr"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setCustomHdrFile(e.target.files[0]);
                          setHdrPreset('custom');
                        }
                      }}
                    />
                  </label>
                  <p className="text-[9px] text-slate-500 leading-normal text-center">
                    支持标准高动态范围 <code>.hdr</code> / <code>.exr</code> 光照图，为模型材质映射真实折射反射。
                  </p>
                </div>
              )}

              {/* Checkbox to enable Background display */}
              {hdrPreset !== 'none' && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10px] text-slate-400 hover:text-slate-200 transition mt-0.5">
                  <input
                    type="checkbox"
                    checked={useHdrAsBackground}
                    onChange={(e) => setUseHdrAsBackground(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer w-3 h-3"
                  />
                  <span>将环境贴图设为 3D 空间背景(Background)</span>
                </label>
              )}
            </div>
          </div>
          </div>
        )}
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col justify-center items-center z-20">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white text-sm font-medium animate-pulse">正在生成模型几何结构与绑定节点...</p>
          </div>
        </div>
      )}

      {/* Loading Error Notice */}
      {loadingError && (
        <div className="absolute top-4 left-4 right-4 bg-red-950/90 border border-red-800 text-red-200 px-4 py-3 rounded-lg text-xs flex justify-between items-center shadow-lg z-30">
          <span>⚠️ {loadingError}</span>
          <button
            onClick={() => setLoadingError(null)}
            className="text-red-400 hover:text-red-100 font-bold ml-2 text-sm focus:outline-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Navigation Instruction Guide */}
      <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2 z-10">
        <div className="bg-slate-900/90 backdrop-blur border border-slate-700/60 rounded-lg p-3 text-xs shadow-xl flex flex-col gap-1.5 text-slate-300 pointer-events-auto">
          <div 
            onClick={() => setIsNavCollapsed(!isNavCollapsed)}
            className="flex items-center justify-between gap-4 text-slate-100 font-medium border-b border-slate-800 pb-1 cursor-pointer select-none group"
          >
            <div className="flex items-center gap-1.5">
              <Move3d className="w-3.5 h-3.5 text-sky-400" />
              <span>三维操作视图</span>
            </div>
            <span className="text-[10px] text-indigo-400 hover:text-indigo-200 transition font-mono">
              {isNavCollapsed ? '展开 ↗' : '收起 ↘'}
            </span>
          </div>
          {!isNavCollapsed && (
            <div className="flex flex-col gap-1.5 animate-in fade-in duration-100 mt-1">
              <p>🖱️ <strong className="text-slate-100">旋转相机</strong>: 鼠标左键 拖拽</p>
              <p>🖱️ <strong className="text-slate-100">平移相机</strong>: 鼠标右键 或 Shift + 拖拽</p>
              <p>🖱️ <strong className="text-slate-100">缩放视角</strong>: 滚轮滑动</p>
              <p>🟢 <strong className="text-slate-100">骨骼节点</strong>: 绿圆球。鼠标左键点击可直接选中</p>
              
              <div className="border-t border-slate-800/60 my-1 pb-0.5" />
              <div className="flex items-center justify-between gap-4 pointer-events-auto select-none mt-0.5">
                <span className="text-slate-400 font-medium text-[11px]">显示3D骨干框架</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSkeleton}
                    onChange={(e) => setShowSkeleton(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-300 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white" />
                </label>
              </div>
            </div>
          )}
        </div>

        {editorMode === 'rigging' && isPaintingActive && (
          <div className="bg-amber-950/85 backdrop-blur border border-amber-800/50 rounded-lg p-3 text-xs shadow-xl flex flex-col gap-1 text-amber-200">
            <div className="flex items-center gap-1.5 font-medium mb-1 border-b border-amber-900/60 pb-1 text-amber-100">
              <Paintbrush className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>毛刷权重粉刷活跃</span>
            </div>
            <p className="opacity-90">按住 <strong>鼠标左键 拖动</strong> 涂抹权重</p>
            <p className="opacity-90">当前选定骨骼: <strong className="text-white">{joints.find(j => j.id === selectedJointId)?.name || '未选择'}</strong></p>
          </div>
        )}
      </div>

      {/* Cinematic Camera Hud Panel */}
      <div className="absolute bottom-4 left-4 bg-slate-900/95 backdrop-blur-sm border border-indigo-500/30 rounded-lg p-3 text-xs shadow-2xl flex flex-col gap-2 text-slate-300 pointer-events-auto w-[240px] z-10 transition-all duration-300 select-none animate-in fade-in duration-300">
        <div 
          onClick={() => setIsCinematicCollapsed(!isCinematicCollapsed)}
          className="flex items-center justify-between gap-4 text-slate-100 font-bold border-b border-indigo-500/20 pb-1.5 cursor-pointer group"
        >
          <div className="flex items-center gap-1.5 text-indigo-400 group-hover:text-indigo-300 transition">
            <Camera className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>🎥 AI 智能镜头运镜系统</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono hover:text-slate-300">
            {isCinematicCollapsed ? '展开 ↗' : '收起 ↘'}
          </span>
        </div>
        
        {!isCinematicCollapsed && (
          <div className="flex flex-col gap-2 mt-1 animate-in fade-in duration-200">
            <p className="text-[11px] text-slate-400 leading-normal">
              检测人物 <strong>表情/心情剧烈过渡</strong> 时，镜头会自动捕获面部/头部特写，配合环境光影完成专业运镜。
            </p>
            
            <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded border border-slate-850">
              <span className="text-slate-500 text-[10px]">当前运镜状态</span>
              {cinematicRef.current.active ? (
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-md font-semibold text-[10px] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                  特写中 ({cinematicRef.current.moodType === 'joy' ? '😊 狂喜' : cinematicRef.current.moodType === 'anger' ? '😡 暴怒' : '😢 悲伤'})
                </span>
              ) : (
                <span className="text-slate-500 text-[10px]">标准监视</span>
              )}
            </div>

            {/* Quick Test Controls */}
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[10px] text-slate-500 font-bold font-mono uppercase tracking-wider">运镜测试预览:</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => handleManualMoodTrigger('joy')}
                  className="bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-400/40 border border-amber-500/25 rounded py-1 text-[10px] text-amber-200 font-bold cursor-pointer text-center transition active:scale-[0.96]"
                >
                  😊 狂喜特写
                </button>
                <button
                  type="button"
                  onClick={() => handleManualMoodTrigger('anger')}
                  className="bg-red-500/10 hover:bg-red-500/20 hover:border-red-400/40 border border-red-500/25 rounded py-1 text-[10px] text-red-200 font-bold cursor-pointer text-center transition active:scale-[0.96]"
                >
                  😡 暴怒聚焦
                </button>
                <button
                  type="button"
                  onClick={() => handleManualMoodTrigger('sadness')}
                  className="bg-blue-500/10 hover:bg-blue-500/20 hover:border-blue-400/40 border border-blue-500/25 rounded py-1 text-[10px] text-blue-200 font-bold cursor-pointer text-center transition active:scale-[0.96]"
                >
                  😢 悲伤特写
                </button>
              </div>
            </div>

            <p className="text-[8.5px] text-slate-500 leading-normal mt-1 border-t border-slate-850 pt-1 leading-normal">
              * 当在 AI 伴侣聊天框回复导致数值突变 5 点以上，该运镜会自动无缝触发。
            </p>
          </div>
        )}
      </div>

      {/* Diagnostic viewport footer panels (Count stats of meshes) */}
      <div className="absolute bottom-4 right-4 bg-slate-900/85 backdrop-blur-sm border border-slate-800 text-[10px] font-mono rounded px-3 py-2 text-slate-400 shadow flex gap-4 pointer-events-none">
        <div>
          <span>顶点: </span>
          <span className="text-emerald-400 text-xs font-semibold">{modelStats.vertices}</span>
        </div>
        <div>
          <span>多边形: </span>
          <span className="text-sky-400 text-xs font-semibold">{modelStats.faces}</span>
        </div>
        <div>
          <span>关节: </span>
          <span className="text-amber-400 text-xs font-semibold">{modelStats.bones}</span>
        </div>
      </div>
    </div>
  );
}
