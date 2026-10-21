// The film look on the high tier (desktop): a lazy chunk, loaded with the backdrop after the
// first frame (src/render/scene.js).
//
// - Atmosphere: one full-screen pass after the scene, before the bloom. From the depth buffer it
//   rebuilds each pixel's ray and adds exponential height fog (thick on the slab, thin above:
//   distance reads as depth, the ground plane's far edge melts) and the light each lamp scatters
//   into the air along that ray, in closed form (the integral of 1/d² along a segment), so every
//   searchlight, uplight and flood bank stands in its own halo of lit haze, cut off exactly where
//   the ray hits something. Plus a soft vignette.
// - Wet slab: a planar reflection of the night stage (half resolution, mipmapped, only what's on
//   the REFLECT layer: sky, Wall, LEDs, beams, the row, the car, the rocket) that the slab's
//   material (src/render/wall.js wetSlab) mixes in where it's wet, blurred by the mip chain.
//
// Nothing here changes a material's program after first load: the slab was compiled with the
// reflection lookup, sampling a black texel until this arrives.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const REFLECT = 1;
const MAX_GLOWS = 20;

const HAZE_FS = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCam;
uniform float uFogA;     // density at the ground (1/m)
uniform float uFogB;     // falloff with height (1/m)
uniform vec3 uFogCol;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uGlowPos[${MAX_GLOWS}];
uniform vec4 uGlowCol[${MAX_GLOWS}];   // rgb, halo radius (m)
uniform int uGlows;
uniform float uVignette;
uniform vec2 uAspect;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float z = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  vec3 wp = (uViewInv * vec4(v.xyz, 1.0)).xyz;
  vec3 d = wp - uCam;
  float L = length(d);
  d /= L;
  if (z >= 0.99999) L = 700.0;              // the sky: a long but finite path through the air
  // Exponential height fog, integrated along the ray.
  float k = uFogA * exp(-uFogB * uCam.y);
  float dy = d.y * uFogB;
  float tau = abs(dy) > 1e-4 ? k * (1.0 - exp(-dy * L)) / dy : k * L;
  float f = 1.0 - exp(-tau);
  float sun = pow(max(dot(d, uSunDir), 0.0), 6.0);
  vec3 col = mix(c.rgb, uFogCol + uSunCol * sun, f);
  // In-scattering from each lamp along the ray up to the surface (the integral of 1/d², closed
  // form: the air around a lamp glows, and that glow stops where geometry stands in front of it).
  vec3 s = vec3(0.0);
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    if (i >= uGlows) break;
    vec3 o = uCam - uGlowPos[i];
    float b = dot(d, o);
    float h = sqrt(max(dot(o, o) - b * b, 0.36));   // a soft core: a pinpoint glow crawled as the camera moved
    float I = (atan((L + b) / h) - atan(b / h)) / h;
    // The closed form is for a lamp in endless uniform haze, which lights the whole sky a little;
    // a halo falls off with the ray's miss distance so the air glows round the lamp, not everywhere.
    // And a camera standing inside a halo sees it as a veil over everything that swings with every
    // turn of the head: fade it out up close.
    float near = smoothstep(uGlowCol[i].w * 2.0, uGlowCol[i].w * 6.0, length(o));
    s += uGlowCol[i].rgb * I * exp(-h / uGlowCol[i].w) * exp(-uFogB * max(uGlowPos[i].y, 0.0)) * near;
  }
  col += s;
  vec2 q = (vUv - 0.5) * uAspect;
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, dot(q, q) * 1.6);
  gl_FragColor = vec4(col, c.a);
}`;

class HazePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
      uFogA: { value: 0 }, uFogB: { value: 0.2 }, uFogCol: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0, 0, 0) },
      uGlowPos: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
      uGlowCol: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4()) },
      uGlows: { value: 0 }, uVignette: { value: 0.3 }, uAspect: { value: new THREE.Vector2(1, 1) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: HAZE_FS,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms, cam = this.camera;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uViewInv.value.copy(cam.matrixWorld);
    u.uCam.value.setFromMatrixPosition(cam.matrixWorld);
    u.uAspect.value.set(readBuffer.width / Math.max(1, readBuffer.height), 1);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

// Per look: ground fog density and falloff, its colour, the sun's forward scatter, the glow scale.
const LOOKS = {
  night: { fogA: 0.0035, fogB: 0.16, fogCol: [0.011, 0.013, 0.021], sunCol: [0, 0, 0], sunDir: [0, 1, 0], glow: 1, vignette: 0.32 },
  lineup: { fogA: 0.0022, fogB: 0.05, fogCol: [0.11, 0.105, 0.115], sunCol: [0.32, 0.17, 0.08], sunDir: [-0.55, 0.06, 0.83], glow: 0.6, vignette: 0.22 },
};

// The planar reflection: the camera mirrored in y = 0, an oblique near plane on the slab so nothing
// below it draws, half resolution, mipmapped (the slab blurs by reading coarser levels).
function createMirror(renderer) {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(REFLECT);
  const matrix = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const camPos = new THREE.Vector3(), target = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const size = new THREE.Vector2();
  function render(scene, camera) {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x / 2)), h = Math.max(1, Math.round(size.y / 2));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < 0.05) return;
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    cam.position.set(camPos.x, -camPos.y, camPos.z);
    target.set(look.x, -look.y, look.z);
    cam.up.set(0, 1, 0).applyMatrix4(rot); cam.up.y = -cam.up.y;
    cam.lookAt(target);
    cam.far = camera.far; cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);   // with the title's view offset: the slab samples it the same way
    matrix.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // Oblique near plane = the slab (Lengyel), so the mirror world below it is clipped away.
    plane.applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = cam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + p[8]) / p[0];
    q.y = (Math.sign(clip.y) + p[9]) / p[5];
    q.z = -1.0;
    q.w = (1.0 + p[10]) / p[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1.0; p[14] = clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    plane.set(plane.normal.set(0, 1, 0), 0);
    const auto = renderer.shadowMap.autoUpdate, prev = renderer.getRenderTarget();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = auto;
  }
  return { rt, matrix, render };
}

// createFilm({ renderer, scene, camera, composer, tier }) → { setLook(id, glows), render(), dispose }
//   glows: [{ pos: Vector3 (world), color: Color (linear, scattered power), radius: halo (m) }]
export function createFilm({ renderer, scene, camera, composer, tier }) {
  const high = tier === 'high' && composer && composer.renderTarget1.depthTexture;
  const haze = high ? new HazePass(camera) : null;
  if (haze) composer.insertPass(haze, 1);
  const mirror = high ? createMirror(renderer) : null;
  let reflecting = false, slabs = [];

  function setLook(id, glows = [], wet = []) {
    if (haze) {
      const L = id === 'lineup' ? LOOKS.lineup : LOOKS.night, u = haze.uniforms;
      u.uFogA.value = L.fogA; u.uFogB.value = L.fogB; u.uFogCol.value.setRGB(...L.fogCol);
      u.uSunCol.value.setRGB(...L.sunCol); u.uSunDir.value.set(...L.sunDir).normalize();
      u.uVignette.value = L.vignette;
      const n = Math.min(MAX_GLOWS, glows.length);
      for (let i = 0; i < n; i++) { const g = glows[i], c = g.color; u.uGlowPos.value[i].copy(g.pos); u.uGlowCol.value[i].set(c.r * L.glow, c.g * L.glow, c.b * L.glow, g.radius ?? 3); }
      u.uGlows.value = n;
    }
    slabs = wet;
    reflecting = !!mirror && wet.length > 0;
    for (const s of slabs) {
      s.tReflect.value = reflecting ? mirror.rt.texture : s.tReflect.value;
      s.uReflK.value = reflecting ? 1 : 0;
    }
  }

  // Before the frame: the mirror view (when the stage has a wet slab).
  function render(active = true) {
    if (haze) haze.enabled = active;   // an outside look (Free Drive) brings its own air
    if (!reflecting) return;
    if (!active) { for (const s of slabs) s.uReflK.value = 0; return; }
    mirror.render(scene, camera);
    for (const s of slabs) { s.uReflMat.value.copy(mirror.matrix); s.uReflK.value = 1; }
  }

  return { setLook, render, haze, mirror };
}
