import { test, expect } from '@playwright/test';

// 0181: on a phone the Lineup flies the one-thumb pad, as the Show and the Wall do. Before, the title said
// "Controls · One-thumb" and the run (and the how-to card) dropped to two thumbs. With the Lineup picked at 390×844
// touch the label, the how-to card and the live overlay name the same scheme, and a thumb held on the pad from Go
// drives, lifts at the line, rolls 360° and lands on its own (src/onethumb.js).
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

// The phone page is a fixture-free newPage: it is closed in afterEach, or its live game keeps rendering in the worker's
// browser for the rest of the shard (on #292 that doubled e2e 3/4 and timed out obs.spec.js).
let page;
test.afterEach(async () => { await page?.close(); page = null; });

test('the Lineup on a phone: the title, the how-to card and the run all fly one thumb, and a held thumb lands it', async ({ browser }) => {
  test.slow();
  page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; window.__coldgas.setTier('assist'); });
  await page.locator('.courses [data-course="lineup"]').tap();
  await expect(page.locator('.courses [data-course="lineup"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-controls-label]').first()).toHaveText('One-thumb');
  // The how-to card (from the title) says the same, in the Lineup's own steps.
  await page.locator('.cta [data-howto-open]').tap();
  await expect(page.locator('[data-howto-device]')).toHaveText('Touch · one thumb');
  const rows = page.locator('[data-howto-rows] li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(/drives you down the runway/i);
  await expect(rows.nth(1)).toContainText(/lifts you over the row and rolls 360°/i);
  await page.locator('[data-howto-go]').tap();
  await expect(page.locator('[data-screen="howto"]')).toBeHidden();
  // The run: one thumb on the pad, held from Go.
  const out = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.startRun('jump'); g.skipCountdown();
    const scheme = document.querySelector('[data-touch]').dataset.scheme;
    const words = new Set();
    const read = () => words.add(document.querySelector('[data-thumb-act]').textContent);
    g.thumb.down();
    for (let i = 0; i < 4000 && S.mode === 'live' && !S.card; i++) { g.liveStep(0.05); read(); }
    return { scheme, course: S.run?.course, verdict: S.card?.verdict, roll: S.card?.facts?.rollDeg, miss: S.card?.facts?.padMiss, words: [...words] };
  });
  expect(out.course).toBe('lineup');
  expect(out.scheme).toBe('thumb');
  expect(out.words).toEqual(expect.arrayContaining(['Drive', 'Lifting', 'Rolling', 'Aim']));
  expect(out.verdict).toMatch(/Stuck it|Perfect 10/);
  expect(out.roll).toBeGreaterThanOrEqual(330);
  expect(out.miss).toBeLessThan(3.5);
  expect(errors).toEqual([]);
});

// 0191: the thumb picks the trick. Held and slid up on the run-up, the pad names the call ("Two turns · Drive"; before it,
// "↑ for 720") and the car flies two turns; the results card reads the 720.
test('the Lineup on a phone: slid up on the run-up, the pad calls two turns and the car rolls 720°', async ({ browser }) => {
  test.slow();
  page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; window.__coldgas.setTier('assist'); });
  await page.locator('.courses [data-course="lineup"]').tap();
  await expect(page.locator('.courses [data-course="lineup"]')).toHaveAttribute('aria-checked', 'true');
  const out = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.startRun('jump'); g.skipCountdown();
    const verbs = new Set();
    const read = () => verbs.add(`${document.querySelector('[data-thumb-verb]').textContent} · ${document.querySelector('[data-thumb-act]').textContent}`);
    g.thumb.down();
    g.liveStep(0.05); read();
    g.thumb.move(0, 48);   // a full slide up the glass
    for (let i = 0; i < 4000 && S.mode === 'live' && !S.card; i++) { g.liveStep(0.05); read(); }
    return { course: S.run?.course, verdict: S.card?.verdict, roll: S.card?.facts?.rollDeg, verbs: [...verbs] };
  });
  expect(out.course).toBe('lineup');
  expect(out.verbs).toEqual(expect.arrayContaining(['↑ for 720 · Drive', 'Two turns · Drive']));
  expect(out.verdict).toMatch(/Stuck it|Perfect 10/);
  expect(out.roll).toBeGreaterThanOrEqual(700);
  expect(errors).toEqual([]);
});
