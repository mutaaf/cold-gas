// A scored set's water and mud, drawn (0340): the splash tanks (concrete walls, a red LED lip, the water) and the mud
// patches, from the same numbers the physics floats and sinks the car with (src/sim/courses.js `surfaces`,
// src/sim/surfaces.js), so what you see is what you hit. Static meshes with plain materials, so scripts/native-stage.mjs
// bakes them into the iPhone's stage too (every look: Real, Anime, 8-bit). And the effects a run makes in them: the
// splash-down's crown and ring, the wake, the mud thrown off the tyres. Driven from the car as drawn (live and replay
// alike), never from the sim's state: nothing here writes anything the sim reads.
//
// NOTE for the Free Drive WATER (0320) and MATTER (0330) tracks: this is the scored sets' own simple water and mud. When
// your renderers land (the water's shading, splash and wake; ruts, mud spray and dirt on the car), swap them in here:
// buildSurfaces' meshes and createSurfaceFx's emitters are the only places that draw them.
import * as THREE from 'three';
import { waterLevel, mudSink, tankWalls, NO_WATER } from '../sim/surfaces.js';
import { wheelAnchors } from '../sim/spec.js';
import { DECAL, LAYER } from './sliver.js';

// --- Textures (canvas, generated once) ----------------------------------------------------------------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  let seed = 3407;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const canvas = (S) => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  // Mud: wet clay, darker where it's deeper, tyre-tracked, a sheen of standing water in the hollows.
  const mc = canvas(512), mx = mc.getContext('2d');
  mx.fillStyle = '#5a4230'; mx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) {
    const r = 6 + rnd() * 46, x = rnd() * 512, y = rnd() * 512, g = mx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.55;
    g.addColorStop(0, dark ? 'rgba(30,20,12,0.55)' : 'rgba(128,100,72,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = g; mx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // Ruts: pairs of tyre tracks along the set's run (v), wavering.
  for (let k = 0; k < 5; k++) {
    let x = 40 + rnd() * 432;
    mx.strokeStyle = 'rgba(18,12,8,0.45)'; mx.lineWidth = 9 + rnd() * 6;
    mx.beginPath(); mx.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) { x += (rnd() - 0.5) * 10; mx.lineTo(x, y); }
    mx.stroke();
  }
  const img = mx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n * 0.8; img.data[i + 2] += n * 0.6; }
  mx.putImageData(img, 0, 0);
  const mud = new THREE.CanvasTexture(mc);
  mud.colorSpace = THREE.SRGBColorSpace; mud.wrapS = mud.wrapT = THREE.RepeatWrapping; mud.anisotropy = 4;
  // Its edge: an ellipse feathered and ragged (the patch's footprint is the ellipse the physics reads; the rag sits inside).
  const ac = canvas(256), ax = ac.getContext('2d');
  ax.fillStyle = '#000'; ax.fillRect(0, 0, 256, 256);
  const ag = ax.createRadialGradient(128, 128, 0, 128, 128, 128);
  ag.addColorStop(0, '#fff'); ag.addColorStop(0.7, '#f2f2f2'); ag.addColorStop(0.9, '#8a8a8a'); ag.addColorStop(1, '#000');
  ax.fillStyle = ag; ax.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, rr = 104 + rnd() * 22, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr, r = 4 + rnd() * 10;
    ax.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.35)';
    ax.beginPath(); ax.arc(x, y, r, 0, Math.PI * 2); ax.fill();
  }
  const edge = new THREE.CanvasTexture(ac);
  // Ripples: a tiling height noise for the water's surface (its bump, scrolled).
  const S = 256, rc = canvas(S), rx = rc.getContext('2d'), rimg = rx.createImageData(S, S);
  const waves = Array.from({ length: 7 }, () => ({ kx: Math.round(1 + rnd() * 6), ky: Math.round(1 + rnd() * 6) * (rnd() < 0.5 ? -1 : 1), p: rnd() * 6.283, a: 0.4 + rnd() * 0.6 }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = 0;
    for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / S) * 6.283 + w.p);
    const v = Math.max(0, Math.min(255, 128 + h * 30)), o = (y * S + x) * 4;
    rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
  }
  rx.putImageData(rimg, 0, 0);
  const ripple = new THREE.CanvasTexture(rc);
  ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
  TEX = { mud, edge, ripple };
  return TEX;
}

// --- The set's water and mud, as meshes -----------------------------------------------------------------
/** The course's tanks and mud as one group (null where the course has none). `update(t)` moves the water's ripples. */
export function buildSurfaces(course, { night = true } = {}) {
  const surf = course?.surfaces;
  if (!surf) return null;
  const T = textures();
  const group = new THREE.Group();
  group.name = 'surfaces';
  // The tanks: board-formed concrete, its coping a little lighter, a red LED along the inside of the lip (the set's one
  // signal colour, as on the Wall's edges), a dark floor so the water reads deep, and the water.
  const wallMat = new THREE.MeshStandardMaterial({ name: 'tank-wall', color: night ? 0x6d7075 : 0x8a8d92, roughness: 0.85, metalness: 0 });
  const copeMat = new THREE.MeshStandardMaterial({ name: 'tank-coping', color: night ? 0x9a9da2 : 0xb4b7bb, roughness: 0.7, metalness: 0 });
  const ledMat = new THREE.MeshBasicMaterial({ name: 'tank-led', color: new THREE.Color(3.2, 0.12, 0.18), fog: false });
  const floorMat = new THREE.MeshStandardMaterial({ name: 'tank-floor', color: 0x10171b, roughness: 0.95, metalness: 0, ...DECAL });
  // Water: a dark, deep teal with a mirror's sheen, a little see-through (the dark floor under it), the ripples a bump.
  T.ripple.repeat.set(3, 3);
  const waterMat = new THREE.MeshPhysicalMaterial({
    name: 'water', color: night ? 0x0f3a46 : 0x1d5a68, emissive: night ? 0x03141a : 0x000000, roughness: 0.06, metalness: 0, clearcoat: 1,
    clearcoatRoughness: 0.03, transparent: true, opacity: 0.88, bumpMap: T.ripple, bumpScale: 0.35, envMapIntensity: 1.6, depthWrite: false,
  });
  for (const k of surf.tanks) {
    for (const b of tankWalls(k)) {
      const sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
      const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy - 0.06, sz), wallMat);
      w.position.set(b[0] + sx / 2, (sy - 0.06) / 2, b[2] + sz / 2);
      w.castShadow = true; w.receiveShadow = true;
      group.add(w);
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, 0.06, sz + 0.04), copeMat);
      c.position.set(b[0] + sx / 2, sy - 0.03, b[2] + sz / 2);
      group.add(c);
    }
    const ix = k.x1 - k.x0, iz = k.z1 - k.z0, cx = (k.x0 + k.x1) / 2, cz = (k.z0 + k.z1) / 2;
    for (const [x, z, lx, lz] of [[cx, k.z0 + 0.02, ix, 0.04], [cx, k.z1 - 0.02, ix, 0.04], [k.x0 + 0.02, cz, 0.04, iz], [k.x1 - 0.02, cz, 0.04, iz]]) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.03, lz), ledMat);
      led.position.set(x, k.top - 0.09, z); led.renderOrder = LAYER.light;
      group.add(led);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ix, iz), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.004, cz); floor.renderOrder = LAYER.pad;
    group.add(floor);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(ix, iz), waterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(cx, k.level, cz);
    water.receiveShadow = true;
    group.add(water);
  }
  // Mud: each patch a decal the size of its ellipse, wet (low roughness), feathered at the edge.
  for (const m of surf.mud) {
    const map = T.mud.clone(); map.needsUpdate = true; map.repeat.set(Math.max(1, m.rx / 3), Math.max(1, m.rz / 3));
    const mat = new THREE.MeshStandardMaterial({
      name: 'mud', map, alphaMap: T.edge, transparent: true, depthWrite: false, color: 0xffffff,
      roughness: 0.3, metalness: 0, envMapIntensity: 1.1, ...DECAL,
    });
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(2 * m.rx, 2 * m.rz), mat);
    patch.rotation.x = -Math.PI / 2; patch.position.set(m.x, 0.005, m.z);
    patch.renderOrder = LAYER.paint; patch.receiveShadow = true;
    group.add(patch);
  }
  group.userData.update = (t) => { T.ripple.offset.set(t * 0.013, t * 0.008); };
  return group;
}

// --- The effects a run makes in them -------------------------------------------------------------------
const MAX = 900;
const W = wheelAnchors();
const WATER_C = new THREE.Color(0.75, 0.86, 0.92), FOAM_C = new THREE.Color(0.95, 0.97, 1), MUD_C = new THREE.Color(0.2, 0.14, 0.09);
/**
 * The splash-down, the wake and the mud spray, from the car as drawn. `update(dt, pos, quat, vel, course)` each frame
 * (live or replay) returns what happened, for the sound and the hand: { splash: 0–1 on the frame the car hits the water,
 * else 0; mud: 0–1 while tyres plough mud; water: 0–1 while it moves in the water }. `reset()` between runs.
 */
export function createSurfaceFx(scene, { tier = 'high' } = {}) {
  const n = tier === 'low' ? 300 : MAX;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3), life = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, n);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
  pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 2;
  scene.add(pts);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -100;
  // The splash's ring on the water: a flat annulus that spreads and fades.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xdfeaf2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 1;
  scene.add(ring);
  let next = 0, alive = 0, wasWet = false, ringT = -1, ringMax = 1, seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = { splash: 0, mud: 0, water: 0 };
  const q = new THREE.Quaternion(), w = new THREE.Vector3();
  function emit(x, y, z, vx, vy, vz, c, l) {
    const i = next; next = (next + 1) % n;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (life[i] <= 0) alive++;
    life[i] = l;
  }
  return {
    reset() { for (let i = 0; i < n; i++) { life[i] = 0; pos[i * 3 + 1] = -100; } alive = 0; wasWet = false; ringT = -1; ring.visible = false; pts.visible = false; },
    update(dt, p, quat, v, course) {
      out.splash = 0; out.mud = 0; out.water = 0;
      const surf = course?.surfaces;
      if (surf && dt > 0) {
        const level = waterLevel(surf, p.x, p.z);
        const speed = Math.hypot(v.x, v.y, v.z), along = Math.hypot(v.x, v.z);
        const wet = level !== NO_WATER && p.y - 0.3 < level;
        if (wet && !wasWet) {
          // The splash-down: a crown of water thrown up and out, more the harder it hit, and the ring.
          const k = Math.min(1, Math.max(0.15, (Math.max(0, -v.y) + 0.4 * along) / 14));
          out.splash = k;
          const count = Math.round((tier === 'low' ? 120 : 360) * k);
          for (let i = 0; i < count; i++) {
            const a = rnd() * Math.PI * 2, r = 1.2 + rnd() * 1.4, up = 3 + rnd() * 9 * k, out_ = 1.5 + rnd() * 5 * k;
            emit(p.x + Math.cos(a) * r, level + 0.05, p.z + Math.sin(a) * r, Math.cos(a) * out_ + v.x * 0.3, up, Math.sin(a) * out_ + v.z * 0.3, rnd() < 0.4 ? FOAM_C : WATER_C, 0.8 + rnd() * 1.2);
          }
          ringT = 0; ring.position.set(p.x, level + 0.02, p.z); ring.visible = true;
          // The ring spreads to the tank's walls and no further.
          ringMax = 1;
          for (const k of surf.tanks) if (p.x > k.x0 && p.x < k.x1 && p.z > k.z0 && p.z < k.z1) ringMax = Math.max(1, Math.min(p.x - k.x0, k.x1 - p.x, p.z - k.z0, k.z1 - p.z));
        } else if (wet && along > 1.2) {
          // The wake: spray off the sides and the bow, as long as it moves through the water.
          out.water = Math.min(1, along / 8);
          const per = Math.min(10, along * 1.5 * dt * 60);
          for (let i = 0; i < per; i++) {
            const s = rnd() < 0.5 ? -1 : 1;
            emit(p.x + v.z / along * s * 1.1, level + 0.03, p.z - v.x / along * s * 1.1, v.x * 0.4 - (v.z / along) * s * 1.5, 0.8 + rnd() * 1.6, v.z * 0.4 + (v.x / along) * s * 1.5, FOAM_C, 0.5 + rnd() * 0.4);
          }
        }
        wasWet = wet;
        // Mud thrown up off the rear tyres while they're in it and turning.
        if (!wet && p.y < 0.7 && along > 1.5) {
          q.set(quat.x, quat.y, quat.z, quat.w);
          let inMud = 0;
          for (let i = 2; i < 4; i++) {
            w.set(W[i][0], -0.35, W[i][2]).applyQuaternion(q).add(p);
            if (mudSink(surf, w.x, w.z) < 0) continue;
            inMud++;
            const per = Math.min(6, along * dt * 30);
            for (let j = 0; j < per; j++) emit(w.x + (rnd() - 0.5) * 0.3, 0.15, w.z, -v.x * 0.35 + (rnd() - 0.5) * 2, 1 + rnd() * 2.5, -v.z * 0.35 + (rnd() - 0.5) * 2, MUD_C, 0.5 + rnd() * 0.5);
          }
          if (inMud) out.mud = Math.min(1, along / 10);
        }
      } else wasWet = false;
      // Integrate what's flying: gravity, a little air, gone at the slab or the water (no allocation).
      if (alive > 0) {
        alive = 0;
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          const o = i * 3;
          vel[o + 1] -= 9.81 * dt;
          vel[o] *= 1 - 0.6 * dt; vel[o + 2] *= 1 - 0.6 * dt;
          pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
          if (pos[o + 1] < 0 || life[i] <= 0) { life[i] = 0; pos[o + 1] = -100; continue; }
          alive++;
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      }
      pts.visible = alive > 0;
      if (ringT >= 0) {
        ringT += dt;
        const s = Math.min(ringMax, 1 + ringT * 9);
        ring.scale.set(s, s, 1);
        ring.material.opacity = Math.max(0, 0.55 * (1 - ringT / 1.6));
        if (ringT > 1.6) { ringT = -1; ring.visible = false; }
      }
      return out;
    },
  };
}
