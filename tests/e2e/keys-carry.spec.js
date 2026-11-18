import { test, expect } from '@playwright/test';

// 0275: the keyboard guide says "Hold ↑ to go", "Keep holding ↑", "Space to let go". A newcomer who keeps holding ↑
// through the release must not be flying the nose down: a key held across the take-off waits for a fresh press, and a
// fresh ↑ in the air still pitches. Stepped from the test (liveStep), so the sim's clock is the test's, not SwiftShader's.
test('keys at 1280×720: ↑ held through the release is no pitch until it is let go and pressed again', async ({ page }) => {
  test.slow();   // a run's climb stepped on SwiftShader
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.physicsReady);
  await page.evaluate(() => { const g = window.__coldgas; g.setTier('assist'); g.startRun('jump'); g.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  await page.keyboard.down('ArrowUp');   // a real key: the device is now the keyboard
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S, run = S.run, dt = 1 / 240;
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    const PITCH = 4;   // inputLog rows: [tick, throttle, brake, steer, pitch, …] (src/sim/run.js KEYS)
    for (let i = 0; i < 240 * 40 && !(run.phase === 'ramp' && run.t.progress >= 0.95); i++) g.liveStep(dt);
    const atLedge = run.phase;
    key('keydown', 'Space');
    for (let i = 0; i < 36; i++) g.liveStep(dt);
    key('keyup', 'Space');
    const from = run.tick;
    for (let i = 0; i < 240 * 0.6 && run.phase !== 'done'; i++) g.liveStep(dt);
    const air = run.phase;
    const pitchHeld = run.inputLog.filter((row) => row[0] >= from).reduce((m, row) => Math.max(m, Math.abs(row[PITCH])), 0);
    // Let go and press again: ↑ is nose down again, as it always was.
    key('keyup', 'ArrowUp'); key('keydown', 'ArrowUp');
    const fresh = run.tick;
    for (let i = 0; i < 24 && run.phase === 'air'; i++) g.liveStep(dt);
    const pitchFresh = run.inputLog.filter((row) => row[0] >= fresh).reduce((m, row) => Math.max(m, Math.abs(row[PITCH])), 0);
    key('keyup', 'ArrowUp');
    return { atLedge, released: S.released, air, pitchHeld, pitchFresh, device: g.input.device() };
  });
  await page.keyboard.up('ArrowUp');
  expect(r.atLedge).toBe('ramp');
  expect(r.released).toBe(true);
  expect(r.air).toBe('air');
  expect(r.device).toBe('key');
  expect(r.pitchHeld).toBe(0);
  expect(r.pitchFresh).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
