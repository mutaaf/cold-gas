// Runs in the browser (scripts/native-stage.mjs loads it through Vite): builds a course's stage, the roadster and the
// parked row with the web's own builders, then flattens them for the native renderer (docs/NATIVE.md §4, 0153):
//   static    every static mesh baked into world space, merged by material
//   parked    each parked vehicle in its own frame (nose +z, centred on its box); the app poses it from the sim:
//             translate(c) · rotate(q_body) · rotateY(π/2), as scene.js lineup() setBodies does
//   lights    spot, point and directional lights with their world positions and targets
//   look      exposure, bloom, fog, the key light (the course's `look`)
//   textures  every texture a material uses, as a PNG data URL (canvas textures are drawn by the real canvas here)
import * as THREE from 'three';
import { COURSE_BUILDERS } from '../src/render/scene.js';
import { makeRoadster } from '../src/render/roadster.js';

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
function materialOf(m, textures) {
  return {
    effect: effectOf(m), alphaMap: textureOf(m.alphaMap, textures),
    name: m.name || m.type, kind: m.type, color: m.color ? m.color.toArray() : [1, 1, 1],   // linear (three keeps colours linear)
    emissive: m.emissive ? m.emissive.toArray() : [0, 0, 0], emissiveIntensity: m.emissiveIntensity ?? 1,
    unlit: m.type === 'MeshBasicMaterial' || m.type === 'ShaderMaterial',
    metalness: m.metalness ?? 0, roughness: m.roughness ?? 1, clearcoat: m.clearcoat ?? 0, clearcoatRoughness: m.clearcoatRoughness ?? 0,
    opacity: m.opacity ?? 1, transparent: !!m.transparent, depthWrite: m.depthWrite !== false, doubleSided: m.side === THREE.DoubleSide,
    additive: m.blending === THREE.AdditiveBlending, polygonOffset: m.polygonOffset ? [m.polygonOffsetFactor, m.polygonOffsetUnits] : null,
    vertexColors: !!m.vertexColors, fog: m.fog !== false,
    map: textureOf(m.map, textures), roughnessMap: textureOf(m.roughnessMap, textures), bumpMap: textureOf(m.bumpMap, textures),
    bumpScale: m.bumpScale ?? 1, emissiveMap: textureOf(m.emissiveMap, textures),
  };
}
// Bake an object's meshes (world matrices from `root`) into per-material groups.
function bake(root, textures, skip = () => false) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  root.traverse((o) => {
    if (skip(o) || !(o.isMesh || o.isInstancedMesh) || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry, P = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const N = g.attributes.normal, UV = g.attributes.uv, COL = g.attributes.color;
    for (let inst = 0; inst < (o.isInstancedMesh ? o.count : 1); inst++) {
      m4.copy(o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(inst, mi); m4.multiply(mi); }
      n3.getNormalMatrix(m4);
      const flip = m4.determinant() < 0;
      const ranges = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : P.count, materialIndex: 0 }];
      for (const r of ranges) {
        const mat = mats[r.materialIndex ?? 0];
        if (!mat || mat.visible === false) continue;
        const key = mat.uuid + (o.renderOrder ? '@' + o.renderOrder : '');
        if (!groups.has(key)) groups.set(key, { mat, order: o.renderOrder || 0, pos: [], nrm: [], uv: [], col: [], idx: [] });
        const gr = groups.get(key), base = gr.pos.length / 3, remap = new Map();
        const at = (k) => (g.index ? g.index.getX(k) : k);
        for (let k = r.start; k < r.start + r.count; k += 3) {
          const tri = [at(k), at(k + 1), at(k + 2)];
          if (flip) [tri[1], tri[2]] = [tri[2], tri[1]];
          for (const i of tri) {
            if (!remap.has(i)) {
              remap.set(i, base + remap.size);
              v.fromBufferAttribute(P, i).applyMatrix4(m4); n.fromBufferAttribute(N, i).applyMatrix3(n3).normalize();
              gr.pos.push(v.x, v.y, v.z); gr.nrm.push(n.x, n.y, n.z);
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
    subs.push({ material: materialOf(gr.mat, textures), renderOrder: gr.order, vertexStart: verts, vertexCount: nv, indexStart: ib.length, indexCount: gr.idx.length });
    for (const i of gr.idx) ib.push(i);
    verts += nv;
  }
  return { vertexStride: 44, vertexCount: verts, submeshes: subs, vertices: b64(new Float32Array(vb)), indices: b64(new Uint32Array(ib)) };
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
      parked.push({ home: { x: p.x, y: p.y, z: p.z }, mesh: bake(car, textures) });
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
    lights.push(L);
  });
  const stat = bake(group, textures, (o) => row && (o === row || row.children.some((c) => { let p = o; while (p) { if (p === c) return true; p = p.parent; } return false; })));
  const car = makeRoadster();
  const carRoot = car.root ?? car.group ?? car;
  const roadster = bake(carRoot.isObject3D ? carRoot : car.object, textures);
  const L = look.look || {};
  return {
    course: id, generated: 'scripts/native-stage.mjs from src/render (scene.js COURSE_BUILDERS, roadster.js). Never edit by hand.',
    look: { exposure: L.exposure ?? 1, bloom: L.bloom ?? null, fog: L.fog ? { color: L.fog.color.toArray(), near: L.fog.near, far: L.fog.far } : null,
      keyLight: look.keyLight ? { color: new THREE.Color(look.keyLight.color).toArray(), intensity: look.keyLight.intensity, offset: look.keyLight.offset.toArray() } : null,
      glows: (look.glows || []).map((g) => ({ pos: g.pos.toArray(), color: g.color.toArray(), radius: g.radius })) },
    static: stat, parked, roadster, lights,
    textures: [...textures.values()],
  };
}
