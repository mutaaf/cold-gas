// Three stages, one renderer. The Show (default): the Wall's night stage with the lineup parked
// across the approach under the ledge. The Wall: the reveal's night stage, built in
// src/render/wall.js. The Lineup: the test range at blue hour, with one low warm key light, a cool
// sky fill, matte concrete, a white kicker with a hairline light strip, the parked lineup and a
// bullseye landing pad. `stage.setCourse(id)` swaps the course group, environment, fog, exposure
// and bloom without recreating the renderer.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RAMP, LINEUP, SHOW } from '../sim/courses.js';
import { makeParked, makeRoadster, lampWhite } from './cars.js';
import { buildWall, nightSkyMaterial, bakeNightEnvironment, STARS } from './wall.js';
import { sliver, sliverView, spreadAxes, spreadThin, spreadRing, DECAL, LAYER } from './sliver.js';

const PAD = LINEUP.pad, START_Z = LINEUP.start.z, RUNOUT_Z = LINEUP.runout.zMax;

export const PALETTE = {
  zenith: new THREE.Color(0x05070c),
  mid: new THREE.Color(0x18243a),
  horizon: new THREE.Color(0xd99a6c),
  haze: new THREE.Color(0x2a3242),
  ground: 0x3a3c40,
};

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: PALETTE.zenith }, mid: { value: PALETTE.mid }, horizon: { value: PALETTE.horizon }, sunDir: { value: new THREE.Vector3(-0.55, 0.06, 0.83).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      ${STARS}
      void main(){
        float h = clamp(vDir.y, -1., 1.);
        vec3 c = mix(mid, zenith, smoothstep(0.02, 0.55, h));
        float band = exp(-max(h, 0.) * 14.0);
        float sunSide = pow(max(dot(normalize(vec3(vDir.x, 0., vDir.z)), normalize(vec3(sunDir.x, 0., sunDir.z))), 0.), 3.0);
        c = mix(c, horizon, band * (0.35 + 0.65 * sunSide));
        c += horizon * pow(max(dot(vDir, sunDir), 0.), 220.) * 1.4;
        // A few stars high up.
        c += starField(vDir, 420., 0.9985, 0.25, false) * 0.7;
        if (h < 0.0) c = mix(mid * 0.6, vec3(0.02), smoothstep(0., -0.2, h));
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Canvas textures (bundled, generated once): concrete grain + expansion joints.
function concreteTextures() {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#7a7c80'; x.fillRect(0, 0, S, S);
  const img = x.getImageData(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26 + (rnd() - 0.5) * 10;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  // Soft blotches.
  for (let i = 0; i < 140; i++) {
    const r = 20 + rnd() * 120;
    const gx = rnd() * S, gy = rnd() * S;
    const grad = x.createRadialGradient(gx, gy, 0, gx, gy, r);
    const a = rnd() * 0.08;
    grad.addColorStop(0, `rgba(${rnd() < 0.5 ? '40,40,44' : '160,160,164'},${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad; x.fillRect(gx - r, gy - r, r * 2, r * 2);
  }
  // Joints every slab.
  x.strokeStyle = 'rgba(20,20,22,0.55)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 1); x.lineTo(S, 1); x.moveTo(1, 0); x.lineTo(1, S); x.stroke();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

// An environment for reflections: the same sky plus a few long softboxes, like a keynote stage
// outdoors. Baked once with PMREM.
function bakeEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial());
  env.add(sky);
  const box = (w, h, x, y, z, ry, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.94).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry; m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(30, 1.2, 0, 16, 0, 0, 2.2);
  box(18, 2, -24, 6, 10, 0, 1.4);
  box(18, 2, 24, 8, -10, 0, 0.9);
  box(40, 4, 0, -2, 30, 0, 0.35);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x15171b }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1;
  env.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  pm.dispose();
  return rt.texture;
}

function ramp() {
  const g = new THREE.Group();
  const L = RAMP.z1 - RAMP.z0, W = RAMP.halfWidth * 2;
  // Profile in the (z, y) plane, extruded across x.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= 40; i++) { const s = i / 40; shape.lineTo(s * L, RAMP.height * s * s); }
  shape.lineTo(L, 0);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, steps: 1, curveSegments: 40 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(RAMP.halfWidth, 0, RAMP.z0);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xe9eaec, roughness: 0.62, metalness: 0, clearcoat: 0.25 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  // Hairline light strips along both top edges and across the lip.
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const s = i / 40; pts.push(new THREE.Vector3(sx * (RAMP.halfWidth - 0.05), RAMP.height * s * s + 0.012, RAMP.z0 + s * L)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.012, 6), stripMat);
    g.add(tube);
  }
  const lip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.02, 0.03), stripMat);
  lip.position.set(0, RAMP.height + 0.01, RAMP.z1 - 0.03);
  g.add(lip);
  return g;
}

// The parked row, one mesh per sim body (src/sim/courses.js createWorld). `setBodies(bodies)`
// moves each to its body's pose (a shoved car is drawn where the physics left it); null puts the
// row back where the course parked it.
function lineup(boxes) {
  const g = new THREE.Group();
  const cars = boxes.map((b) => {
    const car = makeParked(b.id, b.paint);
    // Parked crosswise, nose to +x.
    car.rotation.y = Math.PI / 2;
    car.position.set((b.minX + b.maxX) / 2 + (b.id === 'semi' ? 0.2 : 0), 0, b.cz);
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(car);
    return { car, home: { cx: (b.minX + b.maxX) / 2, cz: b.cz, yaw: 0 }, dx: b.id === 'semi' ? 0.2 : 0 };
  });
  g.userData.setBodies = (bodies) => {
    for (let i = 0; i < cars.length; i++) {
      const p = bodies ? bodies[i] : cars[i].home, k = cars[i];
      if (!p) continue;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      k.car.position.set(p.cx + c * k.dx, 0, p.cz - s * k.dx);
      k.car.rotation.y = Math.PI / 2 + p.yaw;
    }
  };
  return g;
}

function linesAndPad() {
  const g = new THREE.Group();
  // Paint: decal offsets and draw order (no z-fighting with the slab or each other), and slivers
  // that stay a pixel wide at range (src/render/sliver.js).
  const paint = (opacity) => sliver(new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity, depthWrite: false, ...DECAL }), { dim: 'alpha', maxK: 64 });
  const white = paint(0.6), faint = paint(0.22);
  const flat = (geo, mat, x, z, y = 0.004, order = LAYER.paint) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = order; g.add(m); return m; };
  // Run-up edge lines and a dashed centreline.
  const len = RAMP.z0 - START_Z;
  for (const sx of [-1, 1]) flat(spreadThin(new THREE.PlaneGeometry(0.08, len)), white, sx * 3.6, START_Z + len / 2);
  for (let z = START_Z + 2; z < RAMP.z0 - 2; z += 6) flat(spreadThin(new THREE.PlaneGeometry(0.06, 2.4)), faint, 0, z);
  // Distance ticks every 10 m past the lip.
  for (let z = 10; z <= 80; z += 10) flat(spreadThin(new THREE.PlaneGeometry(1.2, 0.05)), faint, 4.6, z);
  // Landing pad: three hairline rings + crosshair + a soft disc.
  flat(new THREE.CircleGeometry(PAD.rings.at(-1) + 0.6, 96), new THREE.MeshBasicMaterial({ color: 0x0e1014, transparent: true, opacity: 0.35, depthWrite: false, ...DECAL }), PAD.x, PAD.z, 0.003, LAYER.pad);
  for (const r of PAD.rings) flat(spreadRing(new THREE.RingGeometry(r - 0.022, r + 0.022, 192), r), white, PAD.x, PAD.z, 0.005);
  flat(spreadThin(new THREE.PlaneGeometry(0.04, 3)), white, PAD.x, PAD.z, 0.006);
  flat(spreadThin(new THREE.PlaneGeometry(3, 0.04)), white, PAD.x, PAD.z, 0.006);
  // Run-out edge lines past the pad.
  for (const sx of [-1, 1]) flat(spreadThin(new THREE.PlaneGeometry(0.06, RUNOUT_Z - PAD.z - 10)), faint, sx * 9, (RUNOUT_Z + PAD.z + 10) / 2);
  return g;
}

// Distant low ridges and a lattice test stand with a slow red beacon — the range's horizon.
function horizon() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0b0f17, fog: true });
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 3; k++) {
    const R = 900 + k * 250, pts = [];
    const shape = new THREE.Shape();
    const N = 160;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = 18 + k * 14 + Math.sin(a * 3 + k) * 10 + Math.sin(a * 11 + k * 2) * 5 + rnd() * 4;
      pts.push(new THREE.Vector3(Math.cos(a) * R, h, Math.sin(a) * R));
    }
    const geo = new THREE.BufferGeometry();
    const pos = [];
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      pos.push(a.x, -5, a.z, b.x, -5, b.z, a.x, a.y, a.z, b.x, -5, b.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(geo, mat.clone());
    m.material.color.offsetHSL(0, 0, 0.012 * (2 - k));
    m.material.side = THREE.DoubleSide;
    g.add(m);
    void shape;
  }
  // Test stand tower.
  const tower = new THREE.Group();
  // ~800 m out its legs and bands are under a pixel: slivers keep them solid.
  const strut = sliver(new THREE.MeshBasicMaterial({ color: 0x080b11 }), { minPx: 1, dim: false, maxK: 4 });
  const H = 70;
  const legGeo = spreadAxes(new THREE.CylinderGeometry(0.5, 0.8, H, 6), [1, 0, 1]), bandGeo = spreadAxes(new THREE.BoxGeometry(9, 0.5, 9), [0, 1, 0]);
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    const leg = new THREE.Mesh(legGeo, strut);
    leg.position.set(x, H / 2, z); tower.add(leg);
  }
  for (let y = 6; y < H; y += 7) {
    const band = new THREE.Mesh(bandGeo, strut);
    band.position.y = y; tower.add(band);
  }
  const beacon = new THREE.Mesh(spreadAxes(new THREE.SphereGeometry(1.1, 12, 8), [1, 1, 1]), sliver(new THREE.MeshBasicMaterial({ color: 0xff2a2a }), { minPx: 2, size: 2.2 }));
  beacon.position.y = H + 2; tower.add(beacon);
  tower.position.set(-420, -2, 640);
  g.add(tower);
  g.userData.beacon = beacon;
  return g;
}

// The blue-hour range (the Lineup's look).
function buildLineup(tier) {
  const group = new THREE.Group();
  group.name = 'course:lineup';
  group.add(new THREE.HemisphereLight(0x8fa6c8, 0x1a1c20, 0.55));
  const rim = new THREE.DirectionalLight(0x9ec5ff, 0.7);
  rim.position.set(30, 18, -40);
  group.add(rim);
  const map = concreteTextures();
  map.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: PALETTE.ground, map, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // The reveal's kickflip used no ramp (thrust alone off flat ground), so the Lineup has none.
  const row = lineup(LINEUP.boxes);
  group.add(row);
  group.add(linesAndPad());
  const hz = horizon();
  group.add(hz);
  // Floodlight poles along the run-up: thin, minimal, each with a small lamp head.
  // Slivers (src/render/sliver.js): down the line the poles and lamp heads are under a pixel, and
  // they crawled against the sky (and through the bloom) as the camera moved.
  const poleMat = sliver(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.6 }), { minPx: 1, dim: false, maxK: 4 });
  const headMat = sliver(lampWhite.clone(), { minPx: 1.5 });
  const poleGeo = spreadAxes(new THREE.CylinderGeometry(0.06, 0.09, 9, 10), [1, 0, 1]), headGeo = spreadAxes(new THREE.BoxGeometry(0.9, 0.08, 0.3), [0, 1, 0]);
  for (let z = START_Z + 10; z < 80; z += 24) {
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(sx * 13, 4.5, z); pole.castShadow = tier !== 'low'; group.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(sx * 12.6, 9, z); head.renderOrder = LAYER.light; group.add(head);
    }
  }
  return {
    group,
    titlePose: { x: PAD.x, z: PAD.z, yaw: -0.6 },
    look: { exposure: 1.05, bloom: { strength: 0.3, radius: 0.5, threshold: 0.92 }, fog: new THREE.Fog(PALETTE.haze, 120, 900) },
    keyLight: { color: 0xffd2ad, intensity: 2.6, offset: new THREE.Vector3(-30, 22, 46) },
    // The beacon's slow blink ramps on and off (a hard cut lit or killed a pixel-sized red dot,
    // and its bloom, in a single frame).
    update(t) {
      const k = THREE.MathUtils.smoothstep(Math.sin(t * 2.2), 0.05, 0.35);
      hz.userData.beacon.visible = k > 0;
      hz.userData.beacon.material.color.setRGB(k, 0.0231 * k, 0.0231 * k);
    },
    setBodies: row.userData.setBodies,
  };
}

// The Show: the night Wall with the lineup parked across the approach under the ledge, and the
// landing pad beyond it (src/sim/courses.js SHOW). The reveal parked its row on a low red-lit
// plinth; here it is a red LED outline on the slab, with two white washes so the cars read at night.
// A generator, like buildWall: the look first, then the pieces.
function* buildShow(tier) {
  const wall = buildWall(tier, SHOW.pad);
  const look = wall.next().value;
  look.group.name = 'course:show';
  look.titlePose = { x: SHOW.start.x, z: SHOW.start.z, yaw: 0 };
  yield look;
  yield* wall;
  const row = lineup(SHOW.boxes);
  look.group.add(row);
  look.setBodies = row.userData.setBodies;
  yield;

  const g = new THREE.Group();
  const red = sliver(new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.2, 0.3), fog: false, ...DECAL }), { minPx: 1.5 });
  const flat = (geo, mat, x, z, y = 0.004) => { const m = new THREE.Mesh(spreadThin(geo), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = LAYER.light; g.add(m); return m; };
  const boxes = SHOW.boxes;
  const minX = Math.min(...boxes.map((b) => b.minX)) - 0.6, maxX = Math.max(...boxes.map((b) => b.maxX)) + 0.6;
  const minZ = Math.min(...boxes.map((b) => b.minZ)) - 0.6, maxZ = Math.max(...boxes.map((b) => b.maxZ)) + 0.6;
  // Red outline of the row.
  for (const z of [minZ, maxZ]) flat(new THREE.PlaneGeometry(maxX - minX, 0.07), red, (minX + maxX) / 2, z, 0.006);
  for (const x of [minX, maxX]) flat(new THREE.PlaneGeometry(0.07, maxZ - minZ), red, x, (minZ + maxZ) / 2, 0.006);
  look.group.add(g);

  const cz = (minZ + maxZ) / 2;
  // Two soft top-lights from beyond the row (away from the Wall), so the paint reads without
  // glaring into the chase camera.
  for (const [x, z] of [[-10, cz - 14], [4, cz - 16]]) {
    const wash = new THREE.SpotLight(0xe8eeff, 420, 0, 0.5, 0.8, 2);
    wash.position.set(x, 14, z); wash.target.position.set(0, 0.8, cz);
    look.group.add(wash, wash.target);
  }
  const glow = new THREE.PointLight(0xff1a28, 10, 14, 2);
  glow.position.set(0, 0.6, cz);
  look.group.add(glow);
}

export const COURSE_IDS = ['show', 'wall', 'lineup'];
const BUILDERS = { show: buildShow, wall: buildWall, lineup: function* (tier) { yield buildLineup(tier); } };

// Hand the main thread back (input, the title's CSS animation, a paint) between slices of work.
const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
// Run the rest of a look's build now (a course picked before the first load finished).
function finishBuild(look) {
  while (look.build && !look.build.next().done);
  look.build = null;
}
// Run it in ~10 ms slices, yielding between them, so no single task blocks the page for long.
async function buildSliced(look) {
  while (look.build) {
    const t0 = performance.now();
    while (look.build && performance.now() - t0 < 10) if (look.build.next().done) look.build = null;
    if (look.build) await nextTask();
  }
}

// createStage(canvas, { tier: 'low' | 'mid' | 'high', course: 'show' | 'wall' | 'lineup' })
//   → { renderer, scene, camera, hero, key, course, ready, resize, render(time), setCourse(id), titlePose() }
//
// First load: createStage returns as soon as the renderer, camera and car exist, so the title is
// wired and usable at once. The course is then built in slices between frames, the environment
// is baked, every shader is compiled off the main thread (KHR_parallel_shader_compile, via
// compileAsync), and only then does `render` draw: the canvas fades in on its first frame
// (`.on`), and `stage.ready` resolves.
export function createStage(canvas, { tier = 'high', course = 'show' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'high' ? 2 : tier === 'mid' ? 1.5 : 1));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = tier !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  // Two skies and two environments, each made on first use and swapped with the course.
  const night = nightSkyMaterial();
  const skies = { lineup: skyMaterial(), wall: night, show: night };
  const envs = {};
  const isNight = (id) => id !== 'lineup';
  const envFor = (id) => (envs[isNight(id) ? 'night' : 'day'] ??= isNight(id) ? bakeNightEnvironment(renderer) : bakeEnvironment(renderer));
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), skies.wall);
  sky.frustumCulled = false;
  scene.add(sky);

  // One shadow-casting key light that follows the hero; colour and angle come from the course.
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = tier !== 'low';
  key.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
  const sc = key.shadow.camera;
  sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
  scene.add(key); scene.add(key.target);

  const hero = makeRoadster();
  hero.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(hero.group);

  // Depth resolution worsens as distance² / near: with near at 0.1 m the slab and its paint ran
  // out of it at range. The closest rigs sit 0.35 m over the slab looking along it and about a
  // metre from the car, so 0.3 m clips nothing; the far ridges are 1.4 km out, and the sky draws
  // at the far plane whatever its value.
  const camera = new THREE.PerspectiveCamera(52, 1, 0.3, 3000);
  camera.position.set(0, 3, -100);

  let composer = null, bloom = null, smaa = null;
  if (tier !== 'low') {
    // No MSAA render target: multisampled HalfFloat targets render black on some GPU paths.
    // SMAA after the output pass does the edges instead.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    // SMAA (desktop only) carries ~45 kB of lookup images: its own chunk, fetched in parallel
    // with the course build, so phones never download it.
    if (tier === 'high') smaa = import('three/examples/jsm/postprocessing/SMAAPass.js').then(({ SMAAPass }) => composer.addPass(new SMAAPass()));
  }

  const looks = {};
  // A look is ready to place the car and camera at once; its geometry follows (look.build).
  const lookFor = (id) => {
    if (looks[id]) return looks[id];
    const build = BUILDERS[id](tier);
    const look = build.next().value;
    look.build = build;
    return (looks[id] = look);
  };
  let current = null, drawing = false;
  const keyOffset = new THREE.Vector3(), snap = new THREE.Vector3(), ORIGIN = new THREE.Vector3();
  const lightRot = new THREE.Matrix4(), lightInv = new THREE.Matrix4();
  const texel = (sc.right - sc.left) / key.shadow.mapSize.x;
  const stage = { renderer, scene, camera, hero, key, course: null, ready: null, resize, render, setCourse, titlePose, setBodies, setLook, bloom };

  function setCourse(id, { sliced = false } = {}) {
    if (!COURSE_IDS.includes(id)) id = 'show';
    if (stage.course === id) return stage;
    if (current) scene.remove(current.group);
    current = lookFor(id);
    if (!sliced) finishBuild(current);
    scene.add(current.group);
    stage.course = id;
    sky.material = skies[id];
    if (!sliced) scene.environment = envFor(id);
    scene.environmentIntensity = isNight(id) ? 1.0 : 0.9;
    scene.fog = current.look.fog;
    renderer.toneMappingExposure = current.look.exposure;
    if (bloom) Object.assign(bloom, current.look.bloom);
    key.color.set(current.keyLight.color);
    key.intensity = current.keyLight.intensity;
    keyOffset.copy(current.keyLight.offset);
    // The light's own frame (as its shadow camera sees it: looking down -offset, y up).
    lightRot.lookAt(keyOffset, ORIGIN, key.up);
    lightInv.copy(lightRot).transpose();
    return stage;
  }

  // An outside look takes the stage (Free Drive's roads, src/drive/): its own group with its own
  // sky, plus fog, environment, exposure, bloom and the key light. setLook(null) gives the stage
  // back to the course.
  let external = null;
  function setLook(look) {
    if (external) { scene.remove(external.group); external = null; }
    if (!look) {
      sky.visible = true;
      const id = stage.course; stage.course = null; current = null;
      for (const k of Object.keys(looks)) scene.remove(looks[k].group);
      setCourse(id);
      return stage;
    }
    if (current) scene.remove(current.group);
    external = look;
    scene.add(look.group);
    sky.visible = false;
    scene.environment = look.env; scene.environmentIntensity = look.envIntensity ?? 1;
    scene.fog = look.fog;
    renderer.toneMappingExposure = look.exposure;
    if (bloom) Object.assign(bloom, look.bloom);
    key.color.set(look.keyLight.color);
    key.intensity = look.keyLight.intensity;
    keyOffset.copy(look.keyLight.offset);
    lightRot.lookAt(keyOffset, ORIGIN, key.up);
    lightInv.copy(lightRot).transpose();
    return stage;
  }

  // Pose the parked vehicles from the sim's bodies (or null: back where the course parked them).
  function setBodies(bodies) { if (!external) current.setBodies?.(bodies); }

  // Where the car sits on the title screen for this course: { x, z, yaw }.
  function titlePose() { return current.titlePose; }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    sliverView.value.set(w, h).multiplyScalar(renderer.getPixelRatio() / 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(time) {
    if (!drawing) return;
    (external || current).update(time);
    hero.update?.(time);   // lamps, active aero, skirts, nozzle states
    // Keep the shadow frustum on the hero, snapped to whole shadow-map texels across the light,
    // so the map's grid stays fixed on the ground and shadow edges don't crawl as the car moves.
    hero.group.getWorldPosition(snap);
    snap.applyMatrix4(lightInv);
    snap.x = Math.round(snap.x / texel) * texel; snap.y = Math.round(snap.y / texel) * texel;
    key.target.position.copy(snap.applyMatrix4(lightRot));
    key.position.copy(key.target.position).add(keyOffset);
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
  }

  // Compile every material in the scene, hidden ones too (the ghost, idle plumes), so nothing
  // stalls the first frame or the first time it appears. Never waits more than 4 s.
  function precompile() {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    let done;
    try { done = renderer.compileAsync(scene, camera); } finally { for (const o of hidden) o.visible = false; }
    return Promise.race([done, new Promise((r) => setTimeout(r, 4000))]);
  }

  async function boot() {
    try {
      await nextTask();
      await buildSliced(current);
      await nextTask();
      scene.environment = envFor(stage.course);
      await nextTask();
      await precompile();
      await smaa;
    } catch (err) {
      console.warn('stage warm-up', err);
    }
    drawing = true;
    return stage;
  }

  setCourse(course, { sliced: true });
  stage.ready = boot();
  return stage;
}
