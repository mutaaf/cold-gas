import { test, expect } from '@playwright/test';

// 0154: a Jump tapped before the physics engine is ready says so on the button the player pressed ("Starting…",
// aria-busy) until the run begins, a cancel takes it back, or the load fails. On a phone over cellular that wait is
// ≈ 10+ s after the 1.2 s "Loading physics" cue has gone (0053), and the title looked as if nothing had happened.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
test.use(PHONE);

const G = (page, fn, arg) => page.evaluate(fn, arg);
const JUMP = '[data-start]';
const state = (page) => G(page, (sel) => {
  const b = document.querySelector(sel), r = b.getBoundingClientRect();
  return { pending: b.hasAttribute('data-pending'), busy: b.getAttribute('aria-busy'), label: getComputedStyle(b, '::before').content,
    say: document.querySelector('[data-start-say]')?.textContent ?? null, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
}, JUMP);

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
  const before = await state(page);
  expect(before.pending).toBe(false);
  await page.locator(JUMP).tap();
  const at = await state(page);   // the same task as the tap's handlers: well inside 100 ms
  expect(at.pending).toBe(true);
  expect(at.busy).toBe('true');
  expect(at.label).toContain('Starting');
  expect(at.say).toContain('Starting');
  expect([at.w, at.h, at.x, at.y]).toEqual([before.w, before.h, before.x, before.y]);   // no width change, nothing shifts
  await page.waitForTimeout(5000);
  const later = await state(page);
  expect(later.pending).toBe(true);
  expect(await G(page, () => window.__coldgas.S.mode)).toBe('title');
  release();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 60_000 });
  const run = await state(page);
  expect(run.pending).toBe(false);
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

test.describe('1280×720, keyboard', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });
  test('Enter on Jump while the engine loads says Starting… and moves nothing', async ({ page }) => {
    const release = await boot(page);
    const before = await state(page);
    await page.locator(JUMP).focus();
    await page.keyboard.press('Enter');
    const at = await state(page);
    expect(at.pending).toBe(true);
    expect(at.label).toContain('Starting');
    expect([at.w, at.h, at.x, at.y]).toEqual([before.w, before.h, before.x, before.y]);
    release();
    await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 60_000 });
    expect((await state(page)).pending).toBe(false);
  });
});
