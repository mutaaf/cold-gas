// Shared by the judges' stream (src/ai/stream.js) and the board (src/panel.js).
// POST, and try twice more on a 503: the platform's answer when an isolate has run over its CPU
// budget (Cloudflare 1102). The replay is heavy; the next try usually lands on a fresh isolate.
// [obs] Each retry is a self-heal: recorded as a recovery, ok if a later try landed. (The failures
// themselves are recorded by obs's fetch wrapper, by route only: never a header or a key.)
import { obs } from './obs/index.js';

export async function postRetry(url, init, waits = [1200, 3000]) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (i > 0) obs.recovery('net-retry', res.status !== 503, `${String(url).replace(/^.*\/api\//, '/api/')} after ${i} retr${i > 1 ? 'ies' : 'y'}: ${res.status}`);
    if (res.status !== 503 || i >= waits.length || init.signal?.aborted) return res;
    await new Promise((r) => setTimeout(r, waits[i]));
  }
}
