import { test, expect, devices } from '@playwright/test';

// 0266 · on a real iPhone's Safari viewport the title's Daily says what it asks. Safari hands an iPhone 13 a 390×664 page
// (its toolbars subtracted), where the title packs the card (fit level 1 or 2): the goal used to be one ellipsised line beside
// "Play today's" and read "Roll t…". Packed, it now wraps beside its button, never cut. Every objective src/daily.js emits over
// 30 days (US units, the longest; one thumb and two thumbs, whose Lineup goal differs, 0218) is checked whole at each size,
// with Jump and the card on screen and nothing under the top bar. A first visit (0264) shows the Daily's header alone.
test.slow();

const SIZES = {
  'iPhone 13 (390x664)': { ...devices['iPhone 13'] },
  '393x659': { viewport: { width: 393, height: 659 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  '430x932': { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  '390x844': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
};
const START = Date.parse('2026-11-19T15:00:00Z');

async function boot(browser, baseURL, view, landed) {
  const ctx = await browser.newContext({ baseURL, ...view });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(START));
  await page.addInitScript((landed) => {
    localStorage.setItem('coldgas.units', 'us');
    if (landed) localStorage.setItem('coldgas_landings', '1');
    else localStorage.setItem('coldgas_howto', 'new');   // an automated browser is otherwise a returning player
  }, landed);
  await page.route('**/coldgas/api/**', (r) => r.abort());
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 90_000 });
  await page.waitForSelector('[data-title-extra] .xc-daily', { state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);   // past the title's rise-in
  return { ctx, page, errors };
}

// The card as drawn: its goal (whole or cut), Jump's and the card's boxes, and the title's top against the top bar's foot.
const read = (page) => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const t = document.querySelector('.title'), card = t.querySelector('.xc-daily'), g = card.querySelector('.xc-goal');
  const cs = getComputedStyle(g), j = document.querySelector('[data-start]').getBoundingClientRect(), c = card.getBoundingClientRect();
  let top = Infinity;
  for (const k of t.children) if (k.offsetHeight > 1 && getComputedStyle(k).display !== 'none') top = Math.min(top, k.getBoundingClientRect().top);
  let bar = 0;
  for (const e of document.querySelectorAll('.top .brand, .top-actions')) { const r = e.getBoundingClientRect(); if (r.height > 1) bar = Math.max(bar, r.bottom); }
  res({
    fit: t.dataset.extraFit ?? '', goal: g.offsetHeight > 0 ? g.textContent : '',
    cut: g.scrollWidth > g.clientWidth + 0.5 || g.scrollHeight > g.clientHeight + 0.5 || (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap'),
    jumpIn: j.top >= 0 && j.bottom <= innerHeight + 0.5 && j.left >= 0 && j.right <= innerWidth + 0.5,
    cardIn: c.top >= 0 && c.bottom <= innerHeight + 0.5 && c.right <= innerWidth + 0.5,
    underBar: top < bar,
  });
}))));

for (const [name, view] of Object.entries(SIZES)) {
  test(`0266: ${name}: every Daily's goal is whole on the title, Jump on screen`, async ({ browser, baseURL }) => {
    const { ctx, page, errors } = await boot(browser, baseURL, view, true);
    const seen = new Set();
    for (const scheme of ['thumb', 'classic']) {
      await page.evaluate((s) => window.__coldgas.touch.set('scheme', s), scheme);
      for (let d = 0; d < 30; d++) {
        await page.clock.setFixedTime(new Date(START + d * 86_400_000));
        await page.evaluate(() => window.__coldgas.comeback.render());
        const r = await read(page);
        const day = `${name} ${scheme} day +${d}`;
        expect(r.fit, `${day}: the card stays`).not.toBe('3');
        expect(r.goal, `${day}: the goal is shown`).not.toBe('');
        expect(r.cut, `${day}: "${r.goal}" is cut (fit ${r.fit || 0})`).toBe(false);
        expect(r.jumpIn, `${day}: Jump on screen`).toBe(true);
        expect(r.cardIn, `${day}: the card on screen`).toBe(true);
        expect(r.underBar, `${day}: nothing under the top bar`).toBe(false);
        seen.add(r.goal);
      }
    }
    expect(seen.size, 'every objective was shown').toBeGreaterThanOrEqual(10);
    expect(errors).toEqual([]);
    await ctx.close();
  });
}

test('0266: a first visit shows the Daily as its header line, Jump on screen, at the Safari sizes', async ({ browser, baseURL }) => {
  for (const name of ['iPhone 13 (390x664)', '393x659']) {
    const { ctx, page, errors } = await boot(browser, baseURL, SIZES[name], false);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-first-title')), name).toBe(true);
    const r = await read(page);
    expect(r.goal, `${name}: the first visit's card is its header alone (0264)`).toBe('');
    expect(r.jumpIn, `${name}: Jump on screen`).toBe(true);
    expect(r.underBar, `${name}: nothing under the top bar`).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
