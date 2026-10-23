import { test, expect } from '@playwright/test';

// 0080: "I shouldn't be able to float into space." In the free modes the jets hop and hover the car near
// the ground (src/build/ceiling.js). Before: a tank of LIFT on Stelvio climbed > 150 m above the road.
// These hold LIFT for a whole tank (and on refills) and read the peak height above the road; a kicker
// jump in the Sandbox still flies its own arc above the band. The sim is stepped directly with the draw
// stubbed (software GL is seconds a frame on a CI runner's mountains).
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  return errors;
};
const ZERO = 12, OVERSHOOT = 1.5;   // CEILING.ZERO, and what a climb may carry past it

// Hold LIFT (Assist, no throttle) for `secs` of sim time in Free Drive, granting nitrogen every `refill` s:
// the peak height of the car's floor above the ground straight under it (bisected on the world's distance
// field here, not by the code under test) and above the road's centreline (the operator's measure), with a
// trace of the first every second. A hovering car drifts: off the road's edge the ground is lower.
async function holdLift(page, { secs = 24, refill = 0 } = {}) {
  return page.evaluate(({ secs, refill }) => {
    const g = window.__coldgas, d = g.drive;
    g.stage.render = () => {};
    d.goto(d.road.endless ? 60 : 18, 1);
    const lift = { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 1, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 };
    d.state.pilot = () => lift;
    const out = { x: 0, y: 0, z: 0 };
    const sdf = (x, y, z) => d.course.sdf(x, y, z, out);
    const groundY = (x, z, y0) => {
      let hi = y0, lo = y0 - 400;
      for (let k = 0; k < 40; k++) { const m = (hi + lo) / 2; if (sdf(x, m, z) > 0) hi = m; else lo = m; }
      return (hi + lo) / 2;
    };
    const com = d.car.pos.y - groundY(d.car.pos.x, d.car.pos.z, d.car.pos.y);   // the CoM's height over the ground, parked
    let peak = -1, peakRoad = -1, t = 0, nextRefill = refill;
    const trace = [];
    for (let k = 0; k < secs * 20; k++) {
      d.frame(0.05, performance.now() / 1000);
      t += 0.05;
      if (refill && t >= nextRefill) { d.layer.api.power.grant('nitrogen', d.car); nextRefill += refill; }
      const c = d.car.pos, h = c.y - com - groundY(c.x, c.z, c.y);
      peak = Math.max(peak, h);
      peakRoad = Math.max(peakRoad, c.y - com - d.road.y[d.state.hint]);
      if (k % 20 === 19) trace.push(Math.round(h * 10) / 10);
    }
    d.state.pilot = null;
    return { peak, peakRoad, trace, air: d.car.air };
  }, { secs, refill });
}

test('Free Drive (Stelvio): a tank of LIFT hovers near the road, and refills never add height', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=stelvio&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 60_000 });
  const tank = await holdLift(page);
  console.log('stelvio tank', JSON.stringify(tank));
  expect(tank.peak).toBeGreaterThan(5);                      // it does lift off and hover
  expect(tank.peak).toBeLessThanOrEqual(ZERO + OVERSHOOT);   // and goes no higher
  expect(tank.peakRoad).toBeLessThanOrEqual(ZERO + OVERSHOOT);
  const fed = await holdLift(page, { secs: 30, refill: 2 });
  console.log('stelvio refills', JSON.stringify(fed));
  expect(fed.peak).toBeLessThanOrEqual(ZERO + OVERSHOOT);
  expect(fed.trace.at(-1)).toBeGreaterThan(5);                // still hovering on the refills, not reset
  expect(errors).toEqual([]);
});

test('the endless world: the same ceiling', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=endless&seed=ceiling&gfx=low&idb=0');
  // The endless world builds its first rings on the main thread's software GL: 120 s, as tests/e2e/endless.spec.js.
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  const tank = await holdLift(page, { secs: 30, refill: 3 });
  console.log('endless refills', JSON.stringify(tank));
  expect(tank.peak).toBeGreaterThan(5);
  expect(tank.peak).toBeLessThanOrEqual(ZERO + OVERSHOOT);
  expect(errors).toEqual([]);
});

test('the Sandbox: LIFT hovers, a big kicker still throws the car above the band, and the button says why', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = watch(page);
  await page.goto('/coldgas/?drive=sandbox&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 60_000 });
  // LIFT held on the apron: a hover in the band, the LIFT button dashed while the ceiling takes it away.
  const hover = await page.evaluate(() => {
    const g = window.__coldgas, s = g.sandbox;
    g.stage.render = () => {};
    s.place(0, -100, 0);
    s.pilot(() => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 1, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 }));
    let peak = 0, faded = false;
    for (let k = 0; k < 120; k++) {
      s.frame(0.05, performance.now() / 1000);
      peak = Math.max(peak, s.car.pos.y - 0.4);
      if (document.querySelector('[data-btn-lift]')?.hasAttribute('data-faded')) faded = true;
    }
    s.pilot(null);
    return { peak, faded };
  });
  expect(hover.peak).toBeLessThanOrEqual(ZERO + OVERSHOOT);
  expect(hover.faded).toBe(true);
  // A kicker at 1.5× (2.4 m, lip ≈28°) at ≈40 m/s: ballistic, no LIFT; it peaks well above the band.
  const jump = await page.evaluate(() => {
    const s = window.__coldgas.sandbox;
    s.layer.place('kicker', 0, 60, { scale: 1.5 });
    s.place(0, -150, 0);
    s.pilot((c) => ({ throttle: Math.hypot(c.vel.x, c.vel.z) < 40 ? 1 : 0, brake: 0, steer: -c.pos.x * 0.08 - c.vel.x * 0.05, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 }));
    let peak = 0;
    for (let k = 0; k < 300; k++) {
      s.frame(0.05, performance.now() / 1000);
      peak = Math.max(peak, s.car.pos.y - 0.4);
    }
    s.pilot(null);
    return { peak };
  });
  console.log('sandbox', JSON.stringify({ hover, jump }));
  expect(jump.peak).toBeGreaterThan(ZERO);
  expect(jump.peak).toBeLessThan(60);
  expect(errors).toEqual([]);
  await page.close();
});
