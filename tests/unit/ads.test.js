import { describe, it, expect, vi } from 'vitest';
import { wantLoader, canFill, postrunDue, createAds, mayStartAds, frameHeight, frameFilled, SLOTS, TITLE_DWELL_MS, TITLE_FRAME_SRC, TITLE_SKIP_MQ, NO_ROOM_EVENT } from '../../src/ads.js';

describe('ads (Marquee, between runs only)', () => {
  it('declares the three slots, all menu context', () => {
    expect(SLOTS.split(',').map((s) => s.split(':')[2])).toEqual(['menu', 'menu', 'menu']);
  });
  it('loads the loader only off a local host, or when asked', () => {
    expect(wantLoader({ hostname: 'mutaafaziz.com', search: '' })).toBe(true);
    expect(wantLoader({ hostname: 'localhost', search: '' })).toBe(false);
    expect(wantLoader({ hostname: '127.0.0.1', search: '?marquee=debug' })).toBe(true);
  });
  it("a 'none' source or a disabled config never fills", () => {
    expect(canFill({ enabled: true, slots: { a: { source: 'none' } } }, 'a')).toBe(false);
    expect(canFill({ enabled: false, slots: { a: { source: 'direct' } } }, 'a')).toBe(false);
    expect(canFill({ enabled: true, slots: { a: { source: 'network' } } }, 'a')).toBe(true);
    expect(canFill(null, 'a')).toBe(false);
  });
  it('skips the first run and caps the interstitial', () => {
    expect(postrunDue({ runs: 1, lastAt: 0, now: 1e9 })).toBe(false);
    expect(postrunDue({ runs: 2, lastAt: 0, now: 1e9 })).toBe(true);
    expect(postrunDue({ runs: 5, lastAt: 1e9, now: 1e9 + 60_000 })).toBe(false);
  });
  it('missing window.marquee (or the {q:[]} stub) is a no-op: go runs at once', () => {
    for (const win of [{}, { marquee: { q: [] } }, undefined]) {
      const ads = createAds({ win, doc: undefined });
      ads.noteRun(); ads.noteRun();
      const go = vi.fn();
      ads.postrun(go);
      expect(go).toHaveBeenCalledTimes(1);
      expect(ads.rewardReady()).toBe(false);
    }
  });
  it('a resolved config with no fill never calls the loader', async () => {
    const m = { v: 1, ready: async () => ({ enabled: true, slots: { postrun: { source: 'none' } } }), interstitial: vi.fn(), rewarded: vi.fn() };
    const ads = createAds({ win: { marquee: m, location: {} }, doc: {} });
    ads.start(); await Promise.resolve(); await Promise.resolve();
    ads.noteRun(); ads.noteRun();
    const go = vi.fn();
    ads.postrun(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(m.interstitial).not.toHaveBeenCalled();
    expect(await ads.reward()).toBe(false);
  });

  it('may start only between runs: the title and the results (0117)', () => {
    expect(mayStartAds('title')).toBe(true);
    expect(mayStartAds('results')).toBe(true);
    for (const m of ['boot', 'countdown', 'live', 'replay', 'drive', 'paused', undefined]) expect(mayStartAds(m)).toBe(false);
  });

  // A tiny DOM: enough for a script tag in head and a banner in the title.
  const fakeDoc = () => {
    // An iframe carries a stand-in document: `filled` says whether it holds a drawn ad (frameFilled's selector).
    const node = (tag) => ({ tagName: tag, dataset: {}, style: {}, attrs: {}, children: [], parent: null, contentWindow: tag === 'iframe' ? {} : undefined,
      contentDocument: tag === 'iframe' ? { filled: false, querySelector() { return this.filled ? {} : null; } } : undefined,
      listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= new Set()).add(f); }, removeEventListener(t, f) { this.listeners[t]?.delete(f); },
      dispatch(t) { for (const f of [...(this.listeners[t] || [])]) f({ type: t }); },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      querySelector(sel) { return sel === '[data-marquee-frame]' ? this.children.find((c) => c.dataset.marqueeFrame) || null : null; } });
    const head = node('head');
    return { head, createElement: node, querySelectorAll: (sel) => (sel === 'script[src]' ? head.children.filter((c) => c.src) : []) };
  };
  it('the loader waits for the title or the results, and starts once (0117)', () => {
    let mode = 'countdown';
    const doc = fakeDoc();
    const ads = createAds({ win: { location: { hostname: 'mutaafaziz.com', search: '' } }, doc, mode: () => mode });
    ads.arm(null);
    expect(doc.head.children).toHaveLength(0);           // ?play=jump: armed in the countdown, nothing injected
    mode = 'live'; ads.sync();
    expect(doc.head.children).toHaveLength(0);
    mode = 'results'; ads.sync();
    expect(doc.head.children).toHaveLength(1);
    expect(doc.head.children[0].src).toBe('/ads/v1/ads.js');
    mode = 'title'; ads.sync();
    expect(doc.head.children).toHaveLength(1);
  });
  it('nothing happens before arm (the first load stays clear)', () => {
    const doc = fakeDoc();
    const ads = createAds({ win: { location: { hostname: 'mutaafaziz.com', search: '' } }, doc, mode: () => 'title' });
    ads.sync();
    expect(doc.head.children).toHaveLength(0);
  });
  it('the title banner exists only while the title shows, after a dwell; a config that resolves in a run places nothing (0117)', async () => {
    vi.useFakeTimers();
    try {
      let mode = 'title';
      let resolve;
      const ready = new Promise((r) => { resolve = r; });
      const m = { v: 1, ready: () => ready, interstitial: vi.fn(), rewarded: vi.fn() };
      const doc = fakeDoc();
      const title = doc.createElement('section');
      const ads = createAds({ win: { marquee: m, location: {} }, doc, mode: () => mode });
      ads.arm(title);
      mode = 'countdown'; ads.sync();                    // Jump before the config resolved
      resolve({ enabled: true, slots: { title: { source: 'network' } } });
      await ready; await Promise.resolve();
      vi.advanceTimersByTime(TITLE_DWELL_MS * 2);
      expect(title.children).toHaveLength(0);           // no slot for a hidden title: no ad request
      mode = 'results'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS * 2);
      expect(title.children).toHaveLength(0);
      mode = 'title'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS - 100);
      expect(title.children).toHaveLength(0);           // a quick Jump never starts the pipeline
      mode = 'countdown'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS * 2);
      expect(title.children).toHaveLength(0);
      mode = 'title'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS);
      expect(title.children).toHaveLength(1);           // the player stayed: asked for
      const first = title.children[0];
      expect(first.tagName).toBe('iframe');
      expect(first.dataset.marqueeFrame).toBe('title');
      expect(first.src).toBe(TITLE_FRAME_SRC);
      mode = 'countdown'; ads.sync();
      expect(title.children).toHaveLength(0);           // taken out when the title goes
      mode = 'title'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS);
      expect(title.children).toHaveLength(1);
      expect(title.children[0]).not.toBe(first);         // a fresh frame for the next title
    } finally { vi.useRealTimers(); }
  });
  it("the title's slot is Marquee's frame: removed the moment the title goes, filled or not, and sized by its own report (0122)", async () => {
    vi.useFakeTimers();
    try {
      let mode = 'title';
      const cfg = { enabled: true, slots: { title: { source: 'network' } } };
      const m = { v: 1, ready: () => Promise.resolve(cfg), interstitial: vi.fn(), rewarded: vi.fn() };
      const doc = fakeDoc();
      const title = doc.createElement('section');
      const handlers = new Set();
      const location = { origin: 'https://mutaafaziz.com' };
      const win = { marquee: m, location, stop: vi.fn(),
        addEventListener: (t, f) => t === 'message' && handlers.add(f), removeEventListener: (t, f) => t === 'message' && handlers.delete(f) };
      const post = (source, data, origin = location.origin) => { for (const f of [...handlers]) f({ source, data, origin }); };
      const ads = createAds({ win, doc, mode: () => mode });
      ads.arm(title);
      await Promise.resolve(); await Promise.resolve();
      vi.advanceTimersByTime(TITLE_DWELL_MS);
      const f = title.children[0];
      expect(f.tagName).toBe('iframe');
      expect(f.style.height).toBe('0px');                 // an unfilled slot takes no room, as the in-page one did
      expect(f.attrs.scrolling).toBe('no');
      post(f.contentWindow, { marqueeFrame: 'title', h: 60 });
      expect(f.style.height).toBe('0px');                // 0142: a reported height with no drawn ad takes no room
      expect('filled' in f.dataset).toBe(false);
      f.contentDocument.filled = true; f.dispatch('load');
      expect(f.style.height).toBe('60px');               // filled: it grows exactly as the in-page slot would
      expect('filled' in f.dataset).toBe(true);
      post(f.contentWindow, { marqueeFrame: 'title', h: 250 });
      expect(f.style.height).toBe('90px');               // the slot's cap
      post({}, { marqueeFrame: 'title', h: 10 });         // another window's message: ignored
      post(f.contentWindow, { marqueeFrame: 'title', h: 10 }, 'https://evil.example');
      expect(f.style.height).toBe('90px');
      f.hidden = true;                                    // settled, filled: still removed (its document keeps working)
      mode = 'countdown'; ads.sync();                     // Jump
      expect(title.children).toHaveLength(0);
      expect(handlers.size).toBe(0);                      // the listener goes with it
      expect(win.stop).not.toHaveBeenCalled();            // the frame's removal is the cut: nothing of the page's is stopped
      mode = 'drive'; ads.sync();
      mode = 'title'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS - 1);
      expect(title.children).toHaveLength(0);             // each title waits out its own dwell
      vi.advanceTimersByTime(1);
      expect(title.children).toHaveLength(1);
      mode = 'drive'; ads.sync();                         // any way off the title removes it
      expect(title.children).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("0142: an unfilled frame takes no room whatever it reports; a filled one that costs the Daily its room goes, for this title only", async () => {
    vi.useFakeTimers();
    try {
      let mode = 'title';
      const cfg = { enabled: true, slots: { title: { source: 'network' } } };
      const m = { v: 1, ready: () => Promise.resolve(cfg), interstitial: vi.fn(), rewarded: vi.fn() };
      const doc = fakeDoc();
      const title = doc.createElement('section');
      const handlers = new Set();
      const location = { origin: 'https://mutaafaziz.com' };
      const win = { marquee: m, location, addEventListener: (t, f) => t === 'message' && handlers.add(f), removeEventListener: (t, f) => t === 'message' && handlers.delete(f) };
      const post = (source, data) => { for (const f of [...handlers]) f({ source, data, origin: location.origin }); };
      const ads = createAds({ win, doc, mode: () => mode });
      ads.arm(title);
      await Promise.resolve(); await Promise.resolve();
      vi.advanceTimersByTime(TITLE_DWELL_MS);
      let f = title.children[0];
      f.dispatch('load');
      post(f.contentWindow, { marqueeFrame: 'title', h: 90 });   // Google reserved the unit's height, drew nothing
      vi.advanceTimersByTime(15_000);
      expect(f.style.height).toBe('0px');
      expect('filled' in f.dataset).toBe(false);
      f.contentDocument.filled = true; post(f.contentWindow, { marqueeFrame: 'title', h: 90 });
      expect(f.style.height).toBe('90px');
      f.contentDocument.filled = false; post(f.contentWindow, { marqueeFrame: 'title', h: 90 });   // the unit went unfilled
      expect(f.style.height).toBe('0px');
      // The title's fit has no room for it: the frame goes, with its listener, and this title asks for no other.
      f.contentDocument.filled = true; post(f.contentWindow, { marqueeFrame: 'title', h: 90 });
      title.dispatch(NO_ROOM_EVENT);
      expect(title.children).toHaveLength(0);
      expect(handlers.size).toBe(0);
      vi.advanceTimersByTime(TITLE_DWELL_MS * 3); ads.sync();
      expect(title.children).toHaveLength(0);
      title.dispatch(NO_ROOM_EVENT);                             // nothing placed: a no-op
      // The next title looks again.
      mode = 'countdown'; ads.sync();
      mode = 'title'; ads.sync();
      vi.advanceTimersByTime(TITLE_DWELL_MS);
      f = title.children[0];
      expect(f?.tagName).toBe('iframe');
      expect(f.style.height).toBe('0px');
    } finally { vi.useRealTimers(); }
  });
  it("0142: frameFilled reads Google's verdict or a direct creative, never a reserved unit", () => {
    const d = (html) => ({ querySelector: (sel) => (html.some((h) => sel.split(', ').includes(h)) ? {} : null) });
    expect(frameFilled(d(['[data-marquee] ins.adsbygoogle[data-ad-status="filled"]']))).toBe(true);
    expect(frameFilled(d(['[data-marquee] img']))).toBe(true);
    expect(frameFilled(d([]))).toBe(false);
    expect(frameFilled(null)).toBe(false);
    expect(frameFilled({ querySelector() { throw new Error('torn down'); } })).toBe(false);
  });
  it("a short or narrow screen, where the title has no room for the banner, gets no frame at all: no ad work for an ad nobody sees (0122)", async () => {
    vi.useFakeTimers();
    try {
      const cfg = { enabled: true, slots: { title: { source: 'network' } } };
      const m = { v: 1, ready: () => Promise.resolve(cfg), interstitial: vi.fn(), rewarded: vi.fn() };
      for (const [short, n] of [[true, 0], [false, 1]]) {
        const doc = fakeDoc();
        const title = doc.createElement('section');
        const asked = [];
        const win = { marquee: m, location: { origin: 'https://mutaafaziz.com' }, addEventListener: () => {}, removeEventListener: () => {},
          matchMedia: (q) => { asked.push(q); return { matches: short }; } };
        const ads = createAds({ win, doc, mode: () => 'title' });
        ads.arm(title);
        await Promise.resolve(); await Promise.resolve();
        vi.advanceTimersByTime(TITLE_DWELL_MS);
        expect(title.children).toHaveLength(n);
        expect(asked).toEqual([TITLE_SKIP_MQ]);
      }
      expect(TITLE_SKIP_MQ).toBe('(max-height: 620px), (max-width: 360px)');   // the same query styles.css hides the banner at
    } finally { vi.useRealTimers(); }
  });
  it('frameHeight reads only its own slot and caps at the in-page 90 px', () => {
    expect(frameHeight({ marqueeFrame: 'title', h: 50.4 })).toBe(50);
    expect(frameHeight({ marqueeFrame: 'title', h: -3 })).toBe(0);
    expect(frameHeight({ marqueeFrame: 'title', h: 400 })).toBe(90);
    expect(frameHeight({ marqueeFrame: 'other', h: 50 })).toBe(null);
    expect(frameHeight({ marqueeFrame: 'title', h: 'x' })).toBe(null);
    expect(frameHeight('title')).toBe(null);
    expect(frameHeight(null)).toBe(null);
  });
  it('the ?marquee= ask is read at boot: the title rewriting the address keeps it', () => {
    const doc = fakeDoc();
    const location = { hostname: 'localhost', search: '?marquee=1' };
    const ads = createAds({ win: { location }, doc, mode: () => 'title' });
    location.search = '';   // the title's replaceState (?course=)
    ads.arm(null);
    expect(doc.head.children).toHaveLength(1);
  });
});
