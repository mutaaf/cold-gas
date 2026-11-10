// 0183: "previous session ended without pagehide" counted a phone tab that the OS discarded while it sat in the
// background as a crash. A hidden page can be frozen and dropped without ever getting pagehide (iOS Safari, and a
// Chrome tab discarded in the background), so a session that went hidden had already said goodbye. Only a session
// that died while on screen (a crashed renderer, an out-of-memory kill, a hang) is unclean, for the report and for
// the ledger's tier step-down alike.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { chooseBoot, diedOnScreen, LEDGER_KEY } from '../../src/obs/ledger.js';

const sess = (extra = {}) => ({ tier: 'high', p95: 12, frames: 5000, scale: 0, ended: true, crashes: {}, ctxLost: 0, ...extra });

describe('0183: which session ended unclean', () => {
  it('is one that never said goodbye while on screen; hidden first, it left the normal way', () => {
    expect(diedOnScreen(sess({ ended: false }))).toBe(true);
    expect(diedOnScreen(sess({ ended: false, hidden: true }))).toBe(false);
    expect(diedOnScreen(sess({ ended: false, hidden: false }))).toBe(true);   // hidden, then back on screen, then gone
    expect(diedOnScreen(sess())).toBe(false);
    expect(diedOnScreen(sess({ ended: false, frames: 300 }))).toBe(false);   // too short to count
    expect(diedOnScreen(null)).toBe(false);
  });

  it('two phone tabs dropped in the background keep the tier; two killed on screen still step it down', () => {
    const background = [sess({ ended: false, hidden: true }), sess(), sess({ ended: false, hidden: true })];
    expect(chooseBoot({ sessions: background }).tier).toBe('high');
    const killed = [sess({ ended: false }), sess(), sess({ ended: false })];
    expect(chooseBoot({ sessions: killed }).tier).toBe('mid');
  });
});

// The live wiring (src/obs/index.js) in Node: a stand-in window, document and localStorage.
function fakePage(ledger) {
  const store = new Map(ledger ? [[LEDGER_KEY, JSON.stringify(ledger)]] : []);
  const handlers = { win: new Map(), doc: new Map() };
  const target = (m) => ({ addEventListener: (t, fn) => m.set(t, [...(m.get(t) || []), fn]), removeEventListener() {} });
  const doc = Object.assign(target(handlers.doc), { visibilityState: 'visible' });
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('addEventListener', target(handlers.win).addEventListener);
  vi.stubGlobal('removeEventListener', () => {});
  vi.stubGlobal('fetch', async () => ({ status: 200 }));
  const fire = (where, type) => { for (const fn of handlers[where].get(type) || []) fn({ type }); };
  return {
    stored: () => JSON.parse(store.get(LEDGER_KEY)),
    hide: () => { doc.visibilityState = 'hidden'; fire('doc', 'visibilitychange'); },
    show: () => { doc.visibilityState = 'visible'; fire('doc', 'visibilitychange'); },
    pagehide: () => fire('win', 'pagehide'),
  };
}
async function boot(ledger) {
  const page = fakePage(ledger);
  vi.resetModules();
  const { obs } = await import('../../src/obs/index.js');
  obs.init({ deviceClass: 'phone-lo', send: false });
  const unclean = () => obs.snapshot().errors.filter((e) => e.kind === 'unclean').length;
  return { page, obs, unclean };
}

describe('0183: the page records how it left', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('a session that went hidden and was then discarded is not reported at the next boot', async () => {
    const { unclean } = await boot({ v: 1, sessions: [sess({ ended: false, hidden: true })], breakers: {}, recoveries: [] });
    expect(unclean()).toBe(0);
  });
  it('a session that died on screen still is (a crash, an out-of-memory kill)', async () => {
    const { unclean } = await boot({ v: 1, sessions: [sess({ ended: false })], breakers: {}, recoveries: [] });
    expect(unclean()).toBe(1);
  });
  it('hiding marks the session hidden, coming back clears it, and pagehide ends it', async () => {
    const { page } = await boot(null);
    const last = () => page.stored().sessions.at(-1);
    expect(last().ended).toBe(false);
    expect(last().hidden).toBeFalsy();
    page.hide();
    expect(last().hidden).toBe(true);
    page.show();
    expect(last().hidden).toBe(false);
    page.pagehide();
    expect(last().ended).toBe(true);
  });
});
