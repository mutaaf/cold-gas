import { test, expect } from '@playwright/test';

// 0229: "Turning left and crashing into a pole caused the game to break." Full throttle with the wheel held
// over from Go curls the car into one of the Wall's set lights, where it stops dead on its wheels; the sim
// has no end for that (it sat to the 90 s cap, the HUD frozen). The game now says so and goes again from the
// mark, with no page error and the physics still running.
test('a run wedged against a set light goes again from the mark', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low&course=wall');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); window.__coldgas.S.holdLive = true; });
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  // Game time, stepped here (software GL is slow): at most 30 s of it, a frame at a time.
  const out = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S, run = S.run;
    let stuckAt = -1;
    for (let i = 0; i < 60 * 30 && S.mode === 'live'; i++) {
      g.liveStep(1 / 60);
      if (stuckAt < 0 && S.wedgeGo != null) stuckAt = run.tick;
    }
    return { mode: S.mode, stuckAt, tick: run.tick, phase: run.phase, newRun: S.run !== run, cue: document.querySelector('[data-cue]')?.textContent || '' };
  });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('ArrowLeft');
  expect(out.stuckAt).toBeGreaterThan(0);
  expect(out.tick).toBeLessThan(240 * 20);   // long before the sim's 90 s cap
  expect(out.phase).toBe('drive');           // the old run was never ended or scored
  expect(out.mode).toBe('countdown');        // Retry's one-beat READY
  expect(out.newRun).toBe(true);
  await page.evaluate(() => { window.__coldgas.S.holdLive = false; });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
