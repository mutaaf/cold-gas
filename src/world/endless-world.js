// THE ENDLESS WORLD, drawn: terrain streamed in LOD rings around the camera from a worker, the road
// built in chunks as it's generated, vegetation and rocks instanced on the GPU, the sea, the sky,
// and whatever has been placed in the world. Same light and materials as Free Drive's real roads.
//
//   terrain   four levels of 32 × 32-cell tiles: 128 m (4 m posts) within ≈ 500 m, 512 m (16 m)
//             within ≈ 2.3 km, 2 km (64 m) within ≈ 9 km and 8 km (256 m) to the horizon. A finer
//             tile cuts its hole in the coarser one under it once it's drawn; skirts hide the seams.
//             Tiles are built in a Web Worker (src/world/terrain.worker.js), so the main thread only
//             wraps typed arrays in buffers. Built tiles stay in an LRU (and, if allowed, IndexedDB)
//             so driving back, or the same seed next time, costs nothing.
//   road      192 m chunks (src/render/road.js) within ≈ 2 km, as the road is generated ahead.
//   budget    each frame does at most `budget` ms of uploads and chunk building, nearest and most
//             ahead first; tiles, chunks and GPU memory beyond their rings (or over the tier's
//             budget) are disposed.
//
// The world API (for build modes and the like) is on the returned object: addObject, removeObject,
// objectsNear, objectsInChunk, getObject, groundAt, roadPoseAt, nearestRoad, biomeAt, onObjects…
// See docs/WORLD.md.
import * as THREE from 'three';
import { createUniforms, applyLook, roadMaterial, wallMaterial, steelMaterial, propMaterial, treeMaterial, farTreeMaterial, skyMaterial, TODS } from '../render/roadlook.js';
import { VEG_SPACING } from '../sim/scenery.js';
import { bakeEnv, disposeTree, CONIFER_GEO, CONIFER_LOW_GEO, BROAD_GEO, CHUNK } from '../render/road.js';
import { N, LEVELS } from './tilegen.js';
import { chunkFromData } from './roadchunk.js';
import { groundAt, poseAt, nearestSeg, nearestSample, SHOULDER } from '../sim/roads.js';
import { biomeName, ENDLESS_VERSION } from '../sim/endless.js';
import { createLru, createIdbCache, tileBytes } from './cache.js';
import { endlessTerrainMaterial, rockMaterial, SHRUB_GEO, ROCK_GEO } from './look.js';
import { createObjectView } from './objects-view.js';
import { createPool } from './pool.js';
import { wantHi } from './lod.js';
import { obs } from '../obs/index.js';

// Quality tiers (?gfx=high|mid|low; phones and tablets get high like a desktop, 0097). radius: each
// level's ring (m). veg0/veg1: vegetation spacing (m) per prop on level-0 / near level-1 tiles. Level 0's are the props the
// physics has (src/sim/scenery.js VEG_SPACING) on every tier: a tier draws them nearer or farther,
// never fewer. hiR: level-0 tiles nearer than
// this get the detailed trees. pool: instance capacity per prop. budget: main-thread ms per frame
// for uploads and road chunks. gpuMB / cacheMB: the drawn geometry's and the tile cache's budgets.
export const TIERS = {
  high: { radius: [480, 2300, 9000, 30000], roadR: 2200, veg0: VEG_SPACING, veg1: { conifer: 22, broad: 26 }, vegR1: 1150, hiR: 300,
    pool: { coniferHi: 6000, conifer: 20000, broad: 9000, shrub: 14000, rock: 9000, conifer1: 12000, broad1: 6000 }, budget: 4, workers: 2, inflight: 3, gpuMB: 260, cacheMB: 160 },
  mid: { radius: [400, 1900, 7000, 24000], roadR: 1700, veg0: VEG_SPACING, veg1: { conifer: 30 }, vegR1: 800, hiR: 200,
    pool: { coniferHi: 5500, conifer: 16000, broad: 8500, shrub: 11000, rock: 8000, conifer1: 5000, broad1: 1 }, budget: 3, workers: 2, inflight: 2, gpuMB: 170, cacheMB: 96 },
  low: { radius: [320, 1400, 5200, 18000], roadR: 1200, veg0: VEG_SPACING, veg1: null, vegR1: 0, hiR: 0,
    pool: { coniferHi: 1, conifer: 11000, broad: 5500, shrub: 7500, rock: 5500, conifer1: 1, broad1: 1 }, budget: 2.5, workers: 1, inflight: 2, gpuMB: 110, cacheMB: 48 },
};
const SUN = { az: 205, el: 34 };

// One index buffer per coverage pattern is too many; each tile keeps its own (cells under a finer
// tile are left out), rebuilt only when that coverage changes.
function tileIndex(n, skip) {
  const V = (n + 1) * (n + 1), S = 4 * n;
  const border = [];
  for (let a = 0; a < n; a++) border.push(a);
  for (let b = 0; b < n; b++) border.push(b * (n + 1) + n);
  for (let a = n; a > 0; a--) border.push(n * (n + 1) + a);
  for (let b = n; b > 0; b--) border.push(b * (n + 1));
  return (idx, covered) => {
    let c = 0;
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      if (covered && covered(a, b)) continue;
      const k = b * (n + 1) + a;
      idx[c++] = k; idx[c++] = k + n + 1; idx[c++] = k + 1;
      idx[c++] = k + 1; idx[c++] = k + n + 1; idx[c++] = k + n + 2;
    }
    for (let s = 0; s < S; s++) {
      const k0 = border[s], k1 = border[(s + 1) % S], o0 = V + s, o1 = V + ((s + 1) % S);
      idx[c++] = k0; idx[c++] = k1; idx[c++] = o0; idx[c++] = k1; idx[c++] = o1; idx[c++] = o0;
      idx[c++] = k0; idx[c++] = o0; idx[c++] = k1; idx[c++] = k1; idx[c++] = o0; idx[c++] = o1;
    }
    void skip;
    return c;
  };
}
const fillIndex = tileIndex(N);
const INDEX_LEN = N * N * 6 + 4 * N * 12;

export function createEndlessWorld({ course, tier = 'high', renderer, tod = 'day', idb = true, info = {} }) {
  // [obs] The world's worker is breaker-guarded: after it has crashed repeatedly, the world streams
  // at the low tier's rings with one worker until the breaker's cooldown allows a retry.
  const worldOk = obs.breaker('world').allow();
  const cfg = worldOk ? TIERS[tier] || TIERS.high : TIERS.low;
  if (!worldOk) obs.recovery('world', true, 'world worker breaker open: streaming at the low tier');
  const road = course.road, seed = road.seed;
  const group = new THREE.Group();
  group.name = 'endless';
  const U = createUniforms();
  const mats = {
    terrain: endlessTerrainMaterial(U), road: roadMaterial(U, 'eu'), wall: wallMaterial(U), steel: steelMaterial(U), prop: propMaterial(U),
    tree: treeMaterial(U), treeFar: farTreeMaterial(U, cfg.radius[0] - 64), rock: rockMaterial(U),
  };
  // Road chunks shade their verges with the terrain's colours: the same material, an aCol per vertex.
  const vergeMat = mats.terrain;

  // --- Sky, light, look ------------------------------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMaterial(U));
  sky.frustumCulled = false; sky.renderOrder = -1000;
  group.add(sky);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  group.add(hemi);
  const fog = new THREE.FogExp2(0xffffff, 1e-4);
  const look = { group, fog, env: null, envIntensity: 0.8, exposure: 1, bloom: {}, keyLight: { color: 0xffffff, intensity: 3, offset: new THREE.Vector3() }, update: () => {}, lamps: 0 };
  let todId = tod;
  function setTod(id) {
    todId = TODS[id] ? id : 'day';
    const T = applyLook(U, 'bigsur', todId, info.sun || SUN).T;
    sky.material.uniforms.cgHaze.value.set(T.haze);
    sky.material.uniforms.cgSun.value.set(T.sun);
    sky.material.uniforms.cgStars.value = T.stars;
    sky.material.uniforms.cgClouds.value = T.clouds;
    fog.color.set(T.haze);
    fog.density = T.density * (tier === 'low' ? 1.25 : 1);
    hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround); hemi.intensity = T.hemiI;
    look.exposure = T.exposure; look.bloom = T.bloom;
    look.keyLight.color = T.sun; look.keyLight.intensity = T.sunI;
    look.keyLight.offset.copy(U.cgSunDir.value).multiplyScalar(60);
    look.lamps = T.lamps;
    look.env?.dispose?.();
    look.env = bakeEnv(renderer, U, T);
    return look;
  }

  // --- Workers and caches ----------------------------------------------------------------------
  const lru = createLru(cfg.cacheMB * 1024 * 1024);
  const disk = idb ? createIdbCache() : null;
  const keyOf = (lvl, i, j) => `${lvl}:${i}:${j}`;
  const diskKey = (k) => `v${ENDLESS_VERSION}:${seed}:${k}`;
  const workers = [];
  const wstat = { built: 0, ms: 0, msMax: 0, samples: [], errors: 0, fromLru: 0, fromDisk: 0 };
  const cstat = { built: 0, ms: 0, msMax: 0 };
  let epoch = 1;                                   // bumped on dispose: late replies are dropped
  let inflight = cfg.inflight, wake = null;        // jobs per worker at once; prime() raises it
  const spawn = () => {
    const worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'seed', seed, tier });
    return worker;
  };
  // A worker that died (an uncaught error, out of memory) loses its jobs: record it, respawn it if
  // the breaker allows, and re-ask for everything in flight (late replies are dropped by epoch).
  // A worker that never answered and died without a message never loaded: its script is gone (a
  // deploy replaced the build) or the network dropped it. Respawning would only fail again, so it's
  // a stale build: the self-heal checks for a new one (src/obs/heal.js), and prime() gives up now.
  let workersDown = 0;
  const crashed = (entry, e) => {
    e?.preventDefault?.();
    if (!entry.alive && !e?.message) {
      try { entry.worker.terminate(); } catch { /* already gone */ }
      if (entry.busy !== Infinity) { entry.busy = Infinity; workersDown++; }
      pending.clear();
      obs.lazyFailed(Object.assign(new Error('terrain worker failed to load'), { stack: '    at onerror (terrain.worker.js:0:0)' }));
      obs.recovery('world', false, 'terrain worker never loaded (stale build?)');
      return;
    }
    obs.fail('world', Object.assign(new Error(`terrain worker crashed: ${e?.message || 'no message'}`), { stack: '    at onerror (terrain.worker.js:0:0)' }), 'worker');
    try { entry.worker.terminate(); } catch { /* already gone */ }
    entry.busy = 0; epoch++; pending.clear();
    if (obs.breaker('world').allow()) { entry.worker = spawn(); entry.alive = false; entry.worker.onmessage = entry.onmessage; entry.worker.onerror = (e2) => crashed(entry, e2); obs.recovery('world', true, 'terrain worker respawned'); }
    else { entry.busy = Infinity; workersDown++; obs.recovery('world', false, 'terrain worker left down (breaker open)'); }
  };
  for (let w = 0; w < cfg.workers; w++) {
    const worker = spawn();
    const entry = { worker, busy: 0, alive: false };
    worker.onerror = (e) => crashed(entry, e);
    entry.onmessage = worker.onmessage = (e) => {
      const m = e.data;
      entry.alive = true;
      entry.busy--;
      if (wake) { const w = wake; wake = null; w(); }
      if (m.gen !== epoch) return;
      if (m.type === 'error') { wstat.errors++; pending.delete(m.key); console.warn('[endless] build', m.key, m.message); obs.fail('world', Object.assign(new Error(String(m.message).split('\n')[0]), { stack: String(m.message) }), 'worker'); return; }
      obs.ok('world');
      if (m.type === 'chunk') {
        const d = m.chunk;
        cstat.built++; cstat.ms += d.ms; cstat.msMax = Math.max(cstat.msMax, d.ms);
        let b = 0;
        for (const x of d.meshes) { if (x.instances) b += x.instances.byteLength; else { for (const a of x.attrs) b += a.array.byteLength; if (x.index) b += x.index.byteLength; } }
        lru.set(m.key, d, b);
        ready.push(m.key);
        return;
      }
      const t = m.tile;
      wstat.built++; wstat.ms += t.ms; wstat.msMax = Math.max(wstat.msMax, t.ms);
      wstat.samples.push(t.ms); if (wstat.samples.length > 400) wstat.samples.shift();
      lru.set(m.key, t, tileBytes(t));
      if (disk && t.lvl >= 1) disk.put(diskKey(m.key), t);
      ready.push(m.key);
    };
    workers.push(entry);
  }

  // --- Terrain tiles -----------------------------------------------------------------------------
  const tiles = [new Map(), new Map(), new Map(), new Map()];     // level → key → tile
  const pending = new Map();                                      // key → { lvl, i, j, d }
  const ready = [];                                               // keys with data, to upload
  let gpuBytes = 0;
  // Vegetation: one pool (one draw call) per prop; detailed spruces near the road, simple far.
  const pools = {
    coniferHi: createPool(CONIFER_GEO(), mats.tree, cfg.pool.coniferHi, 'conifer-hi'),
    conifer: createPool(CONIFER_LOW_GEO(), mats.tree, cfg.pool.conifer, 'conifer'),
    broad: createPool(BROAD_GEO(), mats.tree, cfg.pool.broad, 'broad'),
    shrub: createPool(SHRUB_GEO(), mats.tree, cfg.pool.shrub, 'shrub'),
    rock: createPool(ROCK_GEO(), mats.rock, cfg.pool.rock, 'rock'),
    // Far tiles' trees: hidden near the camera, where the near tiles' (the solid ones) stand.
    conifer1: createPool(CONIFER_LOW_GEO(), mats.treeFar, cfg.pool.conifer1, 'conifer-far'),
    broad1: createPool(BROAD_GEO(), mats.treeFar, cfg.pool.broad1, 'broad-far'),
  };
  const poolGroup = new THREE.Group();
  poolGroup.name = 'vegetation';
  for (const p of Object.values(pools)) { p.mesh.castShadow = false; poolGroup.add(p.mesh); }
  group.add(poolGroup);
  // The pools' origin follows the camera in 4 km steps (instance positions are float32 on the GPU:
  // kept small, they don't shimmer 100 km out).
  const origin = { x: 0, z: 0 };
  function rebase(cx, cz) {
    const nx = Math.round(cx / 4096) * 4096, nz = Math.round(cz / 4096) * 4096;
    if (nx === origin.x && nz === origin.z) return;
    const dx = nx - origin.x, dz = nz - origin.z;
    for (const p of Object.values(pools)) {
      const a = p.mesh.instanceMatrix.array;
      for (let k = 0; k < p.mesh.count; k++) if (a[k * 16 + 15] !== 0) { a[k * 16 + 12] -= dx; a[k * 16 + 14] -= dz; }
      p.mesh.instanceMatrix.clearUpdateRanges(); p.mesh.instanceMatrix.needsUpdate = true;
    }
    origin.x = nx; origin.z = nz;
    poolGroup.position.set(nx, 0, nz); poolGroup.updateMatrixWorld(true);
  }

  // Is cell (a, b) of a level-`lvl` tile at (x0, z0) drawn by a finer tile?
  const coveredBy = (lvl, x0, z0, step) => (a, b) => {
    const f = LEVELS[lvl - 1].size, x = x0 + (a + 0.5) * step, z = z0 + (b + 0.5) * step;
    const t = tiles[lvl - 1].get(keyOf(lvl - 1, Math.floor(x / f), Math.floor(z / f)));
    return !!(t && t.drawn);
  };
  function reindex(t) {
    const size = LEVELS[t.lvl].size, step = size / N;
    const c = fillIndex(t.idx.array, t.lvl ? coveredBy(t.lvl, t.x0, t.z0, step) : null);
    t.geo.setDrawRange(0, c);
    t.idx.needsUpdate = true;
    // Wholly under finer tiles: not drawn at all (its skirt would only draw under them).
    t.mesh.visible = c > 4 * N * 12;
  }

  const box = new THREE.Box3();
  function upload(key) {
    const d = lru.get(key);
    const [lvl, i, j] = key.split(':').map(Number);
    if (!d || tiles[lvl].has(key)) return 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.nor, 4, true));
    geo.setAttribute('aCol', new THREE.BufferAttribute(d.col, 4, true));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(d.dep, 1, true));
    const idx = new THREE.BufferAttribute(new Uint16Array(INDEX_LEN), 1);
    geo.setIndex(idx);
    box.min.set(0, d.minY, 0); box.max.set(d.size, d.maxY, d.size);
    geo.boundingBox = box.clone();
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, mats.terrain);
    mesh.position.set(d.x0, 0, d.z0);
    mesh.receiveShadow = lvl === 0 && tier !== 'low';
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    const t = { lvl, i, j, x0: d.x0, z0: d.z0, mesh, geo, idx, drawn: false, veg: [], bytes: 0 };
    reindex(t);
    group.add(mesh);
    t.bytes = d.pos.byteLength + d.nor.byteLength + d.col.byteLength + d.dep.byteLength + INDEX_LEN * 2;
    if (d.veg) {
      t.hi = lvl === 0 && nearHi(t, lastX ?? 0, lastZ ?? 0);
      for (const [type, v] of Object.entries(d.veg)) {
        const pool = pools[lvl > 0 ? `${type}1` : type === 'conifer' && t.hi ? 'coniferHi' : type];
        const block = pool.add(v.m, v.c, v.n, d.x0 - origin.x, d.z0 - origin.z);
        if (block) t.veg.push([pool, block, type]);
      }
    }
    gpuBytes += t.bytes;
    tiles[lvl].set(key, t);
    t.drawn = true;
    // The coarser tile under it loses those cells.
    if (lvl < 3) {
      const c = LEVELS[lvl + 1].size, pk = keyOf(lvl + 1, Math.floor(d.x0 / c), Math.floor(d.z0 / c));
      const parent = tiles[lvl + 1].get(pk);
      if (parent) reindex(parent);
    }
    return 1;
  }
  // Detailed spruces on the level-0 tiles nearest the camera, simple ones beyond; a tile swaps its
  // spruces between the pools as the camera comes and goes (from the cached arrays).
  const nearHi = (t, cx, cz) => wantHi(Math.hypot(t.x0 + 64 - cx, t.z0 + 64 - cz), cfg.hiR, !!t.hi);
  function swapSpruces(t, hi) {
    const d = lru.get(keyOf(0, t.i, t.j));
    if (!d || !d.veg || !d.veg.conifer) return false;
    const k = t.veg.findIndex((e) => e[2] === 'conifer');
    if (k < 0) return false;
    t.veg[k][0].release(t.veg[k][1]);
    const pool = pools[hi ? 'coniferHi' : 'conifer'], v = d.veg.conifer;
    const block = pool.add(v.m, v.c, v.n, d.x0 - origin.x, d.z0 - origin.z);
    if (block) t.veg[k] = [pool, block, 'conifer']; else t.veg.splice(k, 1);
    t.hi = hi;
    return true;
  }
  function drop(t) {
    t.drawn = false;
    group.remove(t.mesh);
    t.geo.dispose();
    for (const [pool, block] of t.veg) pool.release(block);
    gpuBytes -= t.bytes;
    tiles[t.lvl].delete(keyOf(t.lvl, t.i, t.j));
    if (t.lvl < 3) {
      const c = LEVELS[t.lvl + 1].size, parent = tiles[t.lvl + 1].get(keyOf(t.lvl + 1, Math.floor(t.x0 / c), Math.floor(t.z0 / c)));
      if (parent) reindex(parent);
    }
  }

  // --- Road chunks (built in the worker, src/world/roadchunk.js) ---------------------------------
  const chunks = new Map();                      // c → group
  const g3 = [0, 0, 0], h3 = [0, 0, 0];
  function uploadChunk(key) {
    const c = Number(key.slice(2));
    const d = lru.get(key);
    if (!d || chunks.has(c)) return 0;
    const g = chunkFromData(d, mats);
    group.add(g);
    gpuBytes += g.userData.bytes;
    chunks.set(c, g);
    return 1;
  }
  function dropChunk(c) {
    const g = chunks.get(c);
    group.remove(g);
    gpuBytes -= g.userData.bytes || 0;
    // Geometries only: the prop geometries (posts, delineators) are shared and stay.
    g.traverse((o) => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    chunks.delete(c);
  }
  const chunkKey = (c) => `r:${c}`;

  // --- Objects ------------------------------------------------------------------------------------
  const objectView = course.objects ? createObjectView(course.objects, group, U) : null;

  // --- Planning -----------------------------------------------------------------------------------
  // What should exist around (cx, cz), looking `ax, az` metres ahead (where the car will be in ≈ 3 s).
  const queue = [];        // { kind: 't' | 'r', key | c, d }
  let planX = 1e9, planZ = 1e9, lastPlan = -1e9;
  const fx = { x: 0, z: 0 };
  function plan(cx, cz, ax, az) {
    queue.length = 0;
    const px = cx + ax, pz = cz + az;          // the point a little ahead weighs priorities
    for (let lvl = 0; lvl < 4; lvl++) {
      const size = LEVELS[lvl].size, R = cfg.radius[lvl];
      const i0 = Math.floor((cx - R) / size), i1 = Math.floor((cx + R) / size), j0 = Math.floor((cz - R) / size), j1 = Math.floor((cz + R) / size);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const dx = Math.max(0, Math.abs(cx - (i + 0.5) * size) - size / 2), dz = Math.max(0, Math.abs(cz - (j + 0.5) * size) - size / 2);
        if (dx * dx + dz * dz > R * R) continue;
        const key = keyOf(lvl, i, j);
        if (tiles[lvl].has(key)) continue;
        const ex = Math.max(0, Math.abs(px - (i + 0.5) * size) - size / 2), ez = Math.max(0, Math.abs(pz - (j + 0.5) * size) - size / 2);
        // Nearer first; a coarse tile counts as nearer than it is (it's cheap and fills the view).
        queue.push({ kind: 't', key, lvl, i, j, d: Math.hypot(ex, ez) * (lvl === 0 ? 1 : 0.6) + lvl * 30 });
      }
      // Drop what's well past the ring.
      for (const t of [...tiles[lvl].values()]) {
        const dx = Math.max(0, Math.abs(cx - (t.i + 0.5) * size) - size / 2), dz = Math.max(0, Math.abs(cz - (t.j + 0.5) * size) - size / 2);
        if (dx * dx + dz * dz > (R + size * 0.75) * (R + size * 0.75)) drop(t);
      }
    }
    let swaps = 0;
    for (const t of tiles[0].values()) {
      const hi = nearHi(t, cx, cz);
      if (t.hi !== hi && swaps < 4 && swapSpruces(t, hi)) swaps++;
    }
    // Road chunks: generated far enough, built within roadR.
    road.ensure(cz + cfg.roadR + 400);
    const nC = Math.floor((road.n - 4) / CHUNK);
    let s0 = nearestSample(road, cx, cz, fx.hint ?? -1, 400);
    // A jump (a reset, a teleport): search the whole road again.
    if (Math.hypot(road.x[s0] - cx, road.z[s0] - cz) > 300) s0 = nearestSample(road, cx, cz, -1);
    fx.hint = s0;
    const span = Math.ceil((cfg.roadR * 1.6) / (CHUNK * road.meta.spacing));
    const c0 = Math.max(0, Math.floor(s0 / CHUNK) - span), c1 = Math.min(nC - 1, Math.floor(s0 / CHUNK) + span);
    for (let c = c0; c <= c1; c++) {
      if (chunks.has(c)) continue;
      const i = Math.min(road.n - 1, c * CHUNK + CHUNK / 2);
      const d = Math.hypot(road.x[i] - cx, road.z[i] - cz) - 100;
      const de = Math.hypot(road.x[i] - px, road.z[i] - pz) - 100;
      if (d < cfg.roadR) queue.push({ kind: 'r', key: chunkKey(c), c, d: Math.max(0, de) * 0.6 - 60 });
    }
    for (const c of [...chunks.keys()]) {
      const i = Math.min(road.n - 1, c * CHUNK + CHUNK / 2);
      if (Math.hypot(road.x[i] - cx, road.z[i] - cz) > cfg.roadR + 600) dropChunk(c);
    }
    queue.sort((a, b) => a.d - b.d);
  }

  // Hand out tile jobs: from the LRU (instant), from disk (async), or to a worker.
  function dispatch() {
    for (const job of queue) {
      if (pending.has(job.key)) continue;
      if (job.kind === 'r') {
        if (chunks.has(job.c)) continue;
        if (lru.has(job.key)) { if (!ready.includes(job.key)) ready.push(job.key); continue; }
        const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
        if (w.busy >= inflight) break;
        pending.set(job.key, job);
        w.busy++; w.worker.postMessage({ type: 'chunk', key: job.key, gen: epoch, c: job.c });
        continue;
      }
      if (job.kind !== 't' || tiles[job.lvl].has(job.key)) continue;
      if (lru.has(job.key)) { if (!ready.includes(job.key)) { ready.push(job.key); wstat.fromLru++; } continue; }
      const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (w.busy >= inflight) break;
      pending.set(job.key, job);
      const veg = job.lvl === 0 ? cfg.veg0 : job.lvl === 1 && cfg.veg1 && job.d < cfg.vegR1 ? cfg.veg1 : null;
      const send = () => { w.busy++; w.worker.postMessage({ type: 'tile', key: job.key, gen: epoch, lvl: job.lvl, i: job.i, j: job.j, veg }); };
      if (disk && job.lvl >= 1) {
        w.busy++;
        disk.get(diskKey(job.key)).then((t) => {
          w.busy--;
          if (t && t.pos) { lru.set(job.key, t, tileBytes(t)); ready.push(job.key); wstat.fromDisk++; } else send();
        });
      } else send();
    }
  }

  // The frame's work, under the budget: uploads (nearest first), then road chunks.
  const perf = { frameMs: 0, samples: [], uploads: 0, chunksBuilt: 0, chunkMs: 0 };
  function work(budgetMs, cx, cz) {
    const t0 = performance.now();
    // Uploads in queue order (ready keys sorted by their job's priority).
    if (ready.length > 1) {
      const pri = new Map(queue.map((j) => [j.key, j.d]));
      ready.sort((a, b) => (pri.get(a) ?? 1e9) - (pri.get(b) ?? 1e9));
    }
    while (ready.length && performance.now() - t0 < budgetMs) {
      const key = ready.shift();
      pending.delete(key);
      if (key[0] === 'r') { const tc = performance.now(); perf.chunksBuilt += uploadChunk(key); perf.chunkMs = Math.max(perf.chunkMs, performance.now() - tc); continue; }
      const [lvl, i, j] = key.split(':').map(Number);
      const size = LEVELS[lvl].size, R = cfg.radius[lvl];
      const dx = Math.max(0, Math.abs(cx - (i + 0.5) * size) - size / 2), dz = Math.max(0, Math.abs(cz - (j + 0.5) * size) - size / 2);
      if (dx * dx + dz * dz > (R + size * 0.5) * (R + size * 0.5)) continue;       // out of range by now
      perf.uploads += upload(key);
    }
    // Over the GPU budget: drop the farthest drawn level-0/1 tiles beyond their inner rings.
    if (gpuBytes > cfg.gpuMB * 1024 * 1024) {
      const all = [];
      for (let lvl = 0; lvl < 2; lvl++) for (const t of tiles[lvl].values()) { const s = LEVELS[lvl].size; all.push([Math.hypot((t.i + 0.5) * s - cx, (t.j + 0.5) * s - cz) / cfg.radius[lvl], t]); }
      all.sort((a, b) => b[0] - a[0]);
      for (const [r, t] of all) { if (gpuBytes <= cfg.gpuMB * 1024 * 1024 * 0.9 || r < 0.7) break; drop(t); }
    }
  }

  // --- Per frame ----------------------------------------------------------------------------------
  let lastX = null, lastZ = null, velX = 0, velZ = 0;
  function update(camera, time, dt = 1 / 60) {
    const t0 = performance.now();
    U.cgTime.value = time;
    sky.position.copy(camera.position);
    const cx = camera.position.x, cz = camera.position.z;
    rebase(cx, cz);
    if (lastX !== null && dt > 0) { const k = Math.min(1, dt * 2); velX += ((cx - lastX) / dt - velX) * k; velZ += ((cz - lastZ) / dt - velZ) * k; }
    lastX = cx; lastZ = cz;
    if (Math.hypot(cx - planX, cz - planZ) > 24 || time - lastPlan > 0.5) {
      plan(cx, cz, velX * 3, velZ * 3); planX = cx; planZ = cz; lastPlan = time;
    }
    dispatch();
    work(cfg.budget, cx, cz);
    objectView?.update(time);
    perf.frameMs = performance.now() - t0;
    perf.samples.push(perf.frameMs); if (perf.samples.length > 600) perf.samples.shift();
  }

  // Everything near a point, now (behind the loading screen): waits for the workers.
  async function prime(x, z, onProgress, { signal = null } = {}) {
    planX = x; planZ = z; lastX = x; lastZ = z;
    rebase(x, z);
    road.ensure(z + cfg.roadR + 400);
    plan(x, z, 0, 0);
    const need = queue.filter((j) => (j.kind === 't' && (j.lvl >= 2 || j.d < cfg.radius[j.lvl] * 0.6)) || (j.kind === 'r' && j.d < 900));
    const total = need.length;
    const t0 = performance.now();
    inflight = 64;                            // nothing else to do yet: queue everything (the page may be busy drawing)
    for (;;) {
      dispatch();
      work(40, x, z);
      const left = need.filter((j) => (j.kind === 't' ? !tiles[j.lvl].has(j.key) : !chunks.has(j.c))).length;
      onProgress?.(1 - left / Math.max(1, total));
      if (!left || performance.now() - t0 > 30000) break;
      // Cancelled (Back), or no worker left to build anything: stop waiting.
      if (signal?.aborted) { inflight = cfg.inflight; throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }
      if (workersDown >= workers.length) { inflight = cfg.inflight; throw new Error('the terrain workers could not start'); }
      await new Promise((r) => { wake = r; setTimeout(r, 40); });
    }
    inflight = cfg.inflight;
    plan(x, z, 0, 0);
  }

  // Is the ground under (x, z) drawn at full detail (level 0), and the road chunk there built?
  function coverage(x, z, s) {
    const t0 = tiles[0].get(keyOf(0, Math.floor(x / LEVELS[0].size), Math.floor(z / LEVELS[0].size)));
    const i = s != null ? s : nearestSample(road, x, z, fx.hint ?? -1, 200);
    return { terrain: !!(t0 && t0.drawn), road: chunks.has(Math.floor(i / CHUNK)) };
  }

  function stats() {
    let tris = 0, draws = 0;
    group.traverse((o) => {
      if (!o.visible || !o.isMesh) return;
      draws++;
      const g = o.geometry, n = g.drawRange.count !== Infinity ? g.drawRange.count : g.index ? g.index.count : g.attributes.position.count;
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    const ws = wstat.samples.slice().sort((a, b) => a - b), pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    const fs = perf.samples.slice().sort((a, b) => a - b);
    return {
      seed, tiles: tiles.map((m) => m.size), chunks: chunks.size, veg: Object.fromEntries(Object.entries(pools).map(([k, p]) => [k, p.stats().used])), queue: queue.length, pending: pending.size, ready: ready.length,
      draws, tris: Math.round(tris), gpuMB: +((gpuBytes + Object.values(pools).reduce((a, p) => a + p.bytes, 0)) / 1048576).toFixed(1), cacheMB: +(lru.stats().bytes / 1048576).toFixed(1),
      worker: { built: wstat.built, avgMs: +(wstat.built ? wstat.ms / wstat.built : 0).toFixed(2), p95Ms: +pct(ws, 0.95).toFixed(2), maxMs: +wstat.msMax.toFixed(2), errors: wstat.errors, fromLru: wstat.fromLru, fromDisk: wstat.fromDisk },
      main: { lastMs: +perf.frameMs.toFixed(2), p50Ms: +pct(fs, 0.5).toFixed(2), p95Ms: +pct(fs, 0.95).toFixed(2), maxMs: +(fs[fs.length - 1] || 0).toFixed(2), uploads: perf.uploads, chunksUploaded: perf.chunksBuilt, chunkUploadMaxMs: +perf.chunkMs.toFixed(2) },
      chunkWorker: { built: cstat.built, avgMs: +(cstat.built ? cstat.ms / cstat.built : 0).toFixed(2), maxMs: +cstat.msMax.toFixed(2) },
      road: { km: +(road.length / 1000).toFixed(2), samples: road.n },
    };
  }

  function dispose() {
    epoch++;
    for (const w of workers) w.worker.terminate();
    for (let lvl = 0; lvl < 4; lvl++) for (const t of [...tiles[lvl].values()]) drop(t);
    for (const c of [...chunks.keys()]) dropChunk(c);
    for (const p of Object.values(pools)) p.dispose();
    objectView?.dispose();
    disposeTree(group);
    look.env?.dispose?.();
    for (const m of Object.values(mats)) m.dispose();
    lru.clear();
  }

  // --- The world API ------------------------------------------------------------------------------
  const objects = course.objects;
  const q = { seg: -1, t: 0, lat: 0, yc: 0, hw: 0, bank: 0, u: 0, other: Infinity };
  const api = {
    seed, road, course, objects,
    // Height and normal of the ground the car drives on at (x, z) (the road's ribbon where it is).
    groundAt(x, z) {
      road.ensure(z);
      const hN = road.dem(x, z, h3)[0];
      let y = groundAt(road, x, hN, z, g3)[0], nx = -g3[1], ny = 1, nz = -g3[2];
      if (nearestSeg(road, x, hN, z, q) && Math.abs(q.lat) <= q.hw + SHOULDER && !(road.flags[q.seg] & 2)) {
        y = q.yc + q.bank * Math.max(-q.hw, Math.min(q.hw, q.lat)); nx = 0; nz = 0;
      }
      const l = Math.hypot(nx, ny, nz);
      return { y, normal: { x: nx / l, y: ny / l, z: nz / l } };
    },
    biomeAt: (x, z) => ['Mountain pass', 'Coast road', 'Desert', 'Forest'][road.terrain.biomeAt(x, z)],
    // A pose on the road s m from its start, in the right-hand lane (dir −1: facing back down it).
    roadPoseAt(s, dir = 1) { road.generate(Math.ceil(s / road.meta.spacing) + 8); return { ...poseAt(road, s, dir) }; },
    // The nearest point of the road to (x, z): its distance along (s), offset (lat, + left), half-width.
    nearestRoad(x, z) {
      road.ensure(z);
      if (!nearestSeg(road, x, road.dem(x, z, h3)[0], z, q)) return null;
      return { s: q.seg * road.meta.spacing + q.t, lat: q.lat, hw: q.hw, y: q.yc, biome: biomeName(road, q.seg) };
    },
    addObject(spec) { if (!objects) throw new Error('this world has no object registry'); return objects.add(spec); },
    removeObject: (id) => objects?.remove(id) ?? false,
    getObject: (id) => objects?.get(id) ?? null,
    objectsNear: (pos, r = 50) => objects?.near(pos.x, pos.z, r) ?? [],
    objectsInChunk: (cx, cz) => objects?.inChunk(cx, cz) ?? [],
    onObjects: (fn) => objects?.onChange(fn) ?? (() => {}),
    exportObjects: () => objects?.toJSON() ?? [],
    importObjects: (list) => objects?.load(list),
    colliders: (minX, minZ, maxX, maxZ) => objects?.colliders(minX, minZ, maxX, maxZ) ?? [],
  };

  setTod(todId);
  return {
    ...api, group, look, setTod, update, prime, dispose, stats, coverage, uniforms: U,
    get tod() { return todId; }, get tiles() { return tiles; }, get chunks() { return chunks; },
  };
}
