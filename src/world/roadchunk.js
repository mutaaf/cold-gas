// The endless road's chunks, built where the tiles are (the terrain worker), so the main thread
// never spends a frame on them. The geometry is Free Drive's own (src/render/road.js: ribbon and
// paint, verges, walls and parapets, bridge decks and piers, rails and posts, delineators); here it
// is built against stand-in materials, flattened to typed arrays, and rebuilt on the main thread
// around the real materials (`chunkFromData`).
import * as THREE from 'three';
import { buildRoadChunk, CHUNK, POST_GEO, DELINEATOR_GEO, POLE_GEO } from '../render/road.js';
import { groundAt } from '../sim/roads.js';
import { colourAt } from './tilegen.js';

export { CHUNK };
const NAMES = ['terrain', 'road', 'wall', 'steel', 'prop'];

// Per-sample tangent and curve radius for a growing road (what road.js's chunks read as P).
function createPrep(road) {
  const P = { tx: new Float32Array(1024), tz: new Float32Array(1024), R: new Float32Array(1024), n: 0 };
  return function prep(upTo) {
    if (P.tx.length < upTo + 4) {
      let cap = P.tx.length;
      while (cap < upTo + 4) cap *= 2;
      for (const k of ['tx', 'tz', 'R']) { const a = new Float32Array(cap); a.set(P[k]); P[k] = a; }
    }
    for (let i = P.n; i < upTo; i++) {
      const a = Math.max(0, i - 1), b = Math.min(road.n - 1, i + 1);
      const ex = road.x[b] - road.x[a], ez = road.z[b] - road.z[a], l = Math.hypot(ex, ez) || 1;
      P.tx[i] = ex / l; P.tz[i] = ez / l;
    }
    for (let i = Math.max(2, P.n - 2); i < upTo - 2; i++) {
      const a = i - 2, b = i + 2;
      const turn = Math.abs(Math.atan2(P.tx[a] * P.tz[b] - P.tz[a] * P.tx[b], P.tx[a] * P.tx[b] + P.tz[a] * P.tz[b]));
      P.R[i] = turn > 1e-4 ? (4 * road.meta.spacing) / turn : 1e5;
    }
    if (P.n === 0) { P.R[0] = 1e5; P.R[1] = 1e5; }
    P.n = Math.max(P.n, upTo);
    return P;
  };
}

// The worker side: build chunk c of the seed's road, as transferable arrays.
export function createChunkBuilder(gen, tier) {
  const { road } = gen;
  const prep = createPrep(road);
  const mats = Object.fromEntries(NAMES.map((n) => { const m = new THREE.MeshBasicMaterial(); m.name = n; return [n, m]; }));
  const geoKey = new Map([[POST_GEO(), 'post'], [DELINEATOR_GEO(), 'delineator'], [POLE_GEO(), 'pole']]);
  const g3 = [0, 0, 0], h3 = [0, 0, 0], cc = [0, 0, 0];
  const H = (x, z) => groundAt(road, x, road.dem(x, z, h3)[0], z, g3)[0];
  return function build(c) {
    const t0 = performance.now();
    road.generate((c + 1) * CHUNK + 8);
    const P = prep((c + 1) * CHUNK + 6);
    const g = buildRoadChunk(road, P, c, mats, H, null, tier);
    const meshes = [], transfer = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry, attrs = [];
      if (o.isInstancedMesh) {
        const m = o.instanceMatrix.array.slice(0, o.count * 16);
        transfer.push(m.buffer);
        meshes.push({ mat: o.material.name, geo: geoKey.get(geo), instances: m, count: o.count, receive: o.receiveShadow });
        return;
      }
      // The verges draw with the terrain's material: give them its colours (and no sea depth).
      if (o.material.name === 'terrain') {
        const p = geo.attributes.position, n = geo.attributes.normal, col = new Uint8Array(p.count * 4);
        for (let k = 0; k < p.count; k++) {
          colourAt(gen, p.getX(k) + g.position.x, p.getZ(k) + g.position.z, p.getY(k), 1 - n.getY(k), cc);
          col[k * 4] = Math.round(Math.min(1, cc[0]) * 255); col[k * 4 + 1] = Math.round(Math.min(1, cc[1]) * 255); col[k * 4 + 2] = Math.round(Math.min(1, cc[2]) * 255); col[k * 4 + 3] = 200;
        }
        geo.deleteAttribute('aDepth');
        geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4, true));
        geo.setAttribute('aDepth', new THREE.BufferAttribute(new Int8Array(p.count), 1, true));
      }
      for (const [name, a] of Object.entries(geo.attributes)) {
        const arr = a.array instanceof Float64Array ? new Float32Array(a.array) : a.array;
        attrs.push({ name, array: arr, itemSize: a.itemSize, normalized: a.normalized });
        transfer.push(arr.buffer);
      }
      const index = geo.index ? (geo.attributes.position.count < 65536 ? Uint16Array.from(geo.index.array) : Uint32Array.from(geo.index.array)) : null;
      if (index) transfer.push(index.buffer);
      meshes.push({ mat: o.material.name, attrs, index, receive: o.receiveShadow });
    });
    return { c, x: g.position.x, z: g.position.z, meshes, ms: performance.now() - t0, transfer };
  };
}

// The main-thread side: the chunk as a group, with the real materials and the shared prop meshes.
const SHARED = { post: POST_GEO, delineator: DELINEATOR_GEO, pole: POLE_GEO };
export function chunkFromData(d, mats) {
  const g = new THREE.Group();
  g.position.set(d.x, 0, d.z);
  let bytes = 0;
  for (const m of d.meshes) {
    let mesh;
    if (m.instances) {
      mesh = new THREE.InstancedMesh(SHARED[m.geo](), mats[m.mat], m.count);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m.instances, 16);
      mesh.computeBoundingSphere();
      bytes += m.instances.byteLength;
    } else {
      const geo = new THREE.BufferGeometry();
      for (const a of m.attrs) { geo.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized)); bytes += a.array.byteLength; }
      if (m.index) { geo.setIndex(new THREE.BufferAttribute(m.index, 1)); bytes += m.index.byteLength; }
      geo.computeBoundingSphere();
      mesh = new THREE.Mesh(geo, mats[m.mat]);
    }
    mesh.receiveShadow = m.receive;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    g.add(mesh);
  }
  g.updateMatrix();
  g.userData.bytes = bytes;
  return g;
}
