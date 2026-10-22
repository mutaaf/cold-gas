// Fetch a road from our own origin (public/roads/<id>.bin.gz), gunzip it in the browser, parse
// and build it for the sim. Nothing here talks to anything but /coldgas/.
//
// Every step has a deadline and a cancel: the headers must arrive within HEADERS_MS, the body may
// not stall for longer than STALL_MS between chunks, and `signal` (Back on the picker) stops it at
// once. A failure throws (the picker shows an error card); a cancel throws an AbortError.
import { parseRoad, buildRoad } from '../sim/roads.js';
import { fetchWithDeadline } from '../net.js';

export const HEADERS_MS = 12_000, STALL_MS = 12_000;

async function gunzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const abortError = () => { const e = new Error('cancelled'); e.name = 'AbortError'; return e; };
export const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };

// onProgress(fraction 0–1, label)
export async function loadRoad(id, onProgress = () => {}, { signal = null } = {}) {
  const url = `${import.meta.env.BASE_URL}roads/${id}.bin.gz`;
  onProgress(0, 'Fetching the road');
  // The body read runs under its own controller, so a stalled stream can be cut off.
  const body = new AbortController();
  const cancel = () => body.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let stall = 0, stalled = false;
  const watch = () => { clearTimeout(stall); stall = setTimeout(() => { stalled = true; body.abort(); }, STALL_MS); };
  try {
    const res = await fetchWithDeadline(url, { ms: HEADERS_MS, signal: body.signal });
    if (!res.ok) throw new Error(`road ${id}: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let bytes;
    watch();
    if (res.body && total) {
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        watch();
        parts.push(value); got += value.length;
        onProgress(Math.min(0.5, (got / total) * 0.5), 'Fetching the road');
      }
      bytes = new Uint8Array(got);
      let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    } else bytes = new Uint8Array(await res.arrayBuffer());
    clearTimeout(stall);
    checkAbort(signal);
    // The server may already have decoded it (Content-Encoding); gzip starts with 1f 8b.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
    onProgress(0.55, 'Grading the road');
    await new Promise((r) => setTimeout(r, 0));
    checkAbort(signal);
    const data = parseRoad(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const road = buildRoad(data);
    onProgress(0.7, 'Shaping the land');
    return road;
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (stalled) { const e = new Error(`road ${id}: the download stalled`); e.name = 'TimeoutError'; throw e; }
    throw err;
  } finally {
    clearTimeout(stall);
    signal?.removeEventListener('abort', cancel);
  }
}
