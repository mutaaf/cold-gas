// The Sandbox's look: a sealed-concrete apron at blue hour, a hairline survey grid (1 m faint, 10 m
// firmer, the 400 m arena edge in signal red), a gradient sky and haze. Same voice as the stage:
// matte concrete, hairlines, one signal colour. Returns a `look` for stage.setLook().
import * as THREE from 'three';
import { ARENA, MASTS } from './arena.js';

export function createArenaWorld({ renderer, tier = 'high' }) {
  const group = new THREE.Group();
  group.name = 'sandbox';

  // Sky: zenith to horizon, a warm band low in the west, a little glow where the key light sits.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cZen: { value: new THREE.Color(0x0a1326) }, cHor: { value: new THREE.Color(0x40566f) }, cWarm: { value: new THREE.Color(0xc98a5e) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 cZen, cHor, cWarm;
      void main(){ float h = clamp(vDir.y, -0.1, 1.0);
        vec3 c = mix(cHor, cZen, pow(clamp(h, 0.0, 1.0), 0.55));
        float west = pow(max(0.0, dot(normalize(vDir.xz + 1e-4), normalize(vec2(-0.8, 0.6)))), 6.0);
        c = mix(c, cWarm, west * exp(-max(h, 0.0) * 9.0) * 0.75);
        if (h < 0.0) c = mix(cHor, vec3(0.05, 0.07, 0.1), clamp(-h * 8.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -1000;
  group.add(sky);

  // The apron: lit, shadowed concrete with the grid drawn in its shader (antialiased by fwidth).
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a515b, roughness: 0.94, metalness: 0 });
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.uHalf = { value: ARENA.half };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform float uHalf;\nfloat gridLine(vec2 p, float step, float w){ vec2 g = abs(fract(p / step - 0.5) - 0.5) * step; vec2 f = fwidth(p); vec2 l = 1.0 - smoothstep(vec2(0.0), f * w, g); return max(l.x, l.y); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vWp.xz;
        float d = length(p - cameraPosition.xz);
        float n = fract(sin(dot(floor(p * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= 0.94 + 0.06 * n;
        float fine = gridLine(p, 1.0, 1.0) * (1.0 - smoothstep(14.0, 50.0, d)) * 0.06;
        float coarse = gridLine(p, 10.0, 1.2) * (1.0 - smoothstep(90.0, 360.0, d)) * 0.14;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), fine + coarse);
        vec2 e = abs(p) - vec2(uHalf);
        float edge = 1.0 - smoothstep(0.0, max(fwidth(p.x), fwidth(p.y)) * 2.0 + 0.06, abs(max(e.x, e.y)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.15, 0.18), edge * 0.9);
        float outside = step(0.0, max(e.x, e.y));
        diffuseColor.rgb *= 1.0 - 0.18 * outside;`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = tier !== 'low';
  group.add(ground);

  // A few tall marker masts at the corners, so distance reads.
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b42 });
  for (const mast of MASTS) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, mast.h, 8), mastMat);
    m.position.set(mast.x, mast.h / 2, mast.z); m.castShadow = tier !== 'low';
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), lampMat);
    l.position.set(mast.x, mast.h + 0.4, mast.z);
    group.add(m, l);
  }

  const hemi = new THREE.HemisphereLight(0x9fb4d6, 0x2a2724, 0.55);
  group.add(hemi);
  const fog = new THREE.Fog(0x3a4c62, 240, 1500);
  // Reflections from this sky over this concrete (clearcoat should show the horizon, not a room).
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material);
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x23272c }));
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = -1.5;
  envScene.add(envSky, envGround);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0.03).texture;
  pm.dispose(); envSky.geometry.dispose(); envGround.geometry.dispose(); envGround.material.dispose();
  const look = {
    group, fog, env, envIntensity: 0.85, exposure: 1.0,
    bloom: { strength: 0.14, radius: 0.45, threshold: 0.95 },
    keyLight: { color: 0xffdcbc, intensity: 2.6, offset: new THREE.Vector3(-34, 42, 26) },
    lamps: 0, update: () => {},
  };
  return {
    look, group,
    dispose() {
      group.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
      env.dispose();
    },
  };
}
