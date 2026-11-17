import { test, expect } from '@playwright/test';

// 0264: a first-ever visit's title gives Jump the only loud voice. Until this device has landed a Jump (the same
// first-run test as 0247's title), the iPhone beta and Judges chips are quieter (still there, labelled, reachable, text at
// ≥ 4.5:1) and the Daily card is its one-line header with no gold "Play today's". A device that has landed sees today's title.
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1280, height: 720 } };

async function boot(page, { landed = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((landed) => {
    localStorage.setItem('coldgas_howto', 'new');   // an automated browser is otherwise a returning player
    if (landed) localStorage.setItem('coldgas_landings', '1');
  }, landed);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.waitForSelector('[data-title-extra] .xc-daily', { state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

// Everything the page shows on the title, measured: each visible control's box, its text's contrast against the darkest
// backing it can sit on (its own fill over the title's black, the conservative case for a translucent chip), and how
// "loud" its fill is (luma of the background colour × alpha).
const measure = (page) => page.evaluate(() => {
  const rgba = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
  const black = { r: 0, g: 0, b: 0 };
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  const controls = [...document.querySelectorAll('.top-actions > :is(a, button), .top-actions .more-toggle, [data-screen="title"] :is(button, a, summary)')]
    .filter((el) => vis(el) && !el.closest('.more-sheet, .fineprint'));   // the fine print's links are words in a line
  const inView = (r) => r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
  const out = controls.map((el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const bg = rgba(cs.backgroundColor), fg = rgba(cs.color);
    const back = over(bg, black), text = over(fg, back);
    const [hi, lo] = [lum(text), lum(back)].sort((a, b) => b - a);
    return {
      sel: el.matches('[data-start]') ? 'jump' : el.matches('.beta-chip') ? 'beta' : el.matches('.ai-chip') ? 'judges'
        : el.matches('[data-daily-play]') ? 'daily' : (el.getAttribute('class') || el.tagName).split(' ')[0],
      box: { x: r.x, y: r.y, w: r.width, h: r.height }, inView: inView(r),
      loud: lum(over(bg, black)), contrast: (hi + 0.05) / (lo + 0.05), border: rgba(cs.borderTopColor).a, tab: el.tabIndex >= 0,
    };
  });
  const card = document.querySelector('[data-title-extra] .xc-daily');
  return {
    flag: document.documentElement.hasAttribute('data-first-title'),
    out,
    card: card && { h: card.getBoundingClientRect().height, head: vis(card.querySelector('.xc-k')), goal: vis(card.querySelector('.xc-goal')),
      streak: vis(card.querySelector('.xc-streak')), play: vis(card.querySelector('[data-daily-play]')), label: card.getAttribute('aria-label') },
    titleTop: document.querySelector('[data-screen="title"]').getBoundingClientRect().top,
    barBottom: Math.max(...[...document.querySelectorAll('.top-actions > *')].filter(vis).map((e) => e.getBoundingClientRect().bottom)),
  };
});

const overlaps = (out) => {
  const hits = [];
  const seen = out.filter((o) => o.inView);
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
    const a = seen[i].box, b = seen[j].box;
    if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) hits.push(`${seen[i].sel} × ${seen[j].sel}`);
  }
  return hits;
};

for (const [name, ctx] of [['390x844 touch', PHONE], ['1280x720', DESKTOP]]) {
  test(`first visit, ${name}: Jump is the only loud button; the chips are quiet and legible; the Daily is one line`, async ({ browser }) => {
    const page = await browser.newPage(ctx);
    const errors = await boot(page);
    const m = await measure(page);
    expect(m.flag).toBe(true);
    const jump = m.out.find((o) => o.sel === 'jump');
    expect(jump?.inView).toBe(true);
    // The one filled button: nothing else visible above the fold has a fill a third as bright as Jump's.
    const loud = m.out.filter((o) => o.inView && o.sel !== 'jump' && o.loud > jump.loud / 3).map((o) => o.sel);
    expect(loud).toEqual([]);
    // The Daily: its header line only, no gold button, still named for a screen reader.
    expect(m.card).toMatchObject({ head: true, goal: false, streak: false, play: false });
    expect(m.card.label).toMatch(/daily/i);
    expect(m.out.some((o) => o.sel === 'daily')).toBe(false);
    // The chips stay (beta on the title, Judges), labelled, reachable by Tab, their text ≥ 4.5:1, and quieter than a
    // returning player's (measured below in the same test): no brighter edge.
    for (const sel of ['beta', 'judges']) {
      const c = m.out.find((o) => o.sel === sel);
      expect(c, sel).toBeTruthy();
      expect(c.tab, sel).toBe(true);
      expect(c.contrast, sel).toBeGreaterThanOrEqual(4.5);
    }
    expect(overlaps(m.out)).toEqual([]);
    expect(m.titleTop).toBeGreaterThanOrEqual(m.barBottom - 1);   // the title never rises under the top bar

    const back = await browser.newPage(ctx);
    const errors2 = await boot(back, { landed: true });
    const r = await measure(back);
    expect(r.flag).toBe(false);
    expect(r.card).toMatchObject({ head: true, goal: true, play: true });
    for (const sel of ['beta', 'judges']) {
      const q = m.out.find((o) => o.sel === sel), full = r.out.find((o) => o.sel === sel);
      expect(q.border, sel).toBeLessThan(full.border);
      expect(q.box.h, sel).toBeLessThanOrEqual(full.box.h);
    }
    expect(errors).toEqual([]);
    expect(errors2).toEqual([]);
    await page.close();
    await back.close();
  });
}

test('first visit: the first landing gives back today’s title, Play today’s and all', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  await expect(page.locator('[data-daily-play]')).toBeHidden();
  // A landing recorded by the funnel (as the results do), then home: the title is today's.
  await page.evaluate(() => { const f = window.__coldgas.funnel; f.jumpEnd(f.jumpStart('show', 'assist'), { course: 'show', tier: 'assist', landed: true, score: 90 }); });
  await page.evaluate(() => window.__coldgas.toTitle());
  await expect(page.locator('[data-daily-play]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-first-title'))).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
});
