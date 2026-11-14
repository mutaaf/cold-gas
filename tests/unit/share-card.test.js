import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareFacts, shareText, inviteText, printedAddress, shareRun } from '../../src/share-card.js';
import { setUnits } from '../../src/units.js';

// The share card's words (0081): three numbers per event, in the player's primary units, and a
// text line that names the score, the verdict and the event.
const show = { total: 94, verdict: 'Perfect 10', tier: 'assist',
  facts: { course: 'show', height: 26.9, invertedS: 1.4, jumped: true, crossedRow: true, contact: false, clearance: 5.1, sink: 0.8 } };

describe('share card', () => {
  afterEach(() => setUnits('us', { persist: false }));

  it('the Show: the wall, the roofs, the touchdown', () => {
    expect(shareFacts(show)).toEqual([['Up the wall', '88 ft'], ['Over the roofs', '17 ft'], ['Touchdown', '2.6 ft/s']]);
    setUnits('metric', { persist: false });
    expect(shareFacts(show)).toEqual([['Up the wall', '26.9 m'], ['Over the roofs', '5.1 m'], ['Touchdown', '0.8 m/s']]);
  });

  it('short of the row or no climb: what happened, never a clearance it did not have', () => {
    const short = { ...show, facts: { ...show.facts, crossedRow: false } };
    expect(shareFacts(short)[1]).toEqual(['Inverted', '1.4 s']);
    const none = { ...show, facts: { course: 'show', height: 0, invertedS: 0, jumped: false, maxG: 1 } };
    expect(shareFacts(none)).toEqual([['Up the wall', '0 ft'], ['Inverted', '0 s'], ['Peak', '1 g']]);
  });

  it('the Lineup: roll, apex, touchdown', () => {
    const lineup = { total: 80, verdict: 'Clean', facts: { course: 'lineup', rollDeg: 360, apex: 6.2, sink: 1.1 } };
    expect(shareFacts(lineup)).toEqual([['Roll', '360°'], ['Apex', '20 ft'], ['Touchdown', '3.6 ft/s']]);
  });

  it('the text names the score, verdict and event, with no URL (the share sheet carries it)', () => {
    expect(shareText(show)).toBe('COLD GAS 94.0: Perfect 10 on The Show. Up the wall 88 ft · Over the roofs 17 ft · Touchdown 2.6 ft/s.');
  });

  it('a link that carries the run (#vs=) is a dare with the stunt (0260); the plain address keeps the summary', () => {
    expect(inviteText(show, 'https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=zAbC')).toBe('Beat my 94.0 on The Show · over the row');
    const wreck = { ...show, total: 12, verdict: 'Contact', facts: { ...show.facts, crashed: true } };
    expect(inviteText(wreck, 'https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=zAbC')).toBe('The Show · into the row, 12.0. Can you land it?');
    expect(inviteText(show, 'https://mutaafaziz.com/coldgas/')).toBe(shareText(show));
  });

  it('prints the challenge itself at the card\'s foot, short (0260)', () => {
    expect(printedAddress('https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=zAbCdEfGhIjKlMnOp')).toBe('mutaafaziz.com/coldgas/#vs=zAbCdEfGhI…');
    expect(printedAddress('https://mutaafaziz.com/coldgas/')).toBe('mutaafaziz.com/coldgas');
  });
});

// The install surface: the manifest's fields and the head's tags, read from the files that ship.
describe('install files', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const html = readFileSync('index.html', 'utf8');

  it('the manifest stays relative to the base path and names the game', () => {
    expect(m).toMatchObject({ name: 'COLD GAS', short_name: 'COLD GAS', start_url: './', scope: './', id: './', display: 'fullscreen',
      background_color: '#05070c', theme_color: '#05070c', orientation: 'any' });
    const urls = [...m.icons, ...m.screenshots, ...m.shortcuts.flatMap((s) => [{ src: s.url }, ...s.icons])].map((i) => i.src);
    for (const u of urls) expect(u, u).not.toMatch(/^\/|^https?:/);
    expect(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'any' && i.sizes === '512x512')).toBe(true);
    expect(m.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'narrow', 'wide', 'wide']);
  });

  it('every shortcut is a deep link the game keeps (AGENTS.md §4)', () => {
    for (const s of m.shortcuts) expect(s.url).toMatch(/^\.\/\?(play=(jump|reveal)|drive=(stelvio|transfagarasan|bigsur|atlantic|sandbox|endless))$/);
  });

  it('the head links the manifest and the icons relatively, and previews absolutely', () => {
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon.png" />');
    expect(html).toContain('content="%VITE_CG_SITE%og.png"');
    expect(html).toMatch(/<html lang="en" style="background:#05070c">/);
  });
});

// Without a share sheet the link is copied at once: the copy never uses the card, so it must not wait for one (a slow
// phone's render, a stalled favicon, the JPEG encode) and spend the tap's activation that the clipboard asks for.
// Main went red on 2026-11-14 when the card outlasted install.spec's 5 s on a slow software-GL runner.
describe('shareRun without a share sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubPage({ share } = {}) {
    const copied = [], toasts = [];
    const el = { setAttribute() {}, classList: { add() {}, remove() {} }, set textContent(v) { toasts.push(v); } };
    let made = null;
    vi.stubGlobal('document', { querySelector: () => made, createElement: () => (made = el), body: { appendChild() {} } });
    vi.stubGlobal('location', { origin: 'https://example.test' });
    vi.stubGlobal('navigator', { ...(share ? { share } : {}), clipboard: { writeText: async (t) => { copied.push(t); } } });
    return { copied, toasts };
  }

  it('copies the link and says so while the card is still drawing', async () => {
    const { copied, toasts } = stubPage();
    const never = new Promise(() => {});
    const via = await Promise.race([shareRun({ card: show, url: 'https://example.test/coldgas/', cardPromise: never }),
      new Promise((r) => setTimeout(() => r('waited for the card'), 200))]);
    expect(via).toBe('copy');
    expect(toasts).toEqual(['Link copied']);
    expect(copied).toEqual([`${shareText(show)} https://example.test/coldgas/`]);
  });

  it('a challenge link still copies as a challenge', async () => {
    const { toasts } = stubPage();
    const via = await Promise.race([shareRun({ card: show, url: Promise.resolve('https://example.test/coldgas/#vs=abc'), cardPromise: new Promise(() => {}) }),
      new Promise((r) => setTimeout(() => r('waited for the card'), 200))]);
    expect(via).toBe('copy');
    expect(toasts).toEqual(['Challenge link copied']);
  });

  it('with a share sheet the card is still awaited and sent as a file', async () => {
    const sent = [];
    stubPage({ share: async (d) => { sent.push(d); } });
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true });
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    expect(await shareRun({ card: show, url: 'https://example.test/coldgas/', cardPromise: Promise.resolve(blob) })).toBe('file');
    expect(sent[0].files?.[0]?.type).toBe('image/jpeg');
  });
});
