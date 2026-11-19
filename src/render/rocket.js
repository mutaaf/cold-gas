// The backdrop: a reusable booster carrying a winged orbiter, standing on its launch mount on a raised
// pad, a fixed service tower beside it with its swing arms and crew access arm, lightning masts, a
// water tank and four flood masts, a few hundred metres beyond the stage. Real-world scale and
// proportions of the class (docs/ROCKET.md); our own design and livery (no marks, no flags, no
// names: AGENTS.md invariant 3.7).
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
// The geometry is the sim's (src/sim/complex.js): the physics builds its colliders from the same
// numbers, and the static fire's thrust comes from src/sim/rocket.js (what pushes a car near the pad
// is what lights the trench here).
import { VEHICLE, MOUNT_TOP, PAD_Y, TOWER_X, TOWER_H, TOWER_W, PAD_PROFILE, PAD_SEGMENTS, MOUNT, TRENCH, MAST_H, MASTS, TANK, BUILDINGS, SPHERES, FLOODS, CLAMP_LEVELS, PLACES as SITES, siteOf } from '../sim/complex.js';
import { staticFire, fireClock, ROCKET } from '../sim/rocket.js';

export { VEHICLE };
const R = VEHICLE.radius;

// Per course: where the complex stands (src/sim/complex.js PLACES), and how it's lit and hazed.
// `look` values are linear RGB. Night: floods dominate, a near-black blue haze. Blue hour: a cool sky
// fill and the floods already on, softer.
const PLACES = {
  night: { ...SITES.night, site: siteOf('show'), haze: [0.006, 0.008, 0.013], hazeK: 0.0016, sky: [0.010, 0.014, 0.024], flood: 0.35 },
  lineup: { ...SITES.lineup, site: siteOf('lineup'), haze: [0.040, 0.050, 0.072], hazeK: 0.0011, sky: [0.050, 0.065, 0.100], flood: 0.25 },
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
// weld rings), 2 transfer stage and the orbiter's upper skin (panel joints, bay doors, the red
// hairline), 3 self-lit (windows, lit decks, the white room), 4 the pad (concrete, the flame
// trench), 5 the orbiter's tiled belly.
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
    // Transfer stage and the orbiter's upper skin: clean white. On the orbiter, its panel joints
    // every 1.6 m and the bay doors' centre line down its back; one signal-red hairline round the
    // transfer stage's collar, where the orbiter's adapter sits.
    float orb = step(${(VEHICLE.stage2Top + 1.0).toFixed(1)}, h);
    float seam = hairline(fract(h / 1.6 + 0.5) - 0.5, 0.008 / 1.6) * 0.6 + hairline(vLp.x, 0.025) * step(0.6, vLp.z);
    alb *= 1.0 - 0.3 * seam * orb;
    float red = hairline(h - ${(VEHICLE.stage2Top + 0.15).toFixed(2)}, 0.16);
    alb = mix(alb, vec3(0.6, 0.02, 0.03), red);
    emit += vec3(2.2, 0.06, 0.1) * red * uOn;
    shin = 40.0; spec = 0.12;
  } else if (vMat > 2.5 && vMat < 3.5) {
    emit += vColor * uOn;
    alb = vec3(0.02);
  } else if (vMat > 4.5) {
    // The orbiter's belly: black heat-shield tiles, each a shade apart, in a 0.6 m grid of gaps. The
    // tile-to-tile shading and the gaps fade out with their pixel footprint (no sparkle at range).
    vec2 tp = vec2(vLp.x + vLp.z * 0.5, h) / 0.6;
    float fw = max(fwidth(tp.x), fwidth(tp.y));
    float near = 1.0 - smoothstep(0.25, 0.6, fw);
    float shade = (hash12(floor(tp)) - 0.5) * 0.35 * near;
    float gap = max(hairline(fract(tp.x + 0.5) - 0.5, 0.04), hairline(fract(tp.y + 0.5) - 0.5, 0.04)) * near;
    alb *= (1.0 + shade) * (1.0 - 0.5 * gap);
    shin = 14.0; spec = 0.05;
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
  c += uSky * 0.6 * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 4.0);
  gl_FragColor = vec4(haze(c, vWp), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The service tower's open faces: K-braced lattice, a mipmapped alpha texture on its open bays.
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
  // One 3.4 m × 6.8 m bay of the service tower's open faces: corner legs, a girt at each end and at
  // mid-height, and K-bracing (each half's diagonals meet at one leg's quarter point); transparent.
  const Wd = 128, Ht = 256;
  const c = document.createElement('canvas'); c.width = Wd; c.height = Ht;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineCap = 'square';
  x.lineWidth = 12; x.beginPath(); x.moveTo(6, 0); x.lineTo(6, Ht); x.moveTo(Wd - 6, 0); x.lineTo(Wd - 6, Ht); x.stroke();
  x.lineWidth = 7; x.beginPath(); x.moveTo(0, 3); x.lineTo(Wd, 3); x.moveTo(0, Ht / 2); x.lineTo(Wd, Ht / 2); x.moveTo(0, Ht - 3); x.lineTo(Wd, Ht - 3); x.stroke();
  x.lineWidth = 5; x.beginPath();
  x.moveTo(Wd - 6, Ht / 4); x.lineTo(6, 3); x.moveTo(Wd - 6, Ht / 4); x.lineTo(6, Ht / 2);
  x.moveTo(6, (3 * Ht) / 4); x.lineTo(Wd - 6, Ht / 2); x.moveTo(6, (3 * Ht) / 4); x.lineTo(Wd - 6, Ht - 3);
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

// Hand-built triangles (position + normal) as a BufferGeometry for part().
function soup(pos, nrm) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  else g.computeVertexNormals();
  return g;
}
// A flat-faced slab: a convex polygon in a plane, extruded both ways by half its local thickness.
// `toWorld(u, v, w)` maps polygon coords (u, v) and the offset w across the plane to the vehicle frame.
// Returns { top, bottom, edge } geometries so each side can carry its own surface; every triangle is
// wound to face out, whatever the mapping's handedness.
function slab(poly, half, toWorld) {
  const top = [], bot = [], edge = [];
  const P = (p, w) => toWorld(p[0], p[1], w);
  const cu = poly.reduce((a, p) => a + p[0], 0) / poly.length, cv = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const tri = (out, a, b, c, want) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) out.push(...a, ...c, ...b); else out.push(...a, ...b, ...c);
  };
  const o = P([cu, cv], 0), up = P([cu, cv], 1), nUp = [up[0] - o[0], up[1] - o[1], up[2] - o[2]], nDn = nUp.map((x) => -x);
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    tri(top, P(a, half(a)), P(b, half(b)), P(c, half(c)), nUp);
    tri(bot, P(a, -half(a)), P(b, -half(b)), P(c, -half(c)), nDn);
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0), out = [m[0] - o[0], m[1] - o[1], m[2] - o[2]];
    const a0 = P(a, -half(a)), a1 = P(a, half(a)), b0 = P(b, -half(b)), b1 = P(b, half(b));
    tri(edge, a0, b0, b1, out); tri(edge, a0, b1, a1, out);
  }
  return { top: soup(top), bottom: soup(bot), edge: soup(edge) };
}
const DS = (g) => { g.computeVertexNormals(); return g; };

// --- The launch vehicle -------------------------------------------------------------------------------
// Our own stack, in the class of a reusable first stage carrying a winged orbiter (docs/ROCKET.md):
//   the booster: nine engines (three in, six out) under an open, flared engine skirt; six short
//     landing-leg pods round the skirt; a white tank with a charcoal intertank band and a charcoal
//     forward skirt carrying four swept steering vanes; a charcoal raceway on the tower side;
//   a ribbed metal-grey interstage and a short white transfer stage whose collar carries the one
//     signal-red hairline;
//   the orbiter, nose up on a strut adapter: a flat-bellied lifting body with a double-delta wing,
//     a single fin, a body flap, two aft pods with their engines, lit cockpit windows, and a black
//     tiled belly (surface 5) under a white upper skin with its bay-door lines (surface 2).
// Everything a car can reach (the first 12 m above the pad) stays inside the sim's colliders.
export const ORBITER = { base: VEHICLE.stage2Top + 1.1, halfWidth: 1.5, hatch: 9.0 };
function vehicleParts(parts) {
  const B = MOUNT_TOP, V = VEHICLE;
  const lathe = (pts, mat, color, seg = 64) => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, B + y)), seg);
    parts.push(part(g, color, mat));
  };
  const around = (geo, a, r, y) => { geo.translate(0, 0, r); geo.rotateY(a); geo.translate(0, B + y, 0); return geo; };
  // Engines: nine bells, three round the middle and six in the outer ring, hanging under the skirt.
  const bell = () => new THREE.CylinderGeometry(0.17, 0.43, 1.3, 18, 1, true).translate(0, 0.7, 0);
  for (let k = 0; k < 3; k++) parts.push(part(around(bell(), Math.PI / 2 + (k * 2 * Math.PI) / 3, 0.52, 0), 0x3a3631, 0));
  for (let k = 0; k < 6; k++) parts.push(part(around(bell(), Math.PI / 6 + (k * Math.PI) / 3, 1.3, 0), 0x3a3631, 0));
  // The engine skirt: a heat shield over the bells, flared out and narrowing up into the tank.
  lathe([[0.0, 1.35], [R + 0.14, 1.35], [R + 0.14, 1.95], [R + 0.03, 4.4], [R, 4.6]], 0, 0x232427);
  // Tank (sooted with use), the intertank band, the upper tank, the forward skirt.
  lathe([[R, 4.6], [R, 23.8]], 1, 0xd9dadb);
  lathe([[R + 0.012, 23.8], [R + 0.012, 25.6]], 0, 0x26272a);
  lathe([[R, 25.6], [R, 38.2]], 1, 0xd9dadb);
  lathe([[R + 0.012, 38.2], [R + 0.012, V.boosterTop]], 0, 0x232427);
  // Six landing-leg pods round the skirt: streamlined fairings, flattened against the tank.
  const podProfile = [[0, 0], [0.24, 0.2], [0.3, 0.9], [0.3, 4.6], [0.26, 5.4], [0.12, 5.8], [0, 5.85]].map(([r, y]) => new THREE.Vector2(r, y));
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const pod = new THREE.LatheGeometry(podProfile, 10);
    pod.scale(1, 1, 0.55);
    parts.push(part(around(pod, a, R + 0.12, 1.55), 0x2a2b2e, 0));
    parts.push(part(around(new THREE.BoxGeometry(0.62, 0.14, 0.32), a, R + 0.3, 1.5), 0x151618, 0));   // the folded foot
  }
  // Raceways: a charcoal tunnel on the tower side, a slimmer grey one opposite.
  parts.push(part(around(new THREE.BoxGeometry(0.36, 38.2 - 4.8, 0.22), Math.PI / 2, R + 0.09, 4.8 + (38.2 - 4.8) / 2), 0x232427, 0));
  parts.push(part(around(new THREE.BoxGeometry(0.2, 38.2 - 6, 0.16), -Math.PI / 2, R + 0.07, 6 + (38.2 - 6) / 2), 0xb4b5b7, 0));
  // Four swept steering vanes on the forward skirt (radial plates, a trapezoid in the r–y plane).
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, s = Math.sin(a), c = Math.cos(a);
    const vane = slab([[0, 38.3], [0.95, 39.35], [0.95, 40.55], [0, 40.95]], () => 0.06,
      (u, v, w) => [s * (R + u) + c * w, B + v, c * (R + u) - s * w]);
    for (const g of [vane.top, vane.bottom, vane.edge]) parts.push(part(DS(g), 0x2c2d30, 0));
  }
  // Interstage: ribbed metal grey (twelve low stringers), then the white transfer stage and its collar.
  lathe([[R + 0.012, V.boosterTop], [R + 0.012, V.interstageTop]], 0, 0x8d9095);
  for (let k = 0; k < 12; k++) {
    parts.push(part(around(new THREE.BoxGeometry(0.07, V.interstageTop - V.boosterTop - 0.4, 0.05), (k * Math.PI) / 6, R + 0.03, (V.boosterTop + V.interstageTop) / 2), 0x7a7d82, 0));
  }
  lathe([[R, V.interstageTop], [R, V.stage2Top + 0.3], [R - 0.25, V.stage2Top + 0.42], [0, V.stage2Top + 0.42]], 2, 0xe6e7e7);
  // The separation adapter: eight struts from the collar to the orbiter's aft frame.
  const O = ORBITER.base;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    const p0 = new THREE.Vector3(Math.sin(a) * (R - 0.35), B + V.stage2Top + 0.42, Math.cos(a) * (R - 0.35));
    const p1 = new THREE.Vector3(Math.sin(a) * 1.0, B + O + 0.05, Math.cos(a) * 0.7);
    parts.push(part(member(p0, p1, 0.16), 0x3a3c40, 0, { spread: [1, 0, 1] }));
  }
  orbiterParts(parts);
}

// The orbiter, standing nose up: s runs from its aft bulkhead (s = 0) to the nose (s = L); its back
// (cockpit, fin) faces +z, toward the floods and the stage, and its belly faces −z.
function orbiterParts(parts) {
  const B = MOUNT_TOP, O = ORBITER.base, L = VEHICLE.fairingTop - O, HW = ORBITER.halfWidth;
  const Y = (s) => B + O + s;
  const NOSE0 = 8.2;
  const nt = (s) => Math.max(0, (s - NOSE0) / (L - NOSE0));
  const ell = (s) => Math.sqrt(Math.max(0, 1 - nt(s) ** 2));
  const bump = (s) => { const t = (s - 6.8) / 3.8; return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 2; };
  const bw = (s) => HW * ell(s);
  const top = (s) => (1.12 + 0.38 * bump(s)) * (0.25 + 0.75 * ell(s));
  const belly = (s) => 0.95 * ell(s);
  const cz = (s) => -0.35 * nt(s) ** 2;
  const sgnp = (x, e) => Math.sign(x) * Math.abs(x) ** e;
  const sect = (s, a) => {
    const c = Math.cos(a), si = Math.sin(a);
    return [bw(s) * sgnp(c, 0.72), Y(s), cz(s) + (si > 0 ? top(s) : belly(s)) * sgnp(si, 0.72)];
  };
  // The fuselage: one indexed grid (smooth normals), split into the white back and the tiled belly.
  const NS = 30, NA = 28;
  const ss = Array.from({ length: NS + 1 }, (_, i) => L * (1 - (1 - i / NS) ** 1.45));
  ss[NS] = L;
  const pos = [], idx = [];
  for (const s of ss) for (let k = 0; k <= NA; k++) pos.push(...sect(s, (k / NA) * Math.PI * 2));
  for (let i = 0; i < NS; i++) for (let k = 0; k < NA; k++) {
    const a = i * (NA + 1) + k, b = a + NA + 1;
    idx.push(a, b + 1, a + 1, a, b, b + 1);   // wound outward
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const flat = hull.toNonIndexed(), P = flat.attributes.position.array, N = flat.attributes.normal.array;
  const white = [[], []], tiles = [[], []];
  for (let t = 0; t < P.length; t += 9) {
    const nz = (N[t + 2] + N[t + 5] + N[t + 8]) / 3;
    const to = nz < -0.42 ? tiles : white;
    to[0].push(...P.slice(t, t + 9)); to[1].push(...N.slice(t, t + 9));
  }
  parts.push(part(soup(...white), 0xe9eaea, 2), part(soup(...tiles), 0x1b1c1e, 5));
  // Aft bulkhead.
  const aft = [];
  for (let k = 0; k < NA; k++) aft.push(0, Y(0), cz(0), ...sect(0, (k / NA) * Math.PI * 2), ...sect(0, ((k + 1) / NA) * Math.PI * 2));
  parts.push(part(soup(aft), 0x2a2b2e, 0));
  // Double-delta wing, low on the body: a steep strake into a main delta (planform in x, s).
  const wing = [[HW - 0.15, NOSE0], [2.45, 5.0], [4.15, 1.3], [4.15, 0.55], [HW - 0.15, 0.15]];
  const zw = -0.55, wt = (x) => 0.19 * (1 - 0.75 * (x - HW) / (4.15 - HW));
  for (const sx of [1, -1]) {
    const w = slab(wing, (p) => wt(p[0]), (u, v, w2) => [sx * u, Y(v), zw + w2]);
    parts.push(part(DS(w.top), 0xe6e7e7, 2), part(DS(w.bottom), 0x1b1c1e, 5), part(DS(w.edge), 0x3b3c3f, 0));
    // Elevon: a slim grey hinge line along the trailing edge.
    parts.push(part(member(new THREE.Vector3(sx * (HW + 0.1), Y(0.5), zw + 0.17), new THREE.Vector3(sx * 4.0, Y(0.62), zw + 0.07), 0.05), 0x7a7c80, 0, { spread: [0, 1, 1] }));
  }
  // The fin, on the back.
  const fin = [[1.1, 4.6], [3.7, 1.75], [3.7, 0.65], [1.1, 0.0]];
  const f = slab(fin, (p) => 0.13 * (1 - 0.5 * (p[0] - 1.1) / 2.6), (u, v, w) => [w, Y(v), u]);
  parts.push(part(DS(f.top), 0xe6e7e7, 2), part(DS(f.bottom), 0xe6e7e7, 2), part(DS(f.edge), 0x3b3c3f, 0));
  // Body flap under the aft end (tiled).
  parts.push(part(new THREE.BoxGeometry(2.3, 0.6, 0.18).translate(0, Y(-0.05), -0.82), 0x1b1c1e, 5));
  // Two aft pods on the back with their engines, and a central main engine.
  for (const sx of [1, -1]) {
    const pod = new THREE.LatheGeometry([[0, -0.05], [0.33, 0.05], [0.33, 2.2], [0.2, 3.0], [0, 3.2]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    pod.scale(1, 1, 0.8); pod.translate(sx * 0.82, Y(0), 0.86);
    parts.push(part(pod, 0xe6e7e7, 2));
    parts.push(part(new THREE.CylinderGeometry(0.22, 0.12, 0.45, 14, 1, true).translate(sx * 0.82, Y(-0.25), 0.86), 0x3a3631, 0));
  }
  parts.push(part(new THREE.CylinderGeometry(0.42, 0.2, 0.7, 18, 1, true).translate(0, Y(-0.38), 0.15), 0x3a3631, 0));
  // Cockpit windows: six panes over the nose, lit from inside.
  const pane = (s0, s1, a0, a1) => {
    const o = 0.03, q = (s, a) => { const p = sect(s, a), n = [Math.cos(a) * 0.4, 0, Math.sin(a)]; return [p[0] + n[0] * o, p[1], p[2] + n[2] * o]; };
    const A = q(s0, a0), Bq = q(s0, a1), C = q(s1, a1), D = q(s1, a0);
    return soup([...A, ...C, ...Bq, ...A, ...D, ...C]);
  };
  const win = new THREE.Color(0.55, 0.48, 0.36).getHex();
  for (const [a0, a1] of [[1.33, 1.57], [1.57, 1.81], [0.95, 1.25], [1.89, 2.19]]) parts.push(part(DS(pane(9.55, 10.2, a0, a1)), win, 3));
  for (const [a0, a1] of [[0.62, 0.86], [2.28, 2.52]]) parts.push(part(DS(pane(9.0, 9.5, a0, a1)), win, 3));
  // Thruster ports: dark squares round the nose and on the pods.
  for (const [s, a] of [[10.9, 0.15], [10.9, Math.PI - 0.15], [11.2, 0.5], [11.2, Math.PI - 0.5], [10.6, 1.57]]) {
    const p = sect(s, a);
    parts.push(part(new THREE.BoxGeometry(0.16, 0.12, 0.16).translate(p[0], p[1], p[2]), 0x0e0f10, 0));
  }
  // The crew hatch on the tower side (+x), where the access arm meets it.
  const h = sect(ORBITER.hatch, 0.05);
  parts.push(part(new THREE.BoxGeometry(0.06, 1.0, 0.8).translate(h[0] + 0.02, h[1], h[2]), 0xbfc1c4, 0));
}

function padParts(parts) {
  // The raised hardstand: a flat top and a sloped skirt down to the ground.
  const mound = new THREE.LatheGeometry(PAD_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), PAD_SEGMENTS);
  parts.push(part(mound, 0x8a8b8e, 4));
  // The flame trench, out from under the mount along −z (away from the stage), to its exit, with the
  // deflector's steel plate flush in its floor under the mount.
  const trench = new THREE.BoxGeometry(TRENCH.w, 0.2, TRENCH.to - TRENCH.from); trench.translate(0, PAD_Y + 0.02, -(TRENCH.from + TRENCH.to) / 2);
  parts.push(part(trench, 0x1a1a1b, 4));
  const defl = new THREE.BoxGeometry(TRENCH.w - 1.2, 0.04, 8.6); defl.translate(0, PAD_Y + 0.13, 0);
  parts.push(part(defl, 0x34363a, 0));
  // Launch mount: a steel table on four columns, the deck under the vehicle.
  const [dw, dh, dd] = MOUNT.deck;
  const deck = new THREE.BoxGeometry(dw, dh, dd); deck.translate(0, MOUNT_TOP - dh / 2, 0);
  parts.push(part(deck, 0x4a4c50, 0));
  for (const [x, z] of MOUNT.cols) {
    const col = new THREE.BoxGeometry(MOUNT.col, MOUNT_TOP - dh - PAD_Y, MOUNT.col); col.translate(x, PAD_Y + (MOUNT_TOP - dh - PAD_Y) / 2, z);
    parts.push(part(col, 0x3a3c40, 0));
    // A deluge riser up the column's outer corner.
    const riser = new THREE.CylinderGeometry(0.14, 0.14, MOUNT_TOP - PAD_Y - 0.2, 8, 1, true);
    riser.translate(x + Math.sign(x) * (MOUNT.col / 2 + 0.05), (MOUNT_TOP + PAD_Y) / 2, z + Math.sign(z) * (MOUNT.col / 2 + 0.05));
    parts.push(part(riser, 0x6a6c70, 0, { spread: [1, 0, 1] }));
  }
  // The deluge ring round the base, on the deck.
  const ring = new THREE.TorusGeometry(R + 1.5, 0.12, 6, 40); ring.rotateX(Math.PI / 2); ring.translate(0, MOUNT_TOP + 0.14, 0);
  parts.push(part(ring, 0x6a6c70, 0));
  // Six hold-down posts between the leg pods: a post and a jaw over the skirt's lip.
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const post = new THREE.BoxGeometry(0.5, 1.2, 0.5); post.translate(0, MOUNT_TOP + 0.6, R + 0.55); post.rotateY(a);
    const jaw = new THREE.BoxGeometry(0.42, 0.3, 0.55); jaw.translate(0, MOUNT_TOP + 1.25, R + 0.33); jaw.rotateY(a);
    parts.push(part(post, 0x2a2b2e, 0), part(jaw, 0x3a3c40, 0));
  }
  // Two tail service masts at the deck's back corners, each with an umbilical to the engine skirt.
  for (const sx of [1, -1]) {
    const m = new THREE.BoxGeometry(1.1, 4.2, 1.1); m.translate(sx * 3.7, MOUNT_TOP + 2.1, -3.7);
    parts.push(part(m, 0x55575b, 0));
    const lit = new THREE.BoxGeometry(0.7, 0.35, 0.04); lit.translate(sx * 3.7, MOUNT_TOP + 3.2, -3.13);
    parts.push(part(lit, new THREE.Color(1.4, 1.15, 0.8).getHex(), 3));
    parts.push(part(member(new THREE.Vector3(sx * 3.4, MOUNT_TOP + 3.6, -3.4), new THREE.Vector3(sx * R * 0.72, MOUNT_TOP + 3.4, -R * 0.72), 0.22), 0x2a2b2e, 0, { spread: [0, 1, 1] }));
  }
  // Ground support buildings: low blocks off to one side, and the tank farm's spheres.
  for (const [x, z, w, h, d] of BUILDINGS) {
    const b = new THREE.BoxGeometry(w, h, d); b.translate(x, PAD_Y + h / 2, z);
    parts.push(part(b, 0x55575b, 0));
    const win = new THREE.BoxGeometry(w * 0.7, 0.5, 0.05); win.translate(x, PAD_Y + h * 0.62, z + d / 2 + 0.03);
    parts.push(part(win, new THREE.Color(1.6, 1.35, 0.95).getHex(), 3));
  }
  for (const [x, z, r] of SPHERES) {
    const s = new THREE.SphereGeometry(r, 24, 12); s.translate(x, PAD_Y + r + 1.2, z);
    parts.push(part(s, 0xe2e3e4, 0));
  }
}

// --- The fixed service tower --------------------------------------------------------------------------
// On the sim's footprint (TOWER_X, TOWER_W, TOWER_H): four corner columns and a service level every
// LEVEL metres. The back (+x) is clad; the sides are clad on alternate levels (enclosed rooms) and open
// lattice between; the face toward the vehicle is open lattice (latticeGeometry). Inside: a lift and
// stair core. Swing arms: the three umbilical arms (on the sim's clamp members), the service arm to the
// transfer stage (the sim's arm box), and the crew access arm with its white room at the orbiter's
// hatch. On top: a hammerhead crane and a lightning mast.
const LEVEL = 7.8;
const LEVELS = Array.from({ length: Math.floor((TOWER_H - PAD_Y - 2) / LEVEL) }, (_, i) => PAD_Y + LEVEL * (i + 1));
function towerParts(parts) {
  const x0 = TOWER_X, W = TOWER_W, B = MOUNT_TOP, hw = W / 2;
  const deckTop = new THREE.BoxGeometry(W + 1.2, 1.0, W + 1.2); deckTop.translate(x0, TOWER_H, 0);
  parts.push(part(deckTop, 0x3b3d41, 0));
  // Corner columns.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const c = new THREE.BoxGeometry(0.46, TOWER_H - PAD_Y, 0.46); c.translate(x0 + dx * (hw - 0.23), (TOWER_H + PAD_Y) / 2, dz * (hw - 0.23));
    parts.push(part(c, 0x3a3c40, 0, { spread: [1, 0, 1] }));
  }
  // The lift and stair core, and its lit shaft windows facing the vehicle.
  const core = new THREE.BoxGeometry(1.3, TOWER_H - PAD_Y, 1.3); core.translate(x0 + 0.65, (TOWER_H + PAD_Y) / 2, -0.6);
  parts.push(part(core, 0x2f3134, 0));
  const shaft = new THREE.BoxGeometry(0.04, TOWER_H - PAD_Y - 4, 0.22); shaft.translate(x0 - 0.02, (TOWER_H + PAD_Y) / 2, -0.6);
  parts.push(part(shaft, new THREE.Color(0.5, 0.42, 0.3).getHex(), 3, { spread: [0, 0, 1] }));
  // Levels: a deck slab, its lit edge, the back cladding, alternate side cladding, a stair flight.
  const lit = new THREE.Color(1.25, 1.05, 0.72).getHex();
  LEVELS.forEach((y, i) => {
    const slabG = new THREE.BoxGeometry(W + 0.5, 0.32, W + 0.5); slabG.translate(x0, y, 0);
    parts.push(part(slabG, 0x45474b, 0));
    const e1 = new THREE.BoxGeometry(0.04, 0.07, W + 0.4); e1.translate(x0 - hw - 0.27, y - 0.2, 0);
    const e2 = new THREE.BoxGeometry(W + 0.4, 0.07, 0.04); e2.translate(x0, y - 0.2, hw + 0.27);
    parts.push(part(e1, lit, 3, { spread: [0, 1, 0] }), part(e2, lit, 3, { spread: [0, 1, 0] }));
    const y0 = i === 0 ? PAD_Y : LEVELS[i - 1], hgt = y - y0 - 0.5, ym = (y + y0) / 2 - 0.1;
    const back = new THREE.BoxGeometry(0.12, hgt, W - 0.1); back.translate(x0 + hw - 0.05, ym, 0);
    parts.push(part(back, i % 2 ? 0x686b70 : 0x60636a, 0));
    if (i % 2 === 1) {
      for (const sz of [1, -1]) {
        const side = new THREE.BoxGeometry(W - 0.1, hgt, 0.12); side.translate(x0, ym, sz * (hw - 0.05));
        parts.push(part(side, 0x6c6f74, 0));
        // A lit window band in each enclosed room.
        const band = new THREE.BoxGeometry(W - 0.9, 0.5, 0.04); band.translate(x0, ym + 0.6, sz * (hw + 0.02));
        parts.push(part(band, new THREE.Color(0.9, 0.8, 0.6).getHex(), 3));
      }
    } else {
      // An open level: a stair flight zigzagging up inside the +z face.
      const a = new THREE.Vector3(x0 - hw + 0.5, y0 + 0.2, hw - 0.45), b = new THREE.Vector3(x0 + hw - 0.5, y0 + (y - y0) / 2, hw - 0.45);
      const c = new THREE.Vector3(x0 - hw + 0.5, y - 0.2, hw - 0.45);
      parts.push(part(member(a, b, 0.14), 0x4a4c50, 0, { spread: [1, 1, 1] }), part(member(b, c, 0.14), 0x4a4c50, 0, { spread: [1, 1, 1] }));
    }
  });
  // Umbilical arms at the sim's clamp levels: a horizontal truss on the sim's two members, laced
  // between them, with the umbilical plate where it meets the booster.
  for (const y of CLAMP_LEVELS.map((h) => B + h)) {
    const x1 = x0 - hw, x2 = R + 0.15;
    const ends = [-0.9, 0.9].map((z) => [new THREE.Vector3(x1, y, z), new THREE.Vector3(x2, y, z * 0.5)]);
    for (const [p, q] of ends) parts.push(part(member(p, q, 0.45), 0x34363a, 0, { spread: [0, 1, 1] }));
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4, t1 = (k + 1) / 4, l = (t, z) => new THREE.Vector3(x1 + (x2 - x1) * t, y + 0.05, z * (1 - 0.5 * t));
      parts.push(part(member(l(t0, k % 2 ? 0.9 : -0.9), l(t1, k % 2 ? -0.9 : 0.9), 0.16), 0x4a4c50, 0, { spread: [1, 1, 1] }));
    }
    const plate = new THREE.BoxGeometry(0.4, 1.3, 1.4); plate.translate(R + 0.35, y, 0);
    parts.push(part(plate, 0x55575b, 0));
  }
  // The service arm to the transfer stage (the sim's arm box), its hood at the vehicle end.
  const armY = B + VEHICLE.interstageTop + 5.5, ax0 = R + 0.2, ax1 = x0 - hw;
  const walk = new THREE.BoxGeometry(ax1 - ax0, 0.3, 2.2); walk.translate((ax0 + ax1) / 2, armY - 1.05, 0);
  parts.push(part(walk, 0x46484c, 0));
  for (const sz of [1, -1]) {
    const wall = new THREE.BoxGeometry(ax1 - ax0, 1.9, 0.1); wall.translate((ax0 + ax1) / 2, armY, sz * 1.05);
    parts.push(part(wall, 0x5b5e63, 0));
  }
  const hood = new THREE.BoxGeometry(2.6, 3.0, 3.0); hood.translate(R + 1.3, armY + 0.2, 0);
  parts.push(part(hood, 0x7c7f84, 0));
  // The crew access arm: an enclosed corridor from the tower to the white room at the orbiter's hatch.
  const cy = B + ORBITER.base + ORBITER.hatch, cx0 = ORBITER.halfWidth * 0.98 + 0.25, cx1 = x0 - hw;
  const room = new THREE.BoxGeometry(1.5, 2.7, 2.5); room.translate(cx0 + 0.75, cy, 0);
  parts.push(part(room, 0xd9dadc, 0));
  const corr = new THREE.BoxGeometry(cx1 - cx0 - 1.5, 2.3, 1.8); corr.translate((cx0 + 1.5 + cx1) / 2, cy - 0.1, 0);
  parts.push(part(corr, 0xaeb0b3, 0));
  for (const sz of [1, -1]) {
    const w = new THREE.BoxGeometry(cx1 - cx0 - 1.8, 0.35, 0.04); w.translate((cx0 + 1.5 + cx1) / 2, cy + 0.35, sz * 0.92);
    parts.push(part(w, new THREE.Color(0.85, 0.8, 0.66).getHex(), 3));
    const g = new THREE.BoxGeometry(1.1, 0.6, 0.04); g.translate(cx0 + 0.75, cy + 0.5, sz * 1.27);
    parts.push(part(g, new THREE.Color(0.95, 0.9, 0.76).getHex(), 3));
  }
  // On top: a hammerhead crane (slewing mast, jib over the vehicle, counterweight, cab, hook) and the
  // lightning mast at the back corner.
  const top = TOWER_H + 0.5;
  parts.push(part(new THREE.BoxGeometry(1.0, 5, 1.0).translate(x0, top + 2.5, 0), 0x2b2c2f, 0, { spread: [1, 0, 1] }));
  parts.push(part(new THREE.BoxGeometry(17, 0.8, 0.8).translate(x0 - 1, top + 5.4, 0), 0x2b2c2f, 0, { spread: [0, 1, 1] }));
  parts.push(part(new THREE.BoxGeometry(2.2, 1.6, 1.6).translate(x0 + 6.4, top + 4.9, 0), 0x45474b, 0));
  parts.push(part(new THREE.BoxGeometry(1.4, 1.2, 1.3).translate(x0 + 1.1, top + 4.3, 0.9), 0x5b5e63, 0));
  parts.push(part(new THREE.BoxGeometry(0.04, 0.4, 0.9).translate(x0 + 0.38, top + 4.4, 0.9), new THREE.Color(1.4, 1.2, 0.9).getHex(), 3));
  parts.push(part(member(new THREE.Vector3(x0 - 8.5, top + 5, 0), new THREE.Vector3(x0 - 8.5, top - 4, 0), 0.06), 0x2b2c2f, 0, { spread: [1, 0, 1] }));
  parts.push(part(new THREE.BoxGeometry(0.6, 0.8, 0.6).translate(x0 - 8.5, top - 4.4, 0), 0x8a6a1c, 0));
  parts.push(part(member(new THREE.Vector3(x0 + 1.3, top, 1.3), new THREE.Vector3(x0 + 1.3, TOWER_H + 9.2, 1.3), 0.32), 0x9a9c9f, 0, { spread: [1, 0, 1] }));
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
  const { x: tx, z: tz } = TANK;
  const tank = new THREE.CylinderGeometry(TANK.r, TANK.r, TANK.h, 24); tank.translate(tx, PAD_Y + TANK.y, tz);
  parts.push(part(tank, 0xbfc0c2, 0));
  const cap = new THREE.SphereGeometry(TANK.r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.35, 1); cap.translate(tx, PAD_Y + TANK.y + TANK.h / 2, tz);
  parts.push(part(cap, 0xbfc0c2, 0));
  for (const [dx, dz] of TANK.legs) {
    parts.push(part(member(new THREE.Vector3(tx + dx * 1.5, PAD_Y, tz + dz * 1.5), new THREE.Vector3(tx + dx, PAD_Y + TANK.legTop, tz + dz), TANK.legT), 0x3a3c40, 0, { spread: [1, 0, 1] }));
  }
}
// Flood banks (src/sim/complex.js FLOODS): ground banks close in (lighting the base hard) and mast
// heads further out (the upper vehicle). Aimed at a point on the vehicle; colour × power in
// candela-ish units. A key from the front-left (a ground bank for the base, a mast for the upper
// vehicle), a dimmer bank front-right, and a rim from behind on the right, so the tanks read round.

function latticeGeometry() {
  // The tower's open faces, level by level: the face toward the vehicle (−x) all the way up, the two
  // sides on the open (even) levels. One bay of the texture is W wide and 2W tall.
  const geos = [], W = TOWER_W;
  const face = (f, y0, y1) => {
    const h = y1 - y0, g = new THREE.PlaneGeometry(W, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (h / (W * 2)) + y0 / (W * 2));
    g.translate(0, y0 + h / 2, W / 2);
    g.rotateY(f * Math.PI / 2);
    g.translate(TOWER_X, 0, 0);
    geos.push(g);
  };
  const ys = [PAD_Y, ...LEVELS, TOWER_H];
  face(3, PAD_Y, TOWER_H);                         // −x: toward the vehicle
  for (let i = 0; i + 1 < ys.length; i++) {
    if (i % 2 === 1 && i < LEVELS.length) continue;   // enclosed level: clad (towerParts)
    face(0, ys[i], ys[i + 1]); face(2, ys[i], ys[i + 1]);
  }
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
    rows.push([[side * 6, PAD_Y + 1, -TRENCH.to + 4 - rnd() * 4], [side * 10, 3 + rnd() * 5, -9 - rnd() * 7], i / 34, 11 + rnd() * 6, 6, 28 + rnd() * 14, 1]);
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
  // The tower's working lights: every other service level's front corner, and the crane's cab.
  LEVELS.forEach((y, i) => { if (i % 2 === 0) lampSpots.push([TOWER_X - TOWER_W / 2 - 0.3, y - 0.4, TOWER_W / 2 + 0.2, 2.0, 1.25, 0.5]); });
  lampSpots.push([TOWER_X + 1.1, TOWER_H + 4.8, 1.6, 1.4, 1.0, 0.6]);
  const lamps = glints(lampSpots, 0.9, 3.5);
  group.add(lamps);

  // Aircraft-warning beacons: tower top, every mast's top and middle, the tank. They pulse together
  // and ease on and off (a hard cut lit or killed a pixel-sized dot and its bloom in one frame).
  const red = [1, 0.04, 0.03];
  // (Tower: the lightning mast's top and the crane jib's tip.)
  const beaconSpots = [[TOWER_X + 1.3, TOWER_H + 9.4, 1.3, ...red], [TOWER_X - 9.5, TOWER_H + 6.2, 0, ...red], [TANK.x, PAD_Y + 53.8, TANK.z, ...red]];
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
  glowGeo.setAttribute('aSrc', one(3, [0, MOUNT_TOP - 2, 0, 0, PAD_Y + 3, 8 - TRENCH.to])); glowGeo.setAttribute('aVel', one(3, [0, 0, 0, 0, 0, 0]));
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
  let place = PLACES.night, age = 0, fireT0 = -1e6, titleT = 0, lastT = null, nextFire = 26, simT = null, simFt = -1;
  const FIRE_LEN = ROCKET.fire.len, STEAM_LEN = FIRE_LEN + 20, sf = {};

  // The flood banks light the air around them (src/render/film.js on the high tier).
  const glows = FLOODS.map((f) => ({ pos: new THREE.Vector3(), color: new THREE.Color(...f.col).multiplyScalar(f.ground ? 0.5 : 0.7), radius: 9 }));

  function setLook(id) {
    place = id === 'lineup' ? PLACES.lineup : PLACES.night;
    group.position.set(...place.pos);
    // Face the vehicle's "front" (+z, where the floods are) toward a point near the stage: the sim's
    // own yaw (src/sim/complex.js siteOf), so the drawn pad is where the solid one is.
    group.rotation.y = place.site.yaw;
    group.updateMatrixWorld(true);
    U.uHaze.value.setRGB(...place.haze); U.uHazeK.value = place.hazeK; U.uSky.value.setRGB(...place.sky);
    for (let i = 0; i < 4; i++) {
      const f = fl[i];
      U.uFloodPos.value[i].copy(f.p).applyMatrix4(group.matrixWorld);
      tmp.copy(f.aim).applyMatrix4(group.matrixWorld);
      U.uFloodDir.value[i].subVectors(tmp, U.uFloodPos.value[i]).normalize();
      U.uFloodCol.value[i].copy(f.col).multiplyScalar(f.k * place.flood);
    }
    U.uFirePos.value.set(0, MOUNT_TOP - 1, -6).applyMatrix4(group.matrixWorld);
    for (let i = 0; i < 4; i++) glows[i].pos.copy(U.uFloodPos.value[i]);
  }

  // A static fire: the engines light for a few seconds, the trench throws out a steam cloud.
  function fire(t) {
    fireT0 = t;
    puffU.uFireT.value = t;
    puffGeo.instanceCount = puffGeo.attributes.aKind.count;
    glow.visible = true;
  }

  // A run's clock (s since its start), or null: in a run the range fires on the sim's schedule
  // (src/sim/rocket.js FIRE_SCHEDULE), the same fire whose jet pushes a car parked near the trench.
  function simClock(t) { simT = t; }

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
    // In a run, the sim's fire: lit when it lights (the steam's clock starts with it). It is part of
    // the physics there (its jet shoves a car), so it shows with reduced motion too.
    if (simT !== null && mode !== 'title') {
      const sft = fireClock(simT);
      if (sft >= 0 && (simFt < 0 || sft < simFt)) fire(t - sft);
      simFt = sft;
    }
    simT = null;
    const ft = t - fireT0;
    if (ft >= 0 && ft < STEAM_LEN) {
      // The engines' thrust as the sim has it (src/sim/rocket.js: staggered ignition, cut-off ramp).
      U.uFire.value = ft < FIRE_LEN ? staticFire(ft, sf).level : 0;
      glow.visible = U.uFire.value > 0;
    } else if (puffGeo.instanceCount !== vapour) {
      puffGeo.instanceCount = vapour; U.uFire.value = 0; glow.visible = false;
    }
  }

  return { group, setLook, update, fire, simClock, glows, uniforms: U };
}
