import { JointNode } from '../types';

/**
 * Calculates the shortest distance from a point P to a line segment AB.
 */
function distanceToSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): { distance: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq === 0) {
    const vx = px - ax;
    const vy = py - ay;
    const vz = pz - az;
    return { distance: Math.sqrt(vx * vx + vy * vy + vz * vz), t: 0 };
  }

  // Projection scalar t
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const cz = az + t * dz;

  const vx = px - cx;
  const vy = py - cy;
  const vz = pz - cz;

  return {
    distance: Math.sqrt(vx * vx + vy * vy + vz * vz),
    t: t
  };
}

/**
 * Checks if a skeletal bone is anatomically allowed to influence a vertex at coordinate (px, py, pz).
 * This eliminates left-right weight bleeding and armpit/crotch diagonal stretching on humanoid geometries.
 * Dynamically scaled via model bounding box metrics to support arbitrary coordinate spaces.
 */
function isBoneAllowedForVertex(
  joint: JointNode,
  px: number,
  py: number,
  pz: number,
  centerX: number = 0,
  shoulderSpan: number = 1.2,
  torsoHeight: number = 1.6,
  pelvisY: number = 0,
  neckY: number = 1.6
): boolean {
  const nameL = (joint.id + " " + joint.name).toLowerCase();
  
  // 1. Extreme Left/Right separation
  const isLeft = nameL.includes('l_') || nameL.includes('left');
  const isRight = nameL.includes('r_') || nameL.includes('right');
  
  // Symmetrical barrier cushion (4% of shoulder width)
  const margin = shoulderSpan * 0.04;
  if (isLeft && px > centerX + margin) {
    return false;
  }
  if (isRight && px < centerX - margin) {
    return false;
  }
  
  // 2. Neck & Head should only influence top vertices above hip level
  if (nameL.includes('neck') || nameL.includes('head')) {
    const minYLimit = pelvisY + torsoHeight * 0.3; // Can't touch hip/leg regions
    if (py < minYLimit) return false;
  }
  
  // 3. Torso bones (Spine, Pelvis, Root, Chest) vs Arms and Legs
  const isSpine = nameL.includes('spine') || nameL.includes('chest') || nameL.includes('torso');
  if (isSpine) {
    // Spine shouldn't reach outer arms or lower legs
    const maxReachX = shoulderSpan * 0.7; // Outer arms start far out
    if (Math.abs(px - centerX) > maxReachX) return false; 
    
    const minReachY = pelvisY - torsoHeight * 0.75;
    if (py < minReachY) return false;
  }
  
  const isPelvis = nameL.includes('pelvis') || nameL.includes('root');
  if (isPelvis) {
    // Pelvis/Root shouldn't reach elbow/head areas
    const maxReachX = shoulderSpan * 0.7;
    if (Math.abs(px - centerX) > maxReachX) return false;
    
    const maxReachY = neckY + torsoHeight * 0.1;
    if (py > maxReachY) return false;
  }
  
  // 4. Arm bones (shoulder, elbow, hand, wrist, arm) shouldn't bleed into pelvis or lower legs
  const isArm = nameL.includes('shoulder') || nameL.includes('elbow') || nameL.includes('wrist') || nameL.includes('arm') || nameL.includes('hand');
  if (isArm) {
    // Shoulders/elbows shouldn't reach chest core unless outside shoulder limit, or reach legs
    const coreRange = shoulderSpan * 0.22;
    if (Math.abs(px - centerX) < coreRange && py < neckY) return false; 
    if (py < pelvisY - torsoHeight * 0.1) return false; // Legs/thighs are off limits
  }
  
  // 5. Elbow / Wrist / Hand should be even more localized (outer arm)
  const isLowerArm = nameL.includes('elbow') || nameL.includes('wrist') || nameL.includes('hand');
  if (isLowerArm) {
    const armRange = shoulderSpan * 0.42;
    if (Math.abs(px - centerX) < armRange) return false; 
  }
  
  // 6. Leg bones (hip, knee, foot, leg) shouldn't reach shoulder or chest
  const isLeg = nameL.includes('hip') || nameL.includes('knee') || nameL.includes('foot') || nameL.includes('leg') || nameL.includes('ankle');
  if (isLeg) {
    const maxLegY = pelvisY + torsoHeight * 0.25; // Stop legs from bleeding into upper chest
    if (py > maxLegY) return false;
  }
  
  // 7. Lower leg / foot (knee, ankle, foot) shouldn't reach pelvis
  const isLowerLeg = nameL.includes('knee') || nameL.includes('foot') || nameL.includes('ankle');
  if (isLowerLeg) {
    const maxLowerLegY = pelvisY - torsoHeight * 0.15;
    if (py > maxLowerLegY) return false;
  }

  return true;
}

/**
 * Automatically computes skin indices and weights for vertices based on a bone hierarchy.
 * Incorporates:
 *   - Spatial scale-invariant metrics parsed dynamically from skeletal constraints.
 *   - Genuine bone segment mappings (segment from parent -> joint belongs to the parent joint's coordinate space).
 *   - Leaf bone virtual endpoint projection (gives leaf bones physical extent segments).
 *   - High-dimensional topological neighbors list centered dynamically.
 *   - BFS manifold geodesic wave propagation logic to prevent cross-limb dragging.
 *   - Multi-pass (14 iterations) Laplacian weight smoothing to ensure organic joint visual bends.
 */
export function calculateAutoWeights(
  vertexPositions: Float32Array,
  joints: JointNode[],
  indices: Uint16Array | Uint32Array | null = null
): { skinIndices: Float32Array; skinWeights: Float32Array } {
  const vertexCount = vertexPositions.length / 3;
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  if (joints.length === 0) {
    return { skinIndices, skinWeights };
  }

  // Create a map from joint ID to index in the array
  const jointMap = new Map<string, number>();
  joints.forEach((j, idx) => jointMap.set(j.id, idx));

  // Determine if this is a standard humanoid rig (has torso/limb bones)
  const hasHumanoidBones = joints.some(j => {
    const name = j.name.toLowerCase();
    return name.includes('shoulder') || name.includes('elbow') || name.includes('hip') || name.includes('knee');
  });

  // Find key joint positions dynamically for scale and position-invariant anatomical clamping
  const pelvisJoint = joints.find(j => j.id === 'root' || j.name.toLowerCase().includes('pelvis'));
  const neckJoint = joints.find(j => j.id === 'neck' || j.name.toLowerCase().includes('neck') || j.name.toLowerCase().includes('head'));
  const lShoulder = joints.find(j => j.name.toLowerCase().includes('l_shoulder') || j.name.toLowerCase().includes('left_shoulder') || j.id.includes('l_shoulder'));
  const rShoulder = joints.find(j => j.name.toLowerCase().includes('r_shoulder') || j.name.toLowerCase().includes('right_shoulder') || j.id.includes('r_shoulder'));
  
  const lHip = joints.find(j => j.name.toLowerCase().includes('l_hip') || j.name.toLowerCase().includes('left_hip') || j.id.includes('l_hip'));
  const rHip = joints.find(j => j.name.toLowerCase().includes('r_hip') || j.name.toLowerCase().includes('right_hip') || j.id.includes('r_hip'));

  let centerX = 0;
  if (lShoulder && rShoulder) {
    centerX = (lShoulder.position[0] + rShoulder.position[0]) / 2;
  } else if (lHip && rHip) {
    centerX = (lHip.position[0] + rHip.position[0]) / 2;
  }

  // Width between shoulders (determines arm span scale)
  let shoulderSpan = 1.2;
  if (lShoulder && rShoulder) {
    shoulderSpan = Math.abs(lShoulder.position[0] - rShoulder.position[0]);
  } else if (lHip && rHip) {
    shoulderSpan = Math.abs(lHip.position[0] - rHip.position[0]) * 2.0;
  }

  // Torso Height (pelvis to neck)
  let torsoHeight = 1.6;
  if (pelvisJoint && neckJoint) {
    torsoHeight = Math.abs(neckJoint.position[1] - pelvisJoint.position[1]);
  } else {
    // Fallback: Find max and min height of skeleton
    let minYAxis = Infinity, maxYAxis = -Infinity;
    joints.forEach(j => {
      minYAxis = Math.min(minYAxis, j.position[1]);
      maxYAxis = Math.max(maxYAxis, j.position[1]);
    });
    if (maxYAxis > minYAxis) {
      torsoHeight = maxYAxis - minYAxis;
    }
  }

  const pelvisY = pelvisJoint ? pelvisJoint.position[1] : 0;
  const neckY = neckJoint ? neckJoint.position[1] : (pelvisY + torsoHeight);

  // Define bone segments
  // A segment from joint A to child joint B represents the physical bone body of joint A.
  // Hence, it is controlled by A (A's joint index).
  // If a joint has no children (leaf joint), we extend a virtual child segment along its parent's direction.
  const segments: Array<{
    jointId: string;
    jointName: string;
    jointIndex: number;
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    hasParent: boolean;
  }> = [];

  joints.forEach((j, idx) => {
    // Find children of this joint
    const children = joints.filter(c => c.parentId === j.id);
    
    if (children.length > 0) {
      // For each child, create a segment from j to child, controlled by j (jointIndex = idx)
      children.forEach(child => {
        segments.push({
          jointId: j.id,
          jointName: j.name,
          jointIndex: idx,
          ax: j.position[0],
          ay: j.position[1],
          az: j.position[2],
          bx: child.position[0],
          by: child.position[1],
          bz: child.position[2],
          hasParent: j.parentId !== null
        });
      });
    } else {
      // Leaf joint: no children! We create a virtual child segment corresponding to this end bone region.
      // Direction is usually parent -> j.
      const parent = j.parentId ? joints.find(p => p.id === j.parentId) : null;
      let vx = 0;
      let vy = torsoHeight * 0.25; // default up extension
      let vz = 0;
      
      if (parent) {
        const dx = j.position[0] - parent.position[0];
        const dy = j.position[1] - parent.position[1];
        const dz = j.position[2] - parent.position[2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
          // extend by 75% of parent bone length
          vx = (dx / len) * (len * 0.75);
          vy = (dy / len) * (len * 0.75);
          vz = (dz / len) * (len * 0.75);
        }
      } else {
        // Isolated root
        if (hasHumanoidBones) {
          vy = torsoHeight * 0.2;
        }
      }

      segments.push({
        jointId: j.id,
        jointName: j.name,
        jointIndex: idx,
        ax: j.position[0],
        ay: j.position[1],
        az: j.position[2],
        bx: j.position[0] + vx,
        by: j.position[1] + vy,
        bz: j.position[2] + vz,
        hasParent: parent !== null
      });
    }
  });

  // Construct adjacency (neighbors) list
  const neighbors = Array.from({ length: vertexCount }, () => new Set<number>());

  // 1. Build topological neighbors from faces (triangles).
  // Even if the mesh is non-indexed, every 3 consecutive vertices represent a face.
  for (let i = 0; i < vertexCount; i += 3) {
    if (i + 2 < vertexCount) {
      const a = i;
      const b = i + 1;
      const c = i + 2;

      const ax = vertexPositions[a * 3];
      const bx = vertexPositions[b * 3];
      const cx = vertexPositions[c * 3];

      // Cross-sagittal barrier protection: do not connect left and right limb halves topological boundaries
      const cLim = 0.04 * shoulderSpan;
      const skipAB = ((ax - centerX) < -cLim && (bx - centerX) > cLim) || ((ax - centerX) > cLim && (bx - centerX) < -cLim);
      const skipBC = ((bx - centerX) < -cLim && (cx - centerX) > cLim) || ((bx - centerX) > cLim && (cx - centerX) < -cLim);
      const skipCA = ((cx - centerX) < -cLim && (ax - centerX) > cLim) || ((cx - centerX) > cLim && (ax - centerX) < -cLim);

      if (!skipAB) { neighbors[a].add(b); neighbors[b].add(a); }
      if (!skipBC) { neighbors[b].add(c); neighbors[c].add(b); }
      if (!skipCA) { neighbors[c].add(a); neighbors[a].add(c); }
    }
  }

  // 2. Spatial Grid Hashing Buckets for high-speed vertex coordinate welding.
  // Duplicated coordinates are welded to maintain topological mesh continuity!
  const bucketSize = 0.01 * (torsoHeight / 1.6); // scale-dependent buckets (approx 1cm)
  const grid = new Map<string, number[]>();

  for (let i = 0; i < vertexCount; i++) {
    const px = vertexPositions[i * 3];
    const py = vertexPositions[i * 3 + 1];
    const pz = vertexPositions[i * 3 + 2];

    const bx = Math.floor(px / bucketSize);
    const by = Math.floor(py / bucketSize);
    const bz = Math.floor(pz / bucketSize);
    const key = `${bx}_${by}_${bz}`;

    let list = grid.get(key);
    if (!list) {
      list = [];
      grid.set(key, list);
    }
    list.push(i);
  }

  // Weld vertices within tolerance to merge separate faces smoothly, keeping sagittal midline division
  const weldLimit = 0.004 * (torsoHeight / 1.6); // 4mm scaled limit
  for (let i = 0; i < vertexCount; i++) {
    const px = vertexPositions[i * 3];
    const py = vertexPositions[i * 3 + 1];
    const pz = vertexPositions[i * 3 + 2];

    const bx = Math.floor(px / bucketSize);
    const by = Math.floor(py / bucketSize);
    const bz = Math.floor(pz / bucketSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = `${bx + dx}_${by + dy}_${bz + dz}`;
          const bucket = grid.get(nKey);
          if (!bucket) continue;

          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (i === j) continue;

            const qx = vertexPositions[j * 3];
            const qy = vertexPositions[j * 3 + 1];
            const qz = vertexPositions[j * 3 + 2];

            // Strict cross-sagittal filter for limbs separation
            const margin = shoulderSpan * 0.04;
            const pxRel = px - centerX;
            const qxRel = qx - centerX;
            if ((pxRel < -margin && qxRel > margin) || (pxRel > margin && qxRel < -margin)) {
              continue;
            }

            const distSq = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
            if (distSq < weldLimit ** 2) {
              neighbors[i].add(j);
              neighbors[j].add(i);
            }
          }
        }
      }
    }
  }

  // 3. Find Bone Surface Seeds
  // For each joint, find the closest mesh vertices which will act as wave propagation seeds
  const jointSeeds: number[][] = Array.from({ length: joints.length }, () => []);
  const vertexDistancesToBones = Array.from({ length: vertexCount }, () => new Float32Array(joints.length));

  // Initialize vertex distances to bones with Infinity
  for (let i = 0; i < vertexCount; i++) {
    vertexDistancesToBones[i].fill(Infinity);
  }

  // Calculate distance to all bones by taking the minimum distance to any of its segments
  for (let i = 0; i < vertexCount; i++) {
    const px = vertexPositions[i * 3];
    const py = vertexPositions[i * 3 + 1];
    const pz = vertexPositions[i * 3 + 2];

    segments.forEach((seg) => {
      const idx = seg.jointIndex;
      const d = distanceToSegment(px, py, pz, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz).distance;
      if (d < vertexDistancesToBones[i][idx]) {
        vertexDistancesToBones[i][idx] = d;
      }
    });

    let minD = Infinity;
    let closestJ = -1;

    for (let j = 0; j < joints.length; j++) {
      let d = vertexDistancesToBones[i][j];

      // Filter seed candidates via anatomical locks to prevent early bad bindings (e.g. foot seed on hip)
      if (hasHumanoidBones && !isBoneAllowedForVertex(joints[j], px, py, pz, centerX, shoulderSpan, torsoHeight, pelvisY, neckY)) {
        d = 9999.0;
      }

      if (d < minD) {
        minD = d;
        closestJ = j;
      }
    }

    // If vertex is close to its best bone, map it as a topological seed for that bone
    if (closestJ !== -1 && minD < 0.35 * torsoHeight) {
      jointSeeds[closestJ].push(i);
    }
  }

  // Safety fallback: Ensure every joint has at least 1 seed vertex
  for (let j = 0; j < joints.length; j++) {
    if (jointSeeds[j].length === 0) {
      let minD = Infinity;
      let closestV = -1;
      for (let i = 0; i < vertexCount; i++) {
        const d = vertexDistancesToBones[i][j];
        if (d < minD) {
          minD = d;
          closestV = i;
        }
      }
      if (closestV !== -1) {
        jointSeeds[j].push(closestV);
      }
    }
  }

  // 4. Run Multi-Source Shortest Path BFS wave propagation for all joints.
  // Calculates real manifold geodesic hop count from every vertex to every bone!
  const topoDist = Array.from({ length: vertexCount }, () => new Uint16Array(joints.length).fill(9999));

  for (let j = 0; j < joints.length; j++) {
    const queue: number[] = [];
    const seeds = jointSeeds[j];

    seeds.forEach((vIdx) => {
      topoDist[vIdx][j] = 0;
      queue.push(vIdx);
    });

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const d = topoDist[u][j];
      const nextD = d + 1;

      neighbors[u].forEach((v) => {
        if (topoDist[v][j] > nextD) {
          topoDist[v][j] = nextD;
          queue.push(v);
        }
      });
    }
  }

  // 5. Integrate Euclidean Proximity and Geodesic Hop Constraints to form Skinned Weights
  const initialWeights = Array.from({ length: vertexCount }, () => new Float32Array(joints.length));

  for (let i = 0; i < vertexCount; i++) {
    const px = vertexPositions[i * 3];
    const py = vertexPositions[i * 3 + 1];
    const pz = vertexPositions[i * 3 + 2];

    // Check if vertex has any finite topological path to any bone
    let hasTopologicalPath = false;
    for (let j = 0; j < joints.length; j++) {
      if (topoDist[i][j] < 9999) {
        hasTopologicalPath = true;
        break;
      }
    }

    const rawWeights = new Float32Array(joints.length);
    let totalW = 0;

    for (let j = 0; j < joints.length; j++) {
      const dEuc = vertexDistancesToBones[i][j];

      if (hasTopologicalPath) {
        const dTopo = topoDist[i][j];
        if (dTopo >= 9999) {
          // If a topological path exists to other bones, but NOT to this bone, set weight to EXACTLY 0.
          // This completely solves left/right cross dragging and leg-to-leg tearing!
          rawWeights[j] = 0.0;
        } else {
          // High-power drop-off combining Euclidean distance and Topological geodesic hop distance.
          // Extremely close hops get highly boosted; distant manifold branches are heavily penalized.
          const w = 1.0 / (Math.pow(dEuc, 2.8) * (1.0 + 5.0 * Math.pow(dTopo, 2)) + 0.001);
          rawWeights[j] = w;
          totalW += w;
        }
      } else {
        // Fallback for isolated disconnected components (e.g. separate shoes or eyeballs)
        // Checks anatomical coordinates directly
        if (hasHumanoidBones && !isBoneAllowedForVertex(joints[j], px, py, pz, centerX, shoulderSpan, torsoHeight, pelvisY, neckY)) {
          rawWeights[j] = 0.0;
        } else {
          const w = 1.0 / (Math.pow(dEuc, 3.5) + 0.01);
          rawWeights[j] = w;
          totalW += w;
        }
      }
    }

    for (let j = 0; j < joints.length; j++) {
      initialWeights[i][j] = totalW > 0 ? rawWeights[j] / totalW : 0;
    }
  }

  // 6. 14-Pass Laplacian Smooth Filter
  // Blends weight matrices with topologically adjacent neighbors to produce smooth, organic joint regions
  let currentWeights = initialWeights;
  const blendFactor = 0.50; // 50% neighbors, 50% original self
  const smoothPasses = 14;

  for (let iter = 0; iter < smoothPasses; iter++) {
    const nextWeights = Array.from({ length: vertexCount }, () => new Float32Array(joints.length));
    for (let i = 0; i < vertexCount; i++) {
      const px = vertexPositions[i * 3];
      const py = vertexPositions[i * 3 + 1];
      const pz = vertexPositions[i * 3 + 2];

      const selfW = currentWeights[i];
      const adj = neighbors[i];

      if (adj.size === 0) {
        nextWeights[i].set(selfW);
        continue;
      }

      const neighborSum = new Float32Array(joints.length);
      adj.forEach((nbIdx) => {
        const nbW = currentWeights[nbIdx];
        for (let j = 0; j < joints.length; j++) {
          neighborSum[j] += nbW[j];
        }
      });

      for (let j = 0; j < joints.length; j++) {
        // Enforce anatomical rules at every smoothing pass to prevent smoothed weight leakage
        if (hasHumanoidBones && !isBoneAllowedForVertex(joints[j], px, py, pz, centerX, shoulderSpan, torsoHeight, pelvisY, neckY)) {
          nextWeights[i][j] = 0;
        } else {
          nextWeights[i][j] = (1.0 - blendFactor) * selfW[j] + blendFactor * (neighborSum[j] / adj.size);
        }
      }
    }
    currentWeights = nextWeights;
  }

  // Assemble final top-4 skin indices & skin weights
  for (let i = 0; i < vertexCount; i++) {
    const finalWeight = currentWeights[i];
    
    // Normalize weights to guarantee they add up to exactly 1.0
    let finalSum = 0;
    for (let j = 0; j < joints.length; j++) {
      finalSum += finalWeight[j];
    }
    
    if (finalSum > 0) {
      for (let j = 0; j < joints.length; j++) {
        finalWeight[j] /= finalSum;
      }
    } else {
      finalWeight[0] = 1.0;
    }

    const entries: { idx: number; w: number }[] = [];
    for (let j = 0; j < joints.length; j++) {
      if (finalWeight[j] > 0.001) {
        entries.push({ idx: j, w: finalWeight[j] });
      }
    }

    if (entries.length === 0) {
      entries.push({ idx: 0, w: 1.0 });
    }

    entries.sort((a, b) => b.w - a.w);

    const top4 = entries.slice(0, 4);
    const sum = top4.reduce((acc, entry) => acc + entry.w, 0);

    const idxOffset = i * 4;
    for (let j = 0; j < 4; j++) {
      if (j < top4.length) {
        skinIndices[idxOffset + j] = top4[j].idx;
        skinWeights[idxOffset + j] = sum > 0 ? top4[j].w / sum : (j === 0 ? 1.0 : 0.0);
      } else {
        skinIndices[idxOffset + j] = 0;
        skinWeights[idxOffset + j] = 0.0;
      }
    }
  }

  return { skinIndices, skinWeights };
}

/**
 * Generates default skeletal bones for a variety of presets
 */
export function getPresetSkeletons(type: 'cylinder' | 'capsule' | 'humanoid' | 'box'): JointNode[] {
  switch (type) {
    case 'cylinder':
      return [
        { id: 'bone_0', name: 'Root Base', parentId: null, position: [0, -2, 0], rotation: [0, 0, 0] },
        { id: 'bone_1', name: 'Middle Joint', parentId: 'bone_0', position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'bone_2', name: 'Top Joint', parentId: 'bone_1', position: [0, 2, 0], rotation: [0, 0, 0] }
      ];

    case 'capsule':
      return [
        { id: 'bone_0', name: 'Base Joint', parentId: null, position: [0, -1.5, 0], rotation: [0, 0, 0] },
        { id: 'bone_1', name: 'Mid Joint', parentId: 'bone_0', position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'bone_2', name: 'Top Tip', parentId: 'bone_1', position: [0, 1.5, 0], rotation: [0, 0, 0] }
      ];

    case 'humanoid':
      return [
        { id: 'root', name: 'Pelvis (Root)', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'spine', name: 'Spine', parentId: 'root', position: [0, 0.8, 0], rotation: [0, 0, 0] },
        { id: 'neck', name: 'Neck & Head', parentId: 'spine', position: [0, 1.6, 0], rotation: [0, 0, 0] },
        
        // Left Arm
        { id: 'l_shoulder', name: 'Left Shoulder', parentId: 'spine', position: [-0.6, 1.3, 0], rotation: [0, 0, 0] },
        { id: 'l_elbow', name: 'Left Elbow', parentId: 'l_shoulder', position: [-1.4, 1.3, 0], rotation: [0, 0, 0] },
        
        // Right Arm
        { id: 'r_shoulder', name: 'Right Shoulder', parentId: 'spine', position: [0.6, 1.3, 0], rotation: [0, 0, 0] },
        { id: 'r_elbow', name: 'Right Elbow', parentId: 'r_shoulder', position: [1.4, 1.3, 0], rotation: [0, 0, 0] },

        // Left Leg
        { id: 'l_hip', name: 'Left Hip', parentId: 'root', position: [-0.4, -0.4, 0], rotation: [0, 0, 0] },
        { id: 'l_knee', name: 'Left Knee', parentId: 'l_hip', position: [-0.4, -1.2, 0], rotation: [0, 0, 0] },
        { id: 'l_foot', name: 'Left Foot', parentId: 'l_knee', position: [-0.4, -2.0, 0], rotation: [0, 0, 0] },

        // Right Leg
        { id: 'r_hip', name: 'Right Hip', parentId: 'root', position: [0.4, -0.4, 0], rotation: [0, 0, 0] },
        { id: 'r_knee', name: 'Right Knee', parentId: 'r_hip', position: [0.4, -1.2, 0], rotation: [0, 0, 0] },
        { id: 'r_foot', name: 'Right Foot', parentId: 'r_knee', position: [0.4, -2.0, 0], rotation: [0, 0, 0] }
      ];

    case 'box':
    default:
      return [
        { id: 'bone_0', name: 'Root Hub', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'bone_1', name: 'Extension Upper', parentId: 'bone_0', position: [0, 1, 0], rotation: [0, 0, 0] }
      ];
  }
}
