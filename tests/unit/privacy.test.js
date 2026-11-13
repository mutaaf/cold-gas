// 0155: the privacy page says what production does. Two halves:
// - the page never gets the zone's analytics beacon: every spelling of its path carries
//   `Cache-Control: no-transform` in dist/_headers (Cloudflare injects nothing into a no-transform answer);
// - its words match the code: while src/ads.js loads Marquee's loader on the web, the page names the web
//   game's ads (who serves them, menus and results, never in a run) and never says "no ads" of the web game;
//   and with the beacon gone it no longer names a page-analytics service.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEADERS } from '../../scripts/static-headers.mjs';

// Parse a _headers file into [{ pattern, headers }] the way Workers Static Assets reads it.
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { rules.push({ pattern: line.trim(), headers: {} }); continue; }
    const [k, ...v] = line.trim().split(':');
    rules.at(-1).headers[k.trim().toLowerCase()] = v.join(':').trim();
  }
  return rules;
}
const matches = (pattern, path) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(path);
const cacheControlFor = (path) => parseHeaders(HEADERS).filter((r) => matches(r.pattern, path)).map((r) => r.headers['cache-control']).filter(Boolean);

const page = readFileSync(new URL('../../public/privacy/index.html', import.meta.url), 'utf8');
const text = page.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const sentences = text.split(/(?<=[.!?])\s+/);
const adsSrc = readFileSync(new URL('../../src/ads.js', import.meta.url), 'utf8');

describe('the privacy page (0155)', () => {
  it('every spelling of its path is served no-transform, so no analytics beacon is injected', () => {
    for (const path of ['/coldgas/privacy', '/coldgas/privacy/', '/coldgas/privacy/index.html']) {
      const cc = cacheControlFor(path);
      expect(cc, path).toHaveLength(1);
      expect(cc[0], path).toMatch(/\bno-transform\b/);
      expect(cc[0], path).toMatch(/must-revalidate/);
    }
  });

  it('the game page keeps its no-transform rule', () => {
    for (const path of ['/coldgas/', '/coldgas/index.html']) expect(cacheControlFor(path).join()).toMatch(/\bno-transform\b/);
  });

  it('loads nothing from another host', () => {
    expect(page).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)="(https?:)?\/\//i);
  });

  it('names the web game\'s ads while src/ads.js loads the loader, and never says "no ads" of the web game', () => {
    expect(adsSrc).toContain("'/ads/v1/ads.js'");   // the condition this check stands on
    expect(text).toMatch(/web game shows ads from Google/);
    expect(text).toMatch(/menus and results, never during a run/);
    expect(text).toMatch(/rewarded ad plays only when you ask/i);
    for (const s of sentences.filter((x) => /\bno ads\b/i.test(x))) expect(s, s).toMatch(/iPhone app/);
  });

  it('names the web\'s usage analytics while the pages load Box Office, and keeps the iPhone app out of it', () => {
    const game = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(game).toContain("'/boxoffice/v1/insights.js'");   // the condition this check stands on
    expect(page).toContain('<script async src="/boxoffice/v1/insights.js"></script>');
    expect(text).toMatch(/anonymous usage analytics to PostHog, through our own relay at mutaafaziz\.com/);
    expect(text).toMatch(/approximate, city-level location/);
    expect(text).toMatch(/Session replays/);
    expect(text).toMatch(/Global Privacy Control or Do Not Track, none of this loads/);
    expect(text).toMatch(/None of it is in the iPhone app/);
  });

  it('no longer names a page-analytics service, now that none runs on our pages', () => {
    expect(text).not.toMatch(/Web Analytics|page analytics|analytics counts/i);
    expect(text).toMatch(/nothing from it goes to an advertising network, an analytics company or a data broker/);
  });
});
