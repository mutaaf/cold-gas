import { test, expect } from '@playwright/test';

// 0154: a Jump tapped before the physics engine is ready says so on the button the player pressed ("Starting…",
// aria-busy) until the run begins, a cancel takes it back, or the load fails. On a phone over cellular that wait is
// ≈ 10+ s after the 1.2 s "Loading physics" cue has gone (0053), and the title looked as if nothing had happened.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
test.use(PHONE);

const G = (page, fn, arg) => page.evaluate(fn, arg);
const JUMP = '[data-start]';
// The box: Jump's size, and where its neighbours (Watch the reference beside or under it, the daily card) sit relative to
// it, so a shift of the whole title as it settles during the load (seen on CI: Jump 14 px up, its row with it) isn't a
// change of the button's, and a button that grew or a row that moved still is.
const state = (page) => G(page, (sel) => {
  const b = document.querySelector(sel), r = b.getBoundingClientRect();
  const rel = (q) => { const e = document.querySelector(q)?.getBoundingClientRect(); return e ? [Math.round(e.x - r.x), Math.round(e.y - r.y)] : null; };
  return { pending: b.hasAttribute('data-pending'), busy: b.getAttribute('aria-busy'), label: getComputedStyle(b, '::before').content,
    say: document.querySelector('[data-start-say]')?.textContent ?? null,
    box: [Math.round(r.width), Math.round(r.height), rel('[data-reveal]'), rel('[data-title-extra]')] };
}, JUMP);
// The title holds still for 600 ms (fonts, the daily card and the title's fit settle during the load).
const settled = (page) => page.waitForFunction(() => {
  const r = document.querySelector('[data-start]').getBoundingClientRect(), k = `${r.x},${r.y},${r.width},${r.height}`, now = performance.now();
  if (window.__k !== k) { window.__k = k; window.__kt = now; }
  return now - window.__kt > 600;
}, null, { timeout: 30_000, polling: 100 });

async function boot(page, { hold = true, fail = false } = {}) {
  await page.addInitScript(() => { try { localStorage.setItem('coldgas_howto', 'seen'); } catch {} });   // a returning player: Jump starts at once
  let release = () => {};
  if (hold || fail) {
    const held = new Promise((r) => { release = r; });
    await page.route('**/*.wasm', async (route) => { await held; if (fail) await route.abort(); else await route.continue(); });
  }
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator(JUMP)).toBeVisible();
  await page.waitForFunction(() => window.__coldgas?.S, null, { timeout: 30_000 });
  return release;
}

test('a Jump tapped while the engine loads says Starting… until the run begins, without moving', async ({ page }) => {
  const release = await boot(page);
  expect(await G(page, () => window.__coldgas.physicsReady())).toBe(false);
  await settled(page);
  const before = await state(page);
  expect(before.pending).toBe(false);
  await G(page, () => { window.__starts = 0; new MutationObserver(() => { if (document.body.dataset.mode === 'countdown') window.__starts++; }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] }); });
  await page.locator(JUMP).tap();
  const at = await state(page);   // the same task as the tap's handlers: well inside 100 ms
  expect(at.pending).toBe(true);
  expect(at.busy).toBe('true');
  expect(at.label).toContain('Starting');
  expect(at.say).toContain('Starting');
  expect(at.box).toEqual(before.box);   // no size change, nothing beside it shifts
  await page.waitForTimeout(5000);
  const later = await state(page);
  expect(later.pending).toBe(true);
  await page.locator(JUMP).tap();   // impatient: tapped again, still pending, still one run
  expect((await state(page)).pending).toBe(true);
  expect(await G(page, () => window.__coldgas.S.mode)).toBe('title');
  release();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 60_000 });
  const run = await state(page);
  expect(run.pending).toBe(false);
  await page.waitForTimeout(500);
  expect(await G(page, () => window.__starts)).toBe(1);
  expect(run.busy).toBeNull();
  await G(page, () => window.__coldgas.toTitle());
  const home = await state(page);
  expect(home.pending).toBe(false);
  expect(home.label).toBe('none');
  expect(home.say).toBe('');
  await expect(page.locator(`${JUMP} .jb-v`)).toHaveText('Jump');
});

test('opening the Menu while a Jump waits cancels it: the label clears and no run starts', async ({ page }) => {
  const release = await boot(page);
  await page.locator(JUMP).tap();
  expect((await state(page)).pending).toBe(true);
  await page.locator('[data-more-toggle]').tap();
  const s = await state(page);
  expect(s.pending).toBe(false);
  expect(s.busy).toBeNull();
  release();
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  expect(await G(page, () => [window.__coldgas.S.mode, !!window.__coldgas.S.run])).toEqual(['title', false]);
});

test('a failed engine load gives Jump back and keeps the error cue', async ({ page }) => {
  const release = await boot(page, { fail: true });
  await page.locator(JUMP).tap();
  expect((await state(page)).pending).toBe(true);
  release();
  await expect(page.locator('[data-cue]')).toContainText('physics engine couldn', { timeout: 30_000 });
  const s = await state(page);
  expect(s.pending).toBe(false);
  expect(s.busy).toBeNull();
  expect(await G(page, () => window.__coldgas.S.mode)).toBe('title');
});

test('with the engine ready, a Jump never flashes Starting…', async ({ page }) => {
  await boot(page, { hold: false });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await G(page, () => {
    window.__pend = 0;
    new MutationObserver(() => { if (document.querySelector('[data-start]').hasAttribute('data-pending')) window.__pend++; })
      .observe(document.querySelector('[data-start]'), { attributes: true });
  });
  await page.locator(JUMP).tap();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 30_000 });
  expect(await G(page, () => window.__pend)).toBe(0);
});

test('Play today\'s tapped while the engine loads says Starting… on its own button, with no second label under it', async ({ page }) => {
  const release = await boot(page);
  const daily = page.locator('[data-daily-play]');
  await expect(daily).toBeVisible();
  const w = (await daily.boundingBox()).width;
  await daily.tap();
  const s = await G(page, () => {
    const b = document.querySelector('[data-daily-play]');
    return { pending: b.hasAttribute('data-pending'), color: getComputedStyle(b).color, label: getComputedStyle(b, '::before').content,
      jump: document.querySelector('[data-start]').hasAttribute('data-pending'), w: b.getBoundingClientRect().width };
  });
  expect(s.pending).toBe(true);
  expect(s.jump).toBe(false);
  expect(s.label).toContain('Starting');
  expect(s.color).toBe('rgba(0, 0, 0, 0)');   // its own words gone at once, not faded under "Starting…"
  expect(Math.round(s.w)).toBe(Math.round(w));
  release();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 60_000 });
  expect(await G(page, () => document.querySelectorAll('[data-pending]').length)).toBe(0);
});

test('Take the challenge tapped before the engine is up says Starting… until the race begins', async ({ browser }) => {
  test.setTimeout(180_000);
  // A link from a real run (a crash into the Wall is enough for a challenge).
  const a = await browser.newContext(PHONE), pa = await a.newPage();
  await pa.route('**/coldgas/api/**', (r) => r.abort());
  await pa.goto('/coldgas/?gfx=low');
  await pa.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 90_000 });
  const link = await pa.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.startRun('jump', true);
    S.autopilot = () => ({ throttle: 1, assist: 1 });
    g.skipCountdown();
    for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
    S.autopilot = null;
    for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
    return g.comeback.linkFor(S.card);
  });
  await a.close();
  const b = await browser.newContext(PHONE), page = await b.newPage();
  await page.route('**/coldgas/api/**', (r) => r.abort());
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/*.wasm', async (route) => { await held; await route.continue(); });
  await page.goto(link.replace(/^https?:\/\/[^/]+/, '').replace('#', '&gfx=low#'));
  const take = page.locator('[data-vs-take]');
  await expect(take).toBeVisible({ timeout: 30_000 });
  await take.tap();
  const pending = () => G(page, () => document.querySelector('[data-vs-take]')?.hasAttribute('data-pending') ?? null);
  expect(await pending()).toBe(true);
  await page.waitForTimeout(3000);
  expect(await pending()).toBe(true);
  release();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 120_000 });
  expect(await G(page, () => document.querySelectorAll('[data-pending]').length)).toBe(0);
  await b.close();
});

test.describe('1280×720, keyboard', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });
  test('Enter on Jump while the engine loads says Starting… and moves nothing', async ({ page }) => {
    const release = await boot(page);
    await settled(page);
    const before = await state(page);
    await page.locator(JUMP).focus();
    await page.keyboard.press('Enter');
    const at = await state(page);
    expect(at.pending).toBe(true);
    expect(at.label).toContain('Starting');
    expect(at.box).toEqual(before.box);
    release();
    await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 60_000 });
    expect((await state(page)).pending).toBe(false);
  });
});
