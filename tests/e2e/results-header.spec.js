import { test, expect } from '@playwright/test';

// Ticket 0111: the results header holds its lines on a narrow phone. At 360 px and under, `/ 100` broke
// from its number and `Perfect 10` broke at its space (the flex row let both children wrap). One flight
// (the Show reference, fast-forwarded) on a touch page at DPR 2, then the page is resized through the
// sizes and the verdict set to each string the judge can give: only the DOM is read, so the canvas isn't
// drawn. Every verdict src/sim/judge.js gives and every drill headline src/practice.js gives is set as text
// (the header lays out text), and a sheet as narrow as a book fold's half (364 px) is checked on a wide screen:
// the row wraps by its own width, not the viewport's.
test.slow();   // a boot and a whole flight on software GL

const PHONES = [[320, 568], [344, 882], [360, 748], [360, 380], [375, 667], [390, 844]];
const WIDE = [[1440, 900], [1280, 720], [844, 390]];
const ONE_LINE = ['Perfect 10', 'Wrecked', 'Stuck it', 'Clean', 'Contact', 'Crash', 'Rolled over', 'No climb', 'Survived',
  'Soft', 'Firm', 'Hard', 'Over the row', 'On the roofs'];
const TWO_LINES = ['Came down on the deck', 'Over, with room to spare', 'Stalled on the wall', 'Fell off the wall', 'Short of the row', 'Rough landing'];
// Where the reference's header fit side by side before 0111, it still does (verdict and total on one line).
const SIDE_BY_SIDE = new Set(['390x844', '1440x900', '1280x720', '844x390']);

function measure(text) {
  const v = document.querySelector('[data-r-verdict]'), total = document.querySelector('.total');
  if (text != null) v.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(v);
  const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const span = total.querySelector('span'), b = total.querySelector('b');
  return {
    text: v.textContent, lines, verdict: box(v), total: box(total), num: box(b), unit: box(span),
    unitRects: span.getClientRects().length,
    verdictPx: parseFloat(getComputedStyle(v).fontSize), totalPx: parseFloat(getComputedStyle(b).fontSize),
    contentR: (() => { const sh = document.querySelector('.results .sheet'); return sh.getBoundingClientRect().right - parseFloat(getComputedStyle(sh).paddingRight); })(),
  };
}
const disjoint = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;

test('the score and the verdict hold their lines from 320 px up', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre
  await page.goto('/coldgas/?gfx=low');
  // (physicsReady is a function: wait on it, docs/LESSONS.md.)
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { const G = window.__coldgas; G.stage.render = () => {}; G.startRun('reveal'); G.skipCountdown(); G.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  // The total rolls up over 1.4 s: measure the number it lands on.
  await page.waitForFunction(() => document.querySelector('[data-r-total]').textContent === window.__coldgas.S.card.total.toFixed(1), null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__coldgas.S.card.verdict)).toBe('Perfect 10');

  const check = async (size, sheetWidth) => {
    await page.evaluate((w) => { document.querySelector('.results .sheet').style.width = w; }, sheetWidth);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    for (const text of [...ONE_LINE, ...TWO_LINES]) {
      const m = await page.evaluate(measure, text);
      const at = `${size}${sheetWidth ? ` sheet ${sheetWidth}` : ''} "${text}": ${JSON.stringify(m)}`;
      // `/ 100` is one piece, beside its number (its top above the number's bottom), never under it.
      expect(m.unitRects, at).toBe(1);
      expect(m.unit.t, at).toBeLessThan(m.num.b);
      expect(m.unit.l, at).toBeGreaterThanOrEqual(m.num.r);
      expect(m.lines, at).toBeLessThanOrEqual(TWO_LINES.includes(text) ? 2 : 1);
      expect(disjoint(m.verdict, m.total), at).toBe(true);
      // Inside the sheet's content box, and legible.
      expect(m.total.r, at).toBeLessThanOrEqual(m.contentR + 0.5);
      expect(m.verdict.r, at).toBeLessThanOrEqual(m.contentR + 0.5);
      expect(m.verdictPx, at).toBeGreaterThanOrEqual(18);
      expect(m.totalPx, at).toBeGreaterThanOrEqual(44);
      if (text === 'Perfect 10' && !sheetWidth && SIDE_BY_SIDE.has(size)) expect(m.total.t, at).toBeLessThan(m.verdict.b);
    }
  };
  for (const [width, height] of [...PHONES, ...WIDE]) {
    await page.setViewportSize({ width, height });
    await check(`${width}x${height}`, '');
  }
  await check('1280x720', '364px');   // the book fold half-open: the results on one 364 px segment
  await page.evaluate(() => { document.querySelector('.results .sheet').style.width = ''; });
  expect(errors).toEqual([]);
  await page.close();
});
