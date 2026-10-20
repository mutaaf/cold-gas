// The backdrop: a reusable two-stage orbital launch vehicle standing on its launch mount on a raised
// pad, a lattice strongback beside it, lightning masts, a water tank and four flood masts, a few
// hundred metres beyond the stage. Real-world scale and proportions (docs/ROCKET.md); our own
// design and livery (no marks, no flags, no names: AGENTS.md invariant 3.7).
//
// Lazy: src/render/scene.js imports this chunk after the first frame, builds it in slices,
// compiles its shaders off the main thread and only then adds it, so the first load doesn't pay
// for it. Everything is unlit-by-three: one shader shades the whole complex from four flood lamps
// (uniforms), so the frame pays no extra lights and the far vehicle can't change any other
// material's program. Draw calls: structure 1, lattice 1, lamps 1, beacons 1, beams 1, vapour 1
// (+ steam and the fire glow, only during a static fire).
//
// Anti-flicker (docs/LESSONS.md): masts, arms and legs carry `aSpread` (src/render/sliver.js) so
// they never drop under a pixel; panel lines, the red hairline and the weld rings fade by their
// own pixel footprint (fwidth); the lattice is a mipmapped texture, so far away it averages to a
// steady grey instead of a moiré of sub-pixel members; lamps and beacons are soft glints that never
// shrink under a few pixels, and the beacons ease rather than cut.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sliver, sliverView, spreadAxes } from './sliver.js';

// --- The vehicle (metres; docs/ROCKET.md) --------------------------------------------------------
export const VEHICLE = {
  height: 70.0,          // overall, base of the engine section to the fairing tip
  radius: 1.83,          // 3.66 m core diameter (road-transportable)
  boosterTop: 41.2,      // first-stage tanks + engine section
  interstageTop: 47.7,   // interstage (carries the four grid fins)
  stage2Top: 56.6,       // second stage, visible part
  fairingRadius: 2.6,    // 5.2 m payload fairing
  fairingTop: 70.0,
  legLength: 9.6,        // four landing legs folded flat against the engine section and tank
  finSize: [1.3, 1.5],   // grid fin, stowed (w × h)
};
const R = VEHICLE.radius;
const MOUNT_TOP = 8.0;   // the launch mount's deck: the vehicle stands on hold-downs here
const PAD_Y = 3.0;       // the pad: a raised hardstand above the surrounding ground
const TOWER_X = 6.4;     // strongback centre, beside the vehicle
const TOWER_H = 82;
const TOWER_W = 3.4;

// Per course: where the complex stands (world), and how it's lit and hazed. `look` values are
// linear RGB. Night: floods dominate, a near-black blue haze. Blue hour: a cool sky fill and the
// floods already on, softer.
const PLACES = {
  night: { pos: [-265, 0, -8], face: [10, -14], haze: [0.006, 0.008, 0.013], hazeK: 0.0016, sky: [0.010, 0.014, 0.024], flood: 0.35 },
  lineup: { pos: [-260, 0, 520], face: [0, 30], haze: [0.040, 0.050, 0.072], hazeK: 0.0011, sky: [0.050, 0.065, 0.100], flood: 0.25 },
};

// --- Shared GLSL ---------------------------------------------------------------------------------
const LIGHT = /* glsl */`
uniform vec3 uFloodPos[4];
uniform vec3 uFloodDir[4];
uniform vec3 uFloodCol[4];
uniform vec3 uSky;
uniform vec3 uHaze;
uniform float uHazeK;
uniform float uOn;
uniform float uFire;
uniform vec3 uFirePos;
// Light arriving at a world point with normal n from the four flood banks (inverse square, a
// soft cone around each bank's aim), the sky, and the engines when they fire.
vec3 floodLight(vec3 wp, vec3 n, vec3 v, float shin, float spec) {
  vec3 acc = uSky * (0.55 + 0.45 * n.y);
  for (int i = 0; i < 4; i++) {
    vec3 L = uFloodPos[i] - wp;
    float d2 = max(dot(L, L), 1.0);
    vec3 l = L * inversesqrt(d2);
    // The bank's beam, plus the spill every flood throws round the pad (the tank farm, the steam).
    float cone = 0.06 + 0.94 * smoothstep(0.80, 0.97, dot(-l, uFloodDir[i]));
    float ndl = max(dot(n, l), 0.0);
    vec3 h = normalize(l + v + vec3(0.0, 1e-4, 0.0));
    acc += uFloodCol[i] * uOn * cone / d2 * (ndl + spec * pow(max(dot(n, h), 0.0), shin) * ndl);
  }
  if (uFire > 0.0) {
    vec3 L = uFirePos - wp;
    float d2 = max(dot(L, L), 4.0);
    acc += vec3(1.0, 0.55, 0.22) * (9000.0 * uFire) * max(dot(n, L * inversesqrt(d2)) * 0.7 + 0.3, 0.0) / d2;
  }
  return acc;
}
vec3 haze(vec3 c, vec3 wp) {
  float f = 1.0 - exp(-length(wp - cameraPosition) * uHazeK);
  return mix(c, uHaze, f);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
// A line of width w (in the units of x) drawn at x = 0, faded by its pixel footprint so it never
// goes under a pixel and sparkles: it dims instead.
float hairline(float x, float w) {
  float fw = max(fwidth(x), 1e-5);
  float cov = 1.0 - smoothstep(w * 0.5, w * 0.5 + fw, abs(x));
  return cov * min(1.0, w / fw);
}`;

function lightUniforms() {
  return {
    uFloodPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uFloodDir: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)) },
    uFloodCol: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
    uSky: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uHazeK: { value: 0.002 },
    uOn: { value: 0 },
    uFire: { value: 0 },
    uFirePos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  };
}

// Surfaces: 0 plain paint/steel (albedo = vertex colour), 1 booster skin (flight-proven soot,
// weld rings), 2 fairing and upper stage (seams, a red hairline), 3 self-lit (windows, the
// white room), 4 the pad (concrete, the flame trench).
const STRUCT_VS = /* glsl */`
attribute float aMat;
varying vec3 vColor; varying float vMat; varying vec3 vWp; varying vec3 vN; varying vec2 vUv; varying vec3 vLp;
#include <common>
void main() {
  #include <begin_vertex>
  vColor = color; vMat = aMat; vUv = uv; vLp = position;
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWp = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const STRUCT_FS = /* glsl */`
uniform float uTime;
varying vec3 vColor; varying float vMat; varying vec3 vWp; varying vec3 vN; varying vec2 vUv; varying vec3 vLp;
${LIGHT}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWp);
  vec3 alb = vColor;
  float shin = 24.0, spec = 0.08;
  float h = vLp.y - ${MOUNT_TOP.toFixed(1)};      // height up the vehicle
  float u = vUv.x;                                 // around the vehicle (0..1)
  vec3 emit = vec3(0.0);
  if (vMat > 0.5 && vMat < 1.5) {
    // Booster: soot from re-entry, heaviest near the top of the tank and down one side, streaked
    // vertically; a cleaner band low down where the legs shield it; faint weld rings.
    float side = 0.5 + 0.5 * cos((u - 0.15) * 6.2831);
    float pat = vnoise(vec2(u * 12.0, h * 0.035)) * 0.55 + vnoise(vec2(u * 34.0, h * 0.09)) * 0.3 + vnoise(vec2(u * 90.0, h * 0.25)) * 0.15;
    float up = smoothstep(3.0, 36.0, h);
    float soot = 0.94 * smoothstep(0.16, 0.6, up * (0.4 + 0.6 * side) + (pat - 0.5) * 0.8);
    alb = mix(alb, vec3(0.03, 0.028, 0.026), soot);
    float ring = hairline(fract(h / 2.95 + 0.5) - 0.5, 0.012);
    alb *= 1.0 - 0.18 * ring;
    shin = 18.0; spec = 0.06 * (1.0 - soot);
  } else if (vMat > 1.5 && vMat < 2.5) {
    // Upper stage and fairing: clean white, the two fairing halves' seam, one signal-red hairline
    // where the fairing meets the stage.
    float seam = max(hairline(fract(u * 2.0 + 0.5) - 0.5, 0.006), 0.0) * step(${(VEHICLE.stage2Top - 0.3).toFixed(1)}, h);
    alb *= 1.0 - 0.35 * seam;
    float red = hairline(h - ${(VEHICLE.stage2Top + 0.15).toFixed(2)}, 0.16);
    alb = mix(alb, vec3(0.6, 0.02, 0.03), red);
    emit += vec3(2.2, 0.06, 0.1) * red * uOn;
    shin = 40.0; spec = 0.12;
  } else if (vMat > 2.5 && vMat < 3.5) {
    emit += vColor * uOn;
    alb = vec3(0.02);
  } else if (vMat > 3.5) {
    // The pad: concrete with large soft patches, darker in the flame trench (scorch).
    float p = vnoise(vWp.xz * 0.05) * 0.5 + vnoise(vWp.xz * 0.21) * 0.3;
    alb *= 0.8 + 0.4 * p;
    shin = 10.0; spec = 0.05;
    // The glow of a lit pad: every flood's light bouncing round the hardstand, fading toward its edge
    // so the pad sits into the night instead of ending in a hard rim.
    emit += alb * uOn * vec3(0.10, 0.10, 0.11) * (1.0 - smoothstep(25.0, 86.0, length(vLp.xz)));
  }
  vec3 c = alb * floodLight(vWp, n, v, shin, spec) + emit;
  // Rim: the night sky catching the curve of the tanks.
  c += uSky * 0.6 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
  gl_FragColor = vec4(haze(c, vWp), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The strongback and the lightning masts: open lattice, a mipmapped alpha texture on open boxes.
const LATTICE_VS = /* glsl */`
varying vec3 vWp; varying vec3 vN; varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LATTICE_FS = /* glsl */`
uniform sampler2D uMap;
varying vec3 vWp; varying vec3 vN; varying vec2 vUv;
${LIGHT}
void main() {
  float a = texture2D(uMap, vUv).a;
  if (a < 0.004) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWp);
  if (dot(n, v) < 0.0) n = -n;
  vec3 c = vec3(0.30, 0.30, 0.31) * floodLight(vWp, n, v, 12.0, 0.1);
  c = haze(c, vWp);
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function latticeTexture() {
  // One 3.4 m × 6.8 m bay: corner legs, a horizontal at each end and an X-brace; transparent.
  const Wd = 128, Ht = 256;
  const c = document.createElement('canvas'); c.width = Wd; c.height = Ht;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineCap = 'square';
  x.lineWidth = 12; x.beginPath(); x.moveTo(6, 0); x.lineTo(6, Ht); x.moveTo(Wd - 6, 0); x.lineTo(Wd - 6, Ht); x.stroke();
  x.lineWidth = 7; x.beginPath(); x.moveTo(0, 3); x.lineTo(Wd, 3); x.moveTo(0, Ht / 2); x.lineTo(Wd, Ht / 2); x.stroke();
  x.lineWidth = 5; x.beginPath();
  x.moveTo(6, 0); x.lineTo(Wd - 6, Ht / 2); x.moveTo(Wd - 6, 0); x.lineTo(6, Ht / 2);
  x.moveTo(6, Ht / 2); x.lineTo(Wd - 6, Ht); x.moveTo(Wd - 6, Ht / 2); x.lineTo(6, Ht);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Additive cones of light from each flood bank toward the vehicle, with slow drifting haze in them.
const BEAM_VS = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vWp;
void main() {
  vUv = uv; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FS = /* glsl */`
uniform float uTime; uniform float uPower;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vWp;
${LIGHT}
void main() {
  // Clamped: interpolation can carry v a hair past 1 at the far rim, and pow() of a negative base is
  // NaN, which the bloom then smeared over half the frame.
  float along = clamp(vUv.y, 0.0, 1.0);
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
  float dust = 0.65 + 0.35 * vnoise(vec2(vUv.x * 7.0 + uTime * 0.05, along * 5.0 - uTime * 0.11));
  float a = uPower * uOn * edge * pow(1.0 - along, 1.5) * smoothstep(0.0, 0.05, along) * dust;
  vec3 c = vec3(0.75, 0.85, 1.0) * a;
  c *= exp(-length(vWp - cameraPosition) * uHazeK * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

// Cryogenic vapour (always: boil-off venting) and steam (a static fire), as soft billboards whose
// whole life is a function of time: no CPU work per frame, nothing to allocate.
const PUFF_VS = /* glsl */`
attribute vec3 aSrc; attribute vec3 aVel; attribute vec4 aLife;   // phase, life (s), size0, size1
attribute float aKind;                                             // 0 vapour, 1 steam
uniform float uTime; uniform float uFireT; uniform vec3 uWind;
varying vec2 vUv; varying float vA; varying vec3 vWp; varying float vSeed; varying float vKind; varying float vAge;
void main() {
  float age;
  if (aKind < 0.5) age = fract(uTime / aLife.y + aLife.x);
  else age = (uTime - uFireT - aLife.x * 7.0) / aLife.y;   // born across the burn, one life each
  vAge = age;
  vKind = aKind;
  float T = age * aLife.y;
  // Vapour leaves the vent fast, slows in the air, sinks (it's colder than the air), drifts downwind.
  vec3 drift = aVel * (1.0 - exp(-T * 1.4)) / 1.4 + uWind * T;
  if (aKind < 0.5) drift.y -= 0.18 * T * T;
  else drift.y += 1.2 * T * (1.0 - exp(-T * 0.4));
  vec3 c = aSrc + drift;
  float size = mix(aLife.z, aLife.w, sqrt(clamp(age, 0.0, 1.0)));
  vec4 wc = modelMatrix * vec4(c, 1.0);
  vWp = wc.xyz;
  vec4 mv = viewMatrix * wc;
  mv.xy += position.xy * size;
  vUv = position.xy + 0.5;
  vSeed = aLife.x * 31.7;
  vA = (age <= 0.0 || age >= 1.0) ? 0.0 : smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age));
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv; varying float vA; varying vec3 vWp; varying float vSeed; varying float vKind; varying float vAge;
${LIGHT}
void main() {
  if (vA <= 0.0) discard;
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float n = vnoise(p * 3.2 + vSeed + vAge * 1.3) * 0.6 + vnoise(p * 7.0 - vSeed + vAge * 2.1) * 0.4;
  // The noise ruffles the edge, but the puff always fades to nothing before the quad's border.
  float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.55) * (1.0 - smoothstep(0.7, 0.98, d)) * vA * (vKind < 0.5 ? 0.26 : 0.7);
  if (a < 0.002) discard;
  // Lit like a cloud: mostly by whatever floods reach it, the underside by the engines.
  vec3 c = vec3(0.8) * (floodLight(vWp, normalize(vec3(p.x, 0.6 - p.y, 0.4)), vec3(0, 0, 1), 4.0, 0.0) * 0.6 + uSky * 3.0 * vKind);
  c = haze(c, vWp);
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The engines' light under the mount during a static fire: an additive glow that breathes.
const GLOW_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv; varying float vA; varying vec3 vWp; varying float vSeed; varying float vKind; varying float vAge;
${LIGHT}
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p * vec2(1.0, 1.6)) * 2.0;
  float breathe = 0.85 + 0.15 * vnoise(vec2(uTime * 6.0, 1.7));
  float a = pow(max(0.0, 1.0 - d), 2.4) * uFire * breathe;
  vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.75), pow(max(0.0, 1.0 - d), 6.0)) * a * 6.0;
  gl_FragColor = vec4(c, 1.0);
}`;

// --- Geometry --------------------------------------------------------------------------------------
// Every structural part: non-indexed, with colour, surface id and sliver attributes, merged into
// one mesh.
function part(geo, color, mat, { spread = null } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (spread) g = spreadAxes(g, spread);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.aSpread) {
    g.setAttribute('aSpread', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  }
  const c = new THREE.Color(color), col = new Float32Array(n * 3), m = new Float32Array(n).fill(mat);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(m, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aSpread', 'aSide', 'color', 'aMat'].includes(k)) g.deleteAttribute(k);
  return g;
}
const at = (geo, x, y, z, ry = 0) => { if (ry) geo.rotateY(ry); geo.translate(x, y, z); return geo; };
// A box from a to b (a stretched unit box along the segment), thickness t.
function member(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function vehicleParts(parts) {
  const B = MOUNT_TOP, V = VEHICLE;
  // Core: booster (with the engine section's slight flare), interstage, upper stage. Separate
  // lathes so each carries its own surface id.
  const lathe = (pts, mat, color) => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, B + y)), 64);
    parts.push(part(g, color, mat));
  };
  lathe([[0.0, 0.0], [R + 0.06, 0.0], [R + 0.06, 1.2], [R, 2.0], [R, V.boosterTop]], 1, 0xd9dadb);
  lathe([[R, V.boosterTop], [R + 0.01, V.boosterTop + 0.05], [R + 0.01, V.interstageTop]], 0, 0x1c1d20);
  // Upper stage, the boat-tail up to the wider fairing, its barrel and a tangent ogive nose.
  const FR = V.fairingRadius, z0 = V.stage2Top, zb = z0 + 1.6, zo = V.fairingTop - 6.2;
  const nose = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    nose.push([Math.max(FR * Math.sqrt(1 - t * t) * (1 - 0.06 * t), 0.0), zo + t * (V.fairingTop - zo)]);
  }
  nose[nose.length - 1][0] = 0;
  lathe([[R, V.interstageTop], [R, z0], [FR - 0.02, zb], [FR, zb + 0.2], [FR, zo], ...nose.slice(1)], 2, 0xe9eaea);

  // Grid fins, stowed flat at the top of the interstage (four, 90° apart).
  const [fw, fh] = V.finSize;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const g = new THREE.BoxGeometry(fw, fh, 0.22);
    g.translate(0, B + V.interstageTop - 1.3, R + 0.16);
    g.rotateY(a);
    parts.push(part(g, 0x2c2d30, 0));
    const hinge = new THREE.BoxGeometry(0.5, 0.3, 0.3); hinge.translate(0, B + V.interstageTop - 0.45, R + 0.12); hinge.rotateY(a);
    parts.push(part(hinge, 0x1a1b1d, 0));
  }
  // Landing legs, folded: a long charcoal fairing on each quadrant between the fins, a foot at the
  // bottom, a pusher fitting at the top.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const leg = new THREE.BoxGeometry(1.0, V.legLength, 0.42);
    leg.translate(0, B + 0.6 + V.legLength / 2, R + 0.2);
    leg.rotateY(a);
    parts.push(part(leg, 0x1d1e21, 0));
    const ridge = new THREE.BoxGeometry(0.34, V.legLength - 0.8, 0.12);
    ridge.translate(0, B + 1.0 + V.legLength / 2, R + 0.46);
    ridge.rotateY(a);
    parts.push(part(ridge, 0x2a2b2f, 0));
    const foot = new THREE.BoxGeometry(1.3, 0.5, 0.7); foot.translate(0, B + 0.55, R + 0.3); foot.rotateY(a);
    parts.push(part(foot, 0x151618, 0));
  }
  // Umbilical / feed lines run up the side: a raceway on the tower side.
  const race = new THREE.BoxGeometry(0.28, V.boosterTop - 3, 0.22);
  race.translate(R + 0.08, B + 3 + (V.boosterTop - 3) / 2, 0.55);
  parts.push(part(race, 0xb9babb, 0));
}

function padParts(parts) {
  // The raised hardstand: a flat top and a sloped skirt down to the ground.
  const mound = new THREE.LatheGeometry([new THREE.Vector2(0, PAD_Y), new THREE.Vector2(66, PAD_Y), new THREE.Vector2(84, 0.25), new THREE.Vector2(86, 0)].reverse(), 64);
  parts.push(part(mound, 0x8a8b8e, 4));
  // The flame trench, out from under the mount, and its deflector exit.
  const trench = new THREE.BoxGeometry(44, 0.2, 9); trench.translate(-26, PAD_Y + 0.02, 0);
  parts.push(part(trench, 0x1a1a1b, 4));
  // Launch mount: a steel table on four columns, the deck under the vehicle.
  const deck = new THREE.BoxGeometry(10, 1.6, 10); deck.translate(0, MOUNT_TOP - 0.8, 0);
  parts.push(part(deck, 0x4a4c50, 0));
  for (const [x, z] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
    const col = new THREE.BoxGeometry(1.4, MOUNT_TOP - 1.6 - PAD_Y, 1.4); col.translate(x, PAD_Y + (MOUNT_TOP - 1.6 - PAD_Y) / 2, z);
    parts.push(part(col, 0x3a3c40, 0));
  }
  // Hold-down clamps at the base.
  for (let k = 0; k < 4; k++) {
    const g = new THREE.BoxGeometry(0.7, 1.1, 0.7); g.translate(0, MOUNT_TOP + 0.4, R + 0.55); g.rotateY(k * Math.PI / 2 + 0.3);
    parts.push(part(g, 0x2a2b2e, 0));
  }
  // Ground support buildings: low blocks off to one side, and the tank farm's spheres.
  for (const [x, z, w, h, d] of [[-48, -30, 22, 7, 12], [-60, -6, 12, 5, 9], [44, -44, 16, 6, 10]]) {
    const b = new THREE.BoxGeometry(w, h, d); b.translate(x, PAD_Y + h / 2, z);
    parts.push(part(b, 0x55575b, 0));
    const win = new THREE.BoxGeometry(w * 0.7, 0.5, 0.05); win.translate(x, PAD_Y + h * 0.62, z + d / 2 + 0.03);
    parts.push(part(win, new THREE.Color(1.6, 1.35, 0.95).getHex(), 3));
  }
  for (const [x, z, r] of [[38, 30, 4.2], [48, 33, 4.2], [-30, 44, 5]]) {
    const s = new THREE.SphereGeometry(r, 24, 12); s.translate(x, PAD_Y + r + 1.2, z);
    parts.push(part(s, 0xe2e3e4, 0));
  }
}

// The strongback beside the vehicle: lattice faces (a separate transparent mesh), plus its solid
// pieces here: the top deck, the crew access arm and white room, the clamp arms.
function towerParts(parts) {
  const x0 = TOWER_X, B = MOUNT_TOP;
  const deckTop = new THREE.BoxGeometry(TOWER_W + 1.2, 1.0, TOWER_W + 1.2); deckTop.translate(x0, TOWER_H, 0);
  parts.push(part(deckTop, 0x3b3d41, 0));
  // Crane jib on top.
  parts.push(part(member(new THREE.Vector3(x0, TOWER_H + 0.5, 0), new THREE.Vector3(x0, TOWER_H + 9, 0), 0.5), 0x2b2c2f, 0, { spread: [1, 0, 1] }));
  parts.push(part(member(new THREE.Vector3(x0, TOWER_H + 8, 0), new THREE.Vector3(x0 - 6, TOWER_H + 6.5, 0), 0.4), 0x2b2c2f, 0, { spread: [1, 1, 1] }));
  // Crew access arm into the white room at the upper stage.
  const armY = B + VEHICLE.interstageTop + 5.5;
  const arm = new THREE.BoxGeometry(x0 - TOWER_W / 2 - (R + 0.2), 2.4, 2.2); arm.translate((x0 - TOWER_W / 2 + R + 0.2) / 2, armY, 0);
  parts.push(part(arm, 0x46484c, 0));
  const room = new THREE.BoxGeometry(2.6, 3.0, 3.0); room.translate(R + 1.3, armY + 0.2, 0);
  parts.push(part(room, 0x8a8c90, 0));
  const glow = new THREE.BoxGeometry(2.0, 0.6, 0.04); glow.translate(R + 1.3, armY + 0.5, 1.53);
  parts.push(part(glow, new THREE.Color(1.8, 1.7, 1.45).getHex(), 3));
  const glow2 = glow.clone(); glow2.translate(0, 0, -3.06);
  parts.push(part(glow2, new THREE.Color(1.8, 1.7, 1.45).getHex(), 3));
  // Clamp arms holding the vehicle (a pair at each level).
  for (const y of [B + 18, B + 33, B + VEHICLE.boosterTop - 1.5]) {
    for (const z of [-0.9, 0.9]) {
      parts.push(part(member(new THREE.Vector3(x0 - TOWER_W / 2, y, z), new THREE.Vector3(R + 0.15, y, z * 0.5), 0.45), 0x34363a, 0, { spread: [0, 1, 1] }));
    }
  }
  // Lightning masts: tall tapered poles around the pad (sliver: always at least a pixel).
  for (const [x, z] of MASTS) {
    const g = new THREE.CylinderGeometry(0.35, 1.0, MAST_H, 8, 1, true); g.translate(x, PAD_Y + MAST_H / 2, z);
    parts.push(part(g, 0x2a2c30, 0, { spread: [1, 0, 1] }));
  }
  // Flood masts: a pole and a lamp bank frame each.
  for (const f of FLOODS) {
    if (f.ground) continue;
    const g = new THREE.CylinderGeometry(0.25, 0.4, f.p[1] - PAD_Y, 8, 1, true); g.translate(f.p[0], (f.p[1] + PAD_Y) / 2, f.p[2]);
    parts.push(part(g, 0x2a2c30, 0, { spread: [1, 0, 1] }));
  }
  // The water tank (sound suppression) on its legs.
  const [tx, tz] = TANK;
  const tank = new THREE.CylinderGeometry(5.5, 5.5, 11, 24); tank.translate(tx, PAD_Y + 46, tz);
  parts.push(part(tank, 0xbfc0c2, 0));
  const cap = new THREE.SphereGeometry(5.5, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.35, 1); cap.translate(tx, PAD_Y + 51.5, tz);
  parts.push(part(cap, 0xbfc0c2, 0));
  for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
    parts.push(part(member(new THREE.Vector3(tx + dx * 1.5, PAD_Y, tz + dz * 1.5), new THREE.Vector3(tx + dx, PAD_Y + 41, tz + dz), 0.6), 0x3a3c40, 0, { spread: [1, 0, 1] }));
  }
}
const MAST_H = 104;
const MASTS = [[-34, -22], [30, -30], [-8, 44]];
const TANK = [-62, 36];
// Flood banks: ground banks close in (lighting the base hard) and mast heads further out (the
// upper vehicle). Aimed at a point on the vehicle; colour × power in candela-ish units.
// A key from the front-left (a ground bank for the base, a mast for the upper vehicle), a dimmer
// bank front-right, and a rim from behind on the right, so the tanks read round, not flat.
const FLOODS = [
  { p: [-15, PAD_Y + 1.2, 19], aim: 18, col: [1.0, 0.95, 0.88], k: 2300, ground: true },
  { p: [18, PAD_Y + 1.2, 13], aim: 26, col: [0.84, 0.9, 1.0], k: 900, ground: true },
  { p: [-30, 26, 24], aim: 52, col: [0.97, 0.98, 1.0], k: 6500 },
  { p: [24, 32, -26], aim: 46, col: [0.78, 0.86, 1.0], k: 7000 },
];

function latticeGeometry() {
  // Open boxes: four faces each, no top or bottom. The strongback and the tank's leg bracing.
  const geos = [];
  const box = (cx, cz, w, y0, y1) => {
    const h = y1 - y0;
    for (let f = 0; f < 4; f++) {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (h / (w * 2)));
      g.translate(0, y0 + h / 2, w / 2);
      g.rotateY(f * Math.PI / 2);
      g.translate(cx, 0, cz);
      geos.push(g);
    }
  };
  box(TOWER_X, 0, TOWER_W, PAD_Y, TOWER_H);
  return mergeGeometries(geos);
}

function beamGeometry() {
  const geos = [];
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  for (const f of FLOODS) {
    const from = new THREE.Vector3(...f.p), to = new THREE.Vector3(0, MOUNT_TOP + f.aim, 0);
    const d = to.clone().sub(from), len = d.length() * 1.25;
    const g = new THREE.CylinderGeometry(len * 0.2, 0.6, len, 24, 1, true);
    g.translate(0, len / 2, 0);
    // CylinderGeometry's v is 0 at the bottom (the lamp, as the searchlights' beams use it).
    g.applyQuaternion(q.setFromUnitVectors(up, d.normalize()));
    g.translate(from.x, from.y, from.z);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Puffs: [src, vel, phase, life, size0, size1, kind]
function puffGeometry(rnd) {
  const B = MOUNT_TOP, V = VEHICLE;
  const rows = [];
  const vent = (n, y, ang, speed, life, s0, s1) => {
    for (let i = 0; i < n; i++) {
      const a = ang + (rnd() - 0.5) * 0.5;
      rows.push([[Math.sin(a) * (R + 0.2), B + y + (rnd() - 0.5) * 0.6, Math.cos(a) * (R + 0.2)], [Math.sin(a) * speed, (rnd() - 0.3) * 0.6, Math.cos(a) * speed], i / n + rnd() * 0.04, life * (0.8 + rnd() * 0.4), s0, s1 * (0.8 + rnd() * 0.4), 0]);
    }
  };
  vent(9, V.stage2Top - 1.5, 1.2, 3.2, 9, 1.0, 8);       // upper-stage oxidiser vent
  vent(7, V.boosterTop - 2.5, -0.6, 2.6, 8, 1.0, 7);       // booster vent below the interstage
  vent(7, 6, 2.6, 1.4, 11, 2, 9);                          // cold tank skin at the base, rolling off the mount
  // Steam: out of the flame trench's exit, billowing sideways and up, through the burn.
  for (let i = 0; i < 34; i++) {
    const side = rnd() - 0.5;
    rows.push([[-44 - rnd() * 4, PAD_Y + 1, side * 6], [-9 - rnd() * 7, 3 + rnd() * 5, side * 10], i / 34, 11 + rnd() * 6, 6, 28 + rnd() * 14, 1]);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const A = (k, n) => new THREE.InstancedBufferAttribute(new Float32Array(rows.flatMap((r) => k(r))), n);
  g.setAttribute('aSrc', A((r) => r[0], 3));
  g.setAttribute('aVel', A((r) => r[1], 3));
  g.setAttribute('aLife', A((r) => [r[2], r[3], r[4], r[5]], 4));
  g.setAttribute('aKind', A((r) => [r[6]], 1));
  g.instanceCount = rows.length;
  return { g, vapour: rows.filter((r) => !r[6]).length };
}

// Point lamps as soft additive glints: a gaussian on a camera-facing quad, never smaller than
// `minPx` (energy kept as it widens). A rasterised dot a couple of pixels wide stepped between
// pixels as the camera drifted and the bloom spread every step; a smooth falloff just slides.
const GLINT_VS = /* glsl */`
attribute vec3 aPos; attribute vec3 aCol;
uniform float uSize; uniform float uMinPx; uniform vec2 uHalfView; uniform vec3 uTint;
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(aPos, 1.0);
  float pxPerM = projectionMatrix[1][1] * uHalfView.y / max(-mv.z, 1e-3);
  float size = max(uSize, uMinPx / pxPerM);
  float k = uSize / size;
  vCol = aCol * uTint * k * k;
  vUv = position.xy * 2.0;
  mv.xy += position.xy * size * 2.0;
  gl_Position = projectionMatrix * mv;
}`;
const GLINT_FS = /* glsl */`
varying vec2 vUv; varying vec3 vCol;
void main() {
  float a = exp(-dot(vUv, vUv) * 4.5);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;
function glints(spots, size, minPx) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(spots.flatMap((p) => p.slice(0, 3))), 3));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(spots.flatMap((p) => p.slice(3, 6))), 3));
  g.instanceCount = spots.length;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: GLINT_VS, fragmentShader: GLINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: size }, uMinPx: { value: minPx }, uHalfView: sliverView, uTint: { value: new THREE.Color(1, 1, 1) } },
  }));
  m.renderOrder = 5; m.frustumCulled = false;
  return m;
}

// --- Assembly --------------------------------------------------------------------------------------
// A generator, like the courses' builders: each `yield` is a safe place for the first load to hand
// the main thread back. Its last value is the backdrop.
export function* buildRocket({ reducedMotion = false } = {}) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const group = new THREE.Group();
  group.name = 'backdrop:rocket';
  const U = lightUniforms();

  const parts = [];
  vehicleParts(parts);
  yield;
  padParts(parts);
  towerParts(parts);
  yield;
  const structMat = sliver(new THREE.ShaderMaterial({ vertexShader: STRUCT_VS, fragmentShader: STRUCT_FS, uniforms: U, vertexColors: true }), { minPx: 1.5, dim: false, maxK: 6 });
  const struct = new THREE.Mesh(mergeGeometries(parts), structMat);
  group.add(struct);
  yield;

  const lattice = new THREE.Mesh(latticeGeometry(), new THREE.ShaderMaterial({
    vertexShader: LATTICE_VS, fragmentShader: LATTICE_FS, side: THREE.DoubleSide, transparent: true, depthWrite: false, premultipliedAlpha: true,
    uniforms: { ...U, uMap: { value: latticeTexture() } },
  }));
  lattice.renderOrder = 1;
  group.add(lattice);

  // Lamps: flood heads (bright, cool) and the tower's working lights (sodium-warm), blobs that stay
  // a couple of pixels wide at any range.
  const lampSpots = [];
  for (const f of FLOODS) lampSpots.push([f.p[0], f.p[1] + (f.ground ? 0.3 : 0.6), f.p[2], 5, 5.3, 5.8]);
  for (const y of [MOUNT_TOP + 4, 34, 58, TOWER_H - 1]) lampSpots.push([TOWER_X - TOWER_W / 2 - 0.3, y, TOWER_W / 2 + 0.2, 2.0, 1.25, 0.5]);
  const lamps = glints(lampSpots, 0.9, 3.5);
  group.add(lamps);

  // Aircraft-warning beacons: tower top, every mast's top and middle, the tank. They pulse together
  // and ease on and off (a hard cut lit or killed a pixel-sized dot and its bloom in one frame).
  const red = [1, 0.04, 0.03];
  const beaconSpots = [[TOWER_X, TOWER_H + 9.4, 0, ...red], [TANK[0], PAD_Y + 53.8, TANK[1], ...red]];
  for (const [x, z] of MASTS) beaconSpots.push([x, PAD_Y + MAST_H + 0.6, z, ...red], [x, PAD_Y + MAST_H * 0.5, z, ...red]);
  const beacons = glints(beaconSpots, 1.1, 3.5);
  group.add(beacons);
  yield;

  const beams = new THREE.Mesh(beamGeometry(), new THREE.ShaderMaterial({
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...U, uPower: { value: 0.05 } },
  }));
  beams.renderOrder = 2;
  beams.frustumCulled = false;
  group.add(beams);

  const { g: puffGeo, vapour } = puffGeometry(rnd);
  const puffU = { ...U, uFireT: { value: -1e6 }, uWind: { value: new THREE.Vector3(1.1, 0, 0.35) } };
  const puffs = new THREE.Mesh(puffGeo, new THREE.ShaderMaterial({
    vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false, premultipliedAlpha: true, uniforms: puffU,
  }));
  puffs.renderOrder = 3;
  puffs.frustumCulled = false;
  puffGeo.instanceCount = vapour;   // steam joins in only while it's needed
  group.add(puffs);

  // The engines' glow under the mount (a single billboard, only during a static fire).
  const glowGeo = new THREE.InstancedBufferGeometry();
  glowGeo.index = puffGeo.index; glowGeo.setAttribute('position', puffGeo.attributes.position);
  const one = (n, v) => new THREE.InstancedBufferAttribute(new Float32Array(v), n);
  // Two: under the vehicle, and where the deflected exhaust leaves the flame trench.
  glowGeo.setAttribute('aSrc', one(3, [0, MOUNT_TOP - 2, 0, -40, PAD_Y + 3, 0])); glowGeo.setAttribute('aVel', one(3, [0, 0, 0, 0, 0, 0]));
  glowGeo.setAttribute('aLife', one(4, [0, 1e9, 22, 22, 0.5, 1e9, 30, 30])); glowGeo.setAttribute('aKind', one(1, [0, 0]));
  glowGeo.instanceCount = 2;
  const glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
    vertexShader: PUFF_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: puffU,
  }));
  glow.renderOrder = 4; glow.frustumCulled = false; glow.visible = false;
  group.add(glow);
  yield;

  // --- Placement, look and life ---
  const fl = FLOODS.map((f) => ({ p: new THREE.Vector3(...f.p), aim: new THREE.Vector3(0, MOUNT_TOP + f.aim, 0), col: new THREE.Color(...f.col), k: f.k }));
  const tmp = new THREE.Vector3();
  let place = PLACES.night, age = 0, fireT0 = -1e6, titleT = 0, lastT = null, nextFire = 26;
  const FIRE_LEN = 7.5, STEAM_LEN = FIRE_LEN + 20;

  // The flood banks light the air around them (src/render/film.js on the high tier).
  const glows = FLOODS.map((f) => ({ pos: new THREE.Vector3(), color: new THREE.Color(...f.col).multiplyScalar(f.ground ? 0.5 : 0.7), radius: 9 }));

  function setLook(id) {
    place = id === 'lineup' ? PLACES.lineup : PLACES.night;
    group.position.set(...place.pos);
    // Face the vehicle's "front" (+z, where the floods are) toward a point near the stage.
    group.rotation.y = Math.atan2(place.face[0] - place.pos[0], place.face[1] - place.pos[2]);
    group.updateMatrixWorld(true);
    U.uHaze.value.setRGB(...place.haze); U.uHazeK.value = place.hazeK; U.uSky.value.setRGB(...place.sky);
    for (let i = 0; i < 4; i++) {
      const f = fl[i];
      U.uFloodPos.value[i].copy(f.p).applyMatrix4(group.matrixWorld);
      tmp.copy(f.aim).applyMatrix4(group.matrixWorld);
      U.uFloodDir.value[i].subVectors(tmp, U.uFloodPos.value[i]).normalize();
      U.uFloodCol.value[i].copy(f.col).multiplyScalar(f.k * place.flood);
    }
    U.uFirePos.value.set(-6, MOUNT_TOP - 1, 0).applyMatrix4(group.matrixWorld);
    for (let i = 0; i < 4; i++) glows[i].pos.copy(U.uFloodPos.value[i]);
  }

  // A static fire: the engines light for a few seconds, the trench throws out a steam cloud.
  function fire(t) {
    fireT0 = t;
    puffU.uFireT.value = t;
    puffGeo.instanceCount = puffGeo.attributes.aKind.count;
    glow.visible = true;
  }

  function update(t, mode) {
    // Time since it arrived (scene time can jump: a pinned clock, a new run), never backwards.
    const dt = lastT === null ? 0 : Math.min(0.25, Math.max(0, t - lastT));
    lastT = t;
    age += dt;
    // Power up: the floods come on first, the beacons and working lights after.
    const on = THREE.MathUtils.smoothstep(age, 0.2, 2.6);
    U.uOn.value = on;
    U.uTime.value = t;
    lamps.material.uniforms.uTint.value.setScalar(THREE.MathUtils.smoothstep(age, 0.0, 1.2));
    // Beacons: ~30 slow pulses a minute, all together, eased on and off over ≈ 0.4 s.
    const b = THREE.MathUtils.smoothstep(Math.sin(t * 3.1), -0.35, 0.75) * THREE.MathUtils.smoothstep(age, 1.5, 2.5);
    beacons.material.uniforms.uTint.value.setScalar(2.4 * b);
    beacons.visible = b > 0;
    // The title's rare spectacle (never with reduced motion).
    if (mode === 'title' && !reducedMotion) {
      titleT += dt;
      if (titleT > nextFire && t - fireT0 > STEAM_LEN) { fire(t); nextFire = titleT + 100 + rnd() * 60; }
    }
    const ft = t - fireT0;
    if (ft >= 0 && ft < STEAM_LEN) {
      // Ignition ramps in 0.4 s, holds, cuts off over 0.6 s.
      U.uFire.value = ft < FIRE_LEN ? THREE.MathUtils.smoothstep(ft, 0, 0.4) * (1 - THREE.MathUtils.smoothstep(ft, FIRE_LEN - 0.6, FIRE_LEN)) : 0;
      glow.visible = U.uFire.value > 0;
    } else if (puffGeo.instanceCount !== vapour) {
      puffGeo.instanceCount = vapour; U.uFire.value = 0; glow.visible = false;
    }
  }

  return { group, setLook, update, fire, glows, uniforms: U };
}
