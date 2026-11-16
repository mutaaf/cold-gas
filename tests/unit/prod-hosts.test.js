// 0262: the verdict behind scripts/prod-hosts.mjs. The logs are the critic's production recordings
// (docs/critique/2026-11-14-0955/phone-title-requests.jsonl and 2026-11-14-1535/phone-jump-requests.jsonl),
// reshaped into the probe's entries: each request's frame chain, innermost first, up to the game's page.
import { describe, it, expect } from 'vitest';
import { verdict, judge, isGoogleAd, isAds, modeAt, line, sawRun, framePlaced, pickInitiators, UNLOAD_GRACE_MS } from '../../scripts/lib/prod-hosts.mjs';

const PAGE = 'https://mutaafaziz.com/coldgas/';
const ADS = 'https://mutaafaziz.com/ads/v1/frame.html?app=coldgas&slot=title';
const GAD = 'https://googleads.g.doubleclick.net/pagead/ads?client=x';
const main = [PAGE], inAds = [ADS, PAGE], inGoogle = [GAD, ADS, PAGE];
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d8730179';
const s = (x) => Math.round(x * 1000);

// 2026-11-14 09:55, 390×844 touch, first visit, no input: the title with its slot frame.
const phoneTitle = () => [
  { t: s(12.9), url: 'https://mutaafaziz.com/ads/v1/ads.js', frames: main, mode: 'title' },
  { t: s(12.9), url: 'https://mutaafaziz.com/ads/api/config', frames: main, initiators: ['https://mutaafaziz.com/ads/v1/ads.js'], mode: 'title' },
  { t: s(17.6), url: ADS, frames: ['', PAGE], mode: 'title' },
  { t: s(17.7), url: BEACON, frames: inAds, mode: 'title' },
  { t: s(18.0), url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', frames: inAds, mode: 'title' },
  { t: s(18.4), url: 'https://mutaafaziz.com/cdn-cgi/challenge-platform/scripts/jsd/main.js', frames: ['about:blank', PAGE], mode: 'title' },
  { t: s(18.7), url: 'https://googleads.g.doubleclick.net/pagead/ads', frames: ['', ADS, PAGE], mode: 'title' },
  { t: s(19.1), url: 'https://ep1.adtrafficquality.google/getconfig/sodar', frames: inAds, mode: 'title' },
  { t: s(19.1), url: 'https://mutaafaziz.com/cdn-cgi/rum', frames: inAds, mode: 'title' },
  { t: s(19.8), url: 'https://www.google.com/recaptcha/api2/aframe', frames: inGoogle, mode: 'title' },
  { t: s(23.5), url: 'https://ep1.adtrafficquality.google/pagead/sodar', frames: inAds, mode: 'title' },
  { t: s(23.6), url: 'data:image/png;base64,AAAA', frames: inGoogle, mode: 'title' },
];

describe('scripts/lib/prod-hosts.mjs (0262)', () => {
  it("fails today's production title, and names Cloudflare's beacon in the /ads/ frame", () => {
    const v = verdict(phoneTitle());
    expect(v.ok).toBe(false);
    expect(v.bad).toHaveLength(1);
    expect(v.bad[0].e.url).toBe(BEACON);
    expect(v.bad[0].why).toMatch(/static\.cloudflareinsights\.com/);
    expect(line(v.bad[0].e, v.bad[0].why)).toMatch(/static\.cloudflareinsights\.com\s+mutaafaziz\.com\/ads\/v1\/frame\.html\s+title\s+FAIL/);
  });

  it("passes the same log with the beacon line removed: Google's ad hosts from the /ads/ frame are allowed", () => {
    const v = verdict(phoneTitle().filter((e) => e.url !== BEACON));
    expect(v).toEqual({ ok: true, bad: [] });
  });

  it("fails Google's ad hosts requested by the game page's own frame, unless an /ads/ script started them", () => {
    const own = { t: 1, url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', frames: main, mode: 'title' };
    expect(judge(own)).toMatch(/outside a Marquee/);
    // The breaks (postrun, reroll) stay in the page (§3.3): the loader's own scripts may call Google from it.
    expect(judge({ ...own, initiators: ['https://mutaafaziz.com/ads/v1/ads.js'] })).toBeNull();
    expect(judge({ ...own, initiators: ['https://mutaafaziz.com/coldgas/assets/index-x.js'] })).toMatch(/outside a Marquee/);
  });

  it('fails any third party in countdown or live, and allows the /ads/ frame\'s unload as the Jump removes it', () => {
    const jump = s(45.99);
    const timeline = [[s(1.09), 'title'], [jump, 'countdown'], [s(49.5), 'live'], [s(70), 'results']];
    const ad = (t) => ({ t, url: 'https://ep1.adtrafficquality.google/pagead/sodar', frames: inAds, mode: modeAt(timeline, t) });
    expect(modeAt(timeline, s(46.05))).toBe('countdown');
    expect(verdict([ad(jump + 60)], { timeline }).ok).toBe(true);                 // the unload, 60 ms after the Jump
    expect(verdict([ad(jump + UNLOAD_GRACE_MS + 1)], { timeline }).bad[0].why).toMatch(/during the run \(countdown\)/);
    expect(verdict([ad(s(55))], { timeline }).bad[0].why).toMatch(/during the run \(live\)/);
    expect(verdict([ad(s(71))], { timeline }).ok).toBe(true);                     // back on the results: the ads' place
    // Own origin in a run is fine (the game's API, the relay); a foreign host is never fine, in or out of a run.
    expect(verdict([{ t: s(55), url: 'https://mutaafaziz.com/coldgas/api/scores', frames: main, mode: 'live' }], { timeline }).ok).toBe(true);
    expect(judge({ t: jump + 10, url: BEACON, frames: inAds, mode: 'countdown' }, { timeline })).toMatch(/not allowed/);
  });

  it('knows the hosts §3.3 names, and nothing that merely looks like them', () => {
    for (const u of ['https://pagead2.googlesyndication.com/x', 'https://tpc.googlesyndication.com/x', 'https://googleads.g.doubleclick.net/x',
      'https://ep2.adtrafficquality.google/x', 'https://www.google.com/recaptcha/api2/aframe']) expect(isGoogleAd(u)).toBe(true);
    for (const u of ['https://www.google.com/search?q=x', 'https://evil-doubleclick.net/x', 'https://googlesyndication.com.evil.io/x',
      'https://static.cloudflareinsights.com/beacon.min.js', 'https://us.i.posthog.com/e/']) expect(isGoogleAd(u)).toBe(false);
    expect(isAds(ADS)).toBe(true);
    expect(isAds('https://mutaafaziz.com/coldgas/ads/x')).toBe(false);
    expect(isAds('https://evil.example/ads/v1/frame.html')).toBe(false);
  });

  it('fails any other foreign host from the game page, and the grace never covers a Retry or the in-page loader', () => {
    expect(judge({ t: 1, url: 'https://us.i.posthog.com/e/', frames: main, mode: 'title' })).toMatch(/us\.i\.posthog\.com is not allowed/);
    const timeline = [[0, 'title'], [s(40), 'countdown'], [s(43), 'live'], [s(60), 'results'], [s(70), 'countdown'], [s(73), 'live']];
    const gad = 'https://pagead2.googlesyndication.com/pagead/sodar';
    // A Retry from the results (the interstitial's place): 100 ms in is already the run.
    expect(judge({ t: s(70) + 100, url: gad, frames: inAds, mode: 'countdown' }, { timeline })).toMatch(/during the run/);
    // At the Jump from the title, only the /ads/ frame's own request is its unload; the page's loader is not.
    expect(judge({ t: s(40) + 100, url: gad, frames: inAds, mode: 'countdown' }, { timeline })).toBeNull();
    expect(judge({ t: s(40) + 100, url: gad, frames: main, initiators: ['https://mutaafaziz.com/ads/v1/ads.js'], mode: 'countdown' }, { timeline })).toMatch(/during the run/);
    // A recording with no mode at all is a recording that missed the run: sawRun says so (the probe exits 2).
    expect(judge({ t: 5, url: gad, frames: inAds, mode: undefined }, { timeline: [] })).toBeNull();
    expect(sawRun([])).toBe(false);
    expect(sawRun([[0, 'title'], [1, 'countdown'], [2, 'live']])).toBe(false);
    expect(sawRun(timeline)).toBe(true);
  });

  it("never lends the game page Marquee's initiators for a URL both of them request", () => {
    const u = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
    const seen = [{ doc: ADS, urls: ['https://mutaafaziz.com/ads/v1/ads.js'] }, { doc: PAGE, urls: ['https://mutaafaziz.com/coldgas/assets/index-x.js'] }];
    const pageReq = { t: 1, url: u, frames: main, initiators: pickInitiators(seen, PAGE), mode: 'title' };
    expect(judge(pageReq)).toMatch(/outside a Marquee/);
    expect(pickInitiators(seen, ADS)).toEqual(['https://mutaafaziz.com/ads/v1/ads.js']);
    expect(pickInitiators(seen, 'about:blank')).toEqual([]);                 // no document of its own: only what all agree on
    expect(pickInitiators([seen[0], seen[0]], '')).toEqual(['https://mutaafaziz.com/ads/v1/ads.js']);
    expect(pickInitiators(undefined, PAGE)).toEqual([]);
  });

  it("calls a title that never placed Marquee's slot frame inconclusive, not clean", () => {
    expect(framePlaced(phoneTitle())).toBe(true);
    const slow = phoneTitle().filter((e) => !e.frames.includes(ADS) && e.url !== ADS);
    expect(verdict(slow).ok).toBe(true);
    expect(framePlaced(slow)).toBe(false);
    expect(framePlaced([{ ...phoneTitle()[2], mode: 'countdown' }])).toBe(false);   // placed only once the run began: no
  });

  it('reads a new frame in its line, and takes /recaptcha only as a path', () => {
    expect(line({ t: 18700, url: 'https://googleads.g.doubleclick.net/pagead/ads', frames: ['', ADS, PAGE], mode: 'title' })).toMatch(/googleads\.g\.doubleclick\.net\s+\(new frame\)\s+title\s+ok/);
    expect(isGoogleAd('https://www.google.com/recaptchaX/y')).toBe(false);
    expect(isGoogleAd('https://www.google.com/recaptcha')).toBe(true);
  });
});
