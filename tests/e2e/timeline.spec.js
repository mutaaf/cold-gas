import { test, expect } from '@playwright/test';

// Ticket 0022: the reference flight's HUD tells the truth. The timeline leaves HANG at the release
// for any pilot (the reference too), and the number labelled ROLL is the bank right now, not the
// roll accumulated over the flight. The sim is stepped from the test (liveStep, 0.1 s at a time), so
// software GL's slow frames don't decide what gets sampled.
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
  // physicsReady is a function: until it says yes, startRun defers to a later task.
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 30_000 });
  return errors;
}

// Steps the live run to its end and returns one sample per 0.1 s: sim phase, the timeline's active
// phase, the ROLL text, and how upright the car is (world up · body up). Starts the reference and flies it in the same task, so no animation frame steps the run unsampled
// (under load, frames between two evaluate calls can carry it past the lip). `rollAfterRelease`:
// a full roll stick and nothing else from the release on (Pro: no computer to level it).
const flyAndSample = (page, rollAfterRelease = false) => page.evaluate((rollAfterRelease) => {
  const g = window.__coldgas, S = g.S, hud = document.querySelector('[data-screen="hud"]');
  g.startRun('reveal'); g.skipCountdown();
  if (rollAfterRelease) {
    const ap = S.autopilot;
    S.autopilot = (run) => {
      const i = ap(run);
      if (!S.released) return i;
      for (const k of g.inputKeys) i[k] = 0;
      i.roll = 1;
      return i;
    };
  }
  const out = [];
  let firstAir = -1;
  for (let i = 0; i < 600 && S.mode === 'live'; i++) {
    g.liveStep(0.1);
    const run = S.run, q = run.car.quat;
    if (firstAir < 0 && run.phase === 'air') firstAir = run.tick;
    out.push({
      tick: run.tick, phase: run.phase, ph: hud.dataset.phase, released: S.released,
      roll: Number(document.querySelector('[data-roll]').textContent),
      upY: 1 - 2 * (q.x * q.x + q.z * q.z), touched: run.t.touchTick >= 0,
    });
    if (run.phase === 'done') break;
  }
  return { out, firstAir };
}, rollAfterRelease);

test('reference flight: RELEASE after the lip, then CARRY/BRAKE, never HANG; ROLL ≈ 0 on the wheels', async ({ page }) => {
  test.slow();   // the whole Show reference, stepped in the page under software GL
  const errors = await boot(page);
  const { out, firstAir } = await flyAndSample(page);
  expect(firstAir, 'the reference leaves the deck').toBeGreaterThan(0);
  // RELEASE within 0.6 s of the first air tick.
  const rel = out.find((s) => s.ph === 'release');
  expect(rel, 'the timeline shows RELEASE').toBeTruthy();
  expect(rel.tick - firstAir).toBeLessThanOrEqual(0.6 * 240);
  // Afterwards, in the air, CARRY or BRAKE, and never HANG again.
  const after = out.filter((s) => s.tick > firstAir + 0.6 * 240 + 24 && s.phase === 'air');
  expect(after.length).toBeGreaterThan(10);
  for (const s of after) expect(['carry', 'brake'], JSON.stringify(s)).toContain(s.ph);
  for (const s of out.filter((s) => s.tick > firstAir)) expect(s.ph, JSON.stringify(s)).not.toBe('hang');
  expect(out.some((s) => s.ph === 'brake'), 'BRAKE is reached').toBe(true);
  // On the wheels after the touchdown: ROLL reads the bank, ≤ 5°.
  const upright = out.filter((s) => s.touched && s.upY > 0.996);
  expect(upright.length, 'upright samples after the touchdown').toBeGreaterThan(0);
  for (const s of upright) expect(s.roll, JSON.stringify(s)).toBeLessThanOrEqual(5);
  // Hanging upside down on the ledge, before the release, ROLL says so.
  const hang = out.filter((s) => s.phase === 'ramp' && !s.released && s.upY < -0.9);
  expect(hang.length, 'samples hanging on the ledge').toBeGreaterThan(0);
  for (const s of hang) expect(s.roll, JSON.stringify(s)).toBeGreaterThanOrEqual(150);
  expect(errors).toEqual([]);
});

// The ticket's crash (every valve shut after the release) now lands on its wheels under SIM_VERSION 25,
// so the crash here is a held full roll stick after the release (Pro: no computer to level it): the car
// tumbles and comes down on its side and roof.
test('reference rolled into a crash: on a side or the roof, ROLL reads ≥ 60°', async ({ page }) => {
  test.slow();
  const errors = await boot(page);
  const { out } = await flyAndSample(page, true);
  const over = out.filter((s) => s.touched && s.phase !== 'air' && s.upY < 0.5);   // down after the flight, not up the deck
  expect(over.length, 'samples on a side or the roof').toBeGreaterThan(0);
  for (const s of over) expect(s.roll, JSON.stringify(s)).toBeGreaterThanOrEqual(60);
  expect(errors).toEqual([]);
});

test('player release on the ledge still runs HANG → RELEASE → CARRY', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const g = window.__coldgas; g.startRun('jump'); g.skipCountdown(); g.startDrill('ledge'); });
  // Hold the frame loop once the drill is live on the ledge: from here only the test steps the run.
  await page.waitForFunction(() => {
    const S = window.__coldgas.S;
    if (!(S.mode === 'live' && S.run.phase === 'ramp' && S.freezeT <= 0)) return false;
    S.paused = true;
    return true;
  }, null, { timeout: 30_000 });
  const before = await page.evaluate(() => { window.__coldgas.liveStep(0.1); return document.querySelector('[data-screen="hud"]').dataset.phase; });
  expect(before).toBe('hang');
  await page.keyboard.down('Space');
  const seq = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S, out = [];
    for (let i = 0; i < 100 && S.run.phase !== 'done'; i++) {
      g.liveStep(0.1);
      out.push({ ph: document.querySelector('[data-screen="hud"]').dataset.phase, dt: S.released ? (S.run.tick - S.releaseTick) / 240 : -1 });
      if (S.released && S.run.tick - S.releaseTick > 1.2 * 240) break;
    }
    return out;
  });
  await page.keyboard.up('Space');
  const txt = JSON.stringify(seq);
  expect(seq[0].ph, txt).toBe('release');
  for (const s of seq) if (s.dt >= 0.6 + 0.1) expect(['carry', 'brake', 'touchdown'], txt).toContain(s.ph);
  expect(seq.at(-1).dt, txt).toBeGreaterThan(0.7);
  expect(errors).toEqual([]);
});
