import { test, expect } from '@playwright/test';

// Ticket 0062: a crashed car finishes its crash. When a Show run ends with the car still moving, it
// doesn't freeze: it brakes to rest under the same physics, and the results come up after that.
// The crash: full throttle at the Wall with no release, so the car falls off the curl. The run ends on
// its first contact, still ≈2 m up and falling at ≈6 m/s; the aftermath plays out the rest of the fall.
async function crashToDone(page) {
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 30_000 });
  await page.evaluate(() => window.__coldgas.startRun('reveal'));
  await page.waitForFunction(() => window.__coldgas.S.run, null, { timeout: 15_000 });
  return page.evaluate(() => {
    const cg = window.__coldgas, S = cg.S;
    S.autopilot = () => ({ throttle: 1, assist: 1 });
    cg.skipCountdown();
    for (let i = 0; i < 4000 && S.run.phase !== 'done'; i++) cg.liveStep(0.1);
    const c = S.run.car;
    return { phase: S.run.phase, reason: S.run.t.endReason, speed: Math.hypot(c.vel.x, c.vel.y, c.vel.z), mode: S.mode, total: S.card?.total ?? null, z: cg.carRoot.position.z };
  });
}

test('a Show crash brakes to rest before the results: the speed falls to ~0, then the sheet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const end = await crashToDone(page);
  expect(end.phase).toBe('done');
  expect(end.mode).toBe('live');               // not frozen into the results
  expect(end.speed).toBeGreaterThan(4);        // still moving when the run ended
  // The page's own frames run the aftermath; sample the car's speed every frame until the results.
  const trace = await page.evaluate(() => new Promise((resolve) => {
    const cg = window.__coldgas, out = [];
    const tick = () => {
      const r = cg.S.run, c = r.car;
      out.push({ mode: cg.S.mode, v: Math.hypot(c.vel.x, c.vel.y, c.vel.z), done: r.after.done, freed: c.world.freed, z: cg.carRoot.position.z, total: cg.S.card?.total ?? null });
      if (cg.S.mode === 'results' || out.length > 5000) resolve(out); else requestAnimationFrame(tick);
    };
    tick();
  }));
  const live = trace.filter((f) => f.mode === 'live');
  expect(trace.at(-1).mode).toBe('results');
  expect(live.length).toBeGreaterThan(5);
  // At rest before the sheet came up (the last live frame), and the world given back by then.
  const last = live.at(-1);
  expect(last.v).toBeLessThan(0.35);
  expect(trace.at(-1).done).toBe(true);
  expect(trace.at(-1).freed).toBe(true);
  expect(trace.at(-1).v).toBeLessThan(0.3);
  // It slid there: the drawn car moved after the run ended, and it slowed all the way.
  expect(Math.abs(last.z - end.z)).toBeGreaterThan(1);
  // Gravity can add speed until it touches down (the fastest frame); from there it only slows.
  const peak = live.reduce((k, f, i) => (f.v > live[k].v ? i : k), 0);
  const settle = live.slice(peak + Math.ceil((live.length - peak) / 2));
  expect(settle.length).toBeGreaterThan(2);
  expect(Math.max(...settle.map((f) => f.v))).toBeLessThan(end.speed);
  // The card is the one decided at the end of the run.
  expect(trace.at(-1).total).not.toBeNull();
  const frames = await page.evaluate(() => [window.__coldgas.S.run.frames.length, window.__coldgas.S.run.t.endTick]);
  expect(frames[0]).toBeGreaterThan(frames[1] / 4 + 60);   // the replay carries the aftermath (≥ 1 s)
  expect(errors).toEqual([]);
});

test('Retry during the aftermath starts a fresh run and gives the crashed world back', async ({ page }) => {
  const end = await crashToDone(page);
  expect(end.phase).toBe('done');
  const before = await page.evaluate(() => {
    const S = window.__coldgas.S;
    window.__oldRun = S.run;
    return { after: S.after, done: S.run.after.done, freed: S.run.car.world.freed };
  });
  expect(before).toEqual({ after: true, done: false, freed: false });   // mid-aftermath
  await page.keyboard.press('KeyR');
  const now = await page.evaluate(() => {
    const S = window.__coldgas.S;
    return { mode: S.mode, fresh: S.run !== window.__oldRun, phase: S.run.phase, tick: S.run.tick, after: S.after, oldFreed: window.__oldRun.car.world.freed, card: S.card };
  });
  expect(now).toEqual({ mode: 'countdown', fresh: true, phase: 'drive', tick: 0, after: false, oldFreed: true, card: null });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.run.tick > 0, null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__coldgas.S.run.phase)).not.toBe('done');
});
