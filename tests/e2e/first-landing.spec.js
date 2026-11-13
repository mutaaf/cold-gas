import { test, expect } from '@playwright/test';

// Ticket 0199: the first landing is a moment, not a form. A landed run of the player's own gets its beat over the
// live scene (the verdict, the score counting up to the card's total, the judges' three cards going up), then the
// sheet; a tap skips it. A player's first runs get the calm sheet: verdict, score, medal, the next run's line and
// Retry, with everything else under More. Runs are stepped from the test (liveStep), the clean run is the reference
// autopilot handed back to the "player" as the run ends (as coach-onboarding.spec.js does), the crash is full
// throttle at the Wall with no release. Only the DOM and S.card are read: the numbers on screen must be the card's.
test.describe.configure({ mode: 'parallel' });
test.slow();

const phone = (browser, opts = {}) => browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...opts });

async function boot(page, { firstVisit = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // An automated browser counts as a returning player; this one is new (once: a reload keeps what it set).
  if (firstVisit) await page.addInitScript(() => { if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new'); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}

// Fly to the card, hand the run to the player, then step the live clock (the aftermath and the beat) to each of
// `marks` (s from the card) and read the beat there; `tap`: click the beat right after the last mark. The page's own
// frames then leave the live clock alone (S.holdLive) until the run is over, so the beat waits for the test.
const flyTo = (page, { crash = false, marks = [], tap = false } = {}) => page.evaluate(({ crash, marks, tap }) => {
  const g = window.__coldgas, S = g.S;
  S.holdLive = true;
  g.startRun('jump', true);
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  S.autopilot = null;
  const b = document.querySelector('[data-beat]');
  const read = () => ({
    mode: S.mode, shown: !b.hidden, total: b.querySelector('[data-beat-total]').textContent, verdict: b.querySelector('[data-beat-verdict]').textContent, eyebrow: b.querySelector('[data-beat-eyebrow]').textContent,
    up: [...b.querySelectorAll('[data-beat-judge].in .bj-score')].map((e) => e.textContent), say: b.querySelector('[data-beat-say]').textContent,
    pad: [...document.querySelectorAll('[data-onethumb]')].some((el) => el.getClientRects().length > 0),
  });
  let steps = 0;
  const at = marks.map((m) => { for (; steps < Math.round(m / 0.05) && S.mode === 'live'; steps++) g.liveStep(0.05); return read(); });
  if (tap) b.click();
  return { mode: S.mode, at, crashed: !!S.card?.facts?.crashed, total: S.card?.total, verdict: S.card?.verdict, judges: S.card?.judges.map((j) => j.score.toFixed(1)) };
}, { crash, marks, tap });
const toSheet = (page) => page.evaluate(() => { const g = window.__coldgas; for (let i = 0; i < 4000 && g.S.mode !== 'results'; i++) g.liveStep(0.1); return g.S.mode; });
const beatShown = (page) => page.evaluate(() => !document.querySelector('[data-beat]').hidden);
const seen = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'), sel);

test('phone, first visit: a landing gets its beat with the card’s numbers, a tap opens the calm sheet, More opens the rest', async ({ browser }) => {
  const page = await phone(browser);
  const errors = await boot(page, { firstVisit: true });
  // The score lands on the card's total, then the judges' cards go up one by one, each the card's; a tap skips the rest.
  const card = await flyTo(page, { marks: [0.3, 1.25, 1.4, 1.9], tap: true });
  expect(card.crashed).toBe(false);
  const [early, landed, one, all] = card.at;
  expect(early.mode).toBe('live');   // the beat plays before the sheet
  expect(early.shown).toBe(true);
  // 0248: a newcomer's first landing is the headline; the verdict steps into the line over it.
  expect(early.verdict).toBe('First landing');
  expect(early.eyebrow).toContain(card.verdict);
  expect(Number(early.total)).toBeLessThan(card.total);   // still counting
  expect(early.up).toEqual([]);
  expect(early.pad).toBe(false);   // the controls step out of the way
  expect(landed.total).toBe(card.total.toFixed(1));
  expect(landed.up).toEqual([]);
  expect(one.up).toEqual(card.judges.slice(0, 1));
  expect(all.up).toEqual(card.judges);
  expect(all.mode).toBe('live');
  expect(card.mode).toBe('results');   // the tap
  expect(await beatShown(page)).toBe(false);
  // The calm sheet: the final score at once (no second count), the medal, Retry; the rest under More.
  const sheet = page.locator('[data-screen="results"]');
  await expect(sheet).toHaveAttribute('data-calm', '');
  await expect(page.locator('[data-r-total]')).toHaveText(card.total.toFixed(1));
  await expect(page.locator('[data-r-verdict]')).toHaveText(card.verdict);
  await expect(page.locator('[data-medals]')).toBeVisible();
  await expect(page.locator('[data-pointer]')).toBeVisible();   // NEXT RUN, from the coach a beat after the sheet
  const retry = page.locator('[data-screen="results"] .retry-btn');
  await expect(retry).toBeInViewport();
  expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
  for (const sel of ['[data-r-judges] > li', '[data-coach]', '[data-call]', '[data-r-post]', '[data-r-facts]', '[data-runline]', '[data-assist-open]'])
    expect(await seen(page, sel), `${sel} waits under More`).toBe(false);
  const more = page.locator('[data-r-more]');
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.tap();
  await expect(sheet).toHaveAttribute('data-more', '');
  await expect(more).toBeHidden();
  await expect(page.locator('[data-r-judges] > li')).toHaveCount(3);
  await expect(page.locator('[data-r-judges] .score')).toHaveText(card.judges);
  await expect(page.locator('[data-r-judges] > li').first()).toBeVisible();
  await expect(page.locator('[data-coach]')).toBeVisible();
  await expect(page.locator('[data-runline]')).toBeVisible();
  await expect(page.locator('[data-r-post]')).toBeVisible();   // a landed board jump can post
  // Retry flies the next run and the beat is gone with the last one.
  await retry.tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await beatShown(page)).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
});

test('phone: a returning player gets the beat and the full sheet; the sheet comes by itself once the beat has run', async ({ browser }) => {
  const page = await phone(browser);
  const errors = await boot(page);
  const card = await flyTo(page, { marks: [0.6] });
  expect(card.at[0].shown).toBe(true);
  // Read out once, whole, a moment after it shows (the counting digits are hidden from screen readers).
  await expect(page.locator('[data-beat-say]')).toHaveText(`${card.verdict}. ${card.total.toFixed(1)} out of 100.`);
  expect(await toSheet(page)).toBe('results');
  const sheet = page.locator('[data-screen="results"]');
  await expect(sheet).not.toHaveAttribute('data-calm', '');
  await expect(page.locator('[data-r-more]')).toBeHidden();
  await expect(page.locator('[data-r-total]')).toHaveText(card.total.toFixed(1));
  await expect(page.locator('[data-r-judges] > li').first()).toBeVisible();
  await expect(page.locator('[data-runline]')).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('a wreck, the reference and a tap too early keep their flow', async ({ browser }) => {
  const page = await phone(browser);
  const errors = await boot(page, { firstVisit: true });
  // A wreck: no beat at any point, straight to the sheet as before.
  const wreck = await flyTo(page, { crash: true, marks: [0.5] });
  expect(wreck.crashed).toBe(true);
  expect(wreck.at[0].shown).toBe(false);
  expect(await page.evaluate(() => {
    const g = window.__coldgas;
    let beat = false;
    for (let i = 0; i < 4000 && g.S.mode !== 'results'; i++) { g.liveStep(0.1); beat ||= !document.querySelector('[data-beat]').hidden; }
    return beat;
  })).toBe(false);
  // The reference jump: its own sheet, no beat.
  expect(await page.evaluate(() => {
    const g = window.__coldgas;
    g.startRun('reveal', true); g.skipCountdown();
    let beat = false;
    for (let i = 0; i < 8000 && g.S.mode !== 'results'; i++) { g.liveStep(0.05); beat ||= !document.querySelector('[data-beat]').hidden; }
    return beat;
  })).toBe(false);
  // A landing: a tap in the guard (a thumb still down from the landing) doesn't skip; one after it does.
  const early = await flyTo(page, { marks: [0.1], tap: true });
  expect(early.at[0].shown).toBe(true);
  expect(early.mode).toBe('live');
  await page.locator('section[data-beat]').tap();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('live');   // held: nothing ends the beat but the test
  expect(await page.evaluate(() => { const g = window.__coldgas; for (let i = 0; i < 10; i++) g.liveStep(0.05); return g.S.mode; })).toBe('live');
  await page.locator('section[data-beat]').tap();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('results');
  expect(errors).toEqual([]);
  await page.close();
});

test('reduced motion: the final numbers on the first frame of the beat, a short hold', async ({ browser }) => {
  const page = await phone(browser, { reducedMotion: 'reduce' });
  const errors = await boot(page);
  const card = await flyTo(page, { marks: [0.05] });
  const b = card.at[0];
  expect(b.shown).toBe(true);
  expect(b.total).toBe(card.total.toFixed(1));
  expect(b.up).toEqual(card.judges);
  // Held ≈ 1.2 s, then the sheet (once the car is at rest).
  expect(await page.evaluate(() => { const g = window.__coldgas; for (let i = 0; i < 40 && g.S.mode === 'live'; i++) g.liveStep(0.05); return g.S.mode; })).toBe('results');
  expect(errors).toEqual([]);
  await page.close();
});

test('keyboard 1280×720: Enter skips the beat to the sheet (and doesn’t retry from it)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await boot(page, { firstVisit: true });
  const card = await flyTo(page, { marks: [0.8] });
  expect(card.at[0].shown).toBe(true);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('results');   // the beat is held: only Enter ended it
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('results');   // and the same Enter didn't Retry
  await expect(page.locator('[data-r-total]')).toHaveText(card.total.toFixed(1));
  await expect(page.locator('[data-screen="results"]')).toHaveAttribute('data-calm', '');
  // More by keyboard.
  await page.locator('[data-r-more]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-r-judges] > li').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('R during the beat settles the run (counted, its best kept) and retries', async ({ page }) => {
  const errors = await boot(page);
  const flown0 = await page.evaluate(() => window.__coldgas.S.flown);
  const card = await flyTo(page, { marks: [0.6] });
  expect(card.at[0].shown).toBe(true);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode) && document.querySelector('[data-beat]').hidden);
  expect(await page.evaluate(() => window.__coldgas.S.flown)).toBe(flown0 + 1);
  expect(await page.evaluate(() => window.__coldgas.S.attempts.show)).toBe(1);
  expect(errors).toEqual([]);
});
