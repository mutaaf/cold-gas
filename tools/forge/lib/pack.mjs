// Pack a forged glb for the phone's first load (0211): quantized attributes (KHR_mesh_quantization) and meshopt
// compression (EXT_meshopt_compression), which three's GLTFLoader decodes with the decoder three ships
// (three/examples/jsm/libs/meshopt_decoder.module.js, bundled: same origin, no CDN). Build time only.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, meshopt, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

// budgets: [LOD0, LOD1, …] triangles. LOD1+ arrive from Blender as full copies of LOD0 and are simplified here.
// Returns the triangle count of each LOD as packed.
export async function pack(inPath, outPath, budgets = []) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(inPath);
  canonical(doc);
  const tris = (node) => node.getMesh().listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  const nodes = Object.fromEntries(doc.getRoot().listNodes().filter((n) => /^LOD\d$/.test(n.getName())).map((n) => [n.getName(), n]));
  for (let i = 1; i < budgets.length; i++) {
    const node = nodes[`LOD${i}`];
    if (!node) continue;
    // small closed parts (lamps, nuts) can't shrink as far as the ratio asks: go again, a little coarser, until it fits
    for (const error of [0.05, 0.1, 0.2, 0.4, 0.8]) {
      if (tris(node) <= budgets[i]) break;
      const ratio = Math.min(1, (budgets[i] * 0.97) / tris(node));
      for (const prim of node.getMesh().listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
    }
  }
  await doc.transform(
    dedup(),
    prune({ keepExtras: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 13, quantizeNormal: 8, quantizeTexcoord: 12, quantizeColor: 8, cleanup: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(outPath, doc);
  return budgets.map((_, i) => (nodes[`LOD${i}`] ? Math.round(tris(nodes[`LOD${i}`])) : 0));
}

// Blender's exporter can list the same triangles in a different order from one run to the next (the panels' fills): put
// each primitive's triangles in one canonical order (each starting at its smallest index, then sorted), so the same
// build gives the same bytes. Winding is kept.
function canonical(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getIndices();
      if (!acc) continue;
      const a = acc.getArray(), tris = [];
      for (let i = 0; i < a.length; i += 3) {
        const t = [a[i], a[i + 1], a[i + 2]];
        const k = t.indexOf(Math.min(...t));
        tris.push([t[k], t[(k + 1) % 3], t[(k + 2) % 3]]);
      }
      tris.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
      const out = new a.constructor(a.length);
      tris.forEach((t, i) => out.set(t, i * 3));
      acc.setArray(out);
    }
  }
}
