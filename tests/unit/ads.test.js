import { describe, it, expect, vi } from 'vitest';
import { wantLoader, canFill, postrunDue, createAds, mayStartAds, SLOTS } from '../../src/ads.js';

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
    const node = (tag) => ({ tagName: tag, dataset: {}, children: [], parent: null,
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      querySelector(sel) { return sel === '[data-marquee]' ? this.children.find((c) => c.dataset.marquee) || null : null; } });
    return { head: node('head'), createElement: node };
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
  it('the title banner exists only while the title shows; a config that resolves in a run places nothing (0117)', async () => {
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
    expect(title.children).toHaveLength(0);           // no slot for a hidden title: no ad request
    mode = 'live'; ads.sync();
    expect(title.children).toHaveLength(0);
    mode = 'results'; ads.sync();
    expect(title.children).toHaveLength(0);
    mode = 'title'; ads.sync();
    expect(title.children).toHaveLength(1);           // asked on the next title
    const first = title.children[0];
    expect(first.dataset.marquee).toBe('title');
    mode = 'countdown'; ads.sync();
    expect(title.children).toHaveLength(0);           // taken out when the title goes
    mode = 'title'; ads.sync();
    expect(title.children).toHaveLength(1);
    expect(title.children[0]).not.toBe(first);         // a fresh slot: Marquee fills each element once
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
