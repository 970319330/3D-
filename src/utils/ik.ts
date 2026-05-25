import * as THREE from 'three';
import { JointNode } from '../types';

interface BoneTransform {
  id: string;
  worldPosition: THREE.Vector3;
  worldRotation: THREE.Quaternion;
}

/**
 * Computes global (world) space coordinates and rotations of all joints,
 * parsing their parent-child tree hierarchy recursively.
 */
export function computeWorldTransforms(joints: JointNode[]): Map<string, BoneTransform> {
  const transforms = new Map<string, BoneTransform>();
  const jointMap = new Map<string, JointNode>();
  joints.forEach(j => jointMap.set(j.id, j));

  const resolve = (id: string) => {
    if (transforms.has(id)) return;
    const j = jointMap.get(id);
    if (!j) return;

    let parentPos = new THREE.Vector3();
    let parentRot = new THREE.Quaternion();

    if (j.parentId) {
      resolve(j.parentId);
      const parentT = transforms.get(j.parentId);
      if (parentT) {
        parentPos = parentT.worldPosition;
        parentRot = parentT.worldRotation;
      }
    }

    // Local offset relative to parent bone in resting pose
    const localOffset = new THREE.Vector3();
    if (j.parentId) {
      const parentJ = jointMap.get(j.parentId)!;
      localOffset.set(
        j.position[0] - parentJ.position[0],
        j.position[1] - parentJ.position[1],
        j.position[2] - parentJ.position[2]
      );
    } else {
      localOffset.set(j.position[0], j.position[1], j.position[2]);
    }

    // Global position is parent position + rotated local offset vector
    const worldPos = parentPos.clone().add(localOffset.clone().applyQuaternion(parentRot));

    // Global rotation is parent rotation multiplied by local rotation
    const localRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(j.rotation[0], j.rotation[1], j.rotation[2], 'XYZ'));
    const worldRot = parentRot.clone().multiply(localRot);

    transforms.set(id, {
      id,
      worldPosition: worldPos,
      worldRotation: worldRot
    });
  };

  joints.forEach(j => resolve(j.id));
  return transforms;
}

/**
 * Solves Inverse Kinematics for a specific joint chain using CCD (Cyclic Coordinate Descent).
 * 
 * @param joints Current joint nodes states
 * @param chainIds List of joint IDs in the chain (e.g. ['r_shoulder', 'r_elbow'])
 * @param endId The end effector joint ID that must reach the target (e.g. 'r_elbow')
 * @param targetPos Target 3D coordinate [x, y, z] to reach
 * @param iterations Number of convergence passes (defaults to 12)
 * @returns An updated list of JointNodes with optimized local Euler rotations
 */
export function solveCCDIK(
  joints: JointNode[],
  chainIds: string[],
  endId: string,
  targetPos: [number, number, number],
  iterations = 12
): JointNode[] {
  // Deep clone joints to avoid modifying original state until solved
  const tempJoints: JointNode[] = joints.map(j => ({
    ...j,
    rotation: [...j.rotation] as [number, number, number]
  }));

  const tPos = new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2]);

  // CCD Iterations
  for (let iter = 0; iter < iterations; iter++) {
    // Traverse from the effector parent backwards to the start of the chain
    for (let i = chainIds.length - 1; i >= 0; i--) {
      const jointId = chainIds[i];
      if (jointId === endId) continue; // End effector doesn't rotate itself to stretch

      // Compute current world transforms for the current state of tempJoints
      const transforms = computeWorldTransforms(tempJoints);
      const jointTransform = transforms.get(jointId);
      const effectorTransform = transforms.get(endId);

      if (!jointTransform || !effectorTransform) continue;

      const jointWorldPos = jointTransform.worldPosition;
      const effectorWorldPos = effectorTransform.worldPosition;

      // Vectors of joint -> effector and joint -> target
      const vEffector = effectorWorldPos.clone().sub(jointWorldPos);
      const vTarget = tPos.clone().sub(jointWorldPos);

      // Skip if almost zero length to prevent NaN calculations
      if (vEffector.length() < 0.001 || vTarget.length() < 0.001) continue;

      vEffector.normalize();
      vTarget.normalize();

      // Find rotation quaternion to align joint-to-effector with joint-to-target
      const qDiff = new THREE.Quaternion().setFromUnitVectors(vEffector, vTarget);

      // Convert world rotation difference to this joint's local space
      const parentJ = tempJoints.find(j => j.id === jointId);
      if (!parentJ) continue;

      let parentWorldRot = new THREE.Quaternion();
      if (parentJ.parentId) {
        const parentTransform = transforms.get(parentJ.parentId);
        if (parentTransform) {
          parentWorldRot = parentTransform.worldRotation;
        }
      }

      // New local rotation = ParentWorldRot^-1 * qDiff * CurrentWorldRot
      const newWorldRot = qDiff.clone().multiply(jointTransform.worldRotation);
      const newLocalRot = parentWorldRot.clone().invert().multiply(newWorldRot);

      // Extract new local Euler angles
      const euler = new THREE.Euler().setFromQuaternion(newLocalRot, 'XYZ');

      // Update joint rotation in place
      const targetJoint = tempJoints.find(j => j.id === jointId);
      if (targetJoint) {
        // Enforce basic anatomical constraints to prevent joints breaking backwards (120 degrees limit)
        const limit = Math.PI * 0.95;
        const boundedX = Math.max(-limit, Math.min(limit, euler.x));
        const boundedY = Math.max(-limit, Math.min(limit, euler.y));
        const boundedZ = Math.max(-limit, Math.min(limit, euler.z));

        targetJoint.rotation = [boundedX, boundedY, boundedZ];
      }
    }
  }

  return tempJoints;
}

/**
 * Procedurally generates a fully synchronized, biologically balanced humanoid walk cycle
 * using Inverse Kinematics (IK) constraints.
 * 
 * It models:
 *   - Feet coordinates moving along an ellipsoidal gait profile (stance drag & swing raise)
 *   - Coronal pelvis swaying (tilting towards the stance leg to support the body weight)
 *   - Opposite arm swings using ARM-IK to reach balanced target coordinates
 * 
 * @param baseJoints The template resting pose joint structure of the model
 * @returns Array of KeyframeData populated with precise joint Euler rotations
 */
export function generateIKWalkCycle(baseJoints: JointNode[]): Record<string, [number, number, number]>[] {
  const maxFrames = 60;
  const frameIndices = [0, 15, 30, 45, 59];
  const generatedRotations: Record<string, [number, number, number]>[] = [];

  // 1. Dynamically locate key joint nodes to parse resting proportions
  const rootJoint = baseJoints.find(j => {
    const nameL = j.name.toLowerCase();
    const idL = j.id.toLowerCase();
    return idL.includes('pelvis') || idL.includes('hips') || idL.includes('root') || 
           nameL.includes('pelvis') || nameL.includes('hips') || nameL.includes('root');
  });

  const lFootJoint = baseJoints.find(j => j.id === 'l_foot') || 
                     baseJoints.find(j => j.id.toLowerCase().includes('l') && (j.id.toLowerCase().includes('foot') || j.id.toLowerCase().includes('ankle') || j.name.toLowerCase().includes('foot')));
  const rFootJoint = baseJoints.find(j => j.id === 'r_foot') || 
                     baseJoints.find(j => j.id.toLowerCase().includes('r') && (j.id.toLowerCase().includes('foot') || j.id.toLowerCase().includes('ankle') || j.name.toLowerCase().includes('foot')));

  const lHipJoint = baseJoints.find(j => j.id === 'l_hip') || 
                    baseJoints.find(j => j.id.toLowerCase().includes('l') && (j.id.toLowerCase().includes('hip') || j.id.toLowerCase().includes('thigh') || j.name.toLowerCase().includes('hip')));
  const rHipJoint = baseJoints.find(j => j.id === 'r_hip') || 
                    baseJoints.find(j => j.id.toLowerCase().includes('r') && (j.id.toLowerCase().includes('hip') || j.id.toLowerCase().includes('thigh') || j.name.toLowerCase().includes('hip')));

  const lShoulderJoint = baseJoints.find(j => j.id === 'l_shoulder') || 
                         baseJoints.find(j => j.id.toLowerCase().includes('l') && (j.id.toLowerCase().includes('shoulder') || j.name.toLowerCase().includes('shoulder')));
  const rShoulderJoint = baseJoints.find(j => j.id === 'r_shoulder') || 
                         baseJoints.find(j => j.id.toLowerCase().includes('r') && (j.id.toLowerCase().includes('shoulder') || j.name.toLowerCase().includes('shoulder')));

  const lElbowJoint = baseJoints.find(j => j.id === 'l_elbow') || 
                      baseJoints.find(j => j.id.toLowerCase().includes('l') && (j.id.toLowerCase().includes('elbow') || j.id.toLowerCase().includes('forearm') || j.id.toLowerCase().includes('hand') || j.name.toLowerCase().includes('elbow')));
  const rElbowJoint = baseJoints.find(j => j.id === 'r_elbow') || 
                      baseJoints.find(j => j.id.toLowerCase().includes('r') && (j.id.toLowerCase().includes('elbow') || j.id.toLowerCase().includes('forearm') || j.id.toLowerCase().includes('hand') || j.name.toLowerCase().includes('elbow')));

  // Helper to discover the actual parent-child path between two joints
  const findChainPath = (startId: string, endId: string): string[] => {
    const chain: string[] = [];
    let currentId: string | null = endId;
    const parentMap = new Map<string, string | null>();
    baseJoints.forEach(j => parentMap.set(j.id, j.parentId));

    const visited = new Set<string>();
    while (currentId && currentId !== startId && !visited.has(currentId)) {
      visited.add(currentId);
      chain.unshift(currentId);
      currentId = parentMap.get(currentId) || null;
    }
    if (currentId === startId) {
      chain.unshift(startId);
    }
    return chain;
  };

  // 2. Extract relative vertical and lateral dimensions
  let footY = -2.0;
  if (lFootJoint && rFootJoint) {
    footY = (lFootJoint.position[1] + rFootJoint.position[1]) / 2;
  } else if (lFootJoint) {
    footY = lFootJoint.position[1];
  } else if (rootJoint) {
    footY = rootJoint.position[1] - 2.0; // Estimate
  }

  let hipY = rootJoint ? rootJoint.position[1] : 0.0;
  if (lHipJoint && rHipJoint) {
    hipY = (lHipJoint.position[1] + rHipJoint.position[1]) / 2;
  }

  const legLength = Math.abs(hipY - footY);

  // Proportional stride parameters
  const strideLengthZ = legLength * 0.26; // Safe step depth within reach bounds (26%)
  const liftHeightY = legLength * 0.15;    // Comfort lift height (15%)
  const strideHeightY = footY;

  const leftFootX = lFootJoint ? lFootJoint.position[0] : -0.4;
  const rightFootX = rFootJoint ? rFootJoint.position[0] : 0.4;

  // Calculate arm base positions from T-pose (resting pose)
  // For T-pose models, shoulder is the reference point
  let shoulderY = hipY + (legLength * 0.5); // Shoulders typically halfway up torso
  if (lShoulderJoint) {
    shoulderY = lShoulderJoint.position[1];
  }

  // In T-pose, arms are extended to the side; calculate comfortable rest position
  // Use elbow position as reference for natural arm center in T-pose
  const leftArmX = lElbowJoint ? lElbowJoint.position[0] : -1.0;
  const rightArmX = rElbowJoint ? rElbowJoint.position[0] : 1.0;
  
  // For natural walking, elbows hang near hip level, not at T-pose shoulder height
  const armY = hipY + (legLength * 0.15);
  
  // Arm swing depth range clamped to [-0.2, 0.2] for natural gait
  const armSwingZ = 0.2;
  // Lateral arm swing in X axis - arms naturally swing closer to body during walk
  const armSwingX = Math.abs(leftArmX) * 0.35; // ~35% of T-pose extension

  // Find exact chain paths
  const leftLegChain = (lHipJoint && lFootJoint) ? findChainPath(lHipJoint.id, lFootJoint.id) : ['l_hip', 'l_knee', 'l_foot'];
  const rightLegChain = (rHipJoint && rFootJoint) ? findChainPath(rHipJoint.id, rFootJoint.id) : ['r_hip', 'r_knee', 'r_foot'];
  
  const leftArmChain = (lShoulderJoint && lElbowJoint) ? findChainPath(lShoulderJoint.id, lElbowJoint.id) : ['l_shoulder', 'l_elbow'];
  const rightArmChain = (rShoulderJoint && rElbowJoint) ? findChainPath(rShoulderJoint.id, rElbowJoint.id) : ['r_shoulder', 'r_elbow'];

  frameIndices.forEach((f) => {
    // Make deep copy of baseJoints with zeroed out rotations
    let currentPose: JointNode[] = baseJoints.map(j => ({
      ...j,
      rotation: [0, 0, 0] as [number, number, number]
    }));

    const phase = (f / maxFrames) * Math.PI * 2;
    const phaseL = phase;
    const phaseR = phase + Math.PI;

    // Left Foot trajectory
    let leftY = strideHeightY;
    let leftZ = -Math.cos(phaseL) * strideLengthZ;
    if (Math.sin(phaseL) > 0) {
      leftY += Math.sin(phaseL) * liftHeightY;
    }

    // Right Foot trajectory
    let rightY = strideHeightY;
    let rightZ = -Math.cos(phaseR) * strideLengthZ;
    if (Math.sin(phaseR) > 0) {
      rightY += Math.sin(phaseR) * liftHeightY;
    }

    // Weight sways and hips bobbing
    const hipBobY = -0.04 + Math.sin(phase * 2.0) * 0.03;
    const hipSwayX = Math.sin(phase) * 0.035;
    const hipTwistY = Math.cos(phase) * 0.06;

    // Apply root hips transform
    if (rootJoint) {
      currentPose = currentPose.map(j => {
        if (j.id === rootJoint.id) {
          return {
            ...j,
            rotation: [hipBobY, hipTwistY, hipSwayX] as [number, number, number]
          };
        }
        return j;
      });
    }

    // Solve Left Leg Leg-IK
    if (lFootJoint && leftLegChain.length > 1) {
      currentPose = solveCCDIK(
        currentPose,
        leftLegChain,
        lFootJoint.id,
        [leftFootX, leftY, leftZ],
        25
      );
    }

    // Solve Right Leg Leg-IK
    if (rFootJoint && rightLegChain.length > 1) {
      currentPose = solveCCDIK(
        currentPose,
        rightLegChain,
        rFootJoint.id,
        [rightFootX, rightY, rightZ],
        25
      );
    }

    // Arm swings balancing weight opposite to legs
    // Enhanced arm swing with natural height variation and forward/backward motion
    const leftArmZ = Math.cos(phaseL) * armSwingZ;
    const rightArmZ = Math.cos(phaseR) * armSwingZ;
    
    // Add height variation to arm swing - arms go up slightly when swinging forward
    // This creates a more natural walking motion with arm momentum
    const armHeightVariationL = Math.sin(phaseL) * 0.07;
    const armHeightVariationR = Math.sin(phaseR) * 0.07;
    
    const leftArmY = armY + armHeightVariationL;
    const rightArmY = armY + armHeightVariationR;
    
    // In walking, arms swing closer to the body (X axis)
    // T-pose arms are extended, but during walk they approach centerline
    const leftArmXSwing = leftArmX * (0.65 + Math.cos(phaseL) * 0.15); // 0.5-0.8 of T-pose width
    const rightArmXSwing = rightArmX * (0.65 + Math.cos(phaseR) * 0.15);

    // Solve Left Arm Arm-IK
    if (lElbowJoint && leftArmChain.length > 1) {
      currentPose = solveCCDIK(
        currentPose,
        leftArmChain,
        lElbowJoint.id,
        [leftArmXSwing, leftArmY, leftArmZ],
        18
      );
    }

    // Solve Right Arm Arm-IK
    if (rElbowJoint && rightArmChain.length > 1) {
      currentPose = solveCCDIK(
        currentPose,
        rightArmChain,
        rElbowJoint.id,
        [rightArmXSwing, rightArmY, rightArmZ],
        18
      );
    }
    
    // Add shoulder rotation to balance hip twist - opposite rotation creates natural counterbalance
    // This makes the upper body move opposite to the lower body, which is how humans naturally walk
    currentPose = currentPose.map(j => {
      const nameL = j.name.toLowerCase();
      const idL = j.id.toLowerCase();
      const isLShoulder = (idL === 'l_shoulder' || nameL.includes('l_shoulder')) && 
                          (idL.includes('shoulder') || nameL.includes('shoulder'));
      const isRShoulder = (idL === 'r_shoulder' || nameL.includes('r_shoulder')) && 
                          (idL.includes('shoulder') || nameL.includes('shoulder'));
      
      // Enhance elbow bend variation - elbows bend more when swinging forward, less when back
      const isLElbow = (idL === 'l_elbow' || nameL.includes('l_elbow')) && 
                       (idL.includes('elbow') || nameL.includes('elbow'));
      const isRElbow = (idL === 'r_elbow' || nameL.includes('r_elbow')) && 
                       (idL.includes('elbow') || nameL.includes('elbow'));
      
      if (isLShoulder) {
        // Blend CCD-IK rotation with subtle hip counter-rotation for natural upper body motion
        return {
          ...j,
          rotation: [
            j.rotation[0] + 0.01,
            j.rotation[1] + hipTwistY * 0.45,
            j.rotation[2] - hipSwayX * 0.35
          ] as [number, number, number]
        };
      }
      if (isRShoulder) {
        return {
          ...j,
          rotation: [
            j.rotation[0] + 0.01,
            j.rotation[1] + hipTwistY * 0.45,
            j.rotation[2] + hipSwayX * 0.35
          ] as [number, number, number]
        };
      }
      
      // Add natural elbow bend variations - more flexion during forward swing
      if (isLElbow) {
        const elbowBendL = Math.abs(Math.sin(phaseL)) * 0.25; // Varies between 0 and 0.25 radians
        return {
          ...j,
          rotation: [
            Math.max(0.15, j.rotation[0] + elbowBendL),
            j.rotation[1],
            j.rotation[2]
          ] as [number, number, number]
        };
      }
      if (isRElbow) {
        const elbowBendR = Math.abs(Math.sin(phaseR)) * 0.25; // Varies between 0 and 0.25 radians
        return {
          ...j,
          rotation: [
            Math.max(0.15, j.rotation[0] + elbowBendR),
            j.rotation[1],
            j.rotation[2]
          ] as [number, number, number]
        };
      }
      
      return j;
    });

    // Apply neck & spine stabilizing twists opposite to hip action
    currentPose = currentPose.map(j => {
      const nameL = j.name.toLowerCase();
      const idL = j.id.toLowerCase();
      const isSpine = idL.includes('spine') || idL.includes('chest') || nameL.includes('spine') || nameL.includes('chest');
      const isNeck = idL.includes('neck') || idL.includes('head') || nameL.includes('neck') || nameL.includes('head');

      if (isSpine) {
        return {
          ...j,
          rotation: [0.02, -hipTwistY * 0.82, -hipSwayX * 0.65] as [number, number, number]
        };
      }
      if (isNeck) {
        return {
          ...j,
          rotation: [0.01, -hipTwistY * 0.12, 0] as [number, number, number]
        };
      }
      return j;
    });

    // Save outputs
    const rotationsMap: Record<string, [number, number, number]> = {};
    currentPose.forEach((joint) => {
      rotationsMap[joint.id] = [...joint.rotation] as [number, number, number];
    });
    generatedRotations.push(rotationsMap);
  });

  return generatedRotations;
}

