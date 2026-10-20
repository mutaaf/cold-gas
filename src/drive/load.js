// Fetch a road from our own origin (public/roads/<id>.bin.gz), gunzip it in the browser, parse
// and build it for the sim. Nothing here talks to anything but /coldgas/.
import { parseRoad, buildRoad } from '../sim/roads.js';

async function gunzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// onProgress(fraction 0–1, label)
export async function loadRoad(id, onProgress = () => {}) {
  const url = `${import.meta.env.BASE_URL}roads/${id}.bin.gz`;
  onProgress(0, 'Fetching the road');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`road ${id}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes;
  if (res.body && total) {
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress(Math.min(0.5, (got / total) * 0.5), 'Fetching the road');
    }
    bytes = new Uint8Array(got);
    let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  } else bytes = new Uint8Array(await res.arrayBuffer());
  // The server may already have decoded it (Content-Encoding); gzip starts with 1f 8b.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  onProgress(0.55, 'Grading the road');
  await new Promise((r) => setTimeout(r, 0));
  const data = parseRoad(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const road = buildRoad(data);
  onProgress(0.7, 'Shaping the land');
  return road;
}
