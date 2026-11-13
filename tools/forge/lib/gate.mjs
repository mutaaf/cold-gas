// The forge's gate (0211): what a built asset must pass before it may reach the game. Pure: a report (from
// tools/forge/blender/finish.py validate) and the glb's bytes in, a list of failures out. Unit-tested
// (tests/unit/forge.test.js).

// The glTF JSON chunk of a .glb.
export function glbJson(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('glb: first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len)));
}

// Words that must never appear in a forged asset's names, materials or a brief's script (AGENTS.md 3.7). Not a
// complete list of the world's marques: the brief's prompt forbids every real name, this catches the obvious slip.
export const BANNED = [
  'tesla', 'cyber', 'model 3', 'model y', 'ford', 'chevrolet', 'chevy', 'dodge', 'toyota', 'honda', 'nissan', 'mazda',
  'subaru', 'mitsubishi', 'suzuki', 'lancia', 'audi', 'quattro', 'bmw', 'mercedes', 'benz', 'porsche', 'volkswagen', 'vw golf',
  'ferrari', 'lamborghini', 'maserati', 'fiat', 'alfa romeo', 'peugeot', 'renault', 'citroen', 'volvo', 'saab', 'jeep', 'hummer',
  'delorean', 'lotus', 'aston', 'jaguar', 'land rover', 'mini cooper', 'datsun', 'lexus', 'hyundai', 'kia', 'rivian', 'lucid',
  'batmobile', 'knight rider', 'kitt', 'back to the future', 'ghostbusters', 'ecto', 'mad max', 'interceptor', 'herbie',
  'general lee', 'mystery machine', 'a-team', 'fast and furious', 'gran turismo', 'need for speed', 'blade runner',
];
export function bannedIn(text) {
  const t = String(text).toLowerCase();
  return BANNED.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t));
}

/**
 * @param {object} report  finish.py's report.json
 * @param {object} slot    tools/forge/lib/slots.mjs entry
 * @param {Uint8Array} glb the exported model
 * @returns {{ ok: boolean, failures: string[], facts: object }}
 */
export function gate(report, slot, glb) {
  const f = [];
  if (!report.ok) return { ok: false, failures: [`build failed: ${report.error || 'unknown'}`, ...(report.scriptProblems || [])], facts: {} };
  const L0 = report.lod0;
  // budgets
  const lods = [L0.tris, ...slot.budgets.slice(1).map((_, i) => report[`lod${i + 1}`]?.tris)];
  slot.budgets.forEach((b, i) => { if (!(lods[i] <= b)) f.push(`LOD${i}: ${lods[i]} triangles over the budget of ${b}`); });
  // scale and placement against the sim's box (Blender frame: x width, y length, z up)
  const { min, max } = L0.bounds;
  const size = { w: max[0] - min[0], l: max[1] - min[1], h: max[2] - min[2] };
  const S = slot.spec;
  for (const k of ['l', 'w', 'h']) {
    const r = size[k] / S[k], [lo, hi] = slot.fit[k];
    if (r < lo || r > hi) f.push(`${k === 'l' ? 'length' : k === 'w' ? 'width' : 'height'} ${size[k].toFixed(3)} m is ${(r * 100).toFixed(1)} % of the sim's ${S[k]} m (allowed ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(1)} %)`);
  }
  if (Math.abs(min[2]) > 0.015) f.push(`it doesn't stand on the ground: lowest point z = ${min[2].toFixed(3)} m`);
  const cx = (max[0] + min[0]) / 2, cy = (max[1] + min[1]) / 2;
  if (Math.abs(cx) > 0.03 || Math.abs(cy) > Math.max(0.03, S.l * 0.012)) f.push(`not centred on its box: centre at x ${cx.toFixed(3)}, y ${cy.toFixed(3)}`);
  // closed solids (a few edges of slack for the exact boolean's slivers)
  const slack = Math.max(4, Math.round(L0.edges * 0.002));
  if (L0.nonManifoldEdges > slack) f.push(`${L0.nonManifoldEdges} non-manifold edges (allowed ${slack}): parts must be closed solids`);
  // no text, no emblems, no imports of images or fonts
  if (report.outlineFlags?.length) f.push(`emblem-like outlines (small, intricate): ${report.outlineFlags.map((x) => x.part).join(', ')}`);
  if (L0.glyphClusterCount > 0) f.push(`${L0.glyphClusterCount} clusters of small flat islands, like lettering`);
  if (L0.fonts || L0.curves || L0.images) f.push(`fonts ${L0.fonts}, curves ${L0.curves}, images ${L0.images}: none allowed`);
  const types = (L0.objectTypes || []).filter((t) => t !== 'MESH' && t !== 'EMPTY');
  if (types.length) f.push(`object types not allowed: ${types.join(', ')}`);
  const words = bannedIn([...(L0.materials || []), report.id, report.source].join(' '));
  if (words.length) f.push(`names that aren't ours: ${words.join(', ')}`);
  // the glb itself
  let facts = { size, tris: lods, bytes: glb?.byteLength ?? 0 };
  if (glb) {
    const j = glbJson(glb);
    if (j.images?.length || j.textures?.length) f.push('the glb carries images: forged assets are geometry + palette materials only');
    const names = (j.nodes || []).map((n) => n.name);
    for (let i = 0; i < slot.budgets.length; i++) if (!names.includes(`LOD${i}`)) f.push(`the glb has no LOD${i} node`);
    if (!(j.extensionsUsed || []).includes('EXT_meshopt_compression')) f.push('the glb is not meshopt-compressed');
    const unknown = (j.materials || []).map((m) => m.name).filter((n) => !/^(paint|paint_alt|glass|trim|gloss|rubber|rim_dark|rim_silver|cover|stainless|steel|chassis|lamp_white|lamp_red|lamp_red_dim|lamp_amber|lens|orange|reflective|plastic_white|plastic_red|concrete|bark|needles|needles_tip|leaves|leaves_dark|stone|stone_dark|lichen|timber|galvanised)(\.\d+)?$/.test(n));
    if (unknown.length) f.push(`materials outside the palette: ${unknown.join(', ')}`);
    const cap = slot.kind === 'vehicle' ? 420_000 : 60_000;
    if (glb.byteLength > cap) f.push(`${(glb.byteLength / 1024).toFixed(0)} kB over the ${cap / 1000} kB download budget`);
    facts = { ...facts, materials: (j.materials || []).map((m) => m.name) };
  }
  return { ok: f.length === 0, failures: f, facts };
}
