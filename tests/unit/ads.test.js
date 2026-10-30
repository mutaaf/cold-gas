import { describe, it, expect, vi } from 'vitest';
import { wantLoader, canFill, postrunDue, createAds, SLOTS } from '../../src/ads.js';

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
});
