import { test, expect } from '@playwright/test';

// Driving levels (0066): one setting, Easy / Standard / Advanced, in the Controls sheet on every device,
// remembered on this device, and the same on the ground in every mode: the Show's run-up and Free Drive.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  return errors;
};

test('desktop: Standard by default; the keyboard picks Advanced, and it is remembered', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__coldgas.driving.settings.level)).toBe('standard');
  const open = page.locator('.cta [data-driving-open]');
  await expect(open).toBeVisible();
  await expect(open).toContainText('Standard');
  // Keyboard only: focus the button, Enter opens the sheet on the checked level, an arrow picks the next.
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await expect(page.locator('[data-drive-level="standard"]')).toBeFocused();
  await expect(page.locator('.ctl-touch')).toBeHidden();   // the touch rows are for touch
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-drive-level="advanced"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-drive-level="advanced"]')).toBeFocused();
  await expect(page.locator('[data-drive-adv]').first()).toBeVisible();   // TC and ABS, Advanced only
  await page.locator('[data-drive-tc="sport"]').click();
  await page.locator('[data-controls-close]').click();
  await expect(open).toContainText('Advanced');
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => ({ ...window.__coldgas.driving.settings }))).toMatchObject({ level: 'advanced', tc: 'sport', saved: true });
  await expect(page.locator('.cta [data-driving-open]')).toContainText('Advanced');
  expect(errors).toEqual([]);
});

test('a phone starts on Easy; the touch Controls sheet has Driving on top', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__coldgas.driving.settings.level)).toBe('easy');
  await page.locator('.cta [data-controls-open]').tap();
  await expect(page.locator('[data-drive-level="easy"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-drive-level="easy"]')).toBeInViewport();
  await expect(page.locator('[data-drive-note]')).toContainText('Brakes for the bend ahead');
  await expect(page.locator('[data-scheme-opt="thumb"]')).toBeVisible();
  await page.locator('[data-controls-close]').tap();
  expect(errors).toEqual([]);
  await page.close();
});

// The rise of the steer channel in the Show's input log, from the first tick off centre to full lock.
async function showSteerRise(page, level) {
  await page.evaluate((level) => window.__coldgas.driving.set({ level }), level);
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  const i = await page.evaluate(() => window.__coldgas.inputKeys.indexOf('steer') + 1);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((i) => window.__coldgas.S.run.inputLog.some((e) => e[i] >= 100), i, { timeout: 30_000 });
  await page.keyboard.up('ArrowRight');
  return page.evaluate((i) => {
    const log = window.__coldgas.S.run.inputLog;
    const a = log.find((e) => e[i] > 0), b = log.find((e) => e[i] >= 100);
    return b[0] - a[0];
  }, i);
}

test('the Show run-up: Advanced steers direct, Standard through the hands (same scored channels)', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  const std = await showSteerRise(page, 'standard');
  await page.evaluate(() => window.__coldgas.toTitle());
  const adv = await showSteerRise(page, 'advanced');
  // Standard: full lock in 0.25 s at a standstill (60 ticks); Advanced: 0.08 s (19 ticks).
  expect(std).toBeGreaterThan(45);
  expect(adv).toBeLessThan(30);
  // The flight tier still owns the scored channels: an Assist run stays Assist on every tick.
  expect(await page.evaluate(() => window.__coldgas.S.run.inputLog.every((e) => e[window.__coldgas.inputKeys.indexOf('assist') + 1] === 100))).toBe(true);
  await page.evaluate(() => window.__coldgas.toTitle());
  expect(errors).toEqual([]);
});

test('Free Drive: the setting is in the pause sheet, and each level drives differently', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=stelvio&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  // Driving and the sheets only, no pixels: skip the draw. Stelvio on software GL took seconds a frame on
  // CI, between every step here (the test ran past 4.5 minutes in the flake guard).
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  const frames = (n) => page.evaluate((n) => { const d = window.__coldgas.drive; for (let k = 0; k < n; k++) d.frame(0.05, performance.now() / 1000); }, n);
  // Esc pauses; Driving is there, and opens the sheet over the pause.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drive-pause]')).toBeVisible();
  const btn = page.locator('[data-drive-pause] [data-driving-open]');
  await expect(btn).toContainText('Standard');
  await btn.click();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await page.locator('[data-drive-level="easy"]').click();
  await page.locator('[data-controls-close]').click();
  await expect(btn).toContainText('Easy');
  await page.locator('[data-dp-resume]').click();
  // Easy: a gentle throttle (0.6 s to full, Standard 0.3 s); the car keeps stability control and a stock
  // drivetrain. Counted in one synchronous loop of 50 ms frames, so no animation frame slips in between.
  const toFull = () => page.evaluate(() => {
    const d = window.__coldgas.drive, g = window.__coldgas.driving.get;
    for (let k = 1; k <= 40; k++) { d.frame(0.05, performance.now() / 1000); if (g().throttle >= 1) return k; }
    return 99;
  });
  await page.keyboard.down('ArrowUp');
  const easyK = await toFull();
  const easy = await page.evaluate(() => ({ ...window.__coldgas.driving.get(), tcOff: window.__coldgas.drive.car.tcOff }));
  await page.keyboard.up('ArrowUp');
  expect(easy.level).toBe('easy');
  expect(easy.tcOff).toBe(false);
  await frames(20);
  await page.evaluate(() => window.__coldgas.driving.set({ level: 'standard' }));
  await page.keyboard.down('ArrowUp');
  const stdK = await toFull();
  await page.keyboard.up('ArrowUp');
  expect(easyK).toBeGreaterThanOrEqual(11);
  expect(stdK).toBeLessThanOrEqual(7);
  await frames(10);
  // Advanced, TC and ABS off: the car carries the flags, the throttle is the key at once.
  await page.evaluate(() => window.__coldgas.driving.set({ level: 'advanced', tc: 'off', abs: false }));
  await page.keyboard.down('ArrowUp');
  await frames(2);
  const adv = await page.evaluate(() => ({ ...window.__coldgas.driving.get(), car: { tcOff: window.__coldgas.drive.car.tcOff, absOff: window.__coldgas.drive.car.absOff } }));
  await page.keyboard.up('ArrowUp');
  expect(adv.throttle).toBe(1);
  expect(adv.car).toEqual({ tcOff: true, absOff: true });
  // Back to Standard: a stock car again.
  await page.evaluate(() => window.__coldgas.driving.set({ level: 'standard', tc: 'on', abs: true }));
  await frames(2);
  expect(await page.evaluate(() => [window.__coldgas.drive.car.tcOff, window.__coldgas.drive.car.absOff])).toEqual([false, false]);
  expect(errors).toEqual([]);
});
