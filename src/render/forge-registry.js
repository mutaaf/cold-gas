// The forged assets (0211), once src/render/forged.js has loaded them (lazily, after the title is up). Tiny on
// purpose: scene.js and the Sandbox's renderer read it without pulling in the glTF loader. Until it's filled every
// reader draws its procedural model, so nothing waits on a download.
//   model(slot)    → a fresh Object3D (nose +z, centred on the slot's physics box, on the ground) or null
//   geometry(slot) → one merged BufferGeometry with vertex colours (base colour × baked occlusion) or null
export const forgeRegistry = { model: null, geometry: null };

// Whether the forge's assets are wanted on this page: `?forge=1|0`, else the default below (on only once the
// forged set looks better than the procedural one in every mode it fills: docs/backlog/0211).
export const FORGE_DEFAULT_ON = true;
export function forgeWanted(search = typeof location === 'undefined' ? '' : location.search) {
  const q = new URLSearchParams(search).get('forge');
  if (q === '1') return true;
  if (q === '0') return false;
  return FORGE_DEFAULT_ON;
}
