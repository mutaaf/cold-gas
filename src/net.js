// Shared by the judges' stream (src/ai/stream.js) and the board (src/panel.js).
// POST, and try twice more on a 503: the platform's answer when an isolate has run over its CPU
// budget (Cloudflare 1102). The replay is heavy; the next try usually lands on a fresh isolate.
export async function postRetry(url, init, waits = [1200, 3000]) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.status !== 503 || i >= waits.length || init.signal?.aborted) return res;
    await new Promise((r) => setTimeout(r, waits[i]));
  }
}
