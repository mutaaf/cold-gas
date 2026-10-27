import { test, expect } from '@playwright/test';

// Ticket 0022: the reference flight's HUD tells the truth. The timeline leaves HANG at the release
// for any pilot (the reference too), and the number labelled ROLL is the bank right now, not the
// roll accumulated over the flight. The sim is stepped from the test (liveStep, 0.1 s at a time), so
// software GL's slow frames don't decide what gets sampled.
async function boot(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/coldgas/?gfx=low${query}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  // physicsReady is a function: until it says yes, startRun defers to a later task.
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  return errors;
}

// Steps the live run to its end and returns one sample per 0.1 s: sim phase, the timeline's active
// phase, the ROLL text, and world up in the car's frame (upY: how upright; upZ: how far pitched). Starts the reference and flies it in the same task, so no animation frame steps the run unsampled
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
      upY: 1 - 2 * (q.x * q.x + q.z * q.z), upZ: 2 * (q.y * q.z - q.w * q.x), touched: run.t.touchTick >= 0,
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
  // Down after the flight (not up the deck), over 60° from upright and not resting on its nose or tail.
  const over = out.filter((s) => s.touched && s.phase !== 'air' && s.upY < 0.5 && Math.abs(s.upZ) < 0.5);
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

test('the Lineup reads ROLLED: the roll so far, which its score counts in whole turns', async ({ page }) => {
  test.slow();
  const errors = await boot(page, '&course=lineup');
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.startRun('reveal'); g.skipCountdown();
    for (let i = 0; i < 600 && S.mode === 'live' && S.run.phase !== 'done'; i++) g.liveStep(0.1);
    return { course: S.run.course, lbl: document.querySelector('.adi-roll .h-lbl').textContent, roll: Number(document.querySelector('[data-roll]').textContent), accum: Math.round(Math.abs(S.run.t.rollAccum) * 180 / Math.PI) };
  });
  expect(r.course).toBe('lineup');
  expect(r.lbl).toBe('Rolled');
  expect(r.accum).toBeGreaterThan(300);
  expect(r.roll).toBe(r.accum);
  expect(errors).toEqual([]);
});

// Ticket 0065: BRAKE means braking. The timeline lit 06 BRAKE on a nozzle sum (the roll-out's attitude
// pulses), so it read BRAKE through a second of free fall on the Show, BRAKE on a crash with every
// valve shut, and TOUCHDOWN over a wreck. Sampled every 0.05 s (12 sim ticks: every sample a new tick)
// with the car's velocity, so the test takes the specific force over 0.5 s (the HUD's G window) and
// over 0.25 s from Δv itself. `shut`: every input zeroed from the release + 0.125 s (the critic's
// no-brake crash).
const sampleFine = (page, shut = false) => page.evaluate((shut) => {
  const g = window.__coldgas, S = g.S, hud = document.querySelector('[data-screen="hud"]');
  const dmg = document.querySelector('[data-dmg]'), tl = document.querySelector('[data-timeline]');
  g.startRun('reveal'); g.skipCountdown();
  if (shut) {
    const ap = S.autopilot;
    S.autopilot = (run) => {
      const i = ap(run);
      if (S.released && run.tick - S.releaseTick >= 30) for (const k of g.inputKeys) i[k] = 0;
      return i;
    };
  }
  const out = [];
  for (let i = 0; i < 1400 && S.mode === 'live'; i++) {
    g.liveStep(0.05);
    const run = S.run, v = run.car.vel, now = tl.querySelector('[data-state="now"]');
    out.push({
      tick: run.tick, phase: run.phase, ph: hud.dataset.phase, vx: v.x, vy: v.y, vz: v.z,
      rel: S.released ? (run.tick - S.releaseTick) / 240 : -1, dmg: dmg.dataset.state,
      nowText: now ? now.textContent.trim() : '', alt: S.hudAlt,
    });
    if (run.phase === 'done') break;
  }
  return out;
}, shut);
// Specific force (g) over `n` samples back (0.05 s each): |Δv/Δt + g| / g, or null without the history.
const sf = (out, i, n) => {
  const a = out[i], b = out[i - n];
  if (!b || a.tick - b.tick !== n * 12) return null;
  const dt = n * 0.05;
  return Math.hypot((a.vx - b.vx) / dt, (a.vy - b.vy) / dt + 9.81, (a.vz - b.vz) / dt) / 9.81;
};
function brakeStats(out) {
  const air = out.map((s, i) => ({ ...s, g5: sf(out, i, 10), g25: sf(out, i, 5) })).filter((s) => s.phase === 'air' && s.ph === 'brake');
  const first = out.find((s) => s.ph === 'brake');
  return {
    air, frames: air.length,
    under1: air.filter((s) => s.g5 != null && s.g5 < 1).length,
    under03: air.filter((s) => s.g25 != null && s.g25 < 0.3).length,
    carry: out.filter((s) => s.phase === 'air' && s.ph === 'carry').length * 0.05,
    from: first ? `+${first.rel.toFixed(2)} s, ${first.alt.toFixed(1)} m` : 'never',
  };
}
const brakeLine = (st) => `BRAKE from ${st.from}, ${st.frames} air frames, ${st.under1} < 1 g, ${st.under03} < 0.3 g, CARRY ${st.carry.toFixed(2)} s`;

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
  test(`0065 Show reference at ${vp.width}×${vp.height}: BRAKE only under a sustained brake, CARRY over the row`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(vp);
    const errors = await boot(page);
    const out = await sampleFine(page);
    const st = brakeStats(out);
    console.log(`0065 show ${vp.width}x${vp.height}: ${brakeLine(st)}`);
    expect(st.frames, 'BRAKE is shown in the air').toBeGreaterThan(5);
    const ok = st.air.filter((s) => s.g5 != null && s.g5 >= 1).length;
    expect(ok / st.frames, `BRAKE samples at ≥ 1 g over 0.5 s: ${ok}/${st.frames}`).toBeGreaterThanOrEqual(0.95);
    expect(st.under03, 'BRAKE samples under 0.3 g over 0.25 s').toBe(0);
    expect(st.carry, 'CARRY over the row (s)').toBeGreaterThanOrEqual(1.0);
    const b = out.findIndex((s) => s.ph === 'brake'), t = out.findIndex((s) => s.ph === 'touchdown');
    expect(b, 'BRAKE is reached').toBeGreaterThan(0);
    expect(t, 'TOUCHDOWN after BRAKE').toBeGreaterThan(b);
    expect(errors).toEqual([]);
  });
}

for (const course of ['wall', 'lineup']) {
  test(`0065 the ${course} reference still reaches BRAKE before TOUCHDOWN`, async ({ page }) => {
    test.slow();
    const errors = await boot(page, `&course=${course}`);
    const out = await sampleFine(page);
    console.log(`0065 ${course}: ${brakeLine(brakeStats(out))}`);
    const b = out.findIndex((s) => s.ph === 'brake'), t = out.findIndex((s) => s.ph === 'touchdown');
    expect(b, 'BRAKE is reached').toBeGreaterThan(0);
    expect(t, 'TOUCHDOWN after BRAKE').toBeGreaterThan(b);
    expect(errors).toEqual([]);
  });
}

test('0065 a valves-shut crash never shows BRAKE, and never TOUCHDOWN over a wreck', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await boot(page);
  const out = await sampleFine(page, true);
  const st = brakeStats(out);
  const wrecked = out.filter((s) => s.dmg === 'wreck');
  const lie = wrecked.filter((s) => /touchdown/i.test(s.nowText));
  console.log(`0065 valves-shut crash: ${brakeLine(st)}; ${wrecked.length} wrecked samples, ${lie.length} under TOUCHDOWN; ends "${out.at(-1).nowText}"`);
  expect(out.filter((s) => s.ph === 'brake').length, 'BRAKE with the valves shut').toBe(0);
  expect(wrecked.length, 'the crash wrecks the car').toBeGreaterThan(0);
  expect(lie.map((s) => JSON.stringify(s)), 'TOUCHDOWN is now while the car reads wrecked').toEqual([]);
  expect(errors).toEqual([]);
});
