export interface JointNode {
  id: string;
  name: string;
  parentId: string | null;
  // Position in model's local space (rest pose)
  position: [number, number, number];
  // Temporal pose transformation (rotation applied during pose/animation mode)
  rotation: [number, number, number]; // Euler angles in radians (XYZ)
}

export interface WeightBrushSettings {
  size: number;
  strength: number;
  mode: 'add' | 'subtract' | 'smooth';
}

export interface KeyframeData {
  frame: number;
  // rotation offset for each joint ID: jointId -> [rx, ry, rz] values (Euler angles in radians)
  rotations: Record<string, [number, number, number]>;
}

export interface AnimationClipData {
  id: string;
  name: string;
  durationFrames: number;
  keyframes: KeyframeData[];
}

export type EditorMode = 'edit-model' | 'edit-skeleton' | 'rigging' | 'animate' | 'ai-companion';

export interface ModelPreset {
  id: string;
  name: string;
  type: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf';
  label: string;
}
