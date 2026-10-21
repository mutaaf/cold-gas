// Free Drive's world: a real road and the land around it, streamed around the camera.
//
//   terrain   three levels: 128 m tiles on 4 m posts within ≈400 m, 512 m tiles on 16 m posts
//             within ≈2.6 km, and one 128 m mesh over the whole ±18 km DEM; each level cuts holes
//             where the finer one is drawn, and skirts hide the seams. Under the road corridor the
//             tiles sink out of sight, and road-following verge strips carry the ground from the
//             shoulder out to 12 m (so the road never fights the terrain).
//   road      192 m chunks within ≈2.6 km: the ribbon (asphalt and paint in one shader), verges,
//             bridge decks and piers, stone walls and parapets, tunnel shells, guard-rail beams
//             with instanced posts, instanced delineators or snow poles.
//   dressing  instanced trees from the OSM forest mask, lakes, the open sea for coastal roads,
//             the skyline ring from the DEM beyond the terrain, and the sky.
//
// All geometry is built in local coordinates around its own origin (mesh.position), so a road
// 15 km long draws with no float jitter. Nothing allocates per frame except new tiles/chunks,
// which are built under a per-frame time budget.
import * as THREE from 'three';
import { terrainAt, RAILS } from '../sim/roads.js';
import {
  createUniforms, applyLook, terrainMaterial, seaMaterial, lakeMaterial, roadMaterial, wallMaterial, steelMaterial,
  propMaterial, treeMaterial, skyMaterial, panoMaterial, TODS, BIOMES,
} from './roadlook.js';

const SHOULDER = 1.2;
export const CHUNK = 64;                   // samples per road chunk (192 m)
const VERGE = [SHOULDER, 3, 6.5, 12];      // verge rows: lateral metres past the edge
const T0 = 128, T1 = 512, TF = 128, N = 32;
const TIERS = {
  high: { r0: 420, r1: 2400, roadR: 2400, tree0: 7, tree1: 15, treeR1: 1150, farStep: 1, budget: 6 },
  mid: { r0: 330, r1: 1700, roadR: 1700, tree0: 9, tree1: 0, treeR1: 0, farStep: 1, budget: 5 },
  low: { r0: 260, r1: 1150, roadR: 1150, tree0: 12, tree1: 0, treeR1: 0, farStep: 2, budget: 4 },
};

export function createRoadWorld({ road, info, tier = 'high', renderer, tod = 'day' }) {
  const cfg = TIERS[tier] || TIERS.high;
  const group = new THREE.Group();
  group.name = 'freedrive';
  const U = createUniforms();
  const biome = BIOMES[info.id] ? info.id : 'stelvio';
  const coast = !!road.meta.coast;
  U.cgCoast.value = coast ? 1 : 0;
  const mats = {
    terrain: terrainMaterial(U), road: roadMaterial(U, road.meta.marking), wall: wallMaterial(U), steel: steelMaterial(U),
    prop: propMaterial(U), tree: treeMaterial(U), sea: seaMaterial(U), lake: lakeMaterial(U),
  };
  // Tree cover as a texture the terrain shader reads (R8, linear).
  const tr = road.data.trees;
  const treeTex = new THREE.DataTexture(tr.data, tr.nx, tr.nz, THREE.RedFormat, THREE.UnsignedByteType);
  treeTex.magFilter = THREE.LinearFilter; treeTex.minFilter = THREE.LinearFilter; treeTex.needsUpdate = true;
  U.cgTrees.value = treeTex;
  U.cgTreeBox.value.set(tr.x0, tr.z0, 1 / (tr.nx * tr.cell), 1 / (tr.nz * tr.cell));

  const P = prepRoad(road);
  const dist = distanceField(road, P);
  const t3 = [0, 0, 0];
  const H = (x, z) => terrainAt(road, x, z, t3)[0];

  // --- Sky, light, look ----------------------------------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMaterial(U));
  sky.frustumCulled = false; sky.renderOrder = -1000;
  group.add(sky);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  group.add(hemi);
  const fog = new THREE.FogExp2(0xffffff, 1e-4);
  const look = {
    group, fog, env: null, envIntensity: 0.8, exposure: 1, bloom: {}, keyLight: { color: 0xffffff, intensity: 3, offset: new THREE.Vector3() },
    update: () => {},
  };
  let todId = tod, T = TODS.day;
  function setTod(id) {
    todId = TODS[id] ? id : 'day';
    T = applyLook(U, biome, todId, info.sun || { az: 180, el: 35 }).T;
    sky.material.uniforms.cgHaze.value.set(T.haze);
    sky.material.uniforms.cgSun.value.set(T.sun);
    sky.material.uniforms.cgStars.value = T.stars;
    sky.material.uniforms.cgClouds.value = T.clouds;
    pano.material.uniforms.cgHaze.value.set(T.haze);
    fog.color.set(T.haze);
    fog.density = T.density;
    hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround); hemi.intensity = T.hemiI;
    look.exposure = T.exposure; look.bloom = T.bloom;
    look.keyLight.color = T.sun; look.keyLight.intensity = T.sunI;
    look.keyLight.offset.copy(U.cgSunDir.value).multiplyScalar(60);
    look.lamps = T.lamps;
    look.env?.dispose?.();
    look.env = bakeEnv(renderer, U, T);
    return look;
  }

  // --- Skyline ring and sea ------------------------------------------------------------------------
  const pano = panoRing(road.meta.pano, U);
  group.add(pano);
  if (coast) {
    const sea = new THREE.Mesh(new THREE.RingGeometry(17000, 44000, 96, 1), mats.sea);
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.4; sea.frustumCulled = false;
    sea.geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(new Float32Array(sea.geometry.attributes.position.count).fill(-30), 1));
    group.add(sea);
  }
  for (const lake of road.meta.lakes || []) group.add(lakeMesh(lake, mats.lake));

  // --- Terrain --------------------------------------------------------------------------------------
  const far = buildFar(road, H, mats.terrain, cfg.farStep, coast);
  group.add(far.mesh);
  const tiles = [new Map(), new Map()];      // level → key → tile
  const roadChunks = new Map();
  const nChunks = Math.ceil((road.n - 1) / CHUNK);
  const queue = [];
  const key = (i, j) => `${i},${j}`;

  function wantTiles(cx, cz) {
    const want = [new Set(), new Set()];
    for (const [lvl, size, R] of [[0, T0, cfg.r0], [1, T1, cfg.r1]]) {
      const i0 = Math.floor((cx - R) / size), i1 = Math.floor((cx + R) / size), j0 = Math.floor((cz - R) / size), j1 = Math.floor((cz + R) / size);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const dx = Math.max(0, Math.abs(cx - (i + 0.5) * size) - size / 2), dz = Math.max(0, Math.abs(cz - (j + 0.5) * size) - size / 2);
        if (dx * dx + dz * dz < R * R && inDem(road, (i + 0.5) * size, (j + 0.5) * size)) want[lvl].add(key(i, j));
      }
    }
    return want;
  }

  const covered = {
    // A level-1 cell (16 m) is covered when the level-0 tile over it is drawn.
    l1: (x, z) => { const t = tiles[0].get(key(Math.floor(x / T0), Math.floor(z / T0))); return !!(t && t.ready); },
    far: (x, z) => { const t = tiles[1].get(key(Math.floor(x / T1), Math.floor(z / T1))); return !!(t && t.ready); },
  };

  function buildTerrainTile(lvl, k) {
    const [i, j] = k.split(',').map(Number);
    const size = lvl ? T1 : T0;
    const t = makeTile(lvl, i * size, j * size, size, N, H, dist, mats.terrain, coast, lvl ? covered.l1 : null);
    const near1 = lvl && cfg.tree1 && Math.hypot((i + 0.5) * size - planX, (j + 0.5) * size - planZ) < cfg.treeR1;
    if (lvl === 0 || near1) {
      const tm = plantTrees(road, H, dist, i * size, j * size, size, lvl ? cfg.tree1 : cfg.tree0, mats.tree, biome, lvl);
      if (tm) { t.trees = tm; t.mesh.add(tm); tm.position.set(0, 0, 0); }
    }
    group.add(t.mesh);
    t.ready = true;
    return t;
  }

  function buildChunk(c) {
    const g = buildRoadChunk(road, P, c, mats, H, info, tier);
    group.add(g);
    return g;
  }

  // Stream around a point (the camera): queue what's missing nearest first, drop what's far.
  const tmpV = new THREE.Vector3();
  let lastPlan = -1e9, planX = 1e9, planZ = 1e9;
  function plan(cx, cz) {
    const want = wantTiles(cx, cz);
    queue.length = 0;
    for (const lvl of [0, 1]) {
      for (const k of want[lvl]) if (!tiles[lvl].has(k)) {
        const [i, j] = k.split(',').map(Number), size = lvl ? T1 : T0;
        queue.push({ kind: 't', lvl, k, d: Math.hypot((i + 0.5) * size - cx, (j + 0.5) * size - cz) * (lvl ? 1.4 : 1) });
      }
    }
    for (let c = 0; c < nChunks; c++) {
      const b = P.chunkBox[c];
      const dx = Math.max(0, b[0] - cx, cx - b[2]), dz = Math.max(0, b[1] - cz, cz - b[3]);
      const d = Math.hypot(dx, dz);
      if (d < cfg.roadR) { if (!roadChunks.has(c)) queue.push({ kind: 'r', c, d: d * 0.8 }); }
      else if (d > cfg.roadR + 400 && roadChunks.has(c)) { const g = roadChunks.get(c); group.remove(g); disposeTree(g); roadChunks.delete(c); }
    }
    queue.sort((a, b) => a.d - b.d);
    // Drop tiles no longer wanted (with a margin), patching holes in the coarser level.
    let dropped0 = false, dropped1 = false;
    for (const lvl of [0, 1]) {
      const size = lvl ? T1 : T0, R = (lvl ? cfg.r1 : cfg.r0) + size;
      for (const [k, t] of tiles[lvl]) {
        const [i, j] = k.split(',').map(Number);
        if (Math.hypot((i + 0.5) * size - cx, (j + 0.5) * size - cz) > R + size * 0.75) {
          t.ready = false; group.remove(t.mesh); disposeTree(t.mesh); tiles[lvl].delete(k);
          if (lvl === 0) dropped0 = true; else dropped1 = true;
        }
      }
    }
    if (dropped0) for (const t of tiles[1].values()) t.reindex(covered.l1);
    if (dropped1) far.reindex(covered.far);
  }

  function work(budgetMs) {
    const t0 = performance.now();
    let touched0 = new Set(), touched1 = false;
    while (queue.length && performance.now() - t0 < budgetMs) {
      const job = queue.shift();
      if (job.kind === 't') {
        if (tiles[job.lvl].has(job.k)) continue;
        tiles[job.lvl].set(job.k, buildTerrainTile(job.lvl, job.k));
        if (job.lvl === 0) {
          const [i, j] = job.k.split(',').map(Number);
          touched0.add(key(Math.floor((i * T0) / T1), Math.floor((j * T0) / T1)));
        } else touched1 = true;
      } else if (!roadChunks.has(job.c)) roadChunks.set(job.c, buildChunk(job.c));
    }
    for (const k of touched0) tiles[1].get(k)?.reindex(covered.l1);
    if (touched1) far.reindex(covered.far);
    return queue.length;
  }

  // Build everything near a point now (behind the loading screen).
  function prime(x, z, onProgress) {
    planX = x; planZ = z;
    plan(x, z);
    const total = queue.length;
    while (queue.length) { work(50); onProgress?.(1 - queue.length / Math.max(1, total)); }
    planX = x; planZ = z;
  }

  function update(camera, time) {
    U.cgTime.value = time;
    sky.position.copy(camera.position);
    const cx = camera.position.x, cz = camera.position.z;
    if (Math.hypot(cx - planX, cz - planZ) > 40 || time - lastPlan > 1.5) { plan(cx, cz); planX = cx; planZ = cz; lastPlan = time; }
    if (queue.length) work(cfg.budget);
    void tmpV;
  }

  function stats() {
    let tris = 0, draws = 0;
    group.traverse((o) => {
      if (!o.visible || !(o.isMesh)) return;
      draws++;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    return { tiles0: tiles[0].size, tiles1: tiles[1].size, chunks: roadChunks.size, queue: queue.length, draws, tris: Math.round(tris) };
  }

  function dispose() {
    disposeTree(group);
    treeTex.dispose();
    look.env?.dispose?.();
    for (const m of Object.values(mats)) m.dispose();
  }

  setTod(todId);
  return { group, look, setTod, update, prime, dispose, stats, uniforms: U, get tod() { return todId; } };
}

// ---- Helpers --------------------------------------------------------------------------------------

function inDem(road, x, z) {
  const f = road.data.far;
  return x > f.x0 - 600 && z > f.z0 - 600 && x < f.x0 + (f.nx - 1) * f.cell + 600 && z < f.z0 + (f.nz - 1) * f.cell + 600;
}

export function disposeTree(o) {
  o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.isInstancedMesh) c.dispose?.(); });
}

// Per-sample tangent, left vector and curve radius; chunk bounding boxes.
function prepRoad(road) {
  const n = road.n, tx = new Float32Array(n), tz = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const ex = road.x[b] - road.x[a], ez = road.z[b] - road.z[a], l = Math.hypot(ex, ez) || 1;
    tx[i] = ex / l; tz[i] = ez / l;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const turn = Math.abs(Math.atan2(tx[a] * tz[b] - tz[a] * tx[b], tx[a] * tx[b] + tz[a] * tz[b]));
    R[i] = turn > 1e-4 ? ((b - a) * road.meta.spacing) / turn : 1e5;
  }
  const chunkBox = [];
  for (let c = 0; c * CHUNK < n - 1; c++) {
    let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity;
    for (let i = c * CHUNK; i <= Math.min(n - 1, (c + 1) * CHUNK); i++) {
      a = Math.min(a, road.x[i]); b = Math.min(b, road.z[i]); cc = Math.max(cc, road.x[i]); d = Math.max(d, road.z[i]);
    }
    chunkBox.push([a - 20, b - 20, cc + 20, d + 20]);
  }
  return { tx, tz, R, chunkBox };
}

// Distance to the road centreline (render side: sinking terrain under the corridor, keeping
// trees off it). A coarse CSR grid of segments with a wide reach.
function distanceField(road, P) {
  const C = 24, reach = road.hwMax + 34;
  const b = road.bounds, x0 = b.minX - reach - C, z0 = b.minZ - reach - C;
  const nx = Math.ceil((b.maxX - x0 + reach + C) / C) + 1, nz = Math.ceil((b.maxZ - z0 + reach + C) / C) + 1;
  const cells = Array.from({ length: nx * nz }, () => []);
  for (let i = 0; i < road.m; i++) {
    const ax = Math.min(road.x[i], road.x[i + 1]) - reach, bx = Math.max(road.x[i], road.x[i + 1]) + reach;
    const az = Math.min(road.z[i], road.z[i + 1]) - reach, bz = Math.max(road.z[i], road.z[i + 1]) + reach;
    for (let j = Math.floor((az - z0) / C); j <= Math.floor((bz - z0) / C); j++)
      for (let k = Math.floor((ax - x0) / C); k <= Math.floor((bx - x0) / C); k++) cells[j * nx + k].push(i);
  }
  const out = { d: Infinity, hw: 0, flags: 0, seg: -1 };
  return function query(x, z) {
    out.d = Infinity; out.seg = -1;
    const ci = Math.floor((x - x0) / C), cj = Math.floor((z - z0) / C);
    if (ci < 0 || cj < 0 || ci >= nx || cj >= nz) return out;
    for (const i of cells[cj * nx + ci]) {
      const px = x - road.sx[i], pz = z - road.sz[i];
      let t = px * road.dx[i] + pz * road.dz[i];
      t = t < 0 ? 0 : t > road.len[i] ? road.len[i] : t;
      const ex = px - road.dx[i] * t, ez = pz - road.dz[i] * t, d = Math.hypot(ex, ez);
      // Prefer ground-level road (bridges and tunnels don't sink the ground) only on ties.
      if (d < out.d) { out.d = d; out.seg = i; out.hw = road.hw[i]; out.flags = road.flags[i]; }
    }
    void P;
    return out;
  };
}

// One terrain tile: (n+1)² posts + a skirt, local to its corner; indices skip covered cells.
function makeTile(lvl, x0, z0, size, n, H, dist, mat, coast, coveredFn) {
  const step = size / n, V = (n + 1) * (n + 1), S = 4 * n;
  const pos = new Float32Array((V + S) * 3), nor = new Float32Array((V + S) * 3), dep = new Float32Array(V + S);
  const sink = lvl ? [3.5, 16, 34] : [1.3, 9, 12.5];      // depth, full until, zero at (m past the half-width)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * (n + 1) + i;
    let h = H(x, z);
    const e = step * 0.5;
    const hx = (H(x + e, z) - H(x - e, z)) / (2 * e), hz = (H(x, z + e) - H(x, z - e)) / (2 * e);
    const r = dist(x, z);
    if (r.seg >= 0 && !(r.flags & 3)) {
      const past = r.d - r.hw;
      if (past < sink[2]) h -= past < sink[1] ? sink[0] : sink[0] * (1 - (past - sink[1]) / (sink[2] - sink[1]));
    }
    dep[k] = h;
    if (coast && h < 0) h = 0;
    pos[k * 3] = x - x0; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z - z0;
    const l = Math.hypot(hx, 1, hz);
    nor[k * 3] = -hx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -hz / l;
  }
  // Skirt: the border posts again, dropped.
  const border = [];
  for (let i = 0; i < n; i++) border.push(i);                                // top edge (j = 0)
  for (let j = 0; j < n; j++) border.push(j * (n + 1) + n);                  // right edge
  for (let i = n; i > 0; i--) border.push(n * (n + 1) + i);                  // bottom edge
  for (let j = n; j > 0; j--) border.push(j * (n + 1));                      // left edge
  const drop = lvl ? 40 : 8;
  border.forEach((k, s) => {
    const o = V + s;
    pos[o * 3] = pos[k * 3]; pos[o * 3 + 1] = pos[k * 3 + 1] - drop; pos[o * 3 + 2] = pos[k * 3 + 2];
    nor[o * 3] = nor[k * 3]; nor[o * 3 + 1] = nor[k * 3 + 1]; nor[o * 3 + 2] = nor[k * 3 + 2];
    dep[o] = dep[k] - drop;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  const idx = new THREE.BufferAttribute(new Uint32Array(n * n * 6 + S * 12), 1);
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x0, 0, z0);
  mesh.receiveShadow = lvl === 0;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  const tile = { mesh, ready: false, trees: null, reindex };
  // Cells under a finer level are left out; the skirt is two-sided (it shows from either side).
  function reindex(cov) {
    const a = idx.array;
    let c = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (cov && cov(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
      const k = j * (n + 1) + i;
      a[c++] = k; a[c++] = k + n + 1; a[c++] = k + 1;
      a[c++] = k + 1; a[c++] = k + n + 1; a[c++] = k + n + 2;
    }
    for (let s = 0; s < S; s++) {
      const k0 = border[s], k1 = border[(s + 1) % S], o0 = V + s, o1 = V + ((s + 1) % S);
      a[c++] = k0; a[c++] = k1; a[c++] = o0; a[c++] = k1; a[c++] = o1; a[c++] = o0;
      a[c++] = k0; a[c++] = o0; a[c++] = k1; a[c++] = k1; a[c++] = o0; a[c++] = o1;
    }
    geo.setDrawRange(0, c);
    idx.needsUpdate = true;
  }
  tile.reindex(coveredFn);
  return tile;
}

// The whole DEM at 128 m (or 256 m on the low tier), with holes where level-1 tiles draw.
function buildFar(road, H, mat, stepK, coast) {
  const f = road.data.far, step = TF * stepK;
  const x0 = Math.ceil(f.x0 / step) * step, z0 = Math.ceil(f.z0 / step) * step;
  const nx = Math.floor((f.x0 + (f.nx - 1) * f.cell - x0) / step), nz = Math.floor((f.z0 + (f.nz - 1) * f.cell - z0) / step);
  const V = (nx + 1) * (nz + 1);
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), dep = new Float32Array(V);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * (nx + 1) + i;
    let h = H(x, z);
    const hx = (H(x + step, z) - H(x - step, z)) / (2 * step), hz = (H(x, z + step) - H(x, z - step)) / (2 * step);
    // The rim sinks away so the edge of the world is never a cliff.
    const edge = Math.min(i, j, nx - i, nz - j);
    if (edge < 2) h -= (2 - edge) * 300;
    dep[k] = h;
    if (coast && h < 0) h = 0;
    pos[k * 3] = x - x0; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z - z0;
    const l = Math.hypot(hx, 1, hz);
    nor[k * 3] = -hx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -hz / l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  const idx = new THREE.BufferAttribute(new Uint32Array(nx * nz * 6), 1);
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x0, 0, z0);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  function reindex(cov) {
    const a = idx.array;
    let c = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (cov && cov(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
      const k = j * (nx + 1) + i;
      a[c++] = k; a[c++] = k + nx + 1; a[c++] = k + 1;
      a[c++] = k + 1; a[c++] = k + nx + 1; a[c++] = k + nx + 2;
    }
    geo.setDrawRange(0, c);
    idx.needsUpdate = true;
  }
  reindex(null);
  return { mesh, reindex };
}

function panoRing(pano, U) {
  const n = pano.y.length, R = pano.r;
  let lo = Infinity, hi = -Infinity;
  for (const v of pano.y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const base = lo - 1800;
  const pos = new Float32Array((n + 1) * 2 * 3);
  for (let k = 0; k <= n; k++) {
    const az = ((k % n) / n) * Math.PI * 2, x = Math.sin(az) * R, z = -Math.cos(az) * R;
    const y = pano.y[k % n];
    pos.set([x, base, z, x, y, z], k * 6);
  }
  const idx = [];
  for (let k = 0; k < n; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = panoMaterial(U);
  mat.uniforms.cgPanoTop.value = hi; mat.uniforms.cgPanoBase.value = lo - 400;
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = -900;
  return m;
}

function lakeMesh(lake, mat) {
  const shape = new THREE.Shape();
  for (let k = 0; k < lake.pts.length; k += 2) (k ? shape.lineTo : shape.moveTo).call(shape, lake.pts[k], -lake.pts[k + 1]);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(-6), 1));
  const m = new THREE.Mesh(geo, mat);
  m.position.y = lake.y + 0.25;
  return m;
}

// Environment for the car's paint: the sky and a ground the colour of the land, baked once.
export function bakeEnv(renderer, U, T) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(U));
  sky.material.uniforms.cgHaze.value.set(T.haze);
  sky.material.uniforms.cgSun.value.set(T.sun).multiplyScalar(0.25);
  sky.material.uniforms.cgClouds.value = T.clouds;
  sky.material.depthTest = true;
  scene.add(sky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(U.cgMid.value).multiplyScalar(T.hemiI * 0.55) }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
  scene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.03);
  pm.dispose();
  sky.geometry.dispose(); sky.material.dispose(); ground.geometry.dispose(); ground.material.dispose();
  return rt.texture;
}

// ---- Road chunks ------------------------------------------------------------------------------------

function shoulderY(road, i, lat) {
  const hw = road.hw[i], al = Math.abs(lat), edge = lat < 0 ? -hw : hw;
  if (al <= hw) return road.y[i] + road.bank[i] * lat;
  return road.y[i] + road.bank[i] * edge - 0.05 * (al - hw);
}

// Geometry writer: positions local to an origin, with optional extra attributes.
function writer(ox, oz, extras = {}) {
  const w = { pos: [], nor: [], col: [], idx: [], ex: {} };
  for (const k of Object.keys(extras)) w.ex[k] = { size: extras[k], data: [] };
  w.v = (x, y, z, nx = 0, ny = 1, nz = 0, ...ex) => {
    w.pos.push(x - ox, y, z - oz); w.nor.push(nx, ny, nz);
    let o = 0;
    for (const k of Object.keys(w.ex)) { const e = w.ex[k]; for (let q = 0; q < e.size; q++) e.data.push(ex[o++] ?? 0); }
    return w.pos.length / 3 - 1;
  };
  w.c = (r, g, b) => { w.col.push(r, g, b); };
  w.geo = (normals = false) => {
    if (!w.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(w.nor, 3));
    if (w.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(w.col, 3));
    for (const [k, e] of Object.entries(w.ex)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    g.setIndex(w.idx);
    if (normals) g.computeVertexNormals();
    return g;
  };
  return w;
}

export function buildRoadChunk(road, P, c, mats, H, info, tier) {
  const g = new THREE.Group();
  const i0 = c * CHUNK, i1 = Math.min(road.n - 1, (c + 1) * CHUNK);
  const ox = road.x[i0], oz = road.z[i0];
  g.position.set(ox, 0, oz);
  const sp = road.meta.spacing;
  const isBridge = (i) => (road.flags[i] & 1) !== 0, isTunnel = (i) => (road.flags[i] & 2) !== 0;
  const L = (i) => [P.tz[i], -P.tx[i]];            // left
  // Clamp a lateral offset on the inside of a tight curve so strips never fold over themselves.
  const clampLat = (i, lat) => {
    const R = P.R[i];
    if (R > 60) return lat;
    // Which side is inside: the curve turns toward the left if the tangent rotates left.
    const a = Math.max(0, i - 2), b = Math.min(road.n - 1, i + 2);
    const turnLeft = P.tx[a] * P.tz[b] - P.tz[a] * P.tx[b] < 0;
    const inside = turnLeft ? lat > 0 : lat < 0;
    if (!inside) return lat;
    const lim = R * 0.92;
    return Math.abs(lat) > lim ? Math.sign(lat) * lim : lat;
  };

  // 1. Ribbon: asphalt to the edges, shoulders beyond (a bridge's deck runs to the parapet).
  const rw = writer(ox, oz, { aRoad: 4 });
  const lats = (i) => { const hw = road.hw[i], s = isBridge(i) ? 0.6 : SHOULDER; return [-(hw + s), -hw, -hw * 0.5, 0, hw * 0.5, hw, hw + s]; };
  const across = 7;
  for (let i = i0; i <= i1; i++) {
    const [lx, lz] = L(i), seg = Math.min(i, road.m - 1);
    const gx = road.grade[seg] * P.tx[i] + road.bank[i] * lx, gz = road.grade[seg] * P.tz[i] + road.bank[i] * lz;
    const nl = Math.hypot(gx, 1, gz);
    for (const lat0 of lats(i)) {
      const lat = clampLat(i, lat0);
      const y = shoulderY(road, i, lat0) + 0.03;
      rw.v(road.x[i] + lx * lat, y, road.z[i] + lz * lat, -gx / nl, 1 / nl, -gz / nl, lat0, i * sp, road.hw[i], isBridge(i) ? 1 : 0);
    }
  }
  for (let i = 0; i < i1 - i0; i++) for (let k = 0; k < across - 1; k++) {
    const a = i * across + k, b = a + across;
    rw.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const ribbon = new THREE.Mesh(rw.geo(), mats.road);
  ribbon.receiveShadow = tier !== 'low';
  g.add(ribbon);

  // 2. Verges: the ground carried from the shoulder out to 12 m, both sides (not on bridges or in tunnels).
  const vw = writer(ox, oz, { aDepth: 1 });
  const nv = VERGE.length;
  let runStart = -1;
  const flushVerge = (a, b) => {
    for (const side of [-1, 1]) {
      const base = vw.pos.length / 3;
      for (let i = a; i <= b; i++) {
        const [lx, lz] = L(i), hw = road.hw[i];
        for (let r = 0; r < nv; r++) {
          const lat0 = side * (hw + VERGE[r]);
          const lat = clampLat(i, lat0);
          const x = road.x[i] + lx * lat, z = road.z[i] + lz * lat;
          const y = r === 0 ? shoulderY(road, i, side * (hw + SHOULDER)) + 0.025 : H(x, z);
          vw.v(x, y, z, 0, 1, 0, y);
        }
      }
      for (let i = 0; i < b - a; i++) for (let r = 0; r < nv - 1; r++) {
        const p = base + i * nv + r, q = p + nv;
        if (side > 0) vw.idx.push(p, q, p + 1, p + 1, q, q + 1);
        else vw.idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
    }
  };
  for (let i = i0; i <= i1 + 1; i++) {
    const ok = i <= i1 && !isBridge(i) && !isTunnel(i);
    if (ok && runStart < 0) runStart = i;
    if (!ok && runStart >= 0) { if (i - 1 > runStart) flushVerge(runStart, i - 1); runStart = -1; }
  }
  const vgeo = vw.geo(true);
  if (vgeo) { const m = new THREE.Mesh(vgeo, mats.terrain); m.receiveShadow = tier !== 'low'; g.add(m); }

  // 3. Walls: stone walls and bridge parapets (extruded), bridge decks and piers, tunnel shells.
  const ww = writer(ox, oz, { aWall: 3 });
  const stone = [0.56, 0.53, 0.48], concrete = [0.72, 0.71, 0.68], tunnelC = [0.42, 0.41, 0.4];
  const extrude = (a, b, profile, colr, stoneK, sideK) => {
    // profile: [[lat, dy], ...] in the road's cross-section, relative to the edge height at that lat.
    const base = ww.pos.length / 3, np = profile.length;
    for (let i = a; i <= b; i++) {
      const [lx, lz] = L(i);
      for (const [lat0, dy] of profile) {
        const lat = lat0 * sideK;
        const y = road.y[i] + road.bank[i] * Math.sign(lat) * Math.min(Math.abs(lat), road.hw[i]) + dy;
        ww.v(road.x[i] + lx * lat, y, road.z[i] + lz * lat, 0, 1, 0, i * sp, dy + 0.6, stoneK);
        ww.c(...colr);
      }
    }
    for (let i = 0; i < b - a; i++) for (let k = 0; k < np - 1; k++) {
      const p = base + i * np + k, q = p + np;
      if (sideK > 0) ww.idx.push(p, q, p + 1, p + 1, q, q + 1); else ww.idx.push(p, p + 1, q, p + 1, q + 1, q);
    }
  };
  const railKind = (i, side) => (side > 0 ? (road.flags[i] >> 2) & 3 : (road.flags[i] >> 4) & 3);
  const steelRuns = [];
  for (const side of [1, -1]) {
    let a = -1, kind = 0;
    for (let i = i0; i <= i1 + 1; i++) {
      const k = i <= i1 ? railKind(i, side) : 0;
      if (k !== kind || i > i1) {
        if (kind && a >= 0 && i - 1 > a) {
          const b = Math.min(i1, i);
          if (kind === 1) steelRuns.push([a, b, side]);
          else if (kind === 2) {
            const r = RAILS[2];
            const hwA = road.hw[a];
            // Profile relative to the centreline; widths follow each sample's half-width below.
            void hwA;
            extrudeVar(a, b, side, r, isBridge(a) ? concrete : stone, isBridge(a) ? 0 : 1);
          } else if (kind === 3 && side > 0) tunnelShell(a, b);
        }
        kind = k; a = i;
      }
    }
  }
  function extrudeVar(a, b, side, r, colr, stoneK) {
    const base = ww.pos.length / 3;
    const prof = [[0, -0.5], [0, r.h], [0.06, r.h + 0.06], [r.t - 0.06, r.h + 0.06], [r.t, r.h], [r.t, -1.2]];
    for (let i = a; i <= b; i++) {
      const [lx, lz] = L(i), c0 = road.hw[i] + r.off;
      const yE = road.y[i] + road.bank[i] * road.hw[i] * side;
      for (const [d, dy] of prof) {
        const lat = side * (c0 + d);
        ww.v(road.x[i] + lx * lat, yE + dy, road.z[i] + lz * lat, 0, 1, 0, i * sp, dy + 0.5, stoneK);
        ww.c(...colr);
      }
    }
    const np = prof.length;
    for (let i = 0; i < b - a; i++) for (let k = 0; k < np - 1; k++) {
      const p = base + i * np + k, q = p + np;
      if (side > 0) ww.idx.push(p, p + 1, q, p + 1, q + 1, q); else ww.idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  function tunnelShell(a, b) {
    const hw = road.hw[a] + RAILS[3].off;
    const prof = [[-hw, -0.3], [-hw, 3.6], [-hw * 0.7, 5.0], [0, 5.6], [hw * 0.7, 5.0], [hw, 3.6], [hw, -0.3]];
    extrude(a, b, prof.map(([l, dy]) => [l, dy]), tunnelC, 0, 1);
  }
  // Bridge decks: a box girder under the ribbon, and piers down to the ground every ≈24 m.
  let ba = -1;
  for (let i = i0; i <= i1 + 1; i++) {
    const on = i <= i1 && isBridge(i);
    if (on && ba < 0) ba = i;
    if (!on && ba >= 0) {
      const b = Math.min(i1, i);
      if (b > ba) {
        const w = road.hw[ba] + 0.6 + 0.5;
        extrude(ba, b, [[-w, -0.2], [-w, -1.3], [-w + 0.8, -1.9], [w - 0.8, -1.9], [w, -1.3], [w, -0.2]], concrete, 0, 1);
        for (let k = ba; k <= b; k++) {
          if (k % 8 !== 4) continue;
          const gy = H(road.x[k], road.z[k]);
          if (gy > road.y[k] - 4) continue;
          pier(k, gy);
        }
      }
      ba = -1;
    }
  }
  function pier(k, gy) {
    const [lx, lz] = L(k), hw = road.hw[k] * 0.55;
    const top = road.y[k] - 1.9, bot = Math.max(gy - 2, -20);
    const tx = P.tx[k], tz = P.tz[k];
    const corners = [[-hw, -0.9], [hw, -0.9], [hw, 0.9], [-hw, 0.9]];
    const base = ww.pos.length / 3;
    for (const y of [top, bot]) for (const [l, f] of corners) {
      ww.v(road.x[k] + lx * l + tx * f, y, road.z[k] + lz * l + tz * f, 0, 1, 0, k * sp + f, y - bot, 0);
      ww.c(...concrete);
    }
    for (let q = 0; q < 4; q++) { const a = base + q, b = base + ((q + 1) % 4); ww.idx.push(a, b, a + 4, b, b + 4, a + 4); }
  }
  const wgeo = ww.geo(true);
  if (wgeo) { const m = new THREE.Mesh(wgeo, mats.wall); m.receiveShadow = tier !== 'low'; g.add(m); }

  // 4. Steel guard rails: a W-beam ribbon and instanced posts every 4 m.
  if (steelRuns.length) {
    const sw = writer(ox, oz);
    const r = RAILS[1];
    const prof = [[0, 0.8], [0.035, 0.71], [0, 0.63], [0.035, 0.54], [0, 0.46]];
    const posts = [];
    for (const [a, b, side] of steelRuns) {
      const base = sw.pos.length / 3;
      for (let i = a; i <= b; i++) {
        const [lx, lz] = L(i), c0 = road.hw[i] + r.off;
        const yE = road.y[i] + road.bank[i] * road.hw[i] * side;
        for (const [d, dy] of prof) {
          const lat = side * (c0 + d);
          sw.v(road.x[i] + lx * lat, yE + dy, road.z[i] + lz * lat, -lx * side, 0, -lz * side);
        }
        if ((i * sp) % 4 < sp) posts.push([road.x[i] + lx * side * (c0 + 0.14), yE, road.z[i] + lz * side * (c0 + 0.14), Math.atan2(P.tx[i], P.tz[i])]);
      }
      for (let i = 0; i < b - a; i++) for (let k = 0; k < prof.length - 1; k++) {
        const p = base + i * prof.length + k, q = p + prof.length;
        sw.idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const sgeo = sw.geo(true);
    if (sgeo) g.add(new THREE.Mesh(sgeo, mats.steel));
    if (posts.length) g.add(instanced(POST_GEO(), mats.steel, posts, ox, oz));
  }

  // 5. Delineators (white posts with an amber reflector, every 50 m) or, in Norway, snow poles
  //    every 25 m; none in the US. Only where there's no barrier on that side.
  const marking = road.meta.marking;
  if (marking !== 'us') {
    const every = marking === 'no' ? 25 : 50;
    const list = [];
    for (let i = i0; i < i1; i++) {
      if ((i * sp) % every >= sp || isBridge(i) || isTunnel(i)) continue;
      for (const side of [1, -1]) {
        if (railKind(i, side)) continue;
        const [lx, lz] = L(i), lat = side * (road.hw[i] + SHOULDER + 0.35);
        const x = road.x[i] + lx * lat, z = road.z[i] + lz * lat;
        list.push([x, shoulderY(road, i, side * (road.hw[i] + SHOULDER)), z, Math.atan2(P.tx[i], P.tz[i]) + (side > 0 ? 0 : Math.PI)]);
      }
    }
    if (list.length) g.add(instanced(marking === 'no' ? POLE_GEO() : DELINEATOR_GEO(), mats.prop, list, ox, oz));
  }
  void info; void extrude;
  g.traverse((o) => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  g.updateMatrix();
  return g;
}

function instanced(geo, mat, list, ox, oz) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4();
  list.forEach(([x, y, z, yaw], k) => { q.setFromAxisAngle(up, yaw); p.set(x - ox, y, z - oz); M.compose(p, q, s); m.setMatrixAt(k, M); });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

// Shared prop geometries (made once).
let postGeo = null, delinGeo = null, poleGeo = null;
export function POST_GEO() {
  if (!postGeo) { postGeo = new THREE.BoxGeometry(0.09, 1.1, 0.12); postGeo.translate(0, 0.25, 0); }
  return postGeo;
}
export function colored(geo, rgb) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) c.set(rgb, k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
export function merge(geos) {
  geos = geos.map((g) => (g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()])));
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.array[k] + o;
    o += g.attributes.position.count; oi += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
export function DELINEATOR_GEO() {
  if (!delinGeo) {
    const body = colored(new THREE.BoxGeometry(0.1, 0.8, 0.12).translate(0, 0.4, 0), [0.93, 0.93, 0.92]);
    const band = colored(new THREE.BoxGeometry(0.105, 0.24, 0.125).translate(0, 0.86, 0), [0.06, 0.06, 0.06]);
    const refl = colored(new THREE.BoxGeometry(0.11, 0.1, 0.05).translate(0, 0.86, -0.04), [1, 0.62, 0.12]);
    delinGeo = merge([body, band, refl]);
  }
  return delinGeo;
}
export function POLE_GEO() {
  if (!poleGeo) {
    const shaft = colored(new THREE.BoxGeometry(0.04, 1.9, 0.04).translate(0, 0.95, 0), [0.78, 0.66, 0.42]);
    const tip = colored(new THREE.BoxGeometry(0.045, 0.5, 0.045).translate(0, 2.15, 0), [1, 0.42, 0.06]);
    poleGeo = merge([shaft, tip]);
  }
  return poleGeo;
}
let coniferGeo = null, broadGeo = null;
export function CONIFER_GEO() {
  if (!coniferGeo) {
    // A spruce: a slim trunk and four stacked tiers, darker underneath (self-shadowing).
    const parts = [colored(new THREE.CylinderGeometry(0.018, 0.03, 0.2, 5).translate(0, 0.1, 0), [0.3, 0.24, 0.2])];
    const tiers = [[0.3, 0.46, 0.36], [0.22, 0.4, 0.58], [0.13, 0.36, 0.8]];
    for (const [r, h, y] of tiers) {
      const g = new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y, 0);
      const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) { const t = (pos.getY(k) - (y - h / 2)) / h, v = 0.62 + 0.45 * t; col[k * 3] = v; col[k * 3 + 1] = v; col[k * 3 + 2] = v; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // Close the skirt of each tier with a dark underside.
      const base = colored(new THREE.CircleGeometry(r, 7).rotateX(Math.PI / 2).translate(0, y - h / 2, 0), [0.35, 0.35, 0.35]);
      parts.push(g, base);
    }
    coniferGeo = merge(parts);
  }
  return coniferGeo;
}
// Far spruce: one cone (12 triangles), the same silhouette from a distance.
let coniferLow = null;
export function CONIFER_LOW_GEO() {
  if (!coniferLow) {
    const g = new THREE.ConeGeometry(0.28, 0.9, 6, 1, false).translate(0, 0.55, 0);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) { const v = 0.6 + 0.45 * (pos.getY(k) - 0.1) / 0.9; col[k * 3] = v; col[k * 3 + 1] = v; col[k * 3 + 2] = v; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    coniferLow = g;
  }
  return coniferLow;
}
export function BROAD_GEO() {
  if (!broadGeo) {
    const trunk = colored(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5).translate(0, 0.2, 0), [0.32, 0.25, 0.2]);
    const crown = colored(new THREE.IcosahedronGeometry(0.42, 0).scale(1.2, 0.8, 1.2).translate(0, 0.62, 0), [1, 1, 1]);
    broadGeo = merge([trunk, crown]);
  }
  return broadGeo;
}

// Trees on one terrain tile: jittered grid, kept where OSM maps woods, off the road, below the
// tree line, on slopes a tree can stand on. Deterministic per tile.
function plantTrees(road, H, dist, x0, z0, size, spacing, mat, biome, lod = 0) {
  if (!spacing) return null;
  const tr = road.data.trees, B = BIOMES[biome];
  const list = [];
  const n = Math.floor(size / spacing);
  const hash = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const gi = Math.round(x0 / spacing), gj = Math.round(z0 / spacing);
  const broad = biome === 'bigsur';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const r1 = hash(gi + i, gj + j), r2 = hash(gi + i + 7919, gj + j - 104729), r3 = hash(gi + i - 31, gj + j + 977);
    const x = x0 + (i + r1) * spacing, z = z0 + (j + r2) * spacing;
    const ti = Math.floor((x - tr.x0) / tr.cell), tj = Math.floor((z - tr.z0) / tr.cell);
    const cover = ti >= 0 && tj >= 0 && ti < tr.nx && tj < tr.nz ? tr.data[tj * tr.nx + ti] / 255 : 0;
    // Forest where mapped; a scatter of lone trees elsewhere below the tree line.
    if (r3 > cover * 0.9 + (B.lone ?? 0.01)) continue;
    const y = H(x, z);
    if (y < 1.5 || y > B.treeline + (r1 - 0.5) * 160) continue;
    const e = 3;
    const sx = (H(x + e, z) - H(x - e, z)) / (2 * e), sz = (H(x, z + e) - H(x, z - e)) / (2 * e);
    if (sx * sx + sz * sz > 1.1) continue;
    const r = dist(x, z);
    if (r.seg >= 0 && r.d < r.hw + 9) continue;
    list.push([x, y - 0.3, z, r3 * 6.283, r1, r2]);
  }
  if (!list.length) return null;
  const geo = broad ? BROAD_GEO() : lod ? CONIFER_LOW_GEO() : CONIFER_GEO();
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), col = new THREE.Color();
  const base = new THREE.Color(B.tree || B.forest);
  list.forEach(([x, y, z, yaw, a, b], k) => {
    const hgt = broad ? 7 + a * 9 : 9 + a * 15, wid = hgt * (broad ? 1.0 : 0.7 + b * 0.25);
    q.setFromAxisAngle(up, yaw); p.set(x - x0, y, z - z0); s.set(wid, hgt, wid);
    M.compose(p, q, s); m.setMatrixAt(k, M);
    col.copy(base).multiplyScalar(0.75 + 0.5 * b); col.offsetHSL((a - 0.5) * 0.03, 0, 0);
    m.setColorAt(k, col);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}
