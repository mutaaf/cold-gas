// Client for POST /coldgas/api/judge/stream: reads the server-sent events and hands each one to
// a handler as it arrives. Also: list a BYOK provider's models.
const API = `${import.meta.env.BASE_URL}api`;

export async function streamPanel({ log, assist, ai }, on, { signal } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (ai.provider !== 'edge' && ai.key) headers['x-cg-key'] = ai.key;
  let res;
  try {
    res = await fetch(`${API}/judge/stream`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ log, assist, provider: ai.provider, model: ai.model }),
    });
  } catch {
    on.error?.({ message: 'The judges are offline.', fallback: true, offline: true });
    return;
  }
  if (!res.ok || !res.body) {
    on.error?.({ message: res.status === 400 && ai.provider !== 'edge' ? 'That key looks malformed.' : 'The judges are offline.', fallback: true, offline: res.status >= 404 });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      try { on[ev]?.(JSON.parse(data)); } catch (err) { console.warn('panel event', ev, err); }
    }
  }
}

export async function listModels(provider, key) {
  try {
    const res = await fetch(`${API}/models`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cg-key': key }, body: JSON.stringify({ provider }) });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body : { error: body.error || 'Could not reach the provider.' };
  } catch {
    return { error: 'You appear to be offline.' };
  }
}
