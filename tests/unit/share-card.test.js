import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareFacts, shareText } from '../../src/share-card.js';
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
