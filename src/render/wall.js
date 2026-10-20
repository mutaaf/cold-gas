// The Wall at night: a board-formed concrete curl that rises from the slab into a vertical wall
// and over into the ledge, edged in red LED, a white line up the middle, a gunmetal lattice truss
// behind it, and searchlights fanning into a black sky. Every surface the car can touch is
// sampled from `wallProfile` (src/sim/courses.js), so the picture is the physics to the
// centimetre.
import * as THREE from 'three';
import { WALL, wallProfile } from '../sim/courses.js';

const W = WALL.width, T = WALL.slab, L = WALL.length;
const SEAM = 1.2;          // board-form pour seams along the curve (m)
const TILE = SEAM * 4;     // texture repeat along the curve (m)

// --- Procedural materials ---------------------------------------------------------------------
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// Board-formed concrete: plank grain across the deck, a pour seam every 1.2 m, form-tie holes,
// water streaks running down the curl, and a polished wheel path. Colour, roughness and bump.
function deckTextures() {
  const S = 1024;
  const rnd = rng(19);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  const [cc, cx] = mk(), [rc, rx] = mk(), [bc, bx] = mk();
  // Base colour with fine grain.
  cx.fillStyle = '#8c8d8f'; cx.fillRect(0, 0, S, S);
  const img = cx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 1;
  }
  cx.putImageData(img, 0, 0);
  bx.fillStyle = '#808080'; bx.fillRect(0, 0, S, S);
  // Plank grain: thin horizontal streaks (boards ran across the width).
  for (let y = 0; y < S; y += 3) {
    const a = 0.02 + rnd() * 0.05;
    cx.fillStyle = `rgba(${rnd() < 0.5 ? '60,60,62' : '170,170,172'},${a})`;
    cx.fillRect(0, y, S, 1 + (rnd() < 0.2 ? 1 : 0));
    bx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${a * 1.5})`;
    bx.fillRect(0, y, S, 1);
  }
  // Board edges every ~15 cm, then the pour seams every 1.2 m (4 per tile).
  const per = S / 4;
  for (let k = 0; k < 4; k++) {
    for (let b = 1; b < 8; b++) {
      const y = k * per + (b * per) / 8 + (rnd() - 0.5) * 2;
      cx.fillStyle = 'rgba(40,40,42,0.10)'; cx.fillRect(0, y, S, 1.5);
      bx.fillStyle = 'rgba(0,0,0,0.25)'; bx.fillRect(0, y, S, 1.5);
    }
    const y = k * per;
    cx.fillStyle = 'rgba(25,25,27,0.32)'; cx.fillRect(0, y, S, 3);
    cx.fillStyle = 'rgba(200,200,202,0.18)'; cx.fillRect(0, y + 3, S, 1);
    bx.fillStyle = '#000'; bx.fillRect(0, y - 1, S, 4);
    // Form-tie holes: a row just past each seam.
    for (let i = 0; i < 6; i++) {
      const hx = (i + 0.5) * (S / 6), hy = y + per * 0.5;
      const g = cx.createRadialGradient(hx, hy, 0, hx, hy, 7);
      g.addColorStop(0, 'rgba(20,20,22,0.85)'); g.addColorStop(0.6, 'rgba(40,40,42,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(hx, hy, 7, 0, Math.PI * 2); cx.fill();
      bx.fillStyle = '#202020'; bx.beginPath(); bx.arc(hx, hy, 4, 0, Math.PI * 2); bx.fill();
    }
  }
  // Water streaks running down the curve, and soft blotches.
  for (let i = 0; i < 26; i++) {
    const sx = rnd() * S, w = 6 + rnd() * 30, a = 0.03 + rnd() * 0.06;
    const g = cx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, `rgba(30,30,32,${a})`); g.addColorStop(1, 'rgba(30,30,32,0)');
    cx.fillStyle = g; cx.fillRect(sx, 0, w, S);
  }
  for (let i = 0; i < 70; i++) {
    const r = 20 + rnd() * 110, gx = rnd() * S, gy = rnd() * S, a = rnd() * 0.07;
    const g = cx.createRadialGradient(gx, gy, 0, gx, gy, r);
    g.addColorStop(0, `rgba(${rnd() < 0.5 ? '50,50,52' : '170,170,170'},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g; cx.fillRect(gx - r, gy - r, r * 2, r * 2);
  }
  // Roughness (green channel): matte concrete, polished where tyres run (track ±0.86 m).
  rx.fillStyle = 'rgb(0,225,0)'; rx.fillRect(0, 0, S, S);
  for (const tx of [-0.86, 0.86]) {
    const cxp = (0.5 + tx / W) * S, half = (0.42 / W) * S;
    const g = rx.createLinearGradient(cxp - half, 0, cxp + half, 0);
    g.addColorStop(0, 'rgba(0,225,0,0)'); g.addColorStop(0.5, 'rgba(0,120,0,1)'); g.addColorStop(1, 'rgba(0,225,0,0)');
    rx.fillStyle = g; rx.fillRect(cxp - half, 0, half * 2, S);
    // Rubber: a faint darkening in the colour map too.
    const d = cx.createLinearGradient(cxp - half, 0, cxp + half, 0);
    d.addColorStop(0, 'rgba(20,20,22,0)'); d.addColorStop(0.5, 'rgba(20,20,22,0.16)'); d.addColorStop(1, 'rgba(20,20,22,0)');
    cx.fillStyle = d; cx.fillRect(cxp - half, 0, half * 2, S);
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  return { map: tex(cc, true), roughnessMap: tex(rc, false), bumpMap: tex(bc, false) };
}

// Dark slab and approach asphalt for the ground.
function groundTexture(seed, base) {
  const S = 512, rnd = rng(seed);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  const img = x.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  for (let i = 0; i < 50; i++) {
    const r = 10 + rnd() * 70, gx = rnd() * S, gy = rnd() * S;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
    g.addColorStop(0, `rgba(0,0,0,${rnd() * 0.12})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(gx - r, gy - r, r * 2, r * 2);
  }
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 1); x.lineTo(S, 1); x.moveTo(1, 0); x.lineTo(1, S); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// --- Geometry helpers ------------------------------------------------------------------------------
// Profile samples, denser on the curves.
function samples(n = 360) {
  const out = [];
  const p = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 };
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    wallProfile(s, p);
    out.push({ s, z: p.z, y: p.y, nz: p.nz, ny: p.ny });
  }
  return out;
}

// The deck: riding surface, back face, two side faces and the lip cap, as one indexed mesh.
function deckGeometry(S) {
  const pos = [], nor = [], uv = [], idx = [];
  const quadStrip = (getA, getB, nA, uA, uB) => {
    const base = pos.length / 3;
    for (let i = 0; i < S.length; i++) {
      const a = getA(S[i]), b = getB(S[i]), n = nA(S[i]);
      pos.push(...a, ...b); nor.push(...n, ...n);
      uv.push(uA, S[i].s / TILE, uB, S[i].s / TILE);
    }
    for (let i = 0; i < S.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  };
  const top = (x) => (p) => [x, p.y, p.z];
  const back = (x) => (p) => [x, p.y - p.ny * T, p.z - p.nz * T];
  // Riding surface (normal toward free space). Winding so front faces face the normal.
  quadStrip(top(W / 2), top(-W / 2), (p) => [0, p.ny, p.nz], 1, 0);
  // Back face.
  quadStrip(back(-W / 2), back(W / 2), (p) => [0, -p.ny, -p.nz], 0, 1);
  // Side faces.
  quadStrip(back(W / 2), top(W / 2), () => [1, 0, 0], 0, T / W);
  quadStrip(top(-W / 2), back(-W / 2), () => [-1, 0, 0], 0, T / W);
  // Lip cap.
  const e = S[S.length - 1], base = pos.length / 3;
  const tz = -e.ny, ty = e.nz; // tangent direction at the end, pointing off the lip
  const cap = [[W / 2, e.y, e.z], [-W / 2, e.y, e.z], [W / 2, e.y - e.ny * T, e.z - e.nz * T], [-W / 2, e.y - e.ny * T, e.z - e.nz * T]];
  for (const c of cap) { pos.push(...c); nor.push(0, ty, tz); }
  uv.push(0, 0, 1, 0, 0, T / TILE, 1, T / TILE);
  idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Make sure every face faces its own normal: flip triangles that disagree.
  const p = g.attributes.position.array, ix = g.index.array;
  const v = (i) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const nn = g.attributes.normal.array;
  for (let t = 0; t < ix.length; t += 3) {
    const a = v(ix[t]), b = v(ix[t + 1]), c = v(ix[t + 2]);
    const fn = b.clone().sub(a).cross(c.clone().sub(a));
    const want = new THREE.Vector3(nn[ix[t] * 3], nn[ix[t] * 3 + 1], nn[ix[t] * 3 + 2]);
    if (fn.dot(want) < 0) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
  }
  return g;
}

// A ribbon lying on the riding surface between x0 and x1, lifted `lift` along the normal.
function ribbon(S, x0, x1, lift, from = 0) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < S.length; i++) {
    const p = S[i];
    if (p.s < from) continue;
    const y = p.y + p.ny * lift, z = p.z + p.nz * lift;
    pos.push(x0, y, z, x1, y, z);
    uv.push(0, p.s, 1, p.s);
  }
  const n = pos.length / 6;
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A band on the deck's outer side face at x, from depth d0 to d1 below the riding surface.
function sideBand(S, x, d0, d1) {
  const pos = [], idx = [];
  for (const p of S) pos.push(x, p.y - p.ny * d0, p.z - p.nz * d0, x, p.y - p.ny * d1, p.z - p.nz * d1);
  for (let i = 0; i < S.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// A tube along the deck edge (LED strip), offset along the normal.
function edgeTube(S, x, lift, depth, radius) {
  const pts = S.map((p) => new THREE.Vector3(x, p.y + p.ny * lift - p.ny * depth, p.z + p.nz * lift - p.nz * depth));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), S.length, radius, 6, false);
}

// --- Truss -------------------------------------------------------------------------------------------
// Instanced unit boxes, one per member: chords, struts, diagonals, gussets, footings.
function truss(tier) {
  const members = [];   // [ax, ay, az, bx, by, bz, thickness]
  const m = (a, b, t) => members.push([...a, ...b, t]);
  const back = (s) => { const p = wallProfile(s); return [p.z - p.nz * T, p.y - p.ny * T]; };

  // The tower behind the wall and ledge: 4 chords in a 3.4 × 2.8 m footprint.
  const zA = WALL.r1 + T + 0.25, zB = zA + 2.8, xs = [-1.7, 1.7];
  const top = WALL.r1 + WALL.h + WALL.r2 + T + 1.0; // a little above the curl's back
  const step = 2.4;
  for (const x of xs) for (const z of [zA, zB]) m([x, 0, z], [x, top, z], 0.3);
  for (let y = step; y <= top + 0.01; y += step) {
    m([xs[0], y, zA], [xs[1], y, zA], 0.15); m([xs[0], y, zB], [xs[1], y, zB], 0.15);
    for (const x of xs) m([x, y, zA], [x, y, zB], 0.15);
  }
  // X bracing on every face, alternating.
  for (let y = 0, k = 0; y < top - 0.01; y += step, k++) {
    const y1 = Math.min(top, y + step);
    const f = k % 2 ? 1 : -1;
    m([xs[0], y, zA], [xs[1], y1, zA], 0.11); m([xs[1], y, zA], [xs[0], y1, zA], 0.11);
    m([xs[0], y, zB], [xs[1], y1, zB], 0.11); m([xs[1], y, zB], [xs[0], y1, zB], 0.11);
    for (const x of xs) m([x, y, f > 0 ? zA : zB], [x, y1, f > 0 ? zB : zA], 0.11);
  }
  // Ties from the tower to the back of the vertical wall.
  const ar = WALL.r1 * Math.PI / 2;
  for (let s = ar + 0.3; s <= ar + WALL.h; s += 1.5) {
    const [bz, by] = back(s);
    for (const x of xs) m([x, by, bz], [x, by, zA], 0.13);
  }
  // Cantilever over the ledge: top chords running back over the curl, hangers down to the deck.
  const sB0 = ar + WALL.h, sB1 = L;
  const zEnd = WALL.lip.z - 1.2;
  for (const x of xs) {
    m([x, top, zA], [x, top, zEnd], 0.26);
    m([x, top - step, zA], [x, top - 0.2, zEnd], 0.14);
  }
  for (let s = sB0 + 0.6; s <= sB1 + 0.01; s += 1.4) {
    const [bz, by] = back(s);
    for (const x of xs) {
      m([x, by, bz], [x, top, Math.min(bz, zA)], 0.12);
      m([x, by, bz], [x, top, Math.min(bz + 1.2, zA)], 0.08);
    }
    m([xs[0], top, Math.min(bz, zA)], [xs[1], top, Math.min(bz, zA)], 0.12);
  }
  // Under-frame for the lower curve: posts from the slab to the back of the arc.
  for (let z = 6.2; z <= WALL.r1 + 0.3; z += 1.45) {
    const y = WALL.r1 - Math.sqrt(Math.max(0, (WALL.r1 + T) ** 2 - z * z));
    if (y < 0.35) continue;
    for (const x of [-1.9, 0, 1.9]) m([x, 0, z], [x, y, z], 0.18);
    m([-1.9, 0, z], [1.9, y * 0.95, z], 0.08);
  }
  // Footings and gussets.
  const boxes = [];
  for (const x of xs) for (const z of [zA, zB]) boxes.push([x, 0.2, z, 1.1, 0.4, 1.1]);
  for (let y = step; y <= top + 0.01; y += step) for (const x of xs) for (const z of [zA, zB]) boxes.push([x, y, z, 0.42, 0.42, 0.42]);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.2 });
  const total = members.length + boxes.length;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), mtx = new THREE.Matrix4();
  let i = 0;
  for (const mm of members) {
    a.set(mm[0], mm[1], mm[2]); b.set(mm[3], mm[4], mm[5]);
    d.subVectors(b, a); const len = d.length(); d.normalize();
    q.setFromUnitVectors(up, d);
    sc.set(mm[6], len, mm[6]);
    mtx.compose(a.clone().add(b).multiplyScalar(0.5), q, sc);
    mesh.setMatrixAt(i++, mtx);
  }
  q.identity();
  for (const bb of boxes) { sc.set(bb[3], bb[4], bb[5]); mtx.compose(a.set(bb[0], bb[1], bb[2]), q, sc); mesh.setMatrixAt(i++, mtx); }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = tier !== 'low'; mesh.receiveShadow = true;
  return mesh;
}

// --- Searchlights ---------------------------------------------------------------------------------
const beamVS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const beamFS = `uniform vec3 uColor; uniform float uPower; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){
    float along = vUv.y;                            // 0 at the lamp, 1 at the far end
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
    float a = uPower * edge * pow(1. - along, 1.7) * smoothstep(0., 0.02, along);
    gl_FragColor = vec4(uColor * a, a);
  }`;

function searchlights(tier) {
  const g = new THREE.Group();
  if (tier === 'low') return { group: g, update() {} };
  const beams = [];
  const geo = new THREE.CylinderGeometry(5.2, 0.22, 130, 32, 1, true);
  geo.translate(0, 65, 0);        // lamp at the origin, beam up +y
  const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.7, roughness: 0.4 });
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.3, 1.6) });
  const spots = [
    [-9, 15, -0.45, 0.10], [-13, 20, -0.62, 0.0], [-18, 25, -0.78, -0.12], [-24, 18, -0.9, 0.18],
    [9, 15, 0.45, 0.10], [13, 20, 0.62, 0.0], [18, 25, 0.78, -0.12], [24, 18, 0.9, 0.18],
  ];
  spots.forEach(([x, z, tilt, lean], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.3, z);
    const mat = new THREE.ShaderMaterial({
      vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(0.62, 0.78, 1.0) }, uPower: { value: 0.16 } },
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.frustumCulled = false;
    pivot.add(beam);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.5, 20), fixtureMat);
    pivot.add(head);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), lensMat);
    lens.rotation.x = -Math.PI / 2; lens.position.y = 0.26;
    pivot.add(lens);
    g.add(pivot);
    beams.push({ pivot, tilt, lean, phase: i * 1.7, speed: 0.11 + (i % 3) * 0.03 });
  });
  return {
    group: g,
    update(t) {
      for (const b of beams) {
        b.pivot.rotation.z = -b.tilt * 0.55 + Math.sin(t * b.speed + b.phase) * 0.18;
        b.pivot.rotation.x = b.lean + Math.cos(t * b.speed * 0.8 + b.phase) * 0.12;
      }
    },
  };
}

// --- Markings, approach, pad ---------------------------------------------------------------------
function approach() {
  const g = new THREE.Group();
  const z0 = WALL.runout.zMin, z1 = 0, len = z1 - z0;
  const map = groundTexture(23, '#1b1c1f'); map.repeat.set(2, len / 8);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(9, len), new THREE.MeshStandardMaterial({ map, color: 0x9a9ca0, roughness: 0.62, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.002, (z0 + z1) / 2); strip.receiveShadow = true;
  g.add(strip);
  const white = new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.55, depthWrite: false });
  const faint = new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.2, depthWrite: false });
  const flat = (geo, mat, x, z, y = 0.006) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  for (const sx of [-1, 1]) flat(new THREE.PlaneGeometry(0.1, len), white, sx * 4.2, (z0 + z1) / 2);
  for (let z = z0 + 3; z < -1; z += 6) flat(new THREE.PlaneGeometry(0.08, 2.6), faint, 0, z);
  // Distance-to-wall markers every 25 m: a bar and a number, painted on the slab.
  for (let d = 25; d <= -z0 - 5; d += 25) {
    flat(new THREE.PlaneGeometry(1.4, 0.08), white, 5.5, -d);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = 'rgba(223,227,232,0.75)'; x.font = '500 40px "Geist Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(d), 64, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const num = flat(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), 7.1, -d);
    num.rotation.z = Math.PI;
  }
  // Landing target.
  const P = WALL.pad;
  flat(new THREE.CircleGeometry(P.rings.at(-1) + 0.8, 96), new THREE.MeshBasicMaterial({ color: 0x050607, transparent: true, opacity: 0.45, depthWrite: false }), P.x, P.z, 0.004);
  for (const r of P.rings) flat(new THREE.RingGeometry(r - 0.025, r + 0.025, 192), white, P.x, P.z, 0.007);
  flat(new THREE.PlaneGeometry(0.05, 3.4), white, P.x, P.z, 0.008);
  flat(new THREE.PlaneGeometry(3.4, 0.05), white, P.x, P.z, 0.008);
  return g;
}

// Additive glow decal on the slab (the red base glow, light pools).
function glowDecal(color, r, x, z, power) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uC: { value: new THREE.Color(color) }, uP: { value: power } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uC; uniform float uP; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.; float a = uP * pow(max(0., 1. - d), 2.2); gl_FragColor = vec4(uC * a, a); }',
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z);
  return m;
}

// --- Night sky and environment -------------------------------------------------------------------------
export function nightSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y, -1., 1.);
        vec3 c = mix(vec3(0.010, 0.013, 0.022), vec3(0.0015, 0.002, 0.004), smoothstep(0.0, 0.5, h));
        c += vec3(0.02, 0.022, 0.03) * exp(-abs(h) * 22.);
        vec3 sp = floor(vDir * 520.);
        float st = step(0.9982, hash(sp)) * smoothstep(0.08, 0.5, h);
        c += vec3(st) * (0.35 + 0.65 * hash(sp + 3.1));
        if (h < 0.0) c = vec3(0.004, 0.005, 0.007);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Night studio for reflections: black, three long softboxes, a red strip low, a cool rim.
export function bakeNightEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x010102);
  const panel = (w, h, x, y, z, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(34, 1.4, 0, 18, -4, 0xffffff, 2.6);
  panel(20, 2.2, -26, 7, -8, 0xfff2e6, 1.6);
  panel(20, 1.6, 26, 6, 10, 0xdfe9ff, 1.1);
  panel(14, 0.5, 18, 9, 16, 0xff2030, 0.7);
  panel(10, 10, 0, -20, 0, 0x0b0c0f, 1);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.03);
  pm.dispose();
  return rt.texture;
}

// --- The whole look ------------------------------------------------------------------------------------
export function buildWall(tier) {
  const group = new THREE.Group();
  group.name = 'course:wall';
  const S = samples(tier === 'low' ? 200 : 380);

  // Deck.
  const tex = deckTextures();
  const deckMat = new THREE.MeshStandardMaterial({
    map: tex.map, roughnessMap: tex.roughnessMap, bumpMap: tex.bumpMap, bumpScale: 1.2,
    color: 0x8f9196, roughness: 1, metalness: 0, envMapIntensity: 0.3,
  });
  const deck = new THREE.Mesh(deckGeometry(S), deckMat);
  deck.castShadow = tier !== 'low'; deck.receiveShadow = true;
  group.add(deck);

  // Centreline: painted, matte white.
  const line = new THREE.Mesh(ribbon(S, -0.065, 0.065, 0.006), new THREE.MeshStandardMaterial({
    color: 0xe9e9e6, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  line.receiveShadow = true;
  group.add(line);

  // Red LED strips on both top edges (HDR so bloom catches them), a dimmer pair on the back edges.
  // Each strip is a flat band on the deck edge plus a band down the outer face, wide enough
  // (7 cm) to stay continuous at stadium distance.
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 0.26, 0.36), fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const ledDim = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.05, 0.08), fog: false });
  for (const sx of [-1, 1]) {
    group.add(new THREE.Mesh(ribbon(S, sx * (W / 2 - 0.1), sx * (W / 2 - 0.01), 0.008), led));
    group.add(new THREE.Mesh(sideBand(S, sx * (W / 2 + 0.006), 0.0, 0.07), led));
    group.add(new THREE.Mesh(edgeTube(S, sx * (W / 2 + 0.005), 0, T - 0.02, 0.016), ledDim));
  }
  // Faint red spill on the concrete next to each strip.
  const spill = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uC: { value: new THREE.Color(1.0, 0.07, 0.1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uC; varying vec2 vUv; void main(){ float a = 0.12 * pow(vUv.x, 4.0); gl_FragColor = vec4(uC * a, a); }',
  });
  group.add(new THREE.Mesh(ribbon(S, W / 2 - 0.85, W / 2, 0.004), spill));
  const spillL = new THREE.Mesh(ribbon(S, -W / 2 + 0.85, -W / 2, 0.004), spill);
  group.add(spillL);

  // Truss.
  group.add(truss(tier));

  // Ground: a dark polished slab, the approach and the target.
  const gmap = groundTexture(41, '#141518'); gmap.repeat.set(70, 70);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({
    map: gmap, color: 0x8c8f94, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.55,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);
  group.add(approach());
  group.add(glowDecal(0xff1828, 8, 0, 1.0, 0.26));
  group.add(glowDecal(0x8fb6ff, 7, -2.5, -5, 0.12));
  group.add(glowDecal(0x8fb6ff, 7, 2.5, -5, 0.12));

  // Lights. Physically based (candela); decay 2.
  const lights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0x22324a, 0x050506, 0.35);
  lights.add(hemi);
  const wash = new THREE.SpotLight(0xfff0e0, 5200, 0, 0.36, 0.65, 2);
  wash.position.set(-15, 6, -30); wash.target.position.set(1, 12, 8);
  lights.add(wash, wash.target);
  const wash2 = new THREE.SpotLight(0xdfe8ff, 4200, 0, 0.32, 0.7, 2);
  wash2.position.set(16, 4, -26); wash2.target.position.set(0, 14, 9);
  lights.add(wash2, wash2.target);
  // Uplights at the base, raking up the curl (the reference's bright lower deck).
  const uplights = [];
  for (const sx of [-1, 1]) {
    const up = new THREE.SpotLight(0xe9f1ff, 1100, 0, 0.42, 0.55, 2);
    up.position.set(sx * 2.4, 0.25, -5.5); up.target.position.set(sx * 0.5, 13, 10.5);
    lights.add(up, up.target);
    uplights.push(up);
    const fx = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.6, roughness: 0.4 }));
    fx.position.set(sx * 2.4, 0.15, -5.7); group.add(fx);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 3) }));
    lens.position.set(sx * 2.4, 0.2, -5.44); lens.rotation.x = -0.5; group.add(lens);
  }
  const red = new THREE.PointLight(0xff1a28, 35, 18, 2);
  red.position.set(0, 1.2, 1.5);
  lights.add(red);
  group.add(lights);

  const beams = searchlights(tier);
  group.add(beams.group);

  return {
    group,
    titlePose: { x: 0, z: -11, yaw: 0 },
    look: { exposure: 1.18, bloom: { strength: 0.62, radius: 0.55, threshold: 0.82 }, fog: new THREE.FogExp2(0x020305, 0.0032) },
    keyLight: { color: 0xdfe6ff, intensity: 1.7, offset: new THREE.Vector3(-18, 30, -22) },
    update(t) { beams.update(t); },
  };
}
