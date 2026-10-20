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
// - for lights and paint under AA_PX wide, pads it by a pixel and fades the edges by pixel
//   coverage (an analytic anti-aliased line), so a 1–2 px strip doesn't step between one and two
//   pixels along its length and bead up in the bloom.
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
varying float vHalf;`;
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
  float w = max( px, uMinPx );                       // the width it should look
  float k = clamp( w / px, 1.0, uMaxK );
  vSliver = px / ( px * k );                         // light kept constant as it's widened
  vEdge = 0.0; vHalf = 1e4;                          // no edge fade
  #ifdef SLIVER_AA
    if ( uSize <= 0.0 && w < ${AA_PX.toFixed(1)} ) {
      float kd = clamp( ( w + 1.0 ) / px, 1.0, uMaxK ); // drawn half a pixel wider each side
      vHalf = 0.5 * px * k;
      vEdge = aSide * 0.5 * px * kd;
      k = kd;
    }
  #endif
  transformed = spine + aSpread * k;
}`;
const FRAG_HEAD = `
varying float vSliver;
varying float vEdge;
varying float vHalf;`;

// Patch a material in place. dim: 'color' (lights), 'alpha' (transparent paint) or false (solid
// structure: just widened, no fade). size (m): treat each mesh as a blob of that diameter (its
// spread is from the mesh origin) instead of a strip. Lights become alpha-blended so their edges
// can fade; where fully covered they draw exactly as an opaque material would.
export function sliver(material, { minPx = 1.25, dim = 'color', maxK = 8, size = 0 } = {}) {
  const aa = !!dim && size <= 0;
  if (aa) material.transparent = true;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uHalfView = sliverView;
    sh.uniforms.uMinPx = { value: minPx };
    sh.uniforms.uMaxK = { value: maxK };
    sh.uniforms.uSize = { value: size };
    sh.vertexShader = (aa ? '#define SLIVER_AA\n' : '') + sh.vertexShader
      .replace('#include <common>', `#include <common>${VERT_HEAD}`)
      .replace('#include <begin_vertex>', VERT_BODY);
    if (dim) {
      const cov = 'clamp( vHalf + 0.5 - abs( vEdge ), 0.0, 1.0 )';
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>${FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${dim === 'alpha'
          ? `diffuseColor.a *= vSliver * ${cov};`
          : `diffuseColor.rgb *= vSliver; diffuseColor.a *= ${cov};`}`);
    }
  };
  material.customProgramCacheKey = () => `sliver:${minPx}:${dim}:${maxK}:${size}`;
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
