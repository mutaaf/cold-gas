// Minimum on-screen width for slivers: LED ribbons, light bars, painted lines, lamp poles, truss
// members. Geometry thinner than a pixel or two is sampled on and off as the camera moves (there's
// no MSAA in the HDR composer target, see docs/LESSONS.md), and bloom spreads every pop over a
// wide halo: that was much of the stage's flicker.
//
// A sliver keeps each vertex's offset from its spine in an `aSpread` attribute (and which side of
// the spine it's on in `aSide`). The vertex shader measures the strip's width on screen and:
// - widens it to at least `minPx` pixels; for lights and paint (`dim`) the colour (or opacity) is
//   scaled down by the same factor, so the light a strip puts on screen stays the same as it
//   shrinks into the distance;
// - under AA_PX wide, pads it by up to a pixel, and for paint fades
//   the edges by pixel coverage (an analytic anti-aliased line), so a 1–3 px strip doesn't step
//   between n and n + 1 pixels along its length and bead up in the bloom.
// Wider than AA_PX on screen (close up) the material draws exactly as before.
import * as THREE from 'three';

// Half the drawing-buffer size in pixels; the stage sets it on resize.
export const sliverView = { value: new THREE.Vector2(640, 360) };
const AA_PX = 4.0;

const VERT_HEAD = `
attribute vec3 aSpread;
attribute float aSide;
uniform vec2 uHalfView;
uniform float uMinPx;
uniform float uMaxK;
uniform float uSize;
varying float vSliver;
varying float vEdge;
varying float vHalf;
varying float vPx;`;
const VERT_BODY = `
vec3 transformed = vec3( position );
{
  vec3 spine = position - aSpread;
  mat4 mv = modelViewMatrix;
  #ifdef USE_INSTANCING
    mv = mv * instanceMatrix;
  #endif
  float px;
  if ( uSize > 0.0 ) {
    // A small blob (a beacon): one factor for the whole object, from its size.
    px = uSize * projectionMatrix[ 1 ][ 1 ] * uHalfView.y / max( -( mv * vec4( 0.0, 0.0, 0.0, 1.0 ) ).z, 1e-3 );
  } else {
    // A strip: its on-screen width here, projecting the spine and spine + spread, in pixels.
    vec4 c0 = mv * vec4( spine, 1.0 );
    vec4 a = projectionMatrix * c0, b = projectionMatrix * ( c0 + mv * vec4( aSpread, 0.0 ) );
    px = 2.0 * length( ( b.xy / max( b.w, 1e-3 ) - a.xy / max( a.w, 1e-3 ) ) * uHalfView );
  }
  px = max( px, 1e-5 );
  vPx = px;
  float w = max( px, uMinPx );                       // the width it should look
  float k = clamp( w / px, 1.0, uMaxK );
  vSliver = 1.0 / k;                                 // light kept constant as it's widened
  vEdge = 0.0; vHalf = 1e4;                          // no edge fade
  #ifdef SLIVER_AA
    // Paint: drawn half a pixel wider each side, edges faded by pixel coverage.
    if ( uSize <= 0.0 && w < ${AA_PX.toFixed(1)} ) {
      float kd = clamp( ( w + 1.0 ) / px, 1.0, uMaxK );
      vHalf = 0.5 * px * k;
      vEdge = aSide * 0.5 * px * kd;
      k = kd;
    }
  #endif
  #ifdef SLIVER_PAD
    // Lights (opaque): up to a pixel wider under AA_PX (easing to none at AA_PX), so a 1–3 px
    // strip never steps between n and n + 1 pixels along its length. Not dimmed for the pad:
    // measured, keeping the strip at full brightness was the steadier of the two.
    if ( uSize <= 0.0 ) k = clamp( ( w + clamp( ${AA_PX.toFixed(1)} - w, 0.0, 1.0 ) ) / px, 1.0, uMaxK );
  #endif
  transformed = spine + aSpread * k;
}`;
const FRAG_HEAD = `
varying float vSliver;
varying float vEdge;
varying float vHalf;
varying float vPx;`;

// Patch a material in place. dim: 'color' (lights: stay opaque, padded), 'alpha' (transparent
// paint: coverage-faded edges) or false (solid structure: just widened). size (m): treat each mesh
// as a blob of that diameter (its spread is from the mesh origin) instead of a strip.
// (Alpha-blended lights were tried and measured worse: blended edges over the moving car and
// mist added jitter of their own.)
// rough (px, lit solids only): specular anti-aliasing (0051). Under this on-screen width the
// material's roughness eases up to 1 and its normal toward the viewer: a member a pixel or two
// across shows all its faces inside one pixel, so the honest shade there is their average
// (Toksvig), not whichever face the pixel centre happens to hit, which flipped between a bright
// face and a dark one as the camera moved (the Show's truss: show-wide wall 111 → 28‰, phone).
export function sliver(material, { minPx = 1.25, dim = 'color', maxK = 8, size = 0, rough = 0 } = {}) {
  const define = dim === 'alpha' ? '#define SLIVER_AA\n' : dim === 'color' ? '#define SLIVER_PAD\n' : '';
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uHalfView = sliverView;
    sh.uniforms.uMinPx = { value: minPx };
    sh.uniforms.uMaxK = { value: maxK };
    sh.uniforms.uSize = { value: size };
    sh.vertexShader = define + sh.vertexShader
      .replace('#include <common>', `#include <common>${VERT_HEAD}`)
      .replace('#include <begin_vertex>', VERT_BODY);
    if (dim || rough) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>${FRAG_HEAD}`);
    if (dim) {
      const cov = 'clamp( vHalf + 0.5 - abs( vEdge ), 0.0, 1.0 )';
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>\n${dim === 'alpha'
          ? `diffuseColor.a *= vSliver * ${cov};`
          : 'diffuseColor.rgb *= vSliver;'}`);
    }
    if (rough) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = mix( 1.0, roughnessFactor, smoothstep( 1.0, ${rough.toFixed(1)}, vPx ) );`)
        .replace('#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\n{ vec3 sV = normalize( vViewPosition ); normal = normalize( mix( sV, normal, smoothstep( 1.0, ${rough.toFixed(1)}, vPx ) ) + sV * 1e-4 ); }`);
    }
  };
  material.customProgramCacheKey = () => `sliver:${minPx}:${dim}:${maxK}:${size}:${rough}`;
  return material;
}

// fn(position, spreadOut) → side (+1 / -1) of the spine this vertex is on.
function setSpread(geo, fn) {
  const p = geo.attributes.position, out = new Float32Array(p.count * 3), side = new Float32Array(p.count);
  const v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    side[i] = fn(v, s.set(0, 0, 0)) || 0;
    out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z;
  }
  geo.setAttribute('aSpread', new THREE.BufferAttribute(out, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  return geo;
}

// Spread from the bounding-box centre along the masked axes, e.g. [0, 1, 0] for a flat light
// bar, [1, 0, 1] for a vertical pole or a unit-box truss member.
export function spreadAxes(geo, mask) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  return setSpread(geo, (v, s) => {
    s.set((v.x - c.x) * mask[0], (v.y - c.y) * mask[1], (v.z - c.z) * mask[2]);
    return Math.sign(s.x + s.y + s.z);   // meaningful for a single axis
  });
}

// Spread along the geometry's thinnest axis (a painted line, a lens, a light bar).
export function spreadThin(geo) {
  geo.computeBoundingBox();
  const d = geo.boundingBox.getSize(new THREE.Vector3());
  // A flat plane has a zero-size axis: that one doesn't count.
  const dims = [d.x, d.y, d.z].map((v) => (v < 1e-6 ? Infinity : v));
  const thin = dims.indexOf(Math.min(...dims));
  return spreadAxes(geo, [0, 1, 2].map((i) => (i === thin ? 1 : 0)));
}

// A ring in its own xy plane (RingGeometry): spread radially from the mid radius.
export function spreadRing(geo, r) {
  return setSpread(geo, (v, s) => {
    const l = Math.hypot(v.x, v.y) || 1;
    s.set((v.x / l) * (l - r), (v.y / l) * (l - r), 0);
    return Math.sign(l - r);
  });
}

// For geometry built by hand (src/render/wall.js ribbons): attach spread and side arrays.
export function setSliverAttributes(geo, spread, side) {
  geo.setAttribute('aSpread', new THREE.Float32BufferAttribute(spread, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  return geo;
}

// Paint and glow lying on the ground. Millimetre lifts alone run out of depth precision at range,
// and a base layer's own slope-scaled offset can beat them at grazing angles, so every decal
// layer pulls itself forward harder than the surface under it (the slab pushes back: +2/+2, the
// approach strip −1/−1) and draws after it (renderOrder).
export const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };

// Draw order for the transparent things that lie on surfaces: before every free-floating effect
// (mist, plumes, beams, crash smoke: renderOrder ≥ 0), so the camera or car moving never flips
// their order against those (that popped), and in a fixed order among themselves.
export const LAYER = { pad: -4, paint: -3, glow: -2, light: -1 };
