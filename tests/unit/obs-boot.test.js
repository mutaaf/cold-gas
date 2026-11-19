// 0293: a build that throws before src/obs installs (while the modules evaluate) used to show the boot watchdog and leave
// no trace in /obs. index.html now keeps those errors in __cgEarly for obs.init to report, and the watchdog sends its own
// beacon when the game never comes up, signed with the same hash as src/obs/signature.js.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { hash12 } from '../../src/obs/signature.js';
import { cleanObs } from '../../src/worker/obs.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// The watchdog's inline script, run against a stand-in page.
function watchdog({ host = 'mutaafaziz.com', search = '' } = {}) {
  const src = html.match(/<script>\s*\(function \(\) \{\s*var shown = null[\s\S]*?\}\)\(\);\s*<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const handlers = new Map(), sent = [], intervals = [];
  const win = {
    location: { hostname: host, search, reload() {} },
    navigator: { onLine: true, sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } },
    matchMedia: () => ({ matches: true }),
    addEventListener: (t, fn) => handlers.set(t, [...(handlers.get(t) || []), fn]),
    setInterval: (fn) => { intervals.push(fn); return 1; }, clearInterval() {}, setTimeout: (fn) => fn(),
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    document: { createElement: () => ({ setAttribute() {}, style: {}, appendChild() {}, addEventListener() {}, remove() {} }), body: { appendChild() {} } },
  };
  win.window = win;
  new Function(...Object.keys(win), src)(...Object.values(win));
  const fire = (type, e) => { for (const fn of handlers.get(type) || []) fn(e); };
  const tick = (n) => { for (let i = 0; i < n; i++) for (const fn of intervals) fn(); };
  return { win, sent, fire, tick };
}

describe('0293: the boot watchdog', () => {
  it('signs with the same hash as src/obs/signature.js', () => {
    const fn = html.match(/function h12\(s\) \{[\s\S]*?\n {6}\}/)[0];
    const h12 = new Function(`${fn}; return h12;`)();
    for (const s of ['', 'a', 'boot watchdog: slow to start|watchdog@index.html|abc1234', 'héllo ✓ 🚀']) expect(h12(s)).toBe(hash12(s));
  });

  it('keeps the errors seen before the game is up, and stops once src/obs takes them', () => {
    const { win, fire } = watchdog();
    fire('error', { error: new TypeError('x is not a function'), message: 'x' });
    fire('unhandledrejection', { reason: 'nope' });
    fire('error', { target: {} });   // a failed <script>/<link>: no message, not kept
    expect(win.__cgEarly.map((e) => e.message)).toEqual(['x is not a function', 'nope']);
    win.__cgEarly = null;   // src/obs drained them
    fire('error', { error: new Error('later') });
    expect(win.__cgEarly).toBeNull();
  });

  it('beacons once when the game never came up, as a batch the Worker accepts', () => {
    const { sent, fire, tick } = watchdog();
    fire('error', { error: new TypeError('Cannot read properties of undefined (reading \'S\') at 12:34'), message: 'x' });
    tick(16);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('api/obs');   // relative: /coldgas/api/obs under the base path (invariant 3.2)
    const body = JSON.parse(sent[0].blob.text);
    const clean = cleanObs(body);
    expect(clean).not.toBeNull();
    expect(clean.errs.map((e) => [e.mod, e.kind])).toEqual([['page', 'unclean'], ['page', 'error']]);
    expect(clean.errs[0].msg).toMatch(/^boot watchdog: /);
    expect(clean.errs[1].msg).toBe("TypeError: Cannot read properties of undefined (reading 'S') at N:N");
    expect(body.first).toBe(false);
    tick(30);
    expect(sent).toHaveLength(1);
  });

  it('stays quiet on localhost (no Worker there) unless ?obs=1', () => {
    const a = watchdog({ host: 'localhost' }); a.tick(16);
    expect(a.sent).toHaveLength(0);
    const b = watchdog({ host: 'localhost', search: '?obs=1' }); b.tick(16);
    expect(b.sent).toHaveLength(1);
  });
});

describe('0293: src/obs reports what the watchdog kept', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete globalThis.__cgEarly; });
  it('drains __cgEarly once at init', async () => {
    const target = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    vi.stubGlobal('document', { ...target, visibilityState: 'visible' });
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('removeEventListener', () => {});
    vi.stubGlobal('fetch', async () => ({ status: 200 }));
    globalThis.__cgEarly = [new TypeError('boom at module eval'), new Error('second')];
    vi.resetModules();
    const { obs } = await import('../../src/obs/index.js');
    obs.init({ deviceClass: 'phone-lo', send: false });
    expect(globalThis.__cgEarly).toBeNull();
    const msgs = obs.snapshot().errors.map((e) => e.msg);
    expect(msgs).toContain('TypeError: boom at module eval');
    expect(msgs).toContain('second');
  });
});
