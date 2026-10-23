import { test, expect } from '@playwright/test';

// Ticket 0074: Standard driving and Assist flight by default on every device, and after three crashed runs
// in a row the results offer one button, Rookie mode: Easy driving + Assist (auto-land), saved, and
// straight into the retry. The crash is aftermath.spec.js's: full throttle at the Wall with no release
// (it falls off the curl). A clean run is the reference autopilot flying a run of the player's own. The
// sim is stepped from the test (liveStep, 0.1 s at a time) and only the DOM is read, so the canvas isn't
// drawn.
test.describe.configure({ mode: 'parallel' });
test.slow();   // a boot and four whole runs on software GL

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  // (physicsReady is a function: wait on it, docs/LESSONS.md.)
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}

// One run of the player's, to its results sheet: a crash, or the reference flight's clean landing.
const fly = (page, crash) => page.evaluate((crash) => {
  const g = window.__coldgas, S = g.S;
  g.startRun('jump', true);
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  const box = document.querySelector('[data-rookie]');
  return { mode: S.mode, crashed: !!S.card?.facts?.crashed, verdict: S.card?.verdict, streak: S.crashStreak, offered: !box.hidden && box.getBoundingClientRect().height > 0 };
}, crash);

test('desktop: the third crash in a row offers Rookie mode (not before), keyboard reachable after Retry; it sets Easy + Assist and goes again', async ({ page }) => {
  const errors = await boot(page);
  expect(await page.evaluate(() => ({ level: window.__coldgas.driving.settings.level, tier: window.__coldgas.S.tier }))).toEqual({ level: 'standard', tier: 'assist' });
  for (let k = 1; k <= 2; k++) {
    const r = await fly(page, true);
    expect(r, JSON.stringify(r)).toMatchObject({ mode: 'results', crashed: true, streak: k, offered: false });
  }
  const r3 = await fly(page, true);
  expect(r3, JSON.stringify(r3)).toMatchObject({ mode: 'results', crashed: true, streak: 3, offered: true });
  const go = page.locator('[data-rookie-go]');
  await expect(go).toBeVisible();
  await expect(go).toContainText(/rookie mode/i);
  await expect(page.locator('[data-rookie-why]')).toBeVisible();
  // The floor: ≥ 44 px tall, text ≥ 11 px, inside the sheet.
  const m = await go.evaluate((el) => {
    const b = el.getBoundingClientRect(), sheet = el.closest('.sheet').getBoundingClientRect();
    const sizes = [el, ...el.querySelectorAll('*'), document.querySelector('[data-rookie-why]')].map((e) => parseFloat(getComputedStyle(e).fontSize));
    return { h: b.height, w: b.width, minFont: Math.min(...sizes), inside: b.left >= sheet.left - 1 && b.right <= sheet.right + 1 };
  });
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.w).toBeGreaterThanOrEqual(44);
  expect(m.minFont).toBeGreaterThanOrEqual(11);
  expect(m.inside).toBe(true);
  // Keyboard: Tab from the sheet's Retry reaches it (after Retry, before anything below the actions).
  await page.locator('.top-actions-row [data-again]').focus();
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await go.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  // Enter on it: Easy + Assist, saved, and a new run on the mark.
  const runBefore = await page.evaluate(() => { window.__coldgas.S.prevRun = window.__coldgas.S.run; return true; });
  expect(runBefore).toBe(true);
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    let saved = null; try { saved = JSON.parse(localStorage.getItem('coldgas_driving')); } catch { /* */ }
    return { level: g.driving.settings.level, tier: S.tier, savedLevel: saved?.level, savedTier: localStorage.getItem('coldgas_tier'), mode: S.mode, newRun: S.run !== S.prevRun, kind: S.runKind, streak: S.crashStreak };
  });
  expect(after, JSON.stringify(after)).toMatchObject({ level: 'easy', tier: 'assist', savedLevel: 'easy', savedTier: 'assist', newRun: true, kind: 'jump', streak: 0 });
  expect(['countdown', 'live']).toContain(after.mode);
  // On Easy + Assist it never shows, however many crashes.
  for (let k = 0; k < 3; k++) await fly(page, true);
  const r4 = await fly(page, true);
  expect(r4, JSON.stringify(r4)).toMatchObject({ crashed: true, streak: 4, offered: false });
  // Back to Standard in the Controls sheet: the offer waits for three new crashes.
  await page.evaluate(() => window.__coldgas.driving.set({ level: 'standard' }));
  expect(await page.evaluate(() => window.__coldgas.S.crashStreak)).toBe(0);
  for (let k = 1; k <= 2; k++) expect((await fly(page, true)).offered).toBe(false);
  expect((await fly(page, true)).offered).toBe(true);
  expect(errors).toEqual([]);
});

test('phone: a clean landing ends the streak; the offer holds on the fourth crash and fits the sheet', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = await boot(page);
  expect(await page.evaluate(() => ({ level: window.__coldgas.driving.settings.level, tier: window.__coldgas.S.tier }))).toEqual({ level: 'standard', tier: 'assist' });
  await fly(page, true);
  await fly(page, true);
  const clean = await fly(page, false);
  expect(clean, JSON.stringify(clean)).toMatchObject({ mode: 'results', crashed: false, streak: 0, offered: false });
  for (let k = 1; k <= 2; k++) expect((await fly(page, true)).offered).toBe(false);
  expect((await fly(page, true)).offered).toBe(true);
  const r4 = await fly(page, true);
  expect(r4, JSON.stringify(r4)).toMatchObject({ streak: 4, offered: true });
  // It doesn't crowd the sheet: on screen, clear of the pinned Retry bar, nothing overlapping it.
  await page.waitForTimeout(1200);   // the sheet's slide-in and the button's rise
  const lay = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const go = r(document.querySelector('[data-rookie-go]')), bar = r(document.querySelector('.results .top-actions-row'));
    return { top: go.top, bottom: go.bottom, h: go.height, barTop: bar.top, vh: innerHeight };
  });
  expect(lay.h).toBeGreaterThanOrEqual(44);
  expect(lay.top).toBeGreaterThanOrEqual(0);
  expect(lay.bottom).toBeLessThanOrEqual(lay.barTop + 1);
  await page.locator('[data-rookie-go]').tap();
  expect(await page.evaluate(() => ({ level: window.__coldgas.driving.settings.level, tier: window.__coldgas.S.tier, mode: window.__coldgas.S.mode })))
    .toMatchObject({ level: 'easy', tier: 'assist' });
  expect(errors).toEqual([]);
  await page.close();
});
