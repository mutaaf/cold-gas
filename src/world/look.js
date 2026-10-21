// The endless world's own materials, in the road world's light (src/render/roadlook.js: the same
// sun, haze and fog toward the sun). The terrain is coloured per vertex by the tile builder (biome
// mix, height, slope, forest), and the shader adds what a 4 m mesh can't hold: patchy grass and
// soil, rock relief, and the sea where the ground is under it.
import * as THREE from 'three';
import { patch, WATER_GLSL } from '../render/roadlook.js';

export function endlessTerrainMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.name = 'endless-terrain';
  return patch(mat, U, {
    vertex: 'attribute vec4 aCol; attribute float aDepth; varying vec4 vCol; varying float vDepth;',
    vertexMain: 'vCol = aCol; vDepth = aDepth * 31.75;',
    fragment: `varying vec4 vCol; varying float vDepth; ${WATER_GLSL}`,
    color: `float cgBump = 0.0;
    {
      vec3 c = pow(vCol.rgb, vec3(2.2));
      vec2 wp = vCgWPos.xz;
      float micro = cgNoise(wp * 0.37), mid = cgNoise(wp * 0.047), macro = cgFbm(wp * 0.0019), patchy = cgFbm(wp * 0.013);
      float road = vCol.a;
      // Patches of lighter and darker ground, drier on the open flats, all of it fading out near
      // the road (where the verges' own shading takes over).
      float k = 1.0 - road * 0.7;
      c *= mix(1.0, (0.84 + 0.3 * patchy) * (0.9 + 0.2 * macro) * (0.93 + 0.14 * micro), k);
      c = mix(c, c * vec3(1.1, 1.05, 0.84), smoothstep(0.6, 0.85, mid) * 0.35 * k);
      diffuseColor.rgb = c;
      float slope = 1.0 - normalize(vCgWN).y;
      cgBump = (0.22 + smoothstep(0.28, 0.55, slope) * 0.95) * (1.0 - road);
    }`,
    normal: `{
      vec2 p = vCgWPos.xz;
      float d = 0.6;
      float n0 = cgFbm(p * 0.09) + 0.35 * cgNoise(p * 0.6);
      float nx = cgFbm((p + vec2(d, 0.0)) * 0.09) + 0.35 * cgNoise((p + vec2(d, 0.0)) * 0.6);
      float nz = cgFbm((p + vec2(0.0, d)) * 0.09) + 0.35 * cgNoise((p + vec2(0.0, d)) * 0.6);
      vec3 g = vec3(n0 - nx, 0.0, n0 - nz) / d * 2.2 * cgBump;
      normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz);
    }`,
    post: 'if (vDepth < -0.02) { outgoingLight = cgWaterShade(vCgWPos, vDepth); }',
  });
}

// Boulders and scree: vertex-coloured, lit like the land.
export function rockMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.name = 'endless-rock';
  return patch(mat, U, {});
}

// Shared prop geometries for the endless world's vegetation.
let shrubGeo = null, rockGeo = null;
export function SHRUB_GEO() {
  if (!shrubGeo) {
    const g = new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.62, 1).translate(0, 0.28, 0);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { const v = 0.55 + 0.6 * (p.getY(k) / 0.6); c[k * 3] = v; c[k * 3 + 1] = v; c[k * 3 + 2] = v; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    shrubGeo = g;
  }
  return shrubGeo;
}
export function ROCK_GEO() {
  if (!rockGeo) {
    // A faceted boulder: an icosahedron pushed about by a fixed pattern, flat side down.
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const f = 1 + 0.22 * Math.sin(x * 9.1 + z * 3.7) * Math.cos(y * 7.3 - x * 2.1);
      p.setXYZ(k, x * f, Math.max(-0.12, y * f * 0.8), z * f);
      const v = 0.7 + 0.35 * (y + 0.5);
      c[k * 3] = v; c[k * 3 + 1] = v; c[k * 3 + 2] = v;
    }
    g.translate(0, 0.12, 0);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    rockGeo = g;
  }
  return rockGeo;
}
