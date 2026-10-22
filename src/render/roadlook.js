// Free Drive's look: the time-of-day sky, the light, haze that tints toward the sun, and the
// materials the road world is drawn with (terrain coloured from height, slope, aspect and the
// OSM tree cover; asphalt with its paint drawn in the shader; water with a fresnel sky and a
// glitter path). One palette per landscape, two times of day. Keynote restraint: few colours,
// soft light, and the distance doing most of the work.
import * as THREE from 'three';

// Landscapes: terrain bands (elevation in metres) and colours.
export const BIOMES = {
  stelvio: {
    low: 0x527d33, mid: 0x6d7843, high: 0x6f7262, rock: 0x6d6964, forest: 0x2c4a30, tree: 0x456a40, snow: 0xeef2f6, shore: 0x8a8a7a,
    e0: 1750, e1: 2250, e2: 2600, snow0: 2950, treeline: 2050, lone: 0.012, water: 0x2f6c70, waterDeep: 0x153a44,
  },
  transfagarasan: {
    low: 0x4d7a30, mid: 0x6c7a3e, high: 0x7c776a, rock: 0x6a6660, forest: 0x263f28, tree: 0x3f623c, snow: 0xeef2f6, shore: 0x8a8a7a,
    e0: 1500, e1: 1950, e2: 2250, snow0: 2500, treeline: 1750, lone: 0.01, water: 0x2d6872, waterDeep: 0x14363f,
  },
  bigsur: {
    low: 0xb0914f, mid: 0x93874b, high: 0x7d7445, rock: 0x86705a, forest: 0x34452c, tree: 0x4c5e3a, snow: 0xeeeeee, shore: 0xcdbd98,
    e0: 80, e1: 300, e2: 600, snow0: 9000, treeline: 9000, lone: 0.018, water: 0x1d5566, waterDeep: 0x0c2a3a,
  },
  atlantic: {
    low: 0x5d7840, mid: 0x6f6a46, high: 0x7a7c78, rock: 0x777a7b, forest: 0x2c4130, tree: 0x3f5a3e, snow: 0xeef2f6, shore: 0x5f5a4b,
    e0: 20, e1: 120, e2: 400, snow0: 1200, treeline: 450, lone: 0, water: 0x22495a, waterDeep: 0x0f2733,
  },
};

// Times of day. Sun elevation and colours; the azimuth comes from the road (manifest `sun`).
export const TODS = {
  day: {
    label: 'Day', elev: null,
    zenith: 0x1f4f98, horizon: 0xb4cce0, haze: 0xa9bccd, sunGlow: 0xfff0d8, sun: 0xfff1de,
    sunI: 4.2, hemiSky: 0xb9cff0, hemiGround: 0x584c3a, hemiI: 0.7, exposure: 1.0, density: 7.5e-5,
    bloom: { strength: 0.1, radius: 0.4, threshold: 0.96 }, lamps: 0, stars: 0, clouds: 0.55, paintGlow: 0,
  },
  dusk: {
    label: 'Dusk', elev: 6.5,
    zenith: 0x16234d, horizon: 0xee9a5e, haze: 0x8d8698, sunGlow: 0xffa45a, sun: 0xffb27a,
    sunI: 2.4, hemiSky: 0x7282b4, hemiGround: 0x362e33, hemiI: 0.7, exposure: 1.1, density: 8.5e-5,
    bloom: { strength: 0.2, radius: 0.5, threshold: 0.9 }, lamps: 1, stars: 0.35, clouds: 0.8, paintGlow: 0.12,
  },
};

export const NOISE_GLSL = /* glsl */`
  float cgHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float cgNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(cgHash(i), cgHash(i + vec2(1, 0)), f.x), mix(cgHash(i + vec2(0, 1)), cgHash(i + vec2(1, 1)), f.x), f.y); }
  float cgFbm(vec2 p){ float a = 0.5, s = 0.; for (int k = 0; k < 4; k++) { s += a * cgNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Fog that leans toward the sun: in-scattering makes the haze warmer and brighter looking into
// the light, cooler away from it (applied to every road-world material).
const FOG_GLSL = /* glsl */`
  #ifdef USE_FOG
    float fogDepth2 = length(vCgWPos - cameraPosition);
    float fogF = 1.0 - exp(-fogDensity * fogDensity * fogDepth2 * fogDepth2);
    vec3 vd = normalize(vCgWPos - cameraPosition);
    float toSun = pow(max(dot(vd, cgSunDir), 0.0), 5.0);
    vec3 fc = mix(fogColor, cgSunGlow, toSun * 0.55);
    // Thinner haze looking up the mountain: fog falls off with height above the eye.
    float up = clamp((vCgWPos.y - cameraPosition.y) / 2500.0, 0.0, 1.0);
    fogF *= 1.0 - up * 0.45;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogF);
  #endif
`;

// Shared uniforms every road-world material reads (one object, updated once per frame).
export function createUniforms() {
  return {
    cgSunDir: { value: new THREE.Vector3(0, 1, 0) },
    cgSunGlow: { value: new THREE.Color() },
    cgTime: { value: 0 },
    cgPaintGlow: { value: 0 },
    cgTrees: { value: null },
    cgTreeBox: { value: new THREE.Vector4(0, 0, 1, 1) },     // x0, z0, 1/width, 1/depth
    cgBiomeA: { value: new THREE.Vector4() },               // e0, e1, e2, snow0
    cgLow: { value: new THREE.Color() }, cgMid: { value: new THREE.Color() }, cgHigh: { value: new THREE.Color() },
    cgRock: { value: new THREE.Color() }, cgForest: { value: new THREE.Color() }, cgSnow: { value: new THREE.Color() },
    cgShore: { value: new THREE.Color() },
    cgWater: { value: new THREE.Color() }, cgWaterDeep: { value: new THREE.Color() },
    cgZenith: { value: new THREE.Color() }, cgHorizon: { value: new THREE.Color() },
    cgCoast: { value: 0 },
  };
}

export function patch(mat, U, { vertex = '', vertexMain = '', fragment = '', color = '', post = '', rough = '', normal = '' }) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCgWPos;\nvarying vec3 vCgWN;\n${vertex}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\nvec4 cgP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ncgP = instanceMatrix * cgP;\n#endif\nvCgWPos = (modelMatrix * cgP).xyz;\nvCgWN = normalize(mat3(modelMatrix) * normal);\n${vertexMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCgWPos;\nvarying vec3 vCgWN;\nuniform vec3 cgSunDir; uniform vec3 cgSunGlow; uniform float cgTime;\n${NOISE_GLSL}\n${fragment}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );\n${color}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normal}`)
      .replace('#include <fog_fragment>', FOG_GLSL)
      .replace('#include <opaque_fragment>', `${post}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `cg-${mat.name}`;
  mat.fog = true;
  return mat;
}

export const WATER_GLSL = /* glsl */`
  uniform vec3 cgWater; uniform vec3 cgWaterDeep; uniform vec3 cgZenith; uniform vec3 cgHorizon;
  vec3 cgWaterShade(vec3 wpos, float depth) {
    vec3 v = normalize(cameraPosition - wpos);
    vec2 p = wpos.xz;
    float t = cgTime;
    float n1 = cgNoise(p * 0.11 + vec2(t * 0.05, t * 0.03)), n2 = cgNoise(p * 0.43 - vec2(t * 0.11, -t * 0.07));
    float n3 = cgNoise(p * 1.7 + vec2(t * 0.3, t * 0.2));
    vec3 n = normalize(vec3((n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.14 + (n3 - 0.5) * 0.06, 1.0, (n2 - 0.5) * 0.22 + (n1 - 0.5) * 0.12 + (n3 - 0.5) * 0.06));
    float fres = 0.02 + 0.98 * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 5.0);
    vec3 r = reflect(-v, n);
    vec3 sky = mix(cgHorizon, cgZenith, smoothstep(0.0, 0.5, r.y));
    vec3 body = mix(cgWater, cgWaterDeep, smoothstep(0.5, 18.0, -depth));
    vec3 c = mix(body, sky, fres * 0.9);
    float spec = pow(max(dot(r, cgSunDir), 0.0), 320.0);
    c += cgSunGlow * spec * 5.0 + cgSunGlow * pow(max(dot(r, cgSunDir), 0.0), 24.0) * 0.12;
    // Surf on the shore.
    float foam = smoothstep(-1.6, -0.05, depth) * smoothstep(0.35, 0.75, cgNoise(p * 0.9 + vec2(t * 0.4, 0.0)) * 0.6 + cgNoise(p * 3.1 - t * 0.6) * 0.5);
    c = mix(c, vec3(0.92, 0.95, 0.96) * (0.5 + 0.5 * max(cgSunDir.y, 0.15)), foam * 0.85);
    return c;
  }
`;

// Terrain: Lambert, coloured in the shader from the world position and normal (so every LOD
// shares one look), with an `aDepth` attribute (pre-clamp height) for the sea.
export function terrainMaterial(U, { name = 'terrain' } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.name = name;
  return patch(mat, U, {
    vertex: 'attribute float aDepth; varying float vCgDepth;',
    vertexMain: 'vCgDepth = aDepth;',
    fragment: `varying float vCgDepth;
      uniform sampler2D cgTrees; uniform vec4 cgTreeBox; uniform vec4 cgBiomeA;
      uniform vec3 cgLow; uniform vec3 cgMid; uniform vec3 cgHigh; uniform vec3 cgRock; uniform vec3 cgForest; uniform vec3 cgSnow; uniform vec3 cgShore;
      uniform float cgCoast;
      ${WATER_GLSL}`,
    color: `float cgBump = 0.0;
    {
      vec3 wp = vCgWPos; vec3 wn = normalize(vCgWN);
      float e = wp.y + (cgFbm(wp.xz * 0.004) - 0.5) * 160.0;
      float slope = 1.0 - wn.y;
      float macro = cgFbm(wp.xz * 0.0021), micro = cgNoise(wp.xz * 0.35), mid = cgNoise(wp.xz * 0.045), patchy = cgFbm(wp.xz * 0.013);
      vec3 c = mix(cgLow, cgMid, smoothstep(cgBiomeA.x - 150., cgBiomeA.y, e));
      c = mix(c, cgHigh, smoothstep(cgBiomeA.y, cgBiomeA.z, e) * (0.65 + 0.7 * patchy));
      // Meadow patches: lighter and darker grass, drier on the sunny side.
      c *= 0.8 + 0.42 * patchy;
      c = mix(c, c * vec3(1.12, 1.06, 0.82), smoothstep(0.55, 0.8, mid) * 0.5);
      c *= 0.9 + 0.2 * macro;
      // Tree cover (OSM woods/forests), patchy at its edges.
      vec2 tuv = (wp.xz - cgTreeBox.xy) * cgTreeBox.zw;
      float tr = (tuv.x > 0. && tuv.y > 0. && tuv.x < 1. && tuv.y < 1.) ? texture2D(cgTrees, tuv).r : 0.0;
      tr = smoothstep(0.25, 0.75, tr + (mid - 0.5) * 0.5) * (1.0 - smoothstep(0.45, 0.7, slope));
      c = mix(c, cgForest * (0.75 + 0.5 * mid), tr);
      // Rock where it's steep, in strata; scree fans lighter below it.
      float rk = smoothstep(0.3, 0.52, slope + (mid - 0.5) * 0.3 + (patchy - 0.5) * 0.15);
      float strata = 0.82 + 0.3 * cgNoise(vec2(wp.y * 0.55 + cgNoise(wp.xz * 0.02) * 6.0, 0.5)) + 0.12 * micro;
      vec3 rock = cgRock * strata * (0.85 + 0.35 * macro);
      float scree = smoothstep(0.18, 0.32, slope) * (1.0 - rk) * smoothstep(cgBiomeA.y - 200., cgBiomeA.z, e);
      c = mix(c, cgRock * 1.25 * (0.9 + 0.2 * micro), scree * 0.55);
      c = mix(c, rock, rk);
      cgBump = 0.25 + rk * 0.9 + scree * 0.4;
      // Snow on the high flats, lingering on the north faces.
      float north = clamp(-wn.z, 0.0, 1.0);
      float sn = smoothstep(cgBiomeA.w - 60., cgBiomeA.w + 120., e + north * 220.0) * (1.0 - smoothstep(0.35, 0.6, slope));
      c = mix(c, cgSnow, sn);
      // Sand and wet rock at the waterline.
      if (cgCoast > 0.5) c = mix(c, cgShore * (0.85 + 0.3 * micro), (1.0 - smoothstep(0.4, 2.5, vCgDepth)) * (1.0 - rk * 0.6));
      c *= 0.94 + 0.12 * micro;
      diffuseColor.rgb = c;
    }`,
    // Relief finer than the 4–16 m posts: a noise bump, stronger on rock.
    normal: `{
      vec2 p = vCgWPos.xz;
      float d = 0.6;
      float n0 = cgFbm(p * 0.09) + 0.35 * cgNoise(p * 0.6);
      float nx = cgFbm((p + vec2(d, 0.0)) * 0.09) + 0.35 * cgNoise((p + vec2(d, 0.0)) * 0.6);
      float nz = cgFbm((p + vec2(0.0, d)) * 0.09) + 0.35 * cgNoise((p + vec2(0.0, d)) * 0.6);
      vec3 g = vec3(n0 - nx, 0.0, n0 - nz) / d * 2.2 * cgBump;
      normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz);
    }`,
    post: `if (cgCoast > 0.5 && vCgDepth < 0.12) { outgoingLight = cgWaterShade(vCgWPos, vCgDepth); }`,
  });
}

// Open sea beyond the terrain (a ring), the same water.
export function seaMaterial(U) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.name = 'sea';
  return patch(mat, U, { fragment: WATER_GLSL, post: 'outgoingLight = cgWaterShade(vCgWPos, -30.0);' });
}

// Lakes: flat water at the lake's level.
export function lakeMaterial(U) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.name = 'lake';
  return patch(mat, U, { fragment: WATER_GLSL, post: 'outgoingLight = cgWaterShade(vCgWPos, -6.0);' });
}

// Asphalt and its paint. `aRoad` = (lateral offset m, distance along m, half-width m, bridge).
export function roadMaterial(U, marking = 'eu') {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  mat.name = `road-${marking}`;
  const centre = {
    // White dashed: 4.5 m dash, 7.5 m gap (Italian/Romanian rural standard), 12 cm wide.
    eu: 'float cl = step(au, 0.065) * step(fract(v / 12.0), 0.375); vec3 pc = vec3(0.92);',
    // Double yellow: two 10 cm lines 10 cm apart.
    us: 'float cl = step(abs(au - 0.15), 0.05); vec3 pc = vec3(0.93, 0.72, 0.18);',
    // Norway: yellow dashed centre (3 m dash, 9 m gap), 10 cm.
    no: 'float cl = step(au, 0.055) * step(fract(v / 12.0), 0.25); vec3 pc = vec3(0.95, 0.75, 0.2);',
  }[marking] || '';
  return patch(mat, U, {
    vertex: 'attribute vec4 aRoad; varying vec4 vRoad;',
    vertexMain: 'vRoad = aRoad;',
    fragment: 'varying vec4 vRoad; uniform float cgPaintGlow;',
    color: `float cgRough = 0.85;
    {
      float u = vRoad.x, v = vRoad.y, hw = vRoad.z, au = abs(u);
      vec2 wp = vCgWPos.xz;
      float g = cgNoise(wp * 2.3) * 0.5 + cgNoise(wp * 9.0) * 0.5;
      float patchy = cgFbm(wp * 0.06);
      vec3 asphalt = vec3(0.105, 0.108, 0.115) * (0.78 + 0.32 * patchy) * (0.88 + 0.24 * g);
      // Polished tyre tracks in each lane.
      float lane = hw * 0.5;
      float tl = (au - lane + 0.8) / 0.35, tr = (au - lane - 0.8) / 0.35;   // squared, not pow(): its base goes negative
      float track = exp(-tl * tl) + exp(-tr * tr);
      asphalt *= 1.0 - 0.18 * track;
      vec3 c = asphalt;
      ${centre}
      float edge = step(abs(au - (hw - 0.22)), 0.075);
      float paint = max(cl, edge);
      // Worn paint.
      paint *= 0.75 + 0.25 * step(0.3, cgNoise(vec2(u * 3.0, v * 0.8)));
      vec3 pcol = (cl > 0.5 ? pc : vec3(0.92));
      c = mix(c, pcol, paint);
      // Gravel shoulder past the edge.
      float sh = smoothstep(hw, hw + 0.08, au);
      vec3 gravel = vec3(0.25, 0.24, 0.22) * (0.7 + 0.5 * g);
      c = mix(c, gravel, sh * (1.0 - vRoad.w));
      diffuseColor.rgb = c;
      cgRough = mix(0.86, 0.55, paint) - track * 0.12;
    }`,
    rough: 'roughnessFactor = cgRough;',
    post: 'outgoingLight += cgPaintGlow * 0.6 * vec3(1.0, 0.97, 0.9) * step(0.5, diffuseColor.r);',
  });
}

// Stone walls, concrete parapets and tunnel walls (vertex colours carry which).
export function wallMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.name = 'wall';
  return patch(mat, U, {
    vertex: 'attribute vec3 aWall; varying vec3 vWall;',
    vertexMain: 'vWall = aWall;',
    fragment: 'varying vec3 vWall;',
    color: `{
      // Rubble stone: uneven courses ≈0.18 m, stones 0.2–0.45 m, joints darker and soft.
      float row = floor(vWall.y / 0.18);
      float len = 0.24 + 0.2 * cgHash(vec2(row, 7.0));
      float sx = vWall.x / len + row * 0.37 + cgHash(vec2(row, 3.0));
      float bx = fract(sx);
      float by = fract(vWall.y / 0.18);
      float mortar = (1.0 - smoothstep(0.0, 0.08, bx) * smoothstep(1.0, 0.92, bx) * smoothstep(0.0, 0.14, by) * smoothstep(1.0, 0.86, by)) * vWall.z;
      float tone = 0.78 + 0.38 * cgHash(vec2(floor(sx), row));
      diffuseColor.rgb = vColor.rgb * mix(1.0, tone, vWall.z) * (1.0 - mortar * 0.38) * (0.9 + 0.2 * cgNoise(vCgWPos.xz * 3.0 + vCgWPos.y));
    }`,
  });
}

// Galvanised steel (guard-rail beams and posts).
export function steelMaterial(U) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xaeb5bb, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide });
  mat.name = 'steel';
  return patch(mat, U, {});
}

// Small painted things (delineator posts, snow poles, tunnel lamps): vertex colour, plus an
// emissive channel in the alpha of the colour for reflectors at dusk.
export function propMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.name = 'prop';
  return patch(mat, U, { fragment: 'uniform float cgPaintGlow;', post: 'outgoingLight += vColor.rgb * step(0.99, vColor.r) * step(vColor.b, 0.35) * cgPaintGlow * 4.0;' });
}

// Trees: Lambert with instance colours; a touch of translucency toward the sun.
export function treeMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.name = 'tree';
  return patch(mat, U, {});
}

// Far trees (a coarser LOD, on tiles beyond the near ring): the same, but an instance within hideR
// metres of the camera collapses to nothing. Near the car the near tiles' trees stand there, and
// those are the trees the physics has (src/sim/scenery.js); a far tree drawn among them would be
// one you could drive through.
export function farTreeMaterial(U, hideR) {
  const mat = treeMaterial(U);
  mat.name = 'tree-far';
  const hide = { value: hideR }, base = mat.onBeforeCompile;
  mat.userData.hideR = hide;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.cgHideR = hide;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float cgHideR;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{ vec3 cgO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; if (distance(cgO.xz, cameraPosition.xz) < cgHideR) transformed = vec3(0.0); }
#endif`);
  };
  return mat;
}

// The sky: gradient, a sun disk with its glow, a haze band, thin clouds, and stars at dusk.
export function skyMaterial(U) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: Object.assign({ cgHaze: { value: new THREE.Color() }, cgSun: { value: new THREE.Color() }, cgStars: { value: 0 }, cgClouds: { value: 0.5 } }, U),
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 1.)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 cgZenith; uniform vec3 cgHorizon; uniform vec3 cgHaze; uniform vec3 cgSun; uniform vec3 cgSunGlow; uniform vec3 cgSunDir;
      uniform float cgStars; uniform float cgClouds; uniform float cgTime; varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float mu = max(dot(d, cgSunDir), 0.0);
        vec3 c = mix(cgHorizon, cgZenith, pow(smoothstep(-0.02, 0.75, h), 0.55));
        // The horizon glows toward the sun.
        float sunSide = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0)), normalize(vec3(cgSunDir.x, 0.0, cgSunDir.z))), 0.0), 2.0);
        c = mix(c, cgSunGlow, exp(-max(h, 0.0) * 9.0) * sunSide * 0.45);
        c += cgSunGlow * pow(mu, 12.0) * 0.35 + cgSunGlow * pow(mu, 120.0) * 0.6;
        c += cgSun * smoothstep(0.99955, 0.99975, mu) * 18.0;
        // Haze band.
        c = mix(c, cgHaze, exp(-abs(h) * 22.0) * 0.75);
        // Thin high cloud, lit from the sun side.
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.12) * 1.4 + vec2(cgTime * 0.004, 0.0);
          float cl = smoothstep(0.52, 0.85, cgFbm(p * vec2(1.0, 2.6))) * cgClouds * smoothstep(0.0, 0.18, h);
          vec3 cc = mix(cgHaze * 1.05, cgSunGlow * 1.2, pow(mu, 3.0) * 0.7 + 0.15);
          c = mix(c, cc, cl * 0.55);
        }
        // Stars at dusk, high up.
        vec3 sp = floor(d * 380.0);
        float st = step(0.9982, cgHash(sp.xy + sp.z * 7.1)) * smoothstep(0.25, 0.75, h) * cgStars;
        c += vec3(st);
        if (h < 0.0) c = mix(c, cgHaze * 0.92, smoothstep(0.0, -0.06, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// The skyline ring (from the DEM, beyond the terrain): haze-coloured, darker at its crest.
export function panoMaterial(U) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: false, depthWrite: false,
    uniforms: Object.assign({ cgHaze: { value: new THREE.Color() }, cgPanoTop: { value: 0 }, cgPanoBase: { value: 0 } }, U),
    vertexShader: 'varying float vY; varying vec3 vW; void main(){ vY = position.y; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 cgHaze; uniform vec3 cgSunGlow; uniform vec3 cgSunDir; uniform vec3 cgZenith; uniform float cgPanoTop; uniform float cgPanoBase; varying float vY; varying vec3 vW;
      void main(){
        float k = clamp((vY - cgPanoBase) / max(1.0, cgPanoTop - cgPanoBase), 0.0, 1.0);
        vec3 d = normalize(vW - cameraPosition);
        float toSun = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0)), normalize(vec3(cgSunDir.x, 0.0, cgSunDir.z))), 0.0), 4.0);
        vec3 c = mix(cgHaze, mix(cgHaze, cgZenith, 0.28), k);
        c = mix(c, cgSunGlow * 0.9 + cgHaze * 0.3, toSun * 0.3 * (1.0 - k));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Apply a biome and a time of day to the uniforms; returns the derived light setup.
export function applyLook(U, biomeId, todId, sun) {
  const B = BIOMES[biomeId] || BIOMES.stelvio, T = TODS[todId] || TODS.day;
  const el = (T.elev ?? sun.el) * Math.PI / 180, az = sun.az * Math.PI / 180;
  // Azimuth clockwise from north; north is −z, east is +x.
  U.cgSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  U.cgSunGlow.value.set(T.sunGlow);
  U.cgZenith.value.set(T.zenith); U.cgHorizon.value.set(T.horizon);
  U.cgPaintGlow.value = T.paintGlow;
  U.cgBiomeA.value.set(B.e0, B.e1, B.e2, B.snow0);
  for (const k of ['low', 'mid', 'high', 'rock', 'forest', 'snow', 'shore']) U[`cg${k[0].toUpperCase()}${k.slice(1)}`].value.set(B[k]);
  U.cgWater.value.set(B.water); U.cgWaterDeep.value.set(B.waterDeep);
  // Dusk dims and warms the land.
  if (todId === 'dusk') for (const k of ['cgLow', 'cgMid', 'cgHigh', 'cgRock', 'cgForest', 'cgShore']) U[k].value.multiplyScalar(0.92);
  return { B, T };
}
