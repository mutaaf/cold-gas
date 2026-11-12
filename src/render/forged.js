// The forge's assets in the game (0211, a lazy chunk): Blender-built glTF models (tools/forge) that replace the
// procedural PIXELS of the parked row and the Sandbox's props. The colliders stay the sim's (docs/OBJECTS.md): a model
// is built to its slot's physics box, and the forge's gate refuses one that isn't.
// Everything comes from our own origin: the .glb files under public/forge/, three's GLTFLoader and its meshopt
// decoder bundled from node_modules (no CDN, AGENTS.md 3.3). Loaded after the title is up, never on the first load's
// critical path; swapped in between runs only (main.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import MANIFEST from './forge-manifest.json';
import { MAT, paint } from './parked/kit.js';
import { LINEUP_SPEC } from '../sim/courses.js';
import { forgeRegistry } from './forge-registry.js';

// Past this distance (m) a vehicle draws its LOD1, a prop past PROP_LOD.
const CAR_LOD = 42, PROP_LOD = 18;

// The forge's palette names → the game's own materials (src/render/parked/kit.js), so a forged car is lit, coated
// and exported (scripts/native-stage-page.js) exactly as the procedural fleet. Vertex colours carry the baked
// occlusion; lamps are unlit HDR, just over the stage's bloom threshold, as kit.js LAMP.
const lampMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
const cache = new Map();
function gameMaterial(src, slot) {
  const name = String(src.name || '').replace(/\.\d+$/, '');
  const paintHex = LINEUP_SPEC.find((s) => s.id === slot)?.paint;
  const key = `${name}:${name === 'paint' ? paintHex : ''}`;
  if (cache.has(key)) return cache.get(key);
  let m;
  switch (name) {
    case 'paint': m = paintHex !== undefined ? paint(paintHex).clone() : src; break;
    case 'paint_alt': m = MAT.gloss.clone(); break;
    case 'glass': m = MAT.glass.clone(); break;
    case 'trim': m = MAT.trim.clone(); break;
    case 'gloss': m = MAT.gloss.clone(); break;
    case 'rubber': m = MAT.rubber.clone(); break;
    case 'rim_dark': m = MAT.rimDark.clone(); break;
    case 'rim_silver': m = MAT.rimSilver.clone(); break;
    case 'cover': m = MAT.cover.clone(); break;
    case 'stainless': m = MAT.stainless.clone(); break;
    case 'steel': m = MAT.steel.clone(); break;
    case 'chassis': m = MAT.chassis.clone(); break;
    case 'lens': m = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0f, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 }); break;
    case 'lamp_white': m = lampMat(1.25, 1.3, 1.38); break;
    case 'lamp_red': m = lampMat(1.15, 0.05, 0.07); break;
    case 'lamp_red_dim': m = lampMat(0.42, 0.02, 0.03); break;
    case 'lamp_amber': m = lampMat(1.2, 0.5, 0.06); break;
    default: m = src;   // the props' own PBR colours (orange, reflective, plastic…), straight from the glTF
  }
  if (m !== src) m.name = name;
  m.vertexColors = !m.isMeshBasicMaterial;
  cache.set(key, m);
  return m;
}

// The packed files carry quantized attributes (KHR_mesh_quantization: int16 positions, int8 normals, the node's scale and
// offset dequantizing them). The game works in metres on float arrays (crash.js dents a struck car's positions in place,
// the Sandbox merges and scales its props, the native exporter bakes them), so each geometry comes in as floats with its
// node's transform baked in, once, at load.
function floatGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    const get = [a.getX, a.getY, a.getZ, a.getW];   // (denormalized; works on interleaved attributes too)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = get[k].call(a, i);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  g.applyMatrix4(matrix);
  if (g.getAttribute('normal')) g.normalizeNormals();
  g.computeBoundingSphere();
  return g;
}

// One slot's glTF → a template: a LOD (nose +z) with the game's materials. `lods: false` keeps LOD0 alone (the native
// exporter's stage carries one mesh per vehicle).
function template(gltf, slot, kind, lods) {
  gltf.scene.updateMatrixWorld(true);
  const levels = [];
  gltf.scene.traverse((o) => { const m = /^LOD(\d)$/.exec(o.name); if (m) levels[+m[1]] = o; });
  const out = new THREE.LOD();
  out.name = `forged:${slot}`;
  levels.forEach((node, i) => {
    if (!node || (i > 0 && !lods)) return;
    const g = new THREE.Group();
    node.traverse((o) => {
      if (!o.isMesh) return;
      // the root's half turn (nose +z), the node's place and its dequantization, baked into float arrays
      const mesh = new THREE.Mesh(floatGeometry(o.geometry, o.matrixWorld), gameMaterial(o.material, slot));
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    });
    out.addLevel(g, i === 0 ? 0 : kind === 'vehicle' ? CAR_LOD : PROP_LOD);
  });
  return out;
}

// One merged geometry (LOD0) with vertex colours = base colour × occlusion: what an instanced prop draws.
// `white`: the paint's vertices stay white × occlusion (the instance colour is the paint, src/build/render.js carMat).
function merged(gltf, white) {
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  let lod0 = null;
  gltf.scene.traverse((o) => { if (o.name === 'LOD0') lod0 = o; });
  (lod0 || gltf.scene).traverse((o) => {
    if (!o.isMesh) return;
    let g = floatGeometry(o.geometry, o.matrixWorld);
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    const n = g.attributes.position.count, ao = g.attributes.color, c = new Float32Array(n * 3);
    const name = String(o.material.name || '').replace(/\.\d+$/, '');
    const base = white && name === 'paint' ? new THREE.Color(1, 1, 1) : (o.material.color || new THREE.Color(1, 1, 1)).clone();
    if (o.material.emissive && (o.material.emissiveIntensity ?? 0) > 0 && o.material.emissive.getHex() !== 0) base.copy(o.material.emissive).multiplyScalar(Math.min(1, o.material.emissiveIntensity));
    for (let i = 0; i < n; i++) {
      const a = ao ? ao.getX(i) : 1;
      c[3 * i] = base.r * a; c[3 * i + 1] = base.g * a; c[3 * i + 2] = base.b * a;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  });
  const out = mergeGeometries(parts, false);
  out.computeBoundingSphere();
  return out;
}

const loading = new Map();   // per (base, lods): the page and the native exporter may ask for different sets
/**
 * Fetch and parse every asset in the manifest (from our own origin) and fill forgeRegistry.
 * @param {{ base?: string, lods?: boolean }} o
 * @returns {Promise<typeof forgeRegistry>}
 */
export function loadForged({ base = import.meta.env.BASE_URL, lods = true } = {}) {
  const key = `${base}|${lods}`;
  if (loading.has(key)) return loading.get(key);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const entries = Object.entries(MANIFEST.assets || {});
  const p = Promise.all(entries.map(([slot, a]) => loader.loadAsync(base + a.file).then((gltf) => [slot, a, gltf]))).then((list) => {
    const templates = new Map(), geos = new Map(), raw = new Map();
    for (const [slot, a, gltf] of list) {
      templates.set(slot, template(gltf, slot, a.kind, lods));
      raw.set(slot, gltf);
    }
    forgeRegistry.model = (slot) => {
      const t = templates.get(slot);
      return t ? t.clone() : null;
    };
    forgeRegistry.geometry = (slot, { white = false } = {}) => {
      const key = `${slot}:${white}`;
      if (!raw.has(slot)) return null;
      if (!geos.has(key)) geos.set(key, merged(raw.get(slot), white));
      return geos.get(key);
    };
    forgeRegistry.slots = templates.size;
    return forgeRegistry;
  });
  loading.set(key, p);
  p.catch(() => loading.delete(key));   // a failed load may be asked for again
  return p;
}
