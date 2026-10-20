// Crashes, made to read: everything here is keyed to the sim's impact events (src/sim/impacts.js),
// so what you see is what the physics did, and the replay re-shows it from the same record.
//
//   HIT     sparks off the contact, a white flash, glass / carbon / paint chips, a dust ring on
//           concrete, parts torn off (wing, intake vanes, barge boards, skirts) as free bodies,
//           the canopy crazing, lamps flickering out, hazards, a rattled camera, a slow-motion
//           beat and a locked-off crash cut, and a crunch layered by severity
//   SCRAPE  a stream of sparks and the grind of bodywork on concrete
//   WHEEL   tyre smoke and dust from a slammed tyre
//   CRUSH   the body dents where the physics folded it, as deep as it folded; a struck parked
//           car dents and rocks on its springs
//
// Effects are seeded from the event (tick, probe), so a crash looks and sounds the same live and
// in the replay. Pools are allocated once (sparks are instanced streak quads, chips one
// InstancedMesh, smoke one Points cloud); nothing allocates per frame. Pool sizes follow the
// graphics tier. `prefers-reduced-motion` drops the shake, the slow motion and the cut.
import * as THREE from 'three';
import { HULL } from '../sim/vehicle.js';
import { HIT, SCRAPE, WHEEL, CRUSH, PART } from '../sim/impacts.js';
import { LINEUP_SPEC, COURSES, surface } from '../sim/courses.js';
import { SPEC } from '../sim/spec.js';
import { ROADSTER_MATERIALS as RM } from './roadster.js';
import { createPieces } from './debris.js';
import { crunch, setGrind, thud } from '../audio.js';

const POOLS = { high: { sparks: 520, chips: 220, smoke: 320 }, mid: { sparks: 320, chips: 140, smoke: 200 }, low: { sparks: 140, chips: 60, smoke: 90 } };
const G = 9.81;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- Sparks: camera-facing streaks along each spark's velocity, hot white → orange → red ---------
const sparkVS = `
  attribute vec2 corner;
  attribute vec3 iPos; attribute vec3 iVel; attribute vec2 iLife;   // life (1 → 0), heat
  uniform float uWidth; uniform float uStreak;
  varying float vLife; varying float vSide; varying float vHeat;
  void main(){
    vLife = iLife.x; vSide = corner.y; vHeat = iLife.y;
    if (iLife.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 h = viewMatrix * vec4(iPos, 1.0);
    vec4 t = viewMatrix * vec4(iPos - iVel * uStreak, 1.0);
    vec2 d = h.xy - t.xy; float l = length(d);
    vec2 dir = l > 1e-5 ? d / l : vec2(1.0, 0.0);
    vec4 p = mix(h, t, corner.x);
    float w = uWidth * (0.45 + 0.55 * iLife.x);
    p.xy += vec2(-dir.y, dir.x) * corner.y * w + dir * w * (1.0 - corner.x);
    gl_Position = projectionMatrix * p;
  }`;
const sparkFS = `
  varying float vLife; varying float vSide; varying float vHeat;
  void main(){
    float a = 1.0 - vSide * vSide;
    float k = vLife * vHeat;
    vec3 c = mix(vec3(1.0, 0.18, 0.04), mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.93, 0.78), smoothstep(0.55, 1.0, k)), smoothstep(0.0, 0.55, k));
    gl_FragColor = vec4(c * (0.75 + 1.1 * k), a * min(1.0, vLife * 4.0) * 0.85);
  }`;

// --- Smoke / dust: soft round puffs with their own colour ---------------------------------------
const smokeVS = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vA; varying vec3 vC; uniform float scale;
  void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const smokeFS = `
  uniform sampler2D map; varying float vA; varying vec3 vC;
  void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`;

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// The parked row: the group scene.js tags with userData.setBodies; its children are the cars in
// the sim's body order.
function findRow(scene) {
  let row = null;
  scene.traverse((o) => { if (!row && o.userData?.setBodies) row = o; });
  return row;
}

export function createCrash({ scene, hero, carRoot, director, tier = 'high', course = () => 'show' }) {
  const P = POOLS[tier] || POOLS.high;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = new THREE.Group();
  root.name = 'crash-fx';
  scene.add(root);

  // Seeded randomness: reseeded per event, so the replay throws the same sparks.
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sgn = () => rnd() * 2 - 1;
  const reseed = (a, b) => { seed = ((a * 7919 + b * 104729 + 12345) % 2147483646) + 1; for (let i = 0; i < 3; i++) rnd(); };

  // --- Sparks pool ---
  const NS = P.sparks;
  const sPos = new Float32Array(NS * 3), sVel = new Float32Array(NS * 3), sLife = new Float32Array(NS * 2), sDecay = new Float32Array(NS);
  const sgeo = new THREE.InstancedBufferGeometry();
  sgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  sgeo.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
  sgeo.setIndex([0, 2, 1, 1, 2, 3]);
  const aSP = new THREE.InstancedBufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage);
  const aSV = new THREE.InstancedBufferAttribute(sVel, 3).setUsage(THREE.DynamicDrawUsage);
  const aSL = new THREE.InstancedBufferAttribute(sLife, 2).setUsage(THREE.DynamicDrawUsage);
  sgeo.setAttribute('iPos', aSP); sgeo.setAttribute('iVel', aSV); sgeo.setAttribute('iLife', aSL);
  sgeo.instanceCount = 0;
  const smat = new THREE.ShaderMaterial({
    vertexShader: sparkVS, fragmentShader: sparkFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uWidth: { value: 0.011 }, uStreak: { value: 0.022 } },
  });
  const sparks = new THREE.Mesh(sgeo, smat);
  sparks.frustumCulled = false; sparks.renderOrder = 4;
  root.add(sparks);
  let sHead = 0, sLive = 0;

  function spark(x, y, z, vx, vy, vz, heat, life) {
    const j = sHead; sHead = (sHead + 1) % NS;
    sPos[j * 3] = x; sPos[j * 3 + 1] = y; sPos[j * 3 + 2] = z;
    sVel[j * 3] = vx; sVel[j * 3 + 1] = vy; sVel[j * 3 + 2] = vz;
    sLife[j * 2] = 1; sLife[j * 2 + 1] = heat; sDecay[j] = 1 / life;
    sLive = Math.max(sLive, j + 1);
  }

  // --- Chips: glass, carbon and paint fragments (one InstancedMesh) ---
  const NC = P.chips;
  const chipGeo = new THREE.TetrahedronGeometry(1, 0);
  const chipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.5, envMapIntensity: 2.2 });
  const chips = new THREE.InstancedMesh(chipGeo, chipMat, NC);
  chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chips.frustumCulled = false; chips.castShadow = false;
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < NC; i++) { chips.setMatrixAt(i, zeroM); chips.setColorAt(i, new THREE.Color(1, 1, 1)); }
  root.add(chips);
  const cPos = new Float32Array(NC * 3), cVel = new Float32Array(NC * 3), cRot = new Float32Array(NC * 4), cSpin = new Float32Array(NC * 3), cScale = new Float32Array(NC * 3), cLife = new Float32Array(NC);
  let cHead = 0;
  const col = new THREE.Color(), m4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  function chip(x, y, z, vx, vy, vz, size, hex, flat) {
    const j = cHead; cHead = (cHead + 1) % NC;
    cPos[j * 3] = x; cPos[j * 3 + 1] = y; cPos[j * 3 + 2] = z;
    cVel[j * 3] = vx; cVel[j * 3 + 1] = vy; cVel[j * 3 + 2] = vz;
    qa.set(sgn(), sgn(), sgn(), sgn() + 0.01).normalize();
    cRot[j * 4] = qa.x; cRot[j * 4 + 1] = qa.y; cRot[j * 4 + 2] = qa.z; cRot[j * 4 + 3] = qa.w;
    cSpin[j * 3] = sgn() * 22; cSpin[j * 3 + 1] = sgn() * 22; cSpin[j * 3 + 2] = sgn() * 22;
    cScale[j * 3] = size * (0.6 + rnd()); cScale[j * 3 + 1] = size * (flat ? 0.12 : 0.5 + rnd() * 0.6); cScale[j * 3 + 2] = size * (0.6 + rnd());
    cLife[j] = 4 + rnd() * 3;
    col.setHex(hex); chips.setColorAt(j, col);
    chips.instanceColor.needsUpdate = true;
  }

  // --- Smoke, dust, condensation (one Points cloud) ---
  const NM = P.smoke;
  const mPos = new Float32Array(NM * 3), mVel = new Float32Array(NM * 3), mLife = new Float32Array(NM), mDecay = new Float32Array(NM), mSize0 = new Float32Array(NM), mGrow = new Float32Array(NM), mAlpha0 = new Float32Array(NM);
  const mSize = new Float32Array(NM), mAlpha = new Float32Array(NM), mCol = new Float32Array(NM * 3);
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute('aSize', new THREE.BufferAttribute(mSize, 1).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute('aAlpha', new THREE.BufferAttribute(mAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute('aColor', new THREE.BufferAttribute(mCol, 3).setUsage(THREE.DynamicDrawUsage));
  const soft = softTexture();
  const mmat = new THREE.ShaderMaterial({ vertexShader: smokeVS, fragmentShader: smokeFS, transparent: true, depthWrite: false, uniforms: { map: { value: soft }, scale: { value: 600 } } });
  const smoke = new THREE.Points(mgeo, mmat);
  smoke.frustumCulled = false; smoke.renderOrder = 2;
  root.add(smoke);
  let mHead = 0;
  function puff(x, y, z, vx, vy, vz, size, grow, life, alpha, r, g, b) {
    const j = mHead; mHead = (mHead + 1) % NM;
    mPos[j * 3] = x; mPos[j * 3 + 1] = y; mPos[j * 3 + 2] = z;
    mVel[j * 3] = vx; mVel[j * 3 + 1] = vy; mVel[j * 3 + 2] = vz;
    mLife[j] = 1; mDecay[j] = 1 / life; mSize0[j] = size; mGrow[j] = grow; mAlpha0[j] = alpha;
    mCol[j * 3] = r; mCol[j * 3 + 1] = g; mCol[j * 3 + 2] = b;
  }

  // --- Flash: a white-hot bloom at the contact for a few frames ---
  const flashMat = new THREE.SpriteMaterial({ map: soft, color: new THREE.Color(3, 2.6, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flash = new THREE.Sprite(flashMat);
  flash.visible = false; flash.renderOrder = 5;
  root.add(flash);
  let flashT = 0, flashS = 1;

  // --- Parts that tear off: free rigid copies (src/render/debris.js) ---
  // Each breakable is one or more pieces, each a box with its own visual, spawned at the part's
  // pose on the car when a hit is hard enough at the right end; the part on the car hides.
  const pieces = createPieces(root);
  const breakable = [];
  const zF = SPEC.wheelbase - SPEC.comFromFront;
  const SKIRT_Y = SPEC.rideHeight + 0.012 + 0.06;          // roadster.js: skirt top + half its height
  const bbox = new THREE.Box3();
  function piece(name, src, center, visual, half, hits, min) {
    if (!src) return;
    breakable.push({ name, src, center, visual, piece: pieces.add(visual, half), hits, min });
  }
  // A clone of a part, centred on its bounds (children keep their own local poses).
  function centred(src) {
    const c = src.clone();
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
    c.updateMatrixWorld(true);
    bbox.setFromObject(c);
    const center = bbox.getCenter(new THREE.Vector3()), half = bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    c.position.copy(center).negate();
    const wrap = new THREE.Group(); wrap.add(c);
    return { wrap, clone: c, center, half };
  }
  if (hero.parts) {
    const P_ = hero.parts;
    { const w = centred(P_.wing); piece('wing', P_.wing, w.center, w.wrap, w.half, [PART.tail], 5.5); breakable[breakable.length - 1].clone = w.clone; }
    { const w = centred(P_.vanes); piece('vanes', P_.vanes, w.center, w.wrap, w.half, [PART.nose], 5); }
    const skirtMat = RM.rubber, barge = RM.carbon, SKIRT_HITS = [PART.floor, PART.side, PART.nose, PART.tail];
    for (const s of [-1, 1]) {
      piece('skirts', P_.sideSkirts, new THREE.Vector3(s * 0.8, SKIRT_Y, 0), new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.12, 1.9), skirtMat), new THREE.Vector3(0.007, 0.06, 0.95), SKIRT_HITS, 6);
      piece('skirts', P_.endSkirts, new THREE.Vector3(0, SKIRT_Y, s * 0.95), new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.014), skirtMat), new THREE.Vector3(0.8, 0.06, 0.007), SKIRT_HITS, 6);
      piece('barge', P_.barge, new THREE.Vector3(s * 0.93, 0.25, zF - 0.5), new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.26), barge), new THREE.Vector3(0.006, 0.08, 0.13), [PART.nose, PART.side], 7);
    }
  }
  // Copy the original's children's local poses onto the clone (the wing deploys, the clone follows).
  function syncPose(src, dst) {
    for (let i = 0; i < src.children.length && i < dst.children.length; i++) {
      const a = src.children[i], b = dst.children[i];
      b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); b.visible = a.visible;
      syncPose(a, b);
    }
  }
  const brokenNow = new Set();
  const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bv = new THREE.Vector3(), bw = new THREE.Vector3();
  function tearOff(part, v, sev, nx, ny, nz) {
    brokenNow.clear();
    for (const b of breakable) {
      if (b.piece.on || v < b.min || !b.src.visible) continue;
      if (!b.hits.includes(part) && !(v > 11 && rnd() < 0.5)) continue;
      b.src.updateWorldMatrix(true, true);
      if (b.clone) syncPose(b.src, b.clone);
      b.src.matrixWorld.decompose(bp, bq, bs);
      bp.copy(b.center).applyMatrix4(b.src.matrixWorld);
      const kick = 1.5 + 4 * sev;
      bv.set(carVel.x * 0.85 + nx * kick + sgn() * 1.2, carVel.y * 0.4 + Math.abs(ny) * kick * 0.6 + 1 + rnd() * 2, carVel.z * 0.85 + nz * kick + sgn() * 1.2);
      bw.set(sgn() * 8, sgn() * 6, sgn() * 8);
      pieces.spawn(b.piece, bp, bq, bv, bw);
      brokenNow.add(b.name);
    }
    for (const name of brokenNow) hero.setBroken?.(name, true);
  }

  // --- Dents: the hero's skin and the struck parked cars ---
  // The hero's merged skin gets its own geometry (the ghost keeps the pristine one).
  const skinMats = new Set([RM.paint, RM.black, RM.glass, RM.carbon, RM.under]);
  const skins = [];
  for (const m of hero.body?.children || []) {
    if (!m.isMesh || !skinMats.has(m.material) || m.geometry.attributes.position.count < 200) continue;
    m.geometry = m.geometry.clone();
    skins.push(dentable(m));
  }
  function dentable(mesh) {
    const g = mesh.geometry;
    return { mesh, orig: g.attributes.position.array.slice(), origN: g.attributes.normal ? g.attributes.normal.array.slice() : null, dirty: false };
  }
  const crazed = new THREE.MeshPhysicalMaterial({ color: 0x9a8a74, metalness: 0.15, roughness: 0.55, transparent: true, opacity: 0.9, envMapIntensity: 1.1, name: 'roadster-glass-crazed' });
  const warm = new THREE.Mesh(new THREE.BufferGeometry(), crazed);   // compiled with the scene (stage.ready)
  warm.visible = false; root.add(warm);
  const canopyMat = hero.canopy?.material;

  const inv = new THREE.Matrix4(), lp = new THREE.Vector3(), ld = new THREE.Vector3(), nq = new THREE.Quaternion();
  // Push vertices within `radius` of local point lp along local direction ld by up to `depth`.
  function dent(d, radius, depth, salt) {
    const g = d.mesh.geometry, pa = g.attributes.position, a = pa.array, R2 = radius * radius;
    let hit = false;
    for (let i = 0, n = pa.count; i < n; i++) {
      const dx = a[i * 3] - lp.x, dy = a[i * 3 + 1] - lp.y, dz = a[i * 3 + 2] - lp.z, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= R2) continue;
      const w = 1 - r2 / R2, h = Math.sin(i * 12.9898 + salt) * 43758.5453;
      const k = depth * w * w * (0.7 + 0.6 * (h - Math.floor(h)));
      a[i * 3] += ld.x * k; a[i * 3 + 1] += ld.y * k; a[i * 3 + 2] += ld.z * k;
      hit = true;
    }
    if (!hit) return;
    pa.needsUpdate = true; d.dirty = true;
    if (g.index) { g.computeVertexNormals(); return; }
    // Non-indexed (the hero's merged skin): crumpled facets, flat-shaded where it moved.
    const na = g.attributes.normal?.array;
    if (!na) return;
    for (let t = 0; t < pa.count; t += 3) {
      let near = false;
      for (let v = t; v < t + 3 && !near; v++) {
        const dx = a[v * 3] - lp.x, dy = a[v * 3 + 1] - lp.y, dz = a[v * 3 + 2] - lp.z;
        near = dx * dx + dy * dy + dz * dz < R2;
      }
      if (!near) continue;
      va.set(a[t * 3 + 3] - a[t * 3], a[t * 3 + 4] - a[t * 3 + 1], a[t * 3 + 5] - a[t * 3 + 2]);
      vb.set(a[t * 3 + 6] - a[t * 3], a[t * 3 + 7] - a[t * 3 + 1], a[t * 3 + 8] - a[t * 3 + 2]);
      vc.crossVectors(va, vb).normalize();
      for (let v = t; v < t + 3; v++) { na[v * 3] = vc.x; na[v * 3 + 1] = vc.y; na[v * 3 + 2] = vc.z; }
    }
    g.attributes.normal.needsUpdate = true;
  }
  function restore(d) {
    if (!d.dirty) return;
    const g = d.mesh.geometry;
    g.attributes.position.array.set(d.orig); g.attributes.position.needsUpdate = true;
    if (d.origN) { g.attributes.normal.array.set(d.origN); g.attributes.normal.needsUpdate = true; }
    d.dirty = false;
  }
  // Dent the hero at hull probe `probe`, pushed in along the contact normal (world).
  const applied = new Float32Array(HULL.length);
  function dentHero(probe, crush, nx, ny, nz, salt) {
    const delta = crush - applied[probe];
    if (delta <= 0.002) return;
    applied[probe] = crush;
    nq.copy(carRoot.quaternion).invert();
    for (const d of skins) {
      // Skin local = physics body frame + comHeight (the model is built in the ground frame).
      lp.set(HULL[probe].x, HULL[probe].y + SPEC.comHeight, HULL[probe].z);
      // Probes sit a few cm inside the skin; centre the dent on the skin, 6 cm further out.
      ld.set(nx, ny, nz).applyQuaternion(nq);
      lp.addScaledVector(ld, -0.06);
      dent(d, 0.42 + crush * 1.3, delta * 1.15, salt);
    }
  }
  // Parked cars: their meshes, made dentable on first contact.
  let row = null;
  const parked = [];          // per body: { car, meshes: [dentable], rock: {...}, mass }
  function parkedFor(i) {
    if (!row) return null;
    const car = row.children[i];
    if (!car) return null;
    let p = parked[i];
    if (!p || p.car !== car) {
      const meshes = [];
      car.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position || o.geometry.attributes.position.count < 60) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (o.geometry.boundingSphere.radius < 0.5) return;        // wheels, lamps, trim
        o.geometry = o.geometry.clone();
        meshes.push(dentable(o));
      });
      const spec = LINEUP_SPEC[i] || LINEUP_SPEC[0];
      p = parked[i] = { car, meshes, ax: 0, az: 0, sy: 0, vax: 0, vaz: 0, vsy: 0, k: 1 / Math.max(1, spec.w * spec.l * spec.h / 12), paint: spec.paint };
    }
    return p;
  }
  const wp = new THREE.Vector3();
  function dentParked(i, x, y, z, nx, ny, nz, depth, salt) {
    const p = parkedFor(i);
    if (!p) return;
    for (const d of p.meshes) {
      const m = d.mesh;
      m.updateWorldMatrix(true, false);
      inv.copy(m.matrixWorld).invert();
      lp.set(x, y, z).applyMatrix4(inv);
      // Into the parked car: against the normal (which points out of it, toward the roadster).
      wp.set(x - nx, y - ny, z - nz).applyMatrix4(inv);
      ld.copy(wp).sub(lp).normalize();
      dent(d, 0.45 + depth * 1.2, depth, salt);
    }
  }
  function rockParked(i, x, z, nx, ny, nz, speed) {
    const p = parkedFor(i);
    if (!p) return;
    const k = Math.min(1.6, speed * 0.09) * p.k;
    // Pushed down where it was hit: the side it was hit on dips, the springs bring it back.
    p.vsy -= k * 0.6 * Math.max(0.2, ny);
    p.vax -= k * (z - p.car.position.z) * 0.9 * Math.max(0.2, ny) - k * nz * 0.4;
    p.vaz += k * (x - p.car.position.x) * 0.25 * Math.max(0.2, ny) + k * nx * 0.4;
  }

  // --- State ---
  const st = {
    cursor: 0, lastTick: -1, slowT: 0, slowK: 1, cutDone: false, bigT: -10, shake: 0,
    head: 1, tail: 1, headFail: 0, tailFail: 0, headDead: false, tailDead: false, hazardT: -1, hazard: false,
    grind: 0, ventT: 0, glass: false, clock: 0,
  };
  const carVel = new THREE.Vector3(), up = new THREE.Vector3(), tailW = new THREE.Vector3();

  function reset() {
    sLife.fill(0); sLive = 0; sgeo.instanceCount = 0; aSL.needsUpdate = true;
    cLife.fill(0); for (let i = 0; i < NC; i++) chips.setMatrixAt(i, zeroM); chips.instanceMatrix.needsUpdate = true;
    mLife.fill(0); mAlpha.fill(0); mgeo.attributes.aAlpha.needsUpdate = true;
    flash.visible = false; flashT = 0;
    pieces.reset();
    for (const b of breakable) hero.setBroken?.(b.name, false);
    for (const d of skins) restore(d);
    applied.fill(0);
    if (hero.canopy && canopyMat) hero.canopy.material = canopyMat;
    for (const p of parked) {
      if (!p) continue;
      for (const d of p.meshes) restore(d);
      p.ax = p.az = p.sy = p.vax = p.vaz = p.vsy = 0;
      p.car.rotation.x = 0; p.car.rotation.z = 0;
    }
    row = findRow(scene);
    Object.assign(st, { cursor: 0, lastTick: -1, slowT: 0, slowK: 1, cutDone: false, bigT: -10, head: 1, tail: 1, headFail: 0, tailFail: 0, headDead: false, tailDead: false, hazardT: -1, hazard: false, grind: 0, ventT: 0, glass: false });
    hero.setDamage?.(1, 1, false);
    setGrind(0);
  }

  // --- One event ---
  function onEvent(imp, i) {
    const kind = imp.kind[i], part = imp.part[i], body = imp.body[i], v = imp.speed[i];
    const x = imp.x[i], y = imp.y[i], z = imp.z[i], nx = imp.nx[i], ny = imp.ny[i], nz = imp.nz[i];
    reseed(imp.tick[i], imp.probe[i] + kind * 37);
    // Tangent: the car's sliding direction along the surface.
    const vn = carVel.x * nx + carVel.y * ny + carVel.z * nz;
    const tx = carVel.x - vn * nx, ty = carVel.y - vn * ny, tz = carVel.z - vn * nz;
    const onGround = body < 0;
    if (kind === SCRAPE) {
      if (v < 3) return;
      // The floor is skirts and a flat pan: it throws sparks only when it really grinds.
      const n = part === PART.floor ? Math.min(6, Math.round((v - 6) * 0.6)) : Math.min(7, Math.round((v - 2.5) * (onGround ? 0.7 : 0.35)));
      for (let k = 0; k < n; k++) {
        const s = 0.5 + rnd() * 0.9;
        spark(x + sgn() * 0.15, y + 0.02, z + sgn() * 0.15, tx * s + nx * (1 + rnd() * 3) + sgn() * 2, ty * s + ny * (1 + rnd() * 3) + rnd() * 2.5, tz * s + nz * (1 + rnd() * 3) + sgn() * 2, 0.7 + rnd() * 0.3, 0.35 + rnd() * 0.5);
      }
      if (part !== PART.floor && onGround && rnd() < 0.6) puff(x, y + 0.1, z, tx * 0.3 + sgn(), 0.2 + rnd() * 0.5, tz * 0.3 + sgn(), 0.5, 3.5, 1.6, 0.16, 0.5, 0.49, 0.47);
      st.grind = Math.max(st.grind, clamp01((v - 2.5) / 9));
      return;
    }
    if (kind === WHEEL) {
      const sev = clamp01((v - 3) / 7);
      for (let k = 0; k < 6 + sev * 10; k++) {
        const a = rnd() * Math.PI * 2, sp = 1.5 + rnd() * 3 * (0.5 + sev);
        puff(x + Math.cos(a) * 0.2, y + 0.12, z + Math.sin(a) * 0.2, Math.cos(a) * sp + carVel.x * 0.3, 0.3 + rnd() * 0.8, Math.sin(a) * sp + carVel.z * 0.3, 0.5, 4 + sev * 3, 1.6 + rnd(), 0.3, 0.8, 0.8, 0.82);
      }
      if (v > 5) thud(1 + sev * 3);   // a landing's own thud is main.js's touchdown
      if (!reduced) director.shake(Math.min(1.2, 0.2 + sev));
      return;
    }
    if (kind === CRUSH) {
      // Folded far enough, the lamps in that end are gone.
      if (part === PART.nose && imp.crush[i] > 0.06 && !st.headDead) { st.headDead = true; st.headFail = Math.max(st.headFail, 0.5); }
      if (part === PART.tail && imp.crush[i] > 0.06 && !st.tailDead) { st.tailDead = true; st.tailFail = Math.max(st.tailFail, 0.5); }
      if (imp.probe[i] < HULL.length) dentHero(imp.probe[i], imp.crush[i], nx, ny, nz, imp.tick[i] * 0.37);
      if (body >= 0) dentParked(body, x, y, z, nx, ny, nz, Math.min(0.3, imp.crush[i] * 0.6), imp.tick[i] * 0.53);
      return;
    }
    // HIT.
    if (v < 1.6) return;
    const sev = clamp01((v - 2) / 12);
    // Sparks off the contact, mostly along the slide and away from the surface.
    const ns = Math.round(10 + 34 * sev);
    for (let k = 0; k < ns; k++) {
      const out = 1.5 + rnd() * 6 * (0.4 + sev), s = 0.3 + rnd() * 0.9;
      spark(x, y + 0.02, z, tx * s + nx * out + sgn() * 3.5, ty * s + ny * out + rnd() * 3, tz * s + nz * out + sgn() * 3.5, 0.75 + rnd() * 0.25, 0.4 + rnd() * 0.7);
    }
    flash.position.set(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2); flashS = 0.35 + 0.9 * sev; flashT = 0.05 + 0.06 * sev; flash.visible = true;
    // Chips: glass from the roof and shoulders, carbon from the nose and tail, paint from both cars.
    const glassy = part === PART.roof || part === PART.side;
    const nChip = Math.round((v > 4 ? 6 : 0) + 40 * sev);
    for (let k = 0; k < nChip; k++) {
      const r = rnd();
      const hex = glassy && r < 0.55 ? (rnd() < 0.7 ? 0xf2ead8 : 0x8a6a44) : part === PART.nose || part === PART.tail ? (r < 0.5 ? 0x16171a : 0xe3e4e2) : r < 0.6 ? 0xe3e4e2 : 0x0c0d0f;
      const pc = body >= 0 && rnd() < 0.4 ? parkedFor(body)?.paint ?? hex : hex;
      const sp = 1 + rnd() * 3.5 * (0.4 + sev);
      chip(x + sgn() * 0.25, y + 0.05 + rnd() * 0.2, z + sgn() * 0.25, carVel.x * 0.6 + nx * sp + sgn() * 2, carVel.y * 0.2 + Math.abs(ny) * sp * 0.6 + 0.5 + rnd() * 2, carVel.z * 0.6 + nz * sp + sgn() * 2,
        glassy && r < 0.55 ? 0.008 + rnd() * 0.018 : 0.012 + rnd() * 0.035, pc, glassy && r < 0.55);
    }
    // Dust ring on concrete, paint dust off a roof.
    // Concrete throws a low ring of dust; a roof, a little paint dust.
    const nPuff = Math.round((onGround ? 4 : 2) + (onGround ? 18 : 5) * sev);
    for (let k = 0; k < nPuff; k++) {
      const a = rnd() * Math.PI * 2, sp = 1 + rnd() * 4.5 * (0.4 + sev);
      const c = onGround ? 0.46 + rnd() * 0.08 : 0.7;
      puff(x + Math.cos(a) * 0.3, y + 0.12, z + Math.sin(a) * 0.3, Math.cos(a) * sp + tx * 0.25, 0.15 + rnd() * 0.8 * (0.4 + sev), Math.sin(a) * sp + tz * 0.25, 0.7, 5 + 6 * sev, 2.2 + rnd() * 1.8, onGround ? 0.2 + 0.12 * sev : 0.12, c, c * 0.97, c * 0.93);
    }
    // Parts tear off: the hardest-hit end loses what hangs off it.
    tearOff(part, v, sev, nx, ny, nz);
    // The canopy crazes when the roof or a shoulder takes it hard.
    if (glassy && v > 6 && !st.glass && hero.canopy) { st.glass = true; hero.canopy.material = crazed; }
    // Lamps: the nose takes the headlamps with it, the tail the taillight; flicker, then out.
    if (part === PART.nose && v > 4) { st.headFail = 0.7 + 0.8 * sev; st.headDead = st.headDead || sev > 0.25; }
    if (part === PART.tail && v > 4) { st.tailFail = 0.6 + 0.6 * sev; st.tailDead = st.tailDead || sev > 0.35; }
    if (sev > 0.6 && part !== PART.floor) { st.headFail = Math.max(st.headFail, 0.6); }
    if (sev > 0.2 && st.hazardT < 0) st.hazardT = 0.9;
    // A big hit vents a nitrogen line: a white jet of condensation for a moment.
    if (sev > 0.55) st.ventT = Math.max(st.ventT, 1.1 + sev);
    // Parked car: a dent and a rock on its springs.
    if (body >= 0) { dentParked(body, x, y, z, nx, ny, nz, Math.min(0.14, 0.003 * v * v), imp.tick[i] * 0.29); rockParked(body, x, z, nx, ny, nz, v); }
    crunch(sev, { glass: glassy && v > 5, seed: imp.tick[i] * 31 + imp.probe[i] });
    if (!reduced) {
      director.shake(Math.min(2.6, 0.25 + v * 0.17));
      // The first big hit of the run: a beat of slow motion and a locked-off crash cut.
      if (v > 6.5 && st.clock - st.bigT > 2.5) {
        st.bigT = st.clock;
        st.slowT = 0.75 + 0.5 * sev;
        if (!st.cutDone) { st.cutDone = true; cutTo(x, y, z); }
      }
    }
  }

  // Place the crash camera beside the impact, looking at the car, with a clear line of sight:
  // the open side first, low, then higher over the roofs, then the other side.
  const camP = new THREE.Vector3(), sn = { x: 0, y: 0, z: 0 };
  const clear = (px, py, pz, x, y, z) => {
    const C = COURSES[course()] || COURSES.show;
    if (surface(C, px, py, pz, sn) < 0.8) return false;
    for (let k = 1; k < 8; k++) {
      const f = k / 8;
      if (surface(C, px + (x - px) * f, py + (y - py) * f, pz + (z - pz) * f, sn) < 0.25) return false;
    }
    return true;
  };
  function cutTo(x, y, z) {
    const sp = Math.hypot(carVel.x, carVel.z);
    const hx = sp > 0.5 ? carVel.x / sp : 0, hz = sp > 0.5 ? carVel.z / sp : -1;
    let sx = hz, sz = -hx;                 // perpendicular to the travel, in plan
    if (sx < 0) { sx = -sx; sz = -sz; }    // the stage's open side (+x) first
    const ty = Math.max(0.5, y) + 0.4;
    for (const side of [1, -1]) {
      for (const h of [Math.max(0.6, Math.min(5, y * 0.45 + 1.0)), 4.6, 7.5]) {
        const px = x + side * sx * 11 + hx * 3.5, pz = z + side * sz * 11 + hz * 3.5;
        if (clear(px, h, pz, x, ty, z)) { camP.set(px, h, pz); director.cut(camP, 1.9, 42); return; }
      }
    }
  }

  // Feed events up to `tick` (live: the run's tick; replay: the frame being shown).
  function feed(imp, tick, vel) {
    if (!imp) return;
    if (tick < st.lastTick) reset();          // the replay looped
    st.lastTick = tick;
    carVel.copy(vel);
    // Catching up a long way (fast-forward, a hidden tab): skip effects older than half a second.
    while (st.cursor < imp.count && imp.tick[st.cursor] <= tick) {
      const i = st.cursor++;
      if (tick - imp.tick[i] > 120 && imp.kind[i] !== CRUSH) continue;
      onEvent(imp, i);
    }
  }

  // Slow motion: the factor to scale the game clock by this frame (1 = normal).
  function timeScale() { return st.slowK; }

  // Per rendered frame (real seconds; particles run on the slowed clock).
  function update(dtReal) {
    st.clock += dtReal;
    // Slow-motion beat: drop to ≈0.2×, hold, ease back.
    if (st.slowT > 0) { st.slowT -= dtReal; st.slowK += (0.2 - st.slowK) * Math.min(1, dtReal * 18); }
    else st.slowK += (1 - st.slowK) * Math.min(1, dtReal * 3.5);
    if (st.slowK > 0.995) st.slowK = 1;
    const dt = dtReal * st.slowK;

    // Sparks: ballistic, a little drag, they bounce once off the concrete and cool.
    if (sLive > 0) {
      let any = false;
      const drag = Math.exp(-dt * 1.2);
      for (let j = 0; j < sLive; j++) {
        if (sLife[j * 2] <= 0) continue;
        sLife[j * 2] -= dt * sDecay[j];
        if (sLife[j * 2] <= 0) { sLife[j * 2] = 0; continue; }
        any = true;
        sVel[j * 3] *= drag; sVel[j * 3 + 1] = sVel[j * 3 + 1] * drag - G * dt; sVel[j * 3 + 2] *= drag;
        sPos[j * 3] += sVel[j * 3] * dt; sPos[j * 3 + 1] += sVel[j * 3 + 1] * dt; sPos[j * 3 + 2] += sVel[j * 3 + 2] * dt;
        if (sPos[j * 3 + 1] < 0.01 && sVel[j * 3 + 1] < 0) { sPos[j * 3 + 1] = 0.01; sVel[j * 3 + 1] *= -0.35; sVel[j * 3] *= 0.7; sVel[j * 3 + 2] *= 0.7; }
      }
      sgeo.instanceCount = any ? sLive : 0;
      if (!any) sLive = 0;
      aSP.needsUpdate = true; aSV.needsUpdate = true; aSL.needsUpdate = true;
    }
    // Chips: tumble, fall, skitter on the ground, rest.
    let chipsMoved = false;
    for (let j = 0; j < NC; j++) {
      if (cLife[j] <= 0) continue;
      cLife[j] -= dt;
      if (cLife[j] <= 0) { chips.setMatrixAt(j, zeroM); chipsMoved = true; continue; }
      const o = j * 3;
      const rest = cPos[o + 1] <= cScale[o + 1] * 0.5 + 0.002 && Math.abs(cVel[o + 1]) < 0.3 && Math.abs(cVel[o]) + Math.abs(cVel[o + 2]) < 0.2;
      if (!rest) {
        cVel[o + 1] -= G * dt;
        cPos[o] += cVel[o] * dt; cPos[o + 1] += cVel[o + 1] * dt; cPos[o + 2] += cVel[o + 2] * dt;
        const floor = cScale[o + 1] * 0.5;
        if (cPos[o + 1] < floor) { cPos[o + 1] = floor; cVel[o + 1] *= -0.3; cVel[o] *= 0.55; cVel[o + 2] *= 0.55; cSpin[o] *= 0.5; cSpin[o + 1] *= 0.5; cSpin[o + 2] *= 0.5; }
        qa.set(cRot[j * 4], cRot[j * 4 + 1], cRot[j * 4 + 2], cRot[j * 4 + 3]);
        va.set(cSpin[o], cSpin[o + 1], cSpin[o + 2]);
        const wl = va.length();
        if (wl > 1e-4) { qb.setFromAxisAngle(va.multiplyScalar(1 / wl), wl * dt); qa.premultiply(qb); cRot[j * 4] = qa.x; cRot[j * 4 + 1] = qa.y; cRot[j * 4 + 2] = qa.z; cRot[j * 4 + 3] = qa.w; }
      }
      const fade = Math.min(1, cLife[j] / 0.6);
      va.set(cPos[o], cPos[o + 1], cPos[o + 2]); vb.set(cScale[o] * fade, cScale[o + 1] * fade, cScale[o + 2] * fade);
      qa.set(cRot[j * 4], cRot[j * 4 + 1], cRot[j * 4 + 2], cRot[j * 4 + 3]);
      m4.compose(va, qa, vb); chips.setMatrixAt(j, m4); chipsMoved = true;
    }
    if (chipsMoved) chips.instanceMatrix.needsUpdate = true;

    // A ruptured nitrogen line: white condensation venting from the tail.
    if (st.ventT > 0) {
      st.ventT -= dt;
      const n = Math.min(4, Math.ceil(dt * 120));
      up.set(0, 1, 0).applyQuaternion(carRoot.quaternion);
      tailW.set(sgn() * 0.3, 0.1, -1.7).applyQuaternion(carRoot.quaternion).add(carRoot.position);
      for (let k = 0; k < n; k++) puff(tailW.x, tailW.y, tailW.z, up.x * 3 + sgn() * 2.5, up.y * 3 + 1.5 + rnd() * 2, up.z * 3 + sgn() * 2.5, 0.35, 4.5, 1.3 + rnd(), 0.2 * Math.min(1, st.ventT), 0.9, 0.94, 0.98);
    }
    // Smoke and dust: drift, slow, grow, fade.
    let smokeAny = false;
    const sd = Math.exp(-dt * 2.2);
    for (let j = 0; j < NM; j++) {
      if (mLife[j] <= 0) { if (mAlpha[j] !== 0) { mAlpha[j] = 0; smokeAny = true; } continue; }
      smokeAny = true;
      mLife[j] -= dt * mDecay[j];
      const o = j * 3;
      mVel[o] *= sd; mVel[o + 1] = mVel[o + 1] * sd + dt * 0.25; mVel[o + 2] *= sd;
      mPos[o] += mVel[o] * dt; mPos[o + 1] += mVel[o + 1] * dt; mPos[o + 2] += mVel[o + 2] * dt;
      if (mPos[o + 1] < 0.1) mPos[o + 1] = 0.1;
      const age = 1 - Math.max(0, mLife[j]);
      mSize[j] = mSize0[j] + age * mGrow[j];
      mAlpha[j] = Math.min(1, age * 9) * Math.max(0, mLife[j]) ** 1.3 * mAlpha0[j];
    }
    if (smokeAny) { mgeo.attributes.position.needsUpdate = true; mgeo.attributes.aSize.needsUpdate = true; mgeo.attributes.aAlpha.needsUpdate = true; mgeo.attributes.aColor.needsUpdate = true; }

    // Flash.
    if (flash.visible) {
      flashT -= dtReal;
      if (flashT <= 0) flash.visible = false;
      else { const k = Math.min(1, flashT / 0.1); flash.scale.setScalar(flashS * (1.3 - 0.3 * k)); flashMat.opacity = k * k; }
    }

    // Torn-off parts: rigid boxes on the concrete.
    pieces.update(dt);

    // Parked cars rock on their springs (ω ≈ 8 rad/s, ζ ≈ 0.3) after the setBodies pose.
    for (const p of parked) {
      if (!p || p.car.parent !== row) continue;
      const w2 = 64, c2 = 4.8;
      p.vax += (-w2 * p.ax - c2 * p.vax) * dt; p.ax += p.vax * dt;
      p.vaz += (-w2 * p.az - c2 * p.vaz) * dt; p.az += p.vaz * dt;
      p.vsy += (-w2 * p.sy - c2 * p.vsy) * dt; p.sy += p.vsy * dt;
      p.ax = Math.max(-0.12, Math.min(0.12, p.ax)); p.az = Math.max(-0.12, Math.min(0.12, p.az)); p.sy = Math.max(-0.12, Math.min(0.05, p.sy));
      p.car.rotation.x = p.ax; p.car.rotation.z = p.az; p.car.position.y = p.sy;
    }

    // Lamps: flicker while failing, then out (or dimmed); hazards after a crash.
    if (st.headFail > 0) { st.headFail -= dtReal; st.head = Math.sin(st.clock * 61) * Math.sin(st.clock * 23.3) > 0.1 ? 1 : 0.05; if (st.headFail <= 0) st.head = st.headDead ? 0 : 0.55; }
    if (st.tailFail > 0) { st.tailFail -= dtReal; st.tail = Math.sin(st.clock * 47) * Math.sin(st.clock * 17.1) > 0 ? 1 : 0.1; if (st.tailFail <= 0) st.tail = st.tailDead ? 0.04 : 0.6; }
    if (st.hazardT > 0) { st.hazardT -= dtReal; if (st.hazardT <= 0) st.hazard = true; }
    hero.setDamage?.(st.head, st.tail, st.hazard);

    // Grinding: held while scrapes keep coming, fading fast once they stop.
    st.grind *= Math.exp(-dtReal * 5);
    setGrind(st.grind * st.slowK);
  }

  function setScale(h) { mmat.uniforms.scale.value = h * 0.6; }

  return { feed, update, reset, timeScale, setScale, state: st, fx: { sparks, chips, smoke, flash, pieces } };
}
