// The test range at blue hour: one low warm key light, a cool sky fill, matte concrete, a white
// kicker with a hairline light strip, the parked lineup, and a bullseye landing pad. Restraint is
// the brief — every object earns its place.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RAMP, LINEUP, PAD, START_Z, RUNOUT_Z } from '../sim/course.js';
import { makeParked, makeRoadster, lampWhite } from './cars.js';

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
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y, -1., 1.);
        vec3 c = mix(mid, zenith, smoothstep(0.02, 0.55, h));
        float band = exp(-max(h, 0.) * 14.0);
        float sunSide = pow(max(dot(normalize(vec3(vDir.x, 0., vDir.z)), normalize(vec3(sunDir.x, 0., sunDir.z))), 0.), 3.0);
        c = mix(c, horizon, band * (0.35 + 0.65 * sunSide));
        c += horizon * pow(max(dot(vDir, sunDir), 0.), 220.) * 1.4;
        // A few stars high up.
        vec3 sp = floor(vDir * 420.);
        float st = step(0.9985, hash(sp)) * smoothstep(0.25, 0.7, h);
        c += vec3(st) * 0.7;
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

function lineup() {
  const g = new THREE.Group();
  for (const b of LINEUP) {
    const car = makeParked(b.id, b.paint);
    // Parked crosswise, nose to +x, alternating facing like a real row.
    car.rotation.y = Math.PI / 2;
    car.position.set(b.id === 'semi' ? 0.2 : 0, 0, b.cz);
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(car);
  }
  return g;
}

function linesAndPad() {
  const g = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.6 });
  const faint = new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.22 });
  const flat = (geo, mat, x, z, y = 0.004) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  // Run-up edge lines and a dashed centreline.
  const len = RAMP.z0 - START_Z;
  for (const sx of [-1, 1]) flat(new THREE.PlaneGeometry(0.08, len), white, sx * 3.6, START_Z + len / 2);
  for (let z = START_Z + 2; z < RAMP.z0 - 2; z += 6) flat(new THREE.PlaneGeometry(0.06, 2.4), faint, 0, z);
  // Distance ticks every 10 m past the lip.
  for (let z = 10; z <= 80; z += 10) flat(new THREE.PlaneGeometry(1.2, 0.05), faint, 4.6, z);
  // Landing pad: three hairline rings + crosshair + a soft disc.
  flat(new THREE.CircleGeometry(PAD.rings.at(-1) + 0.6, 96), new THREE.MeshBasicMaterial({ color: 0x0e1014, transparent: true, opacity: 0.35 }), PAD.x, PAD.z, 0.003);
  for (const r of PAD.rings) flat(new THREE.RingGeometry(r - 0.022, r + 0.022, 192), white, PAD.x, PAD.z, 0.005);
  flat(new THREE.PlaneGeometry(0.04, 3), white, PAD.x, PAD.z, 0.006);
  flat(new THREE.PlaneGeometry(3, 0.04), white, PAD.x, PAD.z, 0.006);
  // Run-out edge lines past the pad.
  for (const sx of [-1, 1]) flat(new THREE.PlaneGeometry(0.06, RUNOUT_Z - PAD.z - 10), faint, sx * 9, (RUNOUT_Z + PAD.z + 10) / 2);
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
  const strut = new THREE.MeshBasicMaterial({ color: 0x080b11 });
  const H = 70;
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, H, 6), strut);
    leg.position.set(x, H / 2, z); tower.add(leg);
  }
  for (let y = 6; y < H; y += 7) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 9), strut);
    band.position.y = y; tower.add(band);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  beacon.position.y = H + 2; tower.add(beacon);
  tower.position.set(-420, -2, 640);
  g.add(tower);
  g.userData.beacon = beacon;
  return g;
}

export function createStage(canvas, { tier = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'high' ? 2 : tier === 'mid' ? 1.5 : 1));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = tier !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.haze, 120, 900);
  scene.environment = bakeEnvironment(renderer);
  scene.environmentIntensity = 0.9;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), skyMaterial());
  sky.frustumCulled = false;
  scene.add(sky);

  // Light: warm low key from the horizon glow, cool hemisphere fill.
  const hemi = new THREE.HemisphereLight(0x8fa6c8, 0x1a1c20, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffd2ad, 2.6);
  key.position.set(-30, 22, 46);
  key.castShadow = tier !== 'low';
  key.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
  const sc = key.shadow.camera;
  sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 140;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
  scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight(0x9ec5ff, 0.7);
  rim.position.set(30, 18, -40);
  scene.add(rim);

  // Ground: one huge slab with tiled concrete.
  const map = concreteTextures();
  map.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: PALETTE.ground, map, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(ramp());
  scene.add(lineup());
  scene.add(linesAndPad());
  const hz = horizon();
  scene.add(hz);

  // Floodlight poles along the run-up: thin, minimal, each with a small lamp head.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.6 });
  for (let z = START_Z + 10; z < 80; z += 24) {
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 9, 10), poleMat);
      pole.position.set(sx * 13, 4.5, z); pole.castShadow = true; scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), lampWhite);
      head.position.set(sx * 12.6, 9, z); scene.add(head);
    }
  }

  const hero = makeRoadster();
  hero.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(hero.group);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 4000);
  camera.position.set(0, 3, START_Z - 8);

  let composer = null, bloom = null;
  if (tier !== 'low') {
    // No MSAA render target: multisampled HalfFloat targets render black on some GPU paths.
    // SMAA after the output pass does the edges instead.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    if (tier === 'high') composer.addPass(new SMAAPass());
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  const keyOffset = new THREE.Vector3(-30, 22, 46);
  function render(time) {
    hz.userData.beacon.visible = Math.sin(time * 2.2) > 0.2;
    // Keep the shadow frustum on the hero.
    hero.group.getWorldPosition(key.target.position);
    key.position.copy(key.target.position).add(keyOffset);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  return { renderer, scene, camera, hero, resize, render, key };
}
