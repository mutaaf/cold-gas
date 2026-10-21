// The endless world's worker: builds terrain tiles (src/world/tilegen.js) and road chunks
// (src/world/roadchunk.js) off the main thread and hands back typed arrays (transferred, not
// copied). One generator per seed; the road is generated here too, from the same pure code, so
// nothing has to be sent but an address.
import { createTileGen, buildTile } from './tilegen.js';
import { createChunkBuilder } from './roadchunk.js';

let gen = null, chunk = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'seed') { gen = createTileGen(m.seed); chunk = createChunkBuilder(gen, m.tier || 'high'); return; }
  if (!gen) return;
  try {
    if (m.type === 'tile') {
      const t = buildTile(gen, m.lvl, m.i, m.j, { veg: m.veg });
      const transfer = [t.pos.buffer, t.nor.buffer, t.col.buffer, t.dep.buffer];
      if (t.veg) for (const v of Object.values(t.veg)) transfer.push(v.m.buffer, v.c.buffer);
      self.postMessage({ type: 'tile', key: m.key, gen: m.gen, tile: t }, transfer);
    } else if (m.type === 'chunk') {
      const d = chunk(m.c);
      const transfer = d.transfer;
      delete d.transfer;
      self.postMessage({ type: 'chunk', key: m.key, gen: m.gen, chunk: d }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: 'error', key: m.key, gen: m.gen, message: String((err && err.stack) || err) });
  }
};
