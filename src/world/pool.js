// A pool of instances for one prop (a tree, a shrub, a rock): one InstancedMesh, one draw call,
// shared by every tile. A tile takes a contiguous block, writes its matrices and colours into it,
// and gives it back when the tile goes (the block is zeroed: a zero-scale instance draws nothing).
import * as THREE from 'three';

export function createPool(geo, mat, capacity, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;          // it spans the world; each instance is cheap
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.array.fill(0);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.matrixAutoUpdate = false;
  let free = [[0, capacity]];          // [start, length], sorted by start
  let used = 0, overflow = 0;
  const M = mesh.instanceMatrix, C = mesh.instanceColor;

  function alloc(n) {
    for (let k = 0; k < free.length; k++) {
      const [s, l] = free[k];
      if (l < n) continue;
      if (l === n) free.splice(k, 1); else free[k] = [s + n, l - n];
      used += n;
      if (s + n > mesh.count) mesh.count = s + n;
      return s;
    }
    overflow += n;
    return -1;
  }
  function release(s, n) {
    M.array.fill(0, s * 16, (s + n) * 16);
    M.addUpdateRange(s * 16, n * 16); M.needsUpdate = true;
    used -= n;
    // Insert and merge.
    let k = 0;
    while (k < free.length && free[k][0] < s) k++;
    free.splice(k, 0, [s, n]);
    if (k + 1 < free.length && free[k][0] + free[k][1] === free[k + 1][0]) { free[k][1] += free[k + 1][1]; free.splice(k + 1, 1); }
    if (k > 0 && free[k - 1][0] + free[k - 1][1] === free[k][0]) { free[k - 1][1] += free[k][1]; free.splice(k, 1); }
    // Shrink the drawn range past a free tail.
    const last = free[free.length - 1];
    if (last && last[0] + last[1] === capacity && last[0] < mesh.count) mesh.count = last[0];
  }
  // Write n instances (matrices local to (ox, oz)) into a new block; returns the block or null.
  function add(m, c, n, ox, oz) {
    const s = alloc(n);
    if (s < 0) return null;
    const a = M.array;
    a.set(m, s * 16);
    for (let k = 0; k < n; k++) { a[(s + k) * 16 + 12] += ox; a[(s + k) * 16 + 14] += oz; }
    C.array.set(c, s * 3);
    M.addUpdateRange(s * 16, n * 16); M.needsUpdate = true;
    C.addUpdateRange(s * 3, n * 3); C.needsUpdate = true;
    return { s, n };
  }
  return {
    mesh, add, release: (b) => b && release(b.s, b.n),
    stats: () => ({ used, capacity, drawn: mesh.count, overflow }),
    bytes: capacity * 19 * 4,
    dispose() { mesh.dispose(); },
  };
}
