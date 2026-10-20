// Cold gas looks nothing like fire: a near-invisible supersonic core, a white shock-diamond
// cone, and condensation mist that blooms and drifts. Each nozzle gets a shader cone scaled by
// its valve state, and a shared particle pool sheds mist. Allocation-free per frame.
import * as THREE from 'three';
import { NOZZLES } from '../sim/vehicle.js';
import { NOZZLE_VISUAL } from './roadster.js';

const coneVS = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vView;
  void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.); vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv; }`;
const coneFS = `
  uniform float uTime; uniform float uPower; uniform float uSeed;
  varying vec2 vUv; varying vec3 vN; varying vec3 vView;
  float hash(float n){ return fract(sin(n)*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    float a=hash(i.x+i.y*57.), b=hash(i.x+1.+i.y*57.), c=hash(i.x+(i.y+1.)*57.), d=hash(i.x+1.+(i.y+1.)*57.);
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
  void main(){
    float along = vUv.y;                   // 0 at the nozzle, 1 at the tip
    float rim = pow(1. - abs(dot(vN, vView)), 1.6);
    float core = 1. - rim;
    float diamonds = 0.55 + 0.45 * cos(along * 38. - uTime * 30. + uSeed);
    float n = noise(vec2(vUv.x * 12. + uSeed, along * 6. - uTime * 14.));
    float fade = pow(1. - along, 1.4) * smoothstep(0., 0.04, along);
    float a = (0.22 * core * diamonds + 0.55 * rim * n) * fade * uPower;
    vec3 col = mix(vec3(0.82, 0.92, 1.0), vec3(1.), core * diamonds);
    gl_FragColor = vec4(col * 1.6, a);
  }`;

function mistTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createPlumes(scene, hero, { maxMist = 900 } = {}) {
  const cones = [];
  const geo = new THREE.ConeGeometry(0.16, 1, 24, 1, true);
  geo.translate(0, -0.5, 0);               // apex at origin, extends down -y
  geo.rotateX(Math.PI);                     // now extends +y; we orient +y along the jet
  for (let i = 0; i < NOZZLES.length; i++) {
    const nz = NOZZLES[i];
    const mat = new THREE.ShaderMaterial({
      vertexShader: coneVS, fragmentShader: coneFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: i * 7.3 } },
    });
    const m = new THREE.Mesh(geo, mat);
    // Jet points opposite the force on the car.
    const jet = new THREE.Vector3(-nz.dir.x, -nz.dir.y, -nz.dir.z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), jet);
    // Nozzle position in the visual body frame (physics origin = CoM): where the model draws it.
    m.position.set(...NOZZLE_VISUAL[i]);
    m.frustumCulled = false;
    m.visible = false;
    hero.add(m);
    cones.push({ mesh: m, mat, jet });
  }

  // Mist particles (world space).
  const pos = new Float32Array(maxMist * 3), vel = new Float32Array(maxMist * 3), life = new Float32Array(maxMist), size = new Float32Array(maxMist), alpha = new Float32Array(maxMist);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: mistTexture() }, scale: { value: 600 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float scale;
      void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = aSize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(0.86,0.9,0.95), t.a * vA); }`,
  });
  const points = new THREE.Points(pgeo, pmat);
  points.frustumCulled = false;
  scene.add(points);
  let head = 0;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const wp = new THREE.Vector3(), wd = new THREE.Vector3(), q = new THREE.Quaternion();
  let spawnAcc = 0;

  function update(dt, time, throttles, carVel, groundY = 0) {
    hero.userData.thr = throttles;   // the car model reads the valve states (nozzle core / frost)
    hero.getWorldQuaternion(q);
    for (let i = 0; i < cones.length; i++) {
      const c = cones[i];
      const p = throttles[i];
      c.mesh.visible = p > 0.02;
      c.mat.uniforms.uPower.value = Math.min(1, p * 1.3);
      c.mat.uniforms.uTime.value = time;
      const L = 0.4 + p * 2.4;
      c.mesh.scale.set(0.6 + p * 0.7, L, 0.6 + p * 0.7);
    }
    // Spawn mist from active nozzles.
    spawnAcc += dt * 240;
    const n = Math.floor(spawnAcc); spawnAcc -= n;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < cones.length; i++) {
        const p = throttles[i];
        if (p < 0.05 || rnd() > p * 0.9) continue;
        const c = cones[i];
        c.mesh.getWorldPosition(wp);
        wd.copy(c.jet).applyQuaternion(q);
        const j = head; head = (head + 1) % maxMist;
        const sp = 7 + rnd() * 9;
        pos[j * 3] = wp.x + wd.x * 0.3; pos[j * 3 + 1] = wp.y + wd.y * 0.3; pos[j * 3 + 2] = wp.z + wd.z * 0.3;
        vel[j * 3] = carVel.x * 0.6 + wd.x * sp + (rnd() - 0.5) * 2;
        vel[j * 3 + 1] = carVel.y * 0.6 + wd.y * sp + (rnd() - 0.5) * 2;
        vel[j * 3 + 2] = carVel.z * 0.6 + wd.z * sp + (rnd() - 0.5) * 2;
        life[j] = 1;
        size[j] = 0.25;
      }
    }
    // Integrate.
    for (let j = 0; j < maxMist; j++) {
      if (life[j] <= 0) { alpha[j] = 0; continue; }
      life[j] -= dt * 0.55;
      const drag = Math.exp(-dt * 4.5);
      vel[j * 3] *= drag; vel[j * 3 + 1] = vel[j * 3 + 1] * drag + dt * 0.6; vel[j * 3 + 2] *= drag;
      pos[j * 3] += vel[j * 3] * dt; pos[j * 3 + 1] += vel[j * 3 + 1] * dt; pos[j * 3 + 2] += vel[j * 3 + 2] * dt;
      // Spread along the ground when the jet hits it.
      if (pos[j * 3 + 1] < groundY + 0.15) {
        pos[j * 3 + 1] = groundY + 0.15;
        const v = vel[j * 3 + 1];
        if (v < 0) { vel[j * 3] += (rnd() - 0.5) * -v * 1.6; vel[j * 3 + 2] += (rnd() - 0.5) * -v * 1.6; vel[j * 3 + 1] = 0; }
      }
      const age = 1 - life[j];
      size[j] = 0.35 + age * 4.2;
      // Fade in over the first moments (no hard-edged pop), then dissolve.
      alpha[j] = Math.min(1, age * 7) * Math.max(0, life[j]) ** 1.6 * 0.16;
    }
    pgeo.attributes.position.needsUpdate = true;
    pgeo.attributes.aSize.needsUpdate = true;
    pgeo.attributes.aAlpha.needsUpdate = true;
  }

  function clear() { life.fill(0); alpha.fill(0); }
  function setScale(h) { pmat.uniforms.scale.value = h * 0.6; }

  return { update, clear, setScale };
}
