import { test, expect } from '@playwright/test';

// Ticket 0055: the descent tape's BRAKE label is never drawn over the tape's scale labels ("0 ft" at the
// bottom, "100" at the top). Near the ground the BRAKE line comes down to a metre or two over the pad and its
// label (6 units above the tick) used to sit on "0 ft": the two numbers that matter in the last second of a
// landing, unreadable together. Flies the Show reference with the frame loop held, steps the run tick by tick
// through the whole descent and measures the tape's labels' rects in every air frame, down to the car a metre
// over the pad and below. The reference flies itself (the HUD hides the descent for it), so each tick the tape
// is drawn as a player's run would draw it, from the same car.
test.describe.configure({ mode: 'parallel' });

// Steps the run until the car is below `stopBelow` m in the air (or the run is done), measuring every air
// frame into window.__tape. Resumable: a test can stop mid-descent, switch the units or the HUD mode, let the
// page lay out (the tape re-measures on a layout change, not in the frame), then fly on.
function descend(stopBelow) {
  const g = window.__coldgas, S = g.S;
  const q = (s) => document.querySelector(s);
  const lbl = q('[data-d-brake-lbl]'), zero = q('[data-d-zero]'), top = q('[data-d-top]'), line = q('[data-d-brake]');
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const out = window.__tape ??= { air: 0, low: 0, minBrakeBy: Infinity, onZero: [], onTop: [], onTick: [], tickMoved: [], hidden: 0, done: false };
  S.paused = true;
  for (let f = 0; f < 240 * 40; f++) {
    if (S.mode !== 'live' || S.run.phase === 'done') { out.done = true; break; }
    g.liveStep(1 / 240);
    if (S.run.phase !== 'air') continue;
    // The reference flies itself, so the HUD keeps its descent hidden; draw it as a player's run would, from
    // the same car on the same tick (src/main.js syncHud).
    g.landing.update(S.run.car, S.hudAlt, 'air', S.run.tick / 240);
    const r = lbl.getBoundingClientRect();
    if (r.width < 1) { out.hidden++; continue; }
    out.air++;
    const y = S.run.car.pos.y;
    if (y < 1.5) out.low++;
    const tick = Number(line.getAttribute('y1')), by = Number(lbl.getAttribute('y'));
    out.minBrakeBy = Math.min(out.minBrakeBy, 140 - tick);
    const at = `y ${y.toFixed(2)} tick ${tick} label ${by}`;
    if (hit(r, zero.getBoundingClientRect())) out.onZero.push(at);
    if (hit(r, top.getBoundingClientRect())) out.onTop.push(at);
    // Never struck through by its own line.
    const ly = line.getBoundingClientRect().top;
    if (ly > r.top + 0.5 && ly < r.bottom - 0.5) out.onTick.push(at);
    // The tick stays true: the line is where the stop has to start, whatever its label does.
    if (line.getAttribute('y2') !== line.getAttribute('y1')) out.tickMoved.push(at);
    if (y < stopBelow) break;
  }
  const cut = (a) => a.slice(0, 5).concat(a.length > 5 ? [`… ${a.length} frames`] : []);
  return { ...out, onZero: cut(out.onZero), onTop: cut(out.onTop), onTick: cut(out.onTick), tickMoved: cut(out.tickMoved) };
}

const VIEWS = [
  { name: 'desktop 1280×720', viewport: { width: 1280, height: 720 } },
  { name: 'desktop 1440×900', viewport: { width: 1440, height: 900 } },
  { name: 'phone 390×844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { name: 'phone 844×390', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  { name: 'phone 360×740 (full set)', viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, full: true },
  // Switched in the air, 8 m up: the tape's type changes size (the HUD mode) or its scale (the units).
  { name: 'desktop 1280×720, HUD mode switched mid-descent', viewport: { width: 1280, height: 720 }, swap: 'KeyI' },
  { name: 'phone 390×844, units switched mid-descent', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, swap: 'KeyU' },
];

for (const { name, full, swap, ...opts } of VIEWS) {
  test(`${name}: BRAKE's label never draws over the tape's scale`, async ({ browser }) => {
    test.slow();   // the whole Show reference, stepped in the page
    const page = await browser.newPage(opts);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/coldgas/?gfx=low&course=show');
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
    await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
    await page.evaluate(() => { const s = window.__coldgas.stage; s.setPixelScale(0.5); s.setPixelScale = () => {}; });
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
    // A phone opens the compact HUD; the full set (the handle) draws the tape at another size.
    if (full) {
      const toggle = page.locator('[data-hud-toggle]');
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
    let r = await page.evaluate(descend, swap ? 8 : -1);
    if (swap) {
      expect(r.done).toBe(false);
      const before = await page.evaluate(() => [document.querySelector('[data-d-zero]').textContent, document.querySelector('.d-tape').getBoundingClientRect().width]);
      await page.keyboard.press(swap);
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      const after = await page.evaluate(() => [document.querySelector('[data-d-zero]').textContent, document.querySelector('.d-tape').getBoundingClientRect().width]);
      expect(after, 'the switch changed the tape').not.toEqual(before);
      r = await page.evaluate(descend, -1);
    }
    console.log(name, JSON.stringify(r));
    expect(r.air).toBeGreaterThan(200);
    // The descent reached the pad with the BRAKE line in the tape's bottom metres (the case the ticket is about).
    expect(r.low).toBeGreaterThan(10);
    expect(r.minBrakeBy).toBeLessThan(10);
    expect(r.onZero, 'BRAKE over "0 ft"').toEqual([]);
    expect(r.onTop, 'BRAKE over the top of the scale').toEqual([]);
    expect(r.onTick, 'BRAKE across its own line').toEqual([]);
    expect(r.tickMoved).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
}
