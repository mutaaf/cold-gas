// The portal builds (CrazyGames, GameDistribution): the index.html edits, the SDK adapter, the saves, the offline
// guard, the local board and the ads object main.js drives. The production build never runs any of it (ON_PORTAL).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { portalHtml, PORTALS, FORBIDDEN } from '../../scripts/portal-html.mjs';
import { createPortal, CG_SDK_URL, GD_SDK_URL } from '../../src/portal/sdk.js';
import { snapshot, fit, hydrate, mirror, SAVE_KEY } from '../../src/portal/storage.js';
import { isServerCall } from '../../src/portal/offline.js';
import { postLocal, readRows, boardRows, rankOf, BOARD_KEY } from '../../src/portal/board.js';
import { createAds } from '../../src/portal/ads.js';
import { PORTAL, ON_PORTAL } from '../../src/portal/flag.js';
import { GD_GAME_ID_PLACEHOLDER, GD_GAME_ID, REWARDED_REROLL } from '../../src/portal/config.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the build flag', () => {
  it('is off in the production build and the tests', () => {
    expect(PORTAL).toBe('none');
    expect(ON_PORTAL).toBe(false);
  });
  it('ships the GameDistribution id as a placeholder, and rewarded off', () => {
    expect(GD_GAME_ID).toBe(GD_GAME_ID_PLACEHOLDER);
    expect(REWARDED_REROLL).toBe(false);
  });
});

describe('index.html for a portal', () => {
  const html = readFileSync('index.html', 'utf8');
  for (const portal of PORTALS) {
    it(`${portal}: every edit applies once and nothing forbidden is left`, () => {
      const out = portalHtml(html, portal);
      expect(out).toContain('<script type="module" src="/src/portal/entry.js"></script>');
      expect(out).toContain(`data-portal="${portal}"`);
      expect(out).toContain('data-portal-css');
      for (const re of FORBIDDEN) expect(out).not.toMatch(re);
      // The game itself is all still there.
      for (const sel of ['data-start', 'data-reveal', 'data-board-open', 'data-screen="results"', 'data-screen="pause"', 'data-drive-open']) expect(out).toContain(sel);
    });
  }
  it('fails loudly when index.html drifts from what the edits expect', () => {
    expect(() => portalHtml(html.replace('<link rel="manifest"', '<link rel="manifesto"'), 'crazygames')).toThrow(/manifest/);
  });
  it('the production index.html is untouched by any of this', () => {
    expect(html).toContain('<script type="module" src="/src/main.js"></script>');
    expect(html).not.toContain('data-portal');
  });
});

describe('the portal entry', () => {
  it('imports every stylesheet the game imports up front, so the title paints inlined', () => {
    const entry = readFileSync('src/portal/entry.js', 'utf8');
    const lazy = /^src\/(drive|build|world|ai)\//;
    const files = readdirSync('src', { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`).filter((f) => !lazy.test(f) && !f.startsWith('src/worker/') && !f.startsWith('src/portal/'));
    for (const f of files) {
      for (const [, css] of readFileSync(f, 'utf8').matchAll(/^import '([^']+\.css)';/gm)) {
        const name = css.startsWith('.') ? css.replace(/^\.\.?\//, '').split('/').pop() : css;
        expect(entry, `${f} imports ${css}`).toContain(name);
      }
    }
    expect(entry).toMatch(/import\('\.\.\/main\.js'\)/);
  });
});

// A stand-in for CrazyGames' SDK v3 (docs.crazygames.com/sdk): window.CrazyGames.SDK with init, environment, game, ad, user, data.
function fakeCG({ env = 'local', fill = 'finish', device = 'mobile', mute = false } = {}) {
  const calls = [];
  const listeners = [];
  const SDK = {
    environment: env,
    init: vi.fn(async () => {}),
    game: {
      settings: { muteAudio: mute },
      gameplayStart: () => calls.push('start'), gameplayStop: () => calls.push('stop'),
      loadingStart: () => calls.push('loadingStart'), loadingStop: () => calls.push('loadingStop'),
      addSettingsChangeListener: (f) => listeners.push(f),
    },
    ad: {
      requestAd(type, cb) {
        calls.push(`ad:${type}`);
        if (fill === 'error') setTimeout(() => cb.adError({ code: 'unfilled' }), 0);
        else setTimeout(() => { cb.adStarted(); setTimeout(() => cb.adFinished(), 0); }, 0);
      },
    },
    user: { systemInfo: { device: { type: device } } },
    data: memStorage(),
  };
  const win = { CrazyGames: { SDK } };
  const load = vi.fn(async () => true);
  return { win, SDK, calls, load, listeners };
}

describe('the adapter: CrazyGames', () => {
  it('starts the SDK and reports gameplay only on a change', async () => {
    const f = fakeCG();
    const p = createPortal('crazygames', { win: f.win, doc: {}, load: f.load });
    expect(await p.init()).toBe(true);
    expect(f.load.mock.calls[0][1]).toBe(CG_SDK_URL);
    p.loadingStart(); p.loadingStart(); p.loadingStop(); p.loadingStop();
    p.gameplayStop(); p.gameplayStart(); p.gameplayStart(); p.gameplayStop(); p.gameplayStop();
    expect(f.calls).toEqual(['loadingStart', 'loadingStop', 'start', 'stop']);
    expect(p.deviceType()).toBe('mobile');
    expect(p.data).toBe(f.SDK.data);
  });
  it('mutes only when the ad starts and always resumes after it', async () => {
    const f = fakeCG();
    const p = createPortal('crazygames', { win: f.win, doc: {}, load: f.load });
    await p.init();
    const seq = [];
    await p.midgame({ beforeAd: () => seq.push('before'), afterAd: () => seq.push('after') });
    expect(seq).toEqual(['before', 'after']);
    expect(await p.rewarded({})).toBe(true);
  });
  it('an unfilled ad resumes nothing it never paused, and earns no reward', async () => {
    const f = fakeCG({ fill: 'error' });
    const p = createPortal('crazygames', { win: f.win, doc: {}, load: f.load });
    await p.init();
    const seq = [];
    await p.midgame({ beforeAd: () => seq.push('before'), afterAd: () => seq.push('after') });
    expect(seq).toEqual([]);
    expect(await p.rewarded({})).toBe(false);
  });
  it('follows the portal mute setting', async () => {
    const f = fakeCG({ mute: true });
    const p = createPortal('crazygames', { win: f.win, doc: {}, load: f.load });
    await p.init();
    const seen = [];
    p.onSettings((s) => seen.push(s.muteAudio));
    f.SDK.game.settings = { muteAudio: false };
    f.listeners[0]();
    expect(seen).toEqual([true, false]);
  });
  it('blocked (an ad blocker) or the wrong domain: everything is a safe no-op', async () => {
    for (const [load, env] of [[async () => false, 'local'], [async () => true, 'disabled']]) {
      const f = fakeCG({ env });
      const p = createPortal('crazygames', { win: f.win, doc: {}, load });
      expect(await p.init()).toBe(false);
      p.loadingStart(); p.gameplayStart(); p.gameplayStop(); p.loadingStop();
      const seq = [];
      await p.midgame({ beforeAd: () => seq.push('before'), afterAd: () => seq.push('after') });
      expect(await p.rewarded({})).toBe(false);
      expect(seq).toEqual([]);
      expect(f.calls).toEqual([]);
      expect(p.deviceType()).toBe(null);
      expect(p.data).toBe(null);
    }
  });
  it('a throwing SDK never reaches the game', async () => {
    const f = fakeCG();
    f.SDK.game.gameplayStart = () => { throw new Error('boom'); };
    f.SDK.ad.requestAd = () => { throw new Error('boom'); };
    const p = createPortal('crazygames', { win: f.win, doc: {}, load: f.load });
    await p.init();
    expect(() => p.gameplayStart()).not.toThrow();
    await expect(p.midgame({})).resolves.toBeUndefined();
  });
});

describe('the adapter: GameDistribution', () => {
  function fakeGD({ ready = true, rewarded = true } = {}) {
    const win = {};
    const load = vi.fn(async () => {
      win.gdsdk = {
        showAd: vi.fn(async (type) => {
          win.GD_OPTIONS.onEvent({ name: 'SDK_GAME_PAUSE' });
          if (type === 'rewarded' && rewarded) win.GD_OPTIONS.onEvent({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
          win.GD_OPTIONS.onEvent({ name: 'SDK_GAME_START' });
        }),
      };
      setTimeout(() => win.GD_OPTIONS.onEvent({ name: ready ? 'SDK_READY' : 'SDK_ERROR' }), 0);
      return true;
    });
    return { win, load };
  }
  it('loads nothing until the game id is pasted', async () => {
    const f = fakeGD();
    const p = createPortal('gamedistribution', { win: f.win, doc: {}, load: f.load });
    expect(await p.init()).toBe(false);
    expect(f.load).not.toHaveBeenCalled();
    await expect(p.midgame({})).resolves.toBeUndefined();
  });
  it('with an id: GD_OPTIONS first, then the SDK; pause and resume around the ad; the reward only when watched', async () => {
    const f = fakeGD();
    const p = createPortal('gamedistribution', { win: f.win, doc: {}, load: f.load, gameId: 'abc123' });
    expect(await p.init()).toBe(true);
    expect(f.win.GD_OPTIONS.gameId).toBe('abc123');
    expect(f.load.mock.calls[0][1]).toBe(GD_SDK_URL);
    const seq = [];
    await p.midgame({ beforeAd: () => seq.push('before'), afterAd: () => seq.push('after') });
    expect(seq).toEqual(['before', 'after']);
    expect(await p.rewarded({})).toBe(true);
    const g = fakeGD({ rewarded: false });
    const q = createPortal('gamedistribution', { win: g.win, doc: {}, load: g.load, gameId: 'abc123' });
    await q.init();
    expect(await q.rewarded({})).toBe(false);
  });
  it('a showAd that rejects still resumes the game', async () => {
    const f = fakeGD();
    const p = createPortal('gamedistribution', { win: f.win, doc: {}, load: f.load, gameId: 'abc123' });
    await p.init();
    f.win.gdsdk.showAd = async () => { f.win.GD_OPTIONS.onEvent({ name: 'SDK_GAME_PAUSE' }); throw new Error('no fill'); };
    const seq = [];
    await p.midgame({ beforeAd: () => seq.push('before'), afterAd: () => seq.push('after') });
    expect(seq).toEqual(['before', 'after']);
  });
});

describe('saves through the data module', () => {
  it('the data module copy wins on load; changes go back to it', () => {
    const ls = memStorage({ coldgas_muted: '0', coldgas_tier: 'assist', other_app: 'x' });
    const data = memStorage({ [SAVE_KEY]: JSON.stringify({ coldgas_muted: '1', coldgas_initials: 'ABC', evil: 'no' }) });
    expect(hydrate(ls, data)).toBe(2);
    expect(ls.getItem('coldgas_muted')).toBe('1');
    expect(ls.getItem('coldgas_initials')).toBe('ABC');
    expect(ls.getItem('evil')).toBe(null);
    const flush = mirror({ ls, data, win: null, doc: null, every: 0 });
    ls.setItem('coldgas_tier', 'pro');
    expect(flush()).toBe(true);
    expect(JSON.parse(data.getItem(SAVE_KEY))).toEqual({ coldgas_muted: '1', coldgas_tier: 'pro', coldgas_initials: 'ABC' });
    expect(flush()).toBe(false);
  });
  it('keeps under the size limit by leaving the largest values local', () => {
    const s = fit({ coldgas_a: 'x'.repeat(500), coldgas_b: 'y' }, 100);
    expect(JSON.parse(s)).toEqual({ coldgas_b: 'y' });
    expect(snapshot(memStorage({ coldgas_x: '1', [SAVE_KEY]: 'z', no: '2' }))).toEqual({ coldgas_x: '1' });
  });
  it('a broken copy changes nothing', () => {
    const ls = memStorage({ coldgas_muted: '0' });
    expect(hydrate(ls, memStorage({ [SAVE_KEY]: '{nope' }))).toBe(0);
    expect(ls.getItem('coldgas_muted')).toBe('0');
  });
});

describe('no server on a portal', () => {
  const base = 'https://games.example.com/abc/index.html?x=1';
  it('refuses the game\'s own api/ calls and nothing else', () => {
    expect(isServerCall('api/scores', base)).toBe(true);
    expect(isServerCall('./api/obs', base)).toBe(true);
    expect(isServerCall('https://games.example.com/abc/api/judge/stream', base)).toBe(true);
    expect(isServerCall('roads/stelvio.bin.gz', base)).toBe(false);
    expect(isServerCall('./assets/rapier.wasm', base)).toBe(false);
    expect(isServerCall('https://sdk.crazygames.com/api/x', base)).toBe(false);
  });
});

describe('the local board', () => {
  const card = (total, jumped = true) => ({ total, verdict: 'Clean', tier: 'pro', facts: { jumped, rollDeg: 360, sink: 1.2 } });
  const now = Date.parse('2026-11-13T12:00:00Z');
  it('saves jumps and ranks them per course and day', () => {
    const ls = memStorage();
    expect(postLocal(ls, { card: card(70), initials: 'AAA', course: 'show', now })).toMatchObject({ ok: true, rank: 1, local: true });
    expect(postLocal(ls, { card: card(80), initials: 'BBB', course: 'show', now })).toMatchObject({ ok: true, rank: 1 });
    expect(postLocal(ls, { card: card(75), initials: 'CCC', course: 'show', now })).toMatchObject({ ok: true, rank: 2 });
    postLocal(ls, { card: card(99), initials: 'DDD', course: 'wall', now });
    postLocal(ls, { card: card(90), initials: 'EEE', course: 'show', now: now - 86_400_000 });
    const rows = readRows(ls);
    expect(boardRows(rows, { kind: 'today', course: 'show', now }).map((r) => r.initials)).toEqual(['BBB', 'CCC', 'AAA']);
    expect(boardRows(rows, { kind: 'all', course: 'show', now }).map((r) => r.initials)).toEqual(['EEE', 'BBB', 'CCC', 'AAA']);
    expect(rankOf(rows, card(78), { course: 'show', now })).toBe(2);
  });
  it('no jump, no entry', () => {
    const ls = memStorage();
    expect(postLocal(ls, { card: card(50, false), initials: 'AAA', course: 'show', now }).ok).toBe(false);
    expect(ls.getItem(BOARD_KEY)).toBe(null);
  });
});

describe('the ads object on a portal (what main.js drives)', () => {
  function fakePortal(live = true) {
    const calls = [];
    return { calls, live, playing: false, gameplayStart() { calls.push('start'); }, gameplayStop() { calls.push('stop'); }, loadingStop() {}, onSettings() {}, midgame: vi.fn(async (h) => { h.beforeAd?.(); h.afterAd?.(); }), rewarded: vi.fn(async () => true) };
  }
  const doc = { querySelector: () => null, readyState: 'complete', body: null, createElement: () => ({}) };
  it('play is the countdown, the run and Free Drive; the rest are breaks', () => {
    let m = 'title';
    const p = fakePortal();
    const ads = createAds({ win: null, doc, mode: () => m, p });
    for (m of ['title', 'countdown', 'live', 'results', 'replay', 'drive', 'title']) ads.sync();
    expect(p.calls).toEqual(['stop', 'start', 'start', 'stop', 'stop', 'start', 'stop']);
  });
  it('no ad after the first run; then one at the break, and go() after it', async () => {
    let t = 1_000_000;
    const p = fakePortal();
    const ads = createAds({ win: null, doc, now: () => t, mode: () => 'results', p });
    const go = vi.fn();
    ads.noteRun(); ads.postrun(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(p.midgame).not.toHaveBeenCalled();
    ads.noteRun(); ads.postrun(go);
    expect(go).toHaveBeenCalledTimes(1);   // held while the ad runs
    await tick(); await tick();
    expect(p.midgame).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(2);
    ads.noteRun(); ads.postrun(go);   // inside our floor between two: none
    expect(p.midgame).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(3);
    t += 181_000; ads.postrun(go);
    await tick(); await tick();
    expect(p.midgame).toHaveBeenCalledTimes(2);
  });
  it('with no SDK the break is instant, and the rewarded button never shows', async () => {
    const p = fakePortal(false);
    const ads = createAds({ win: null, doc, mode: () => 'results', p });
    const go = vi.fn();
    ads.noteRun(); ads.noteRun(); ads.noteRun(); ads.postrun(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(ads.rewardReady()).toBe(false);
    expect(await ads.reward()).toBe(false);
    expect(createAds({ win: null, doc, p: fakePortal(true) }).rewardReady()).toBe(false);   // REWARDED_REROLL off
  });
});
