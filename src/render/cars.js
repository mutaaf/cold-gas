// Procedural vehicles. Every body is a loft: superellipse cross-sections along the length, with
// the lower edge lifting over each wheel so the arches fall out of the profile itself. All our
// own designs; no badges, no real names.
import * as THREE from 'three';

// --- Materials (shared) ---------------------------------------------------------------------
const cache = new Map();
export function paint(color, opts = {}) {
  const key = `paint:${color}:${opts.matte ? 1 : 0}:${opts.metal ?? ''}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshPhysicalMaterial({
      color, metalness: opts.metal ?? 0.55, roughness: opts.matte ? 0.55 : 0.24,
      clearcoat: opts.matte ? 0.15 : 1, clearcoatRoughness: 0.04, envMapIntensity: 1.35,
    }));
  }
  return cache.get(key);
}
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0d131c, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.86, metalness: 0 });
const rim = new THREE.MeshPhysicalMaterial({ color: 0x2b2d31, metalness: 0.85, roughness: 0.32, clearcoat: 0.6 });
const trim = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.2 });
const steel = new THREE.MeshPhysicalMaterial({ color: 0xb9bec4, metalness: 1, roughness: 0.38, envMapIntensity: 1.2 });
export const lampWhite = new THREE.MeshBasicMaterial({ color: 0xf4f7ff });
export const lampRed = new THREE.MeshBasicMaterial({ color: 0xff1e2d });
export const nozzleMat = new THREE.MeshPhysicalMaterial({ color: 0x8b9096, metalness: 1, roughness: 0.25 });

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerpStations = (st, z, k) => {
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;   // soften, keep monotone
      return a[k] + (b[k] - a[k]) * s;
    }
  }
  return st[z < st[0].z ? 0 : st.length - 1][k];
};

// Loft along z. stations: [{z, hw, top, bot, n}] (n = superellipse exponent, 2 = ellipse).
// `arches` lifts the lower edge around wheel centres: [{z, r}] (height of arch apex).
export function loft(stations, { segZ = 64, segR = 48, arches = [], archTop = 0.62, flat = false, phase = 0 } = {}) {
  const z0 = stations[0].z, z1 = stations[stations.length - 1].z;
  const pos = [], idx = [];
  for (let i = 0; i <= segZ; i++) {
    // Denser near the ends for clean noses/tails.
    const u = i / segZ;
    const z = z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    const hw = lerpStations(stations, z, 'hw');
    const top = lerpStations(stations, z, 'top');
    let bot = lerpStations(stations, z, 'bot');
    const n = lerpStations(stations, z, 'n');
    // End taper: close the ends smoothly.
    const endK = Math.min(smooth(z0, z0 + 0.06, z), 1 - smooth(z1 - 0.06, z1, z));
    let arch = 0;
    for (const a of arches) {
      const d = Math.abs(z - a.z);
      if (d < a.r) arch = Math.max(arch, Math.sqrt(1 - (d / a.r) ** 2));
    }
    const archY = bot + (archTop - bot) * arch;
    const mid = (top + bot) / 2, hh = (top - bot) / 2;
    for (let j = 0; j < segR; j++) {
      const th = (j / segR) * Math.PI * 2 + phase;
      const c = Math.cos(th), s = Math.sin(th);
      const ex = 2 / n;
      let x = Math.sign(c) * Math.abs(c) ** ex * hw;
      let y = mid + Math.sign(s) * Math.abs(s) ** ex * hh;
      // Lower half rises into the wheel arch; a dark tub fills the tunnel (see addTub).
      if (s < 0 && arch > 0) y = Math.max(y, archY - (1 - Math.abs(x) / hw) * 0.06);
      x *= 0.15 + 0.85 * endK;
      y = mid + (y - mid) * (0.3 + 0.7 * endK);
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < segZ; i++) {
    for (let j = 0; j < segR; j++) {
      const a = i * segR + j, b = i * segR + ((j + 1) % segR), c = (i + 1) * segR + j, d = (i + 1) * segR + ((j + 1) % segR);
      idx.push(a, b, c, b, d, c);
    }
  }
  // Caps.
  const capA = pos.length / 3; pos.push(0, (stations[0].top + stations[0].bot) / 2, z0);
  const capB = pos.length / 3; pos.push(0, (stations.at(-1).top + stations.at(-1).bot) / 2, z1);
  for (let j = 0; j < segR; j++) {
    idx.push(capA, (j + 1) % segR, j);
    idx.push(capB, segZ * segR + j, segZ * segR + ((j + 1) % segR));
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

function wheel(r = 0.34, width = 0.26, aero = true) {
  const g = new THREE.Group();
  // Tyre: lathe profile with rounded shoulders.
  const pts = [];
  const rr = r * 0.66;
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, (width / 2 - 0.05) * Math.sin(a) + Math.sin(a) * 0.05));
  }
  pts.unshift(new THREE.Vector2(rr, -width / 2));
  pts.push(new THREE.Vector2(rr, width / 2));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), rubber);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  // Rim face: a shallow dish, aero cover or five spokes.
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 0.96, width * 0.7, 40), rim);
  dish.rotation.z = Math.PI / 2;
  g.add(dish);
  if (aero) {
    const cover = new THREE.Mesh(new THREE.CircleGeometry(rr * 0.98, 48), rim);
    cover.position.x = width * 0.36; cover.rotation.y = Math.PI / 2;
    g.add(cover);
    for (let k = 0; k < 5; k++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.01, rr * 0.55, 0.035), trim);
      const a = (k / 5) * Math.PI * 2;
      slot.position.set(width * 0.365, Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5);
      slot.rotation.x = -a;
      g.add(slot);
    }
    const mirror = cover.clone(); mirror.position.x = -width * 0.36; mirror.rotation.y = -Math.PI / 2; g.add(mirror);
  }
  return g;
}

function addWheels(group, xs, zs, r, width, aero, out) {
  for (const z of zs) for (const x of xs) {
    const pivot = new THREE.Group();     // steer pivot
    pivot.position.set(x, r, z);
    const w = wheel(r, width, aero);
    pivot.add(w);
    group.add(pivot);
    out?.push({ pivot, spin: w, baseY: r });
  }
}

// A satin-black chassis tub inside the body: fills the arch tunnels so nothing reads through.
function addTub(group, len, hw, y0, y1) {
  const tub = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, y1 - y0, len), trim);
  tub.position.y = (y0 + y1) / 2;
  tub.name = 'tub';
  group.add(tub);
}

function lightBar(group, z, y, hw, mat, h = 0.025, curve = 0) {
  const geo = new THREE.BoxGeometry(hw * 2, h, 0.02);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, y, z); m.rotation.x = curve;
  group.add(m);
  return m;
}

// --- The hero roadster ---------------------------------------------------------------------
// Built in a ground frame (y = 0 at the tyres' contact patch, origin centred), then offset so
// the group's origin is the physics centre of mass.
export function makeRoadster(color = 0xa30f1c) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const st = [
    { z: -2.17, hw: 0.86, top: 0.74, bot: 0.24, n: 3.4 },
    { z: -1.95, hw: 0.97, top: 0.83, bot: 0.17, n: 3.6 },
    { z: -1.35, hw: 1.0, top: 0.88, bot: 0.14, n: 3.8 },
    { z: -0.6, hw: 0.98, top: 0.84, bot: 0.13, n: 3.4 },
    { z: 0.3, hw: 0.97, top: 0.8, bot: 0.13, n: 3.2 },
    { z: 1.05, hw: 0.97, top: 0.79, bot: 0.14, n: 3.4 },
    { z: 1.6, hw: 0.94, top: 0.74, bot: 0.15, n: 3.3 },
    { z: 1.98, hw: 0.86, top: 0.6, bot: 0.17, n: 3.0 },
    { z: 2.17, hw: 0.72, top: 0.46, bot: 0.21, n: 2.6 },
  ];
  const shell = new THREE.Mesh(loft(st, { arches: [{ z: 1.38, r: 0.43 }, { z: -1.38, r: 0.43 }], archTop: 0.7 }), paint(color));
  shell.castShadow = true; shell.receiveShadow = true;
  body.add(shell);
  // Greenhouse: a teardrop canopy (targa).
  const gh = [
    { z: -1.0, hw: 0.5, top: 0.8, bot: 0.76, n: 2.4 },
    { z: -0.55, hw: 0.66, top: 1.06, bot: 0.78, n: 2.6 },
    { z: -0.05, hw: 0.7, top: 1.13, bot: 0.76, n: 2.6 },
    { z: 0.5, hw: 0.68, top: 1.02, bot: 0.73, n: 2.4 },
    { z: 1.05, hw: 0.56, top: 0.72, bot: 0.66, n: 2.2 },
  ];
  const canopy = new THREE.Mesh(loft(gh, { segZ: 40, segR: 40 }), glass);
  canopy.castShadow = true;
  body.add(canopy);
  addTub(body, 3.5, 0.5, 0.2, 0.55);
  // Full-width light bars, front and rear.
  lightBar(body, 2.12, 0.42, 0.56, lampWhite, 0.014);
  lightBar(body, -2.15, 0.68, 0.72, lampRed, 0.02);
  // Nozzle bezels (the ten jets), so the hardware reads on the car.
  const nozzles = [];
  const ring = new THREE.TorusGeometry(0.04, 0.012, 8, 24);
  const bezel = (x, y, z, rx, ry) => {
    const m = new THREE.Mesh(ring, nozzleMat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    body.add(m); nozzles.push(m); return m;
  };
  for (const [x, z] of [[-0.86, 1.5], [0.86, 1.5], [-0.86, -1.5], [0.86, -1.5]]) bezel(x, 0.14, z, Math.PI / 2, 0);
  bezel(-0.55, 0.42, -2.12, 0, 0); bezel(0.55, 0.42, -2.12, 0, 0);
  bezel(-0.62, 0.34, 2.06, 0, 0); bezel(0.62, 0.34, 2.06, 0, 0);
  bezel(-0.93, 0.86, 0, 0, Math.PI / 2); bezel(0.93, 0.86, 0, 0, Math.PI / 2);

  const wheels = [];
  addWheels(g, [-0.84, 0.84], [1.38, -1.38], 0.34, 0.27, true, wheels);
  // Order wheels to match the sim: FL, FR, RL, RR.
  const ordered = [wheels[0], wheels[1], wheels[2], wheels[3]];
  return { group: g, body, shell, canopy, wheels: ordered, comY: 0.594 };
}

// --- The ghost: a translucent silhouette of the hero (your best run, played back alongside) --
// Only the shell, canopy and tyres, sharing the hero's geometry under one cheap Lambert
// material: six draw calls, no shadows, nothing inside showing through.
export const ghostMat = new THREE.MeshLambertMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.18, depthWrite: false });
export function makeGhost(hero) {
  const g = new THREE.Group();
  hero.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(hero.group.matrixWorld).invert();
  for (const src of [hero.shell, hero.canopy, ...hero.wheels.map((w) => w.spin.children[0])]) {
    const m = new THREE.Mesh(src.geometry, ghostMat);
    m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(inv, src.matrixWorld);
    m.renderOrder = 2;
    g.add(m);
  }
  return g;
}

// --- The parked lineup (built nose → +z, then turned crosswise by the scene) ----------------
const SPECS = {
  sedan: (c) => ({
    st: [
      { z: -2.36, hw: 0.8, top: 0.86, bot: 0.3, n: 3.2 },
      { z: -1.9, hw: 0.92, top: 1.0, bot: 0.2, n: 3.6 },
      { z: -0.8, hw: 0.93, top: 0.98, bot: 0.17, n: 3.4 },
      { z: 0.9, hw: 0.92, top: 0.88, bot: 0.17, n: 3.2 },
      { z: 1.9, hw: 0.88, top: 0.72, bot: 0.2, n: 3.0 },
      { z: 2.36, hw: 0.74, top: 0.56, bot: 0.26, n: 2.6 },
    ],
    gh: [
      { z: -1.75, hw: 0.62, top: 1.0, bot: 0.96, n: 2.4 },
      { z: -0.9, hw: 0.74, top: 1.38, bot: 0.95, n: 2.8 },
      { z: 0.1, hw: 0.76, top: 1.44, bot: 0.92, n: 2.8 },
      { z: 0.9, hw: 0.72, top: 1.25, bot: 0.88, n: 2.6 },
      { z: 1.45, hw: 0.6, top: 0.92, bot: 0.84, n: 2.2 },
    ],
    wheelZ: 1.44, wheelR: 0.34, len: 4.72, color: c,
  }),
  suv: (c) => ({
    st: [
      { z: -2.38, hw: 0.84, top: 1.0, bot: 0.34, n: 3.4 },
      { z: -1.95, hw: 0.96, top: 1.12, bot: 0.24, n: 3.8 },
      { z: -0.6, hw: 0.96, top: 1.1, bot: 0.22, n: 3.6 },
      { z: 1.0, hw: 0.95, top: 1.0, bot: 0.22, n: 3.4 },
      { z: 1.95, hw: 0.9, top: 0.84, bot: 0.25, n: 3.0 },
      { z: 2.38, hw: 0.76, top: 0.66, bot: 0.3, n: 2.6 },
    ],
    gh: [
      { z: -2.05, hw: 0.7, top: 1.12, bot: 1.08, n: 2.6 },
      { z: -1.5, hw: 0.8, top: 1.6, bot: 1.07, n: 3.2 },
      { z: 0.1, hw: 0.8, top: 1.62, bot: 1.04, n: 3.2 },
      { z: 0.9, hw: 0.76, top: 1.42, bot: 1.0, n: 2.8 },
      { z: 1.5, hw: 0.62, top: 1.04, bot: 0.96, n: 2.2 },
    ],
    wheelZ: 1.45, wheelR: 0.37, len: 4.76, color: c,
  }),
  cab: (c) => ({
    st: [
      { z: -1.98, hw: 0.86, top: 0.9, bot: 0.3, n: 3.0 },
      { z: -1.6, hw: 0.96, top: 1.12, bot: 0.22, n: 3.4 },
      { z: 0.4, hw: 0.97, top: 1.08, bot: 0.2, n: 3.2 },
      { z: 1.6, hw: 0.92, top: 0.82, bot: 0.22, n: 2.8 },
      { z: 1.98, hw: 0.78, top: 0.62, bot: 0.28, n: 2.4 },
    ],
    gh: [
      { z: -1.55, hw: 0.7, top: 1.14, bot: 1.1, n: 2.4 },
      { z: -0.9, hw: 0.84, top: 1.5, bot: 1.08, n: 2.6 },
      { z: 0.4, hw: 0.84, top: 1.52, bot: 1.04, n: 2.6 },
      { z: 1.2, hw: 0.72, top: 1.1, bot: 0.92, n: 2.2 },
    ],
    wheelZ: 1.28, wheelR: 0.35, len: 3.95, color: c,
  }),
};

function lofted(spec) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(loft(spec.st, { arches: [{ z: spec.wheelZ, r: spec.wheelR + 0.1 }, { z: -spec.wheelZ, r: spec.wheelR + 0.1 }], archTop: spec.wheelR * 2 - 0.04 }), paint(spec.color));
  shell.castShadow = true; shell.receiveShadow = true;
  g.add(shell);
  addTub(g, spec.len * 0.78, 0.52, spec.wheelR * 0.6, spec.wheelR * 1.7);
  const gh = new THREE.Mesh(loft(spec.gh, { segZ: 36, segR: 36 }), glass);
  gh.castShadow = true; g.add(gh);
  const front = spec.st.at(-1), rear = spec.st[0];
  lightBar(g, front.z - 0.03, (front.top + front.bot) / 2 + 0.06, front.hw * 0.86, lampWhite, 0.014);
  lightBar(g, rear.z + 0.03, (rear.top + rear.bot) / 2 + 0.12, rear.hw * 0.92, lampRed, 0.018);
  addWheels(g, [-0.84, 0.84], [spec.wheelZ, -spec.wheelZ], spec.wheelR, 0.25, true);
  return g;
}

// The faceted stainless pickup: few stations, high exponent, flat shading.
function pickup(color) {
  const g = new THREE.Group();
  const st = [
    { z: -2.84, hw: 1.0, top: 1.12, bot: 0.4, n: 10 },
    { z: -0.6, hw: 1.04, top: 1.3, bot: 0.4, n: 10 },
    { z: 0.25, hw: 1.04, top: 1.86, bot: 0.4, n: 10 },
    { z: 2.84, hw: 1.0, top: 0.98, bot: 0.42, n: 10 },
  ];
  // A straight-edged loft: linear interpolation via many stations along each facet.
  const dense = [];
  for (let i = 0; i < st.length - 1; i++) {
    for (let k = 0; k < 6; k++) {
      const t = k / 6, a = st[i], b = st[i + 1];
      dense.push({ z: a.z + (b.z - a.z) * t, hw: a.hw + (b.hw - a.hw) * t, top: a.top + (b.top - a.top) * t, bot: a.bot + (b.bot - a.bot) * t, n: 10 });
    }
  }
  dense.push(st.at(-1));
  const shell = new THREE.Mesh(loft(dense, { segZ: 48, segR: 8, arches: [{ z: 1.9, r: 0.52 }, { z: -1.9, r: 0.52 }], archTop: 0.92, flat: true, phase: Math.PI / 8 }), steel);
  shell.castShadow = true; shell.receiveShadow = true;
  g.add(shell);
  const glassTri = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.02, 1.6), glass);
  glassTri.position.set(0, 1.52, 0.95); glassTri.rotation.x = -0.36;
  g.add(glassTri);
  lightBar(g, 2.83, 0.98, 0.98, lampWhite, 0.02);
  lightBar(g, -2.83, 1.08, 0.98, lampRed, 0.022);
  addWheels(g, [-0.88, 0.88], [1.9, -1.9], 0.42, 0.3, false);
  return g;
}

// The semi: a tall aerodynamic cab with a short tractor frame.
function semi(color) {
  const g = new THREE.Group();
  const st = [
    { z: -0.2, hw: 1.2, top: 3.7, bot: 0.8, n: 4.5 },
    { z: 0.6, hw: 1.26, top: 3.85, bot: 0.66, n: 4.5 },
    { z: 1.9, hw: 1.26, top: 3.6, bot: 0.62, n: 4.2 },
    { z: 2.8, hw: 1.2, top: 2.6, bot: 0.64, n: 3.6 },
    { z: 3.35, hw: 1.1, top: 1.6, bot: 0.7, n: 3.0 },
  ];
  const cab = new THREE.Mesh(loft(st, { arches: [{ z: 2.5, r: 0.62 }], archTop: 1.15 }), paint(color, { metal: 0.25 }));
  cab.castShadow = true; cab.receiveShadow = true;
  g.add(cab);
  const ws = [
    { z: 2.0, hw: 1.05, top: 3.2, bot: 3.15, n: 3 },
    { z: 2.55, hw: 1.12, top: 3.0, bot: 2.2, n: 3 },
    { z: 2.9, hw: 1.0, top: 2.35, bot: 2.25, n: 3 },
  ];
  g.add(new THREE.Mesh(loft(ws, { segZ: 16, segR: 32 }), glass));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.36, 3.6), trim);
  frame.position.set(0, 0.78, -1.9); frame.castShadow = true; g.add(frame);
  const fifth = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 32), steel);
  fifth.position.set(0, 1.0, -2.0); g.add(fifth);
  lightBar(g, 3.33, 1.3, 1.0, lampWhite, 0.022);
  addWheels(g, [-0.98, 0.98], [2.5], 0.5, 0.32, true);
  addWheels(g, [-0.98, 0.98], [-1.5, -2.9], 0.5, 0.5, false);
  return g;
}

export function makeParked(id, color) {
  if (id === 'pickup') return pickup(color);
  if (id === 'semi') return semi(color);
  return lofted(SPECS[id](color));
}
