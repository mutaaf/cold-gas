import { test, expect } from '@playwright/test';

// The HUD's FAN readout is the suction in kgf, as the livestream's DOWNFORCE channel reads it
// (ticket 0012): on the curl it climbs toward the 4,700 kgf cap and matches the sim to ±1 %.
test('HUD fan readout shows the suction in kgf, matching the sim', async ({ page }) => {
  test.slow();   // the reference climbs the curl in real time on software GL
  await page.goto('/coldgas/?play=reveal&gfx=low');
  await page.waitForFunction(() => { const r = window.__coldgas?.S.run; return r && r.phase === 'ramp' && r.car.fanForce > 20000; }, null, { timeout: 90_000 });
  await expect(page.locator('.r-fan i')).toHaveText('kgf');
  await expect.poll(async () => page.evaluate(() => {
    const shown = Number(document.querySelector('[data-fan]').textContent);
    const kgf = window.__coldgas.S.run.car.fanForce / 9.81;
    return Math.abs(shown - kgf) / kgf;
  }), { timeout: 10_000 }).toBeLessThan(0.01);
});
