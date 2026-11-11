// Runs in the browser (scripts/native-stage.mjs loads it through Vite): builds a course's stage, the roadster and the
// parked row with the web's own builders, then flattens them for the native renderer (docs/NATIVE.md §4, 0153):
//   static    every static mesh baked into world space, merged by material
//   parked    each parked vehicle in its own frame (nose +z, centred on its box); the app poses it from the sim:
//             translate(c) · rotate(q_body) · rotateY(π/2), as scene.js lineup() setBodies does
//   lights    spot, point and directional lights with their world positions and targets
//   look      exposure, bloom, fog, the key light (the course's `look`)
//   carParts  what roadster.js moves or lights on its own (the wing, the vanes, the skirts, the fans, the lamps, the
//             nozzle states) and what crash.js throws off it, each in its own frame, with the poses it hangs from;
//             the body keeps only the merged skin Dents.swift pushes in (crash.js's `skins`)
//   sweep     the searchlights' pivots (wall.js update swings them) and the one drum, lens and beam they share
//   textures  every texture a material uses, as a PNG data URL (canvas textures are drawn by the real canvas here)
//   env       the course's PMREM environment (scene.environment on the web) read back through three's own lookup, as a
//             cube of half floats: mip i is roughness i / (mips - 1)
//   complex   the launch complex (rocket.js): its one flood-lit shader evaluated per vertex and baked into vertex colours
//   wetMask   wall.js wetSlab's puddles as one tile, so the slab reads a texel instead of three noises
import * as THREE from 'three';
import { COURSE_BUILDERS, blobMaterial, bakeEnvironment, PALETTE } from '../src/render/scene.js';
import { bakeNightEnvironment } from '../src/render/wall.js';
import { buildRocket } from '../src/render/rocket.js';
import { LOOKS as FILM_LOOKS } from '../src/render/film.js';
import { VEHICLE, MOUNT_TOP } from '../src/sim/complex.js';
import { makeRoadster, ROADSTER_MATERIALS as RM } from '../src/render/roadster.js';
import { LINEUP_SPEC } from '../src/sim/courses.js';

const b64 = (typed) => {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
function textureOf(tex, textures) {
  if (!tex) return null;
  if (!textures.has(tex.uuid)) {
    const img = tex.image;
    let url = null;
    if (img && img.toDataURL) url = img.toDataURL('image/png');
    else if (img && img.width && img.data) {   // a DataTexture
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'), d = x.createImageData(img.width, img.height);
      const src = img.data, n = img.width * img.height, ch = src.length / n;
      for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) d.data[i * 4 + k] = src[i * ch + Math.min(k, ch - 1)]; d.data[i * 4 + 3] = ch === 4 ? src[i * 4 + 3] : 255; }
      x.putImageData(d, 0, 0); url = c.toDataURL('image/png');
    }
    textures.set(tex.uuid, { id: `t${textures.size}`, url, repeat: [tex.repeat.x, tex.repeat.y], offset: [tex.offset.x, tex.offset.y],
      wrap: tex.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp', srgb: tex.colorSpace === THREE.SRGBColorSpace });
  }
  return textures.get(tex.uuid).id;
}
// The web's few ShaderMaterials, by their uniforms (src/render/wall.js): the native shader recomputes each one's falloff.
function effectOf(m) {
  if (m.type !== 'ShaderMaterial' || !m.uniforms) return null;
  const u = m.uniforms, col = (c) => (c && c.value && c.value.isColor ? c.value.toArray() : null);
  if (u.uColor && u.uPower) return { kind: 'beam', color: col(u.uColor), power: u.uPower.value };
  if (u.uC && u.uP) return { kind: 'glow', color: col(u.uC), power: u.uP.value };
  if (u.uC) return { kind: 'spill', color: col(u.uC), power: 0.12 };
  return { kind: 'skip' };   // (the sky dome: the native renderer draws its own)
}
// The roadster's shut lines (src/render/sliver.js sliverTube, 0187) are faded by coverage in the web's vertex shader, which has no
// port here: the app keeps drawing them as the opaque dark lines they were (in the mirror and the shadow pass too).
const isTube = (m) => String(m.customProgramCacheKey?.() ?? '').startsWith('sliverTube');
function materialOf(m, textures) {
  const tube = isTube(m);
  return {
    effect: effectOf(m), alphaMap: textureOf(m.alphaMap, textures),
    name: m.name || m.type, kind: m.type, color: m.color ? m.color.toArray() : [1, 1, 1],   // linear (three keeps colours linear)
    emissive: m.emissive ? m.emissive.toArray() : [0, 0, 0], emissiveIntensity: m.emissiveIntensity ?? 1,
    unlit: m.type === 'MeshBasicMaterial' || m.type === 'ShaderMaterial',
    metalness: m.metalness ?? 0, roughness: m.roughness ?? 1, clearcoat: m.clearcoat ?? 0, clearcoatRoughness: m.clearcoatRoughness ?? 0,
    opacity: m.opacity ?? 1, transparent: !!m.transparent && !tube, depthWrite: tube || m.depthWrite !== false, doubleSided: m.side === THREE.DoubleSide,
    additive: m.blending === THREE.AdditiveBlending, polygonOffset: m.polygonOffset ? [m.polygonOffsetFactor, m.polygonOffsetUnits] : null,
    vertexColors: !!m.vertexColors, fog: m.fog !== false,
    wet: !!(m.customProgramCacheKey && String(m.customProgramCacheKey()).startsWith('wetSlab')),
    map: textureOf(m.map, textures), roughnessMap: textureOf(m.roughnessMap, textures), bumpMap: textureOf(m.bumpMap, textures),
    bumpScale: m.bumpScale ?? 1, emissiveMap: textureOf(m.emissiveMap, textures),
  };
}
const under = (o, pred) => { for (let p = o; p; p = p.parent) if (pred(p)) return true; return false; };
// Bake an object's meshes (world matrices from `root`) into per-material groups; `frame`: in that object's own frame.
function bake(root, textures, skip = () => false, frame = null) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const frameInv = frame ? new THREE.Matrix4().copy(frame.matrixWorld).invert() : new THREE.Matrix4();
  root.traverse((o) => {
    if (skip(o) || !(o.isMesh || o.isInstancedMesh) || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry, P = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const N = g.attributes.normal, UV = g.attributes.uv, COL = g.attributes.color;
    // The row's red outline (scene.js buildShow): a sliver held at 1.5 px by the web's vertex shader, which has no port here, and from the
    // lens's usual 30 m its 7 cm is half a pixel at the phone's floor scale. Its one strip that's always seen from far: drawn twice as wide.
    const outline = o.geometry.attributes.aSpread && o.material?.isMeshBasicMaterial && o.material.color.r === 4.5 ? o.geometry.attributes.aSpread : null;
    for (let inst = 0; inst < (o.isInstancedMesh ? o.count : 1); inst++) {
      m4.multiplyMatrices(frameInv, o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(inst, mi); m4.multiply(mi); }
      n3.getNormalMatrix(m4);
      const flip = m4.determinant() < 0;
      // A geometry's groups count only with an array of materials, as in three (a box has six; one material draws them all).
      const ranges = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : P.count, materialIndex: 0 }];
      for (const r of ranges) {
        const mat = mats[r.materialIndex ?? 0];
        if (!mat || mat.visible === false) continue;
        const order = isTube(mat) ? 0 : o.renderOrder || 0;
        const key = mat.uuid + (order ? '@' + order : '');
        if (!groups.has(key)) groups.set(key, { mat, order, top: -Infinity, pos: [], nrm: [], uv: [], col: [], idx: [] });
        const gr = groups.get(key), base = gr.pos.length / 3, remap = new Map();
        const at = (k) => (g.index ? g.index.getX(k) : k);
        for (let k = r.start; k < r.start + r.count; k += 3) {
          const tri = [at(k), at(k + 1), at(k + 2)];
          if (flip) [tri[1], tri[2]] = [tri[2], tri[1]];
          for (const i of tri) {
            if (!remap.has(i)) {
              remap.set(i, base + remap.size);
              v.fromBufferAttribute(P, i);
              if (outline) { v.x += outline.getX(i); v.y += outline.getY(i); v.z += outline.getZ(i); }
              v.applyMatrix4(m4); n.fromBufferAttribute(N, i).applyMatrix3(n3).normalize();
              gr.pos.push(v.x, v.y, v.z); gr.nrm.push(n.x, n.y, n.z);
              if (v.y > gr.top) gr.top = v.y;
              gr.uv.push(UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0);
              if (COL) { c.fromBufferAttribute(COL, i); gr.col.push(c.r, c.g, c.b); } else gr.col.push(1, 1, 1);
            }
            gr.idx.push(remap.get(i));
          }
        }
      }
    }
  });
  // One buffer: per vertex position(3) normal(3) uv(2) colour(3) = 44 bytes; indices per submesh, 0-based in it.
  const list = [...groups.values()].sort((a, b) => a.order - b.order || (a.mat.name + a.mat.uuid).localeCompare(b.mat.name + b.mat.uuid));
  const vb = [], ib = [], subs = [];
  let verts = 0;
  for (const gr of list) {
    const nv = gr.pos.length / 3;
    for (let i = 0; i < nv; i++) vb.push(gr.pos[3 * i], gr.pos[3 * i + 1], gr.pos[3 * i + 2], gr.nrm[3 * i], gr.nrm[3 * i + 1], gr.nrm[3 * i + 2], gr.uv[2 * i], gr.uv[2 * i + 1], gr.col[3 * i], gr.col[3 * i + 1], gr.col[3 * i + 2]);
    subs.push({ material: materialOf(gr.mat, textures), renderOrder: gr.order, top: gr.top, vertexStart: verts, vertexCount: nv, indexStart: ib.length, indexCount: gr.idx.length });
    for (const i of gr.idx) ib.push(i);
    verts += nv;
  }
  return { vertexStride: 44, vertexCount: verts, submeshes: subs, vertices: b64(new Float32Array(vb)), indices: b64(new Uint32Array(ib)) };
}

// A part's bounds in its own frame (crash.js `centred`: the clone at rest, its children keeping their local poses).
function bounds(src) {
  const c = src.clone();
  c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
  c.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c);
  return { center: box.getCenter(new THREE.Vector3()).toArray(), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5).toArray() };
}
// The roadster's moving and lit parts, each in its own frame (their poses are roadster.js applyWing, applySkirts,
// applyLights, fanSpin, which the app recomputes); the body bakes what's left. Addressed by reaching into the model as
// roadster.js builds it, so a change there fails here rather than exporting a wrong car.
function carParts(car, textures) {
  const P = car.parts, body = car.body;
  const named = (mat) => body.children.find((c) => c.isMesh && c.material === mat && c !== P.barge);
  const covers = body.children.find((c) => c.isMesh && c.material === RM.paint && c.geometry.attributes.position.count === 6);
  const holders = body.children.filter((c) => c.isGroup && c.children[0]?.material === RM.fan);
  const [pivot, wingLower] = P.wing.children;
  const [blade, edge, wingPlates, wingStruts] = pivot.children;
  const [drl, heads, tailBar, tailDim, brake] = [RM.drl, RM.head, RM.tail, RM.tailDim, RM.brake].map(named);
  const inst = body.children.filter((c) => c.isInstancedMesh);
  const core = inst.find((c) => c.material === RM.jetCore), frost = inst.find((c) => c.material === RM.frost);
  if (![blade, edge, wingPlates, wingStruts, wingLower, drl, heads, covers, tailBar, tailDim, brake, core, frost].every(Boolean) || holders.length !== 4) throw new Error('roadster.js changed: carParts() needs its parts');
  // crash.js's boxes (createCrash): at the car's rest pose, before anything moves.
  const pieces = { wing: bounds(P.wing), vanes: bounds(P.vanes) };
  car.update(0); car.update(5);   // awake: the lamps at their levels (the app sets them per frame, from applyLights)
  for (const o of [pivot, blade, edge, wingPlates, wingStruts, wingLower, P.sideSkirts, P.endSkirts, P.vanes, P.barge, P.wing, drl, heads, covers, tailBar, tailDim, brake]) o.visible = true;
  const own = (o, skip) => bake(o, textures, skip, o);
  const box = (x, y, z, mat) => bake(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat), textures);
  const inner = (mesh) => bake(new THREE.Mesh(mesh.geometry, mesh.material), textures);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6), blobMaterial(0.7));   // scene.js heroBlob
  plane.rotation.x = -Math.PI / 2;
  const meshes = {
    wingBlade: bake(pivot, textures, (o) => o === wingPlates || o === wingStruts, pivot),
    wingPlates: own(wingPlates), wingStruts: own(wingStruts), wingLower: own(wingLower),
    vanes: own(P.vanes), barge: own(P.barge), sideSkirts: own(P.sideSkirts), endSkirts: own(P.endSkirts),
    drl: own(drl), heads: own(heads), covers: own(covers), tailBar: own(tailBar), tailDim: own(tailDim), brake: own(brake),
    rotor: bake(holders[0].children[0], textures, () => false, holders[0].children[0]),
    jetCore: inner(core), frost: inner(frost), blob: bake(plane, textures),
    // crash.js's torn skirts and barge boards: plain boxes (their parts on the car are merged pairs).
    pieceSkirtSide: box(0.014, 0.12, 1.9, RM.rubber), pieceSkirtEnd: box(1.6, 0.12, 0.014, RM.rubber), pieceBarge: box(0.012, 0.16, 0.26, RM.carbon),
  };
  const moved = new Set([P.wing, P.vanes, P.barge, P.sideSkirts, P.endSkirts, drl, heads, covers, tailBar, tailDim, brake, core, frost, ...holders]);
  const m = new THREE.Matrix4();
  const frames = (im) => Array.from({ length: im.count }, (_, i) => { im.getMatrixAt(i, m); return Array.from(m.elements); });
  return {
    moved,
    out: {
      meshes, pieces,
      wing: { position: P.wing.position.toArray(), rotationX: P.wing.rotation.x },
      vanes: { position: P.vanes.position.toArray() }, brake: { position: brake.position.toArray() },
      drl: { position: drl.position.toArray() },
      fans: holders.map((h) => ({ position: h.position.toArray(), rotationX: h.rotation.x })),
      nozzleCore: frames(core), nozzleFrost: frames(frost),
    },
  };
}
// The searchlights (wall.js searchlights: their numbers on each pivot's userData.sweep): one shared drum, lens and beam.
function sweepRig(pivots, textures) {
  if (!pivots.length) return null;
  const [beam, head, lens] = pivots[0].children;
  return { pivots: pivots.map((p) => ({ position: p.position.toArray(), ...p.userData.sweep })),
    beam: bake(pivots[0], textures, (o) => o === head || o === lens, pivots[0]),
    head: bake(pivots[0], textures, (o) => o === beam || o === lens, pivots[0]),
    lens: bake(pivots[0], textures, (o) => o === beam || o === head, pivots[0]) };
}

// --- The environment -----------------------------------------------------------------------------------------------
// scene.environment on the web. PMREM's atlas is read back through three's own textureCubeUV, one cube face at a time, so the
// app samples exactly what MeshStandardMaterial does. The face layout is Metal's (and GL's): row 0 is t = 0.
const ENV_SIZES = [128, 64, 32, 16, 8, 4];
const FACE_DIR = [
  'vec3(1.0, -(2.0*t-1.0), -(2.0*s-1.0))', 'vec3(-1.0, -(2.0*t-1.0), 2.0*s-1.0)',
  'vec3(2.0*s-1.0, 1.0, 2.0*t-1.0)', 'vec3(2.0*s-1.0, -1.0, -(2.0*t-1.0))',
  'vec3(2.0*s-1.0, -(2.0*t-1.0), 1.0)', 'vec3(-(2.0*s-1.0), -(2.0*t-1.0), -1.0)',
];
let envRenderer = null;
function exportEnv(id) {
  envRenderer ??= new THREE.WebGLRenderer({ antialias: false });
  const r = envRenderer, tex = id === 'lineup' ? bakeEnvironment(r) : bakeNightEnvironment(r);
  const h = tex.image.height, maxMip = Math.log2(h) - 2;
  const defines = { ENVMAP_TYPE_CUBE_UV: 1, CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(2 ** maxMip, 7 * 16)), CUBEUV_TEXEL_HEIGHT: 1 / h, CUBEUV_MAX_MIP: `${maxMip}.0` };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); scene.add(quad);
  const mats = FACE_DIR.map((dir) => new THREE.ShaderMaterial({
    defines, uniforms: { envMap: { value: tex }, uRough: { value: 0 } }, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D envMap; uniform float uRough; varying vec2 vUv;
      #include <cube_uv_reflection_fragment>
      void main(){ float s = vUv.x, t = vUv.y; gl_FragColor = vec4(textureCubeUV(envMap, normalize(${dir}), uRough).rgb, 1.0); }`,
  }));
  const toHalf = THREE.DataUtils.toHalfFloat, out = [];
  ENV_SIZES.forEach((n, mip) => {
    const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, depthBuffer: false });
    const px = new Float32Array(n * n * 4);
    for (let f = 0; f < 6; f++) {
      quad.material = mats[f]; mats[f].uniforms.uRough.value = mip / (ENV_SIZES.length - 1);
      r.setRenderTarget(rt); r.render(scene, camera);
      r.readRenderTargetPixels(rt, 0, 0, n, n, px);
      for (let i = 0; i < px.length; i++) out.push(toHalf(i % 4 === 3 ? 1 : Math.min(px[i], 60000)));
    }
    rt.dispose();
  });
  r.setRenderTarget(null);
  return { sizes: ENV_SIZES, data: b64(new Uint16Array(out)) };
}

// --- The wet slab's puddles ------------------------------------------------------------------------------------------
// wall.js wetMask, one tile: 200 m takes each of its noises a whole number of cells (14, 58, 220), so it wraps by itself. Its
// fine detail fading with the pixel's footprint is what the texture's mips do here.
function wetMaskTexture(textures) {
  const S = 512, T = 200;
  const fract = (x) => x - Math.floor(x);
  const hash = (x, y) => { let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); };
  const noise = (x, y, per) => {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const h = (i, j) => hash(((i % per) + per) % per, ((j % per) + per) % per);
    return (h(ix, iy) * (1 - fx) + h(ix + 1, iy) * fx) * (1 - fy) + (h(ix, iy + 1) * (1 - fx) + h(ix + 1, iy + 1) * fx) * fy;
  };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), d = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const px = ((i + 0.5) / S) * T, pz = ((j + 0.5) / S) * T;
    const n = noise(px * 0.07, pz * 0.07, 14) * 0.62 + noise(px * 0.29 + 7, pz * 0.29 + 7, 58) * 0.28 + (noise(px * 1.1 + 3, pz * 1.1 + 3, 220) - 0.5) * 0.2;
    const v = Math.round(ss(0.32, 0.52, n) * 255), k = (j * S + i) * 4;
    d.data[k] = d.data[k + 1] = d.data[k + 2] = v; d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return textureOf(t, textures);
}

// --- The launch complex --------------------------------------------------------------------------------------------------
// rocket.js draws it with one shader from four flood lamps. Nothing there moves, and the lens is always a few hundred metres off,
// so its light is evaluated once per vertex here, line for line from STRUCT_FS / LATTICE_FS, into HDR vertex colours; the surfaces'
// patterns (soot, the pad's patches) need the triangles split finer, which is the whole cost. The red hairline, thinner than a
// pixel, is its own ring. Left out: the vapour vents' puffs and a static fire's glow and steam.
function bakeComplex(id, textures) {
  const gen = buildRocket({ reducedMotion: true });
  let res; do res = gen.next(); while (!res.done);
  const R = res.value;
  R.setLook(id);
  R.group.updateMatrixWorld(true);
  const [struct, lattice, lamps, beacons, beams] = R.group.children;
  const U = R.uniforms, M = R.group.matrixWorld;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const site = V3().setFromMatrixPosition(M);
  // What a stage camera sees it from: the stage's middle, about where every rig stands.
  const eye = id === 'lineup' ? V3(0, 5, 0) : V3(20, 10, -10);
  const dist = site.distanceTo(eye);
  const fract = (x) => x - Math.floor(x);
  const hash12 = (x, y) => { let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); };
  const vnoise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (hash12(ix, iy) * (1 - fx) + hash12(ix + 1, iy) * fx) * (1 - fy) + (hash12(ix, iy + 1) * (1 - fx) + hash12(ix + 1, iy + 1) * fx) * fy;
  };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sky = U.uSky.value, hazeC = U.uHaze.value, hazeK = U.uHazeK.value;
  const L = V3(), l = V3(), h = V3(), v = V3();
  function floodLight(wp, n, shin, spec) {
    const k = 0.55 + 0.45 * n.y, acc = [sky.r * k, sky.g * k, sky.b * k];
    for (let i = 0; i < 4; i++) {
      L.copy(U.uFloodPos.value[i]).sub(wp);
      const d2 = Math.max(L.dot(L), 1);
      l.copy(L).multiplyScalar(1 / Math.sqrt(d2));
      const cone = 0.06 + 0.94 * ss(0.8, 0.97, -l.dot(U.uFloodDir.value[i])), ndl = Math.max(n.dot(l), 0);
      h.copy(l).add(v).normalize();
      const m = (cone / d2) * (ndl + spec * Math.max(n.dot(h), 0) ** shin * ndl), c = U.uFloodCol.value[i];
      acc[0] += c.r * m; acc[1] += c.g * m; acc[2] += c.b * m;
    }
    return acc;
  }
  const hazed = (c, wp) => { const f = 1 - Math.exp(-wp.distanceTo(eye) * hazeK); return [c[0] + (hazeC.r - c[0]) * f, c[1] + (hazeC.g - c[1]) * f, c[2] + (hazeC.b - c[2]) * f]; };
  const wp = V3(), wn = V3(), lp = V3(), ln = V3();
  function shadeStruct(p, n, col, uvx, mat) {
    lp.set(p[0], p[1], p[2]); wp.copy(lp).applyMatrix4(M);
    ln.set(n[0], n[1], n[2]); wn.copy(ln).transformDirection(M);
    v.copy(eye).sub(wp).normalize();
    let alb = [...col], shin = 24, spec = 0.08, emit = [0, 0, 0];
    const hh = p[1] - MOUNT_TOP;
    if (mat === 1) {
      const side = 0.5 + 0.5 * Math.cos((uvx - 0.15) * 6.2831);
      const pat = vnoise(uvx * 12, hh * 0.035) * 0.55 + vnoise(uvx * 34, hh * 0.09) * 0.3 + vnoise(uvx * 90, hh * 0.25) * 0.15;
      const soot = 0.94 * ss(0.16, 0.6, ss(3, 36, hh) * (0.4 + 0.6 * side) + (pat - 0.5) * 0.8);
      alb = [alb[0] + (0.03 - alb[0]) * soot, alb[1] + (0.028 - alb[1]) * soot, alb[2] + (0.026 - alb[2]) * soot];
      shin = 18; spec = 0.06 * (1 - soot);
    } else if (mat === 2) { shin = 40; spec = 0.12; }
    else if (mat === 3) { emit = [...col]; alb = [0.02, 0.02, 0.02]; }
    else if (mat === 4) {
      const pp = vnoise(wp.x * 0.05, wp.z * 0.05) * 0.5 + vnoise(wp.x * 0.21, wp.z * 0.21) * 0.3, k = 0.8 + 0.4 * pp;
      alb = alb.map((a) => a * k); shin = 10; spec = 0.05;
      const g = 1 - ss(25, 86, Math.hypot(p[0], p[2]));
      emit = [alb[0] * 0.1 * g, alb[1] * 0.1 * g, alb[2] * 0.11 * g];
    }
    const fl = floodLight(wp, wn, shin, spec), rim = 0.6 * Math.max(0, Math.min(1, 1 - wn.dot(v))) ** 4;
    return hazed([alb[0] * fl[0] + emit[0] + sky.r * rim, alb[1] * fl[1] + emit[1] + sky.g * rim, alb[2] * fl[2] + emit[2] + sky.b * rim], wp);
  }
  // Non-indexed triangles, split along their longest edge until each edge is under `maxEdge` for its surface.
  const MAX_EDGE = { 0: 16, 1: 3.2, 2: 6, 3: 50, 4: 12 };
  const lerpV = (a, b) => ({ p: a.p.map((x, i) => (x + b.p[i]) / 2), n: a.n.map((x, i) => (x + b.n[i]) / 2), uv: [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2], col: a.col, mat: a.mat, sp: a.sp });
  const dist3 = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const split = (a, b, c, maxE, out) => {
    const ab = dist3(a, b), bc = dist3(b, c), ca = dist3(c, a), m = Math.max(ab, bc, ca);
    if (m <= maxE) { out.push(a, b, c); return; }
    if (m === ab) { const d = lerpV(a, b); split(a, d, c, maxE, out); split(d, b, c, maxE, out); }
    else if (m === bc) { const d = lerpV(b, c); split(a, b, d, maxE, out); split(a, d, c, maxE, out); }
    else { const d = lerpV(c, a); split(a, b, d, maxE, out); split(d, b, c, maxE, out); }
  };
  // A sliver (rocket.js: at least 1.5 px): on this lens, at this range, a fixed width says the same. In metres at the phone's floor scale.
  const minW = 1.5 * (2 * dist * Math.tan((52 * Math.PI) / 360)) / 1434;
  const g = struct.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color, MT = g.attributes.aMat, SP = g.attributes.aSpread;
  const tris = [];
  for (let i = 0; i + 2 < P.count; i += 3) {
    const vert = (k) => {
      const sx = SP.getX(k), sy = SP.getY(k), sz = SP.getZ(k), w = 2 * Math.hypot(sx, sy, sz), wide = w > 0 && w < minW ? minW / w - 1 : 0;
      return { p: [P.getX(k) + sx * wide, P.getY(k) + sy * wide, P.getZ(k) + sz * wide], n: [N.getX(k), N.getY(k), N.getZ(k)], uv: [UV.getX(k), UV.getY(k)], col: [C.getX(k), C.getY(k), C.getZ(k)], mat: Math.round(MT.getX(k)) };
    };
    const a = vert(i), b = vert(i + 1), c = vert(i + 2);
    split(a, b, c, MAX_EDGE[a.mat] ?? 7, tris);
  }
  // The fairing's red hairline (STRUCT_FS `red`), as a ring: 16 cm of emissive band sits under a pixel out here, as it does on the web.
  const ringY = MOUNT_TOP + VEHICLE.stage2Top + 0.15, ringR = VEHICLE.radius + 0.1, ringOut = [];
  const redCol = [2.2 * 0.5, 0.06 * 0.5, 0.1 * 0.5];
  for (let k = 0; k < 32; k++) {
    const a0 = (k / 32) * Math.PI * 2, a1 = ((k + 1) / 32) * Math.PI * 2, vv = (a, y) => ({ p: [Math.sin(a) * ringR, y, Math.cos(a) * ringR], baked: redCol });
    const lo = ringY - 0.14, hi = ringY + 0.14;
    ringOut.push(vv(a0, lo), vv(a1, lo), vv(a1, hi), vv(a0, lo), vv(a1, hi), vv(a0, hi));
  }
  // One mesh, indexed by welding what bakes alike.
  const vb = [], ib = [], subs = [];
  const v2 = V3(), n2 = V3();
  function addSub(material, order, verts) {
    const map = new Map(), start = vb.length / 11, istart = ib.length;
    for (const q of verts) {
      const key = q.key; let ix = map.get(key);
      if (ix === undefined) { ix = vb.length / 11 - start; map.set(key, ix); vb.push(q.pos[0], q.pos[1], q.pos[2], q.nrm[0], q.nrm[1], q.nrm[2], q.uv[0], q.uv[1], q.col[0], q.col[1], q.col[2]); }
      ib.push(ix);
    }
    subs.push({ material, renderOrder: order, top: 100, vertexStart: start, vertexCount: vb.length / 11 - start, indexStart: istart, indexCount: ib.length - istart });
  }
  const fmt = (a) => a.map((x) => x.toFixed(3)).join(',');
  const base = (extra) => ({ name: extra.name, kind: 'baked', color: [1, 1, 1], emissive: [0, 0, 0], emissiveIntensity: 1, unlit: true, metalness: 0, roughness: 1, clearcoat: 0, clearcoatRoughness: 0, opacity: 1, transparent: false, depthWrite: true, doubleSided: false, additive: false, polygonOffset: null, vertexColors: true, fog: false, wet: false, map: null, roughnessMap: null, bumpMap: null, bumpScale: 1, emissiveMap: null, alphaMap: null, effect: null, ...extra });
  const world = (p) => { v2.set(p[0], p[1], p[2]).applyMatrix4(M); return [v2.x, v2.y, v2.z]; };
  const worldN = (n) => { n2.set(n[0], n[1], n[2]).transformDirection(M); return [n2.x, n2.y, n2.z]; };
  const solid = tris.map((q) => {
    const col = shadeStruct(q.p, q.n, q.col, q.uv[0], q.mat), pos = world(q.p), nrm = worldN(q.n);
    return { key: `${fmt(pos)}|${fmt(nrm)}|${fmt(col)}`, pos, nrm, uv: [0, 0], col };
  });
  for (const q of ringOut) { const pos = world(q.p); solid.push({ key: `${fmt(pos)}|ring`, pos, nrm: [0, 1, 0], uv: [0, 0], col: q.baked }); }
  addSub(base({ name: 'complex-struct' }), 0, solid);
  // The strongback's lattice: alpha from the web's own texture, on black, read from green as three's alphaMap is.
  const src = lattice.material.uniforms.uMap.value.image, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(src, 0, 0);
  const alphaTex = new THREE.CanvasTexture(cv); alphaTex.wrapS = alphaTex.wrapT = THREE.RepeatWrapping;
  const lg = lattice.geometry, lp2 = lg.attributes.position, ln2 = lg.attributes.normal, luv = lg.attributes.uv, lat = [], lout = [];
  for (let i = 0; i < lg.index.count; i += 3) {
    const vt = (k) => { const e = lg.index.getX(k); return { p: [lp2.getX(e), lp2.getY(e), lp2.getZ(e)], n: [ln2.getX(e), ln2.getY(e), ln2.getZ(e)], uv: [luv.getX(e), luv.getY(e)] }; };
    split(vt(i), vt(i + 1), vt(i + 2), 9, lat);
  }
  for (const q of lat) {
    const pos = world(q.p); wp.set(pos[0], pos[1], pos[2]); wn.set(q.n[0], q.n[1], q.n[2]).transformDirection(M); v.copy(eye).sub(wp).normalize();
    if (wn.dot(v) < 0) wn.negate();
    const fl = floodLight(wp, wn, 12, 0.1), col = hazed([0.3 * fl[0], 0.3 * fl[1], 0.31 * fl[2]], wp);
    lout.push({ key: `${fmt(pos)}|${fmt(q.uv)}|${fmt(col)}`, pos, nrm: worldN(q.n), uv: q.uv, col });
  }
  addSub(base({ name: 'complex-lattice', transparent: true, depthWrite: false, doubleSided: true, alphaMap: textureOf(alphaTex, textures) }), 1, lout);
  // The flood banks' beams: additive cones; BEAM_FS's haze over this range, its dust held at its mean.
  const bg = beams.geometry, bp = bg.attributes.position, bn = bg.attributes.normal, buv = bg.attributes.uv, bout = [];
  for (let i = 0; i < bg.index.count; i++) {
    const e = bg.index.getX(i), pos = world([bp.getX(e), bp.getY(e), bp.getZ(e)]);
    bout.push({ key: String(e), pos, nrm: worldN([bn.getX(e), bn.getY(e), bn.getZ(e)]), uv: [buv.getX(e), buv.getY(e)], col: [1, 1, 1] });
  }
  addSub(base({ name: 'complex-beams', transparent: true, depthWrite: false, doubleSided: true, additive: true, vertexColors: false,
    effect: { kind: 'floodBeam', color: [0.75, 0.85, 1], power: 0.05 * 0.825 * Math.exp(-dist * hazeK * 0.6) } }), 2, bout);
  const spots = (mesh) => {
    const a = mesh.geometry.attributes.aPos, c = mesh.geometry.attributes.aCol, out = [];
    for (let i = 0; i < a.count; i++) {
      if (![a.getX(i), a.getY(i), a.getZ(i)].every(Number.isFinite)) continue;   // (rocket.js's tank beacon reads TANK[0], undefined: it never draws on the web either)
      const p = world([a.getX(i), a.getY(i), a.getZ(i)]);
      out.push([...p, c.getX(i), c.getY(i), c.getZ(i)]);
    }
    return { size: mesh.material.uniforms.uSize.value, minPx: mesh.material.uniforms.uMinPx.value, spots: out };
  };
  const mesh = { vertexStride: 44, vertexCount: vb.length / 11, submeshes: subs, vertices: b64(new Float32Array(vb)), indices: b64(new Uint32Array(ib)) };
  return { mesh, center: site.clone().add(V3(0, 40, 0)).toArray(), radius: 110, lamps: spots(lamps), beacons: spots(beacons),
    glows: R.glows.map((g2) => ({ pos: g2.pos.toArray(), color: g2.color.toArray(), radius: g2.radius })) };
}

export async function exportCourse(id) {
  const textures = new Map();
  const build = COURSE_BUILDERS[id]('high');
  let first = build.next().value;
  const look = first;
  while (!build.next().done);
  const group = look.group;
  // The parked row: the group with setBodies; its children are the vehicles in course order.
  const row = group.children.find((ch) => ch.userData && ch.userData.setBodies);
  const parked = [];
  if (row) {
    // Each vehicle baked in its own frame where it stands (pose zeroed, nothing re-parented: moving a child while
    // iterating the row's children reorders them, and once baked one car twice).
    for (const car of [...row.children]) {
      const p = car.position.clone(), q = car.quaternion.clone();
      car.position.set(0, 0, 0); car.quaternion.identity(); row.updateMatrixWorld(true);
      // crash.js parkedFor: a struck car's chips are in LINEUP_SPEC's paint, by its place in the row.
      parked.push({ home: { x: p.x, y: p.y, z: p.z }, paint: (LINEUP_SPEC[parked.length] || LINEUP_SPEC[0]).paint, mesh: bake(car, textures) });
      car.position.copy(p); car.quaternion.copy(q); row.updateMatrixWorld(true);
    }
  }
  const lights = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isLight) return;
    const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const L = { kind: o.type, color: o.color.toArray(), intensity: o.intensity, position: wp.toArray(), distance: o.distance ?? 0, decay: o.decay ?? 2 };
    if (o.isSpotLight) { o.target.updateMatrixWorld(true); L.target = new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld).toArray(); L.angle = o.angle; L.penumbra = o.penumbra; }
    if (o.isDirectionalLight) { o.target.updateMatrixWorld(true); L.target = new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld).toArray(); }
    if (o.isHemisphereLight) L.ground = o.groundColor.toArray();
    lights.push(L);
  });
  const pivots = [];
  group.traverse((o) => { if (o.userData.sweep) pivots.push(o); });
  const stat = bake(group, textures, (o) => under(o, (p) => (row && p === row) || p.userData.sweep));
  const sweep = sweepRig(pivots, textures);
  // The roadster: the body, and each wheel as two parts in its pivot's frame (main.js syncCar drives them: the pivot at
  // wheelCenterY(compression), turned by the steer on the fronts; the `spin` group about its axle by the wheel's spin).
  const car = makeRoadster();
  const carRoot = car.root ?? car.group ?? car;
  const rootObj = carRoot.isObject3D ? carRoot : car.object;
  const parts = carParts(car, textures);
  const wheelPivots = new Set(car.wheels.map((w) => w.pivot));
  const roadster = bake(rootObj, textures, (o) => under(o, (p) => wheelPivots.has(p) || parts.moved.has(p)));
  const wheels = car.wheels.map((w, i) => {
    const pos = w.pivot.position.clone(), rot = w.pivot.rotation.clone(), parent = w.pivot.parent;
    parent.remove(w.pivot); w.pivot.position.set(0, 0, 0); w.pivot.rotation.set(0, 0, 0); w.pivot.updateMatrixWorld(true);
    const steerPart = bake(w.pivot, textures, (o) => { for (let p = o; p; p = p.parent) if (p === w.spin) return true; return false; });
    const spinPart = bake(w.spin, textures);
    w.pivot.position.copy(pos); w.pivot.rotation.copy(rot); parent.add(w.pivot);
    return { index: i, x: pos.x, z: pos.z, baseY: w.baseY, steers: i < 2, steerPart, spinPart };
  });
  const L = look.look || {};
  const complex = bakeComplex(id, textures);
  const film = id === 'lineup' ? FILM_LOOKS.lineup : FILM_LOOKS.night;
  const wet = (look.wet || []).length > 0;
  return {
    env: exportEnv(id), complex, wetMask: wet ? wetMaskTexture(textures) : null,
    course: id, generated: 'scripts/native-stage.mjs from src/render (scene.js COURSE_BUILDERS, roadster.js). Never edit by hand.',
    look: { exposure: L.exposure ?? 1, bloom: L.bloom ?? null, fog: L.fog ? { color: L.fog.color.toArray(), near: L.fog.near, far: L.fog.far, density: L.fog.density ?? 0 } : null,
      environmentIntensity: id === 'lineup' ? 0.9 : 1,   // scene.js setCourse
      film,                                              // film.js LOOKS: the height fog, the sun's scatter, the glow scale, the vignette
      sky: id === 'lineup' ? { kind: 'dusk', zenith: PALETTE.zenith.toArray(), mid: PALETTE.mid.toArray(), horizon: PALETTE.horizon.toArray(), sunDir: new THREE.Vector3(-0.55, 0.06, 0.83).normalize().toArray() } : { kind: 'night' },
      keyLight: look.keyLight ? { color: new THREE.Color(look.keyLight.color).toArray(), intensity: look.keyLight.intensity, offset: look.keyLight.offset.toArray() } : null,
      glows: [...(look.glows || []).map((g) => ({ pos: g.pos.toArray(), color: g.color.toArray(), radius: g.radius })), ...complex.glows] },
    static: stat, parked, roadster, wheels, lights, carParts: parts.out, sweep,
    textures: [...textures.values()],
  };
}
