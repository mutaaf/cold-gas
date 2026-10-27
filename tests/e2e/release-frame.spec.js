import { test, expect } from '@playwright/test';

// Ticket 0063: the drop off the ledge is the moment the Show builds to, and the carry camera used to
// draw it behind the top HUD (the car's centre above the mission block's bottom in a quarter of the
// air frames, its tail under the phone's rail). The probe flies the Show reference with the frame loop
// held and steps the run, the director and the probe together at a steady 30 frames a second, so the
// numbers don't depend on how fast CI's software GL draws: every air frame, the car's projected centre
// (carRoot through the camera) and its projected box (each visible mesh's bounding box) against the
// HUD's rects. Rendering never enters, so the canvas is drawn at a quarter of the pixels.
test.describe.configure({ mode: 'parallel' });

function fly() {
  const g = window.__coldgas, S = g.S, cam = g.camera, car = g.carRoot;
  const V = car.position.constructor, v = new V(), c = new V();
  const SEL = '[data-hud-box], [data-hud-toggle], .top-actions';
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const w = innerWidth, h = innerHeight;
  const toPx = (p) => [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
  // The car's projected box: the corners of every visible mesh's bounding box, through the camera (the
  // hero's own meshes: the plumes ride on carRoot too, and a retro-burn's cones are metres long).
  const carBox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    car.updateMatrixWorld(true);
    g.hero.group.traverseVisible((o) => {
      const bb = o.isMesh && o.geometry && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox));
      if (!bb || o.isInstancedMesh) return;
      for (let i = 0; i < 8; i++) {
        c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
        const [px, py] = toPx(c);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
    });
    return { x0, y0, x1, y1 };
  };
  const overlap = (b, r) => Math.max(0, Math.min(b.x1, r.right) - Math.max(b.x0, r.left)) * Math.max(0, Math.min(b.y1, r.bottom) - Math.max(b.y0, r.top));
  const out = { air: 0, aboveTop: [], covered: [], offscreen: [], inStrip: 0, topBottom: 0, minTop: Infinity, minY: Infinity, overRow: 0, noRoof: [] };
  // The parked row as it stands (each vehicle's footprint and height), and the stretch it covers.
  const row = S.run.car.world.bodies.map((b) => ({ x0: b.cx - b.hx, x1: b.cx + b.hx, z0: b.cz - b.hz, z1: b.cz + b.hz, h: b.h }));
  const rowZ0 = Math.min(...row.map((b) => b.z0)), rowZ1 = Math.max(...row.map((b) => b.z1));
  // A roof is in frame when any corner of its top 15 % projects inside the screen.
  const roofIn = (b) => {
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? b.x1 : b.x0, i & 2 ? b.h : b.h * 0.85, i & 4 ? b.z1 : b.z0).project(cam);
      if (c.z < 1 && Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1) return true;
    }
    return false;
  };
  S.paused = true;   // the frame loop stands still; the probe steps the run and the director itself
  const DT = 1 / 30;
  for (let f = 0; f < 30 * 40 && S.mode === 'live' && S.run.phase !== 'done'; f++) {
    g.liveStep(DT);
    S.time += DT;
    g.director.update(DT, S.time, { carPos: car.position, carVel: S.run.car.vel, phase: S.run.phase, mode: 'live', course: g.stage.course });
    cam.updateMatrixWorld(true);
    // The air frames until the car is a metre off the ground, where the director's landing rig (low and
    // close, ahead of the car) takes over.
    if (S.run.phase !== 'air' || car.position.y < 1.0) continue;
    out.air++;
    const rects = [...document.querySelectorAll(SEL)].filter(vis).map((el) => [el.dataset.hudBox || (el.classList.contains('top-actions') ? 'top-actions' : el.hasAttribute('data-hud-toggle') ? 'toggle' : el.className), el.getBoundingClientRect()]);
    // The top HUD: everything standing in the top half (the top bar, the mission block and its timeline;
    // on a landscape phone the mission line docks at the bottom, under the car, and isn't counted).
    const top = Math.max(0, ...rects.filter(([k, r]) => (k === 'mission' || k === 'top-actions') && r.top + r.bottom < h).map(([, r]) => r.bottom));
    out.topBottom = Math.max(out.topBottom, top); out.minTop = Math.min(out.minTop, top);
    const [px, py] = toPx(v.copy(car.position).project(cam));
    if (py < top + 24) out.aboveTop.push(Math.round(py));
    out.minY = Math.min(out.minY, py / h);
    const strip = rects.find(([k]) => k === 'strip');
    if (strip && px >= strip[1].left && px <= strip[1].right && py >= strip[1].top && py <= strip[1].bottom) out.inStrip++;
    const b = carBox(), area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
    let worst = 0, worstK = '';
    for (const [k, r] of rects) { const s = overlap(b, r) / area; if (s > worst) { worst = s; worstK = k; } }
    if (worst > 0.1) out.covered.push(`${worstK} ${Math.round(worst * 100)}%`);
    const inside = overlap(b, { left: 0, top: 0, right: w, bottom: h }) / area;
    if (car.position.z >= rowZ0 && car.position.z <= rowZ1) {
      out.overRow++;
      if (!row.some(roofIn)) out.noRoof.push(`z ${car.position.z.toFixed(1)} y ${car.position.y.toFixed(1)}`);
    }
    if (inside < 0.9) out.offscreen.push(`${Math.round(inside * 100)}% ${Math.round(b.x0)},${Math.round(b.y0)} ${Math.round(b.x1)},${Math.round(b.y1)} y ${car.position.y.toFixed(1)}`);
  }
  S.paused = false;
  out.phase = S.run.phase;
  return out;
}

const VIEWS = [
  { name: 'desktop 1440×900', viewport: { width: 1440, height: 900 } },
  { name: 'desktop 1280×720', viewport: { width: 1280, height: 720 } },
  { name: 'phone 390×844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, phone: true },
  { name: 'phone 844×390', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, phone: true },
  // The iPads (the critic's 2026-10-27 re-measure): touch, held either way.
  { name: 'iPad 820×1180', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  { name: 'iPad 1180×820', viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true },
];

for (const { name, phone, ...opts } of VIEWS) {
  test(`${name}: the drop off the ledge stays in frame, below the top HUD`, async ({ browser }) => {
    test.slow();   // the whole Show reference, stepped in the page
    const page = await browser.newPage(opts);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // A shader that fails to compile (three reports it on the console) fails the probe too.
    page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
    await page.goto('/coldgas/?gfx=low&course=show');
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
    await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
    await page.evaluate(() => { const s = window.__coldgas.stage; s.setPixelScale(0.5); s.setPixelScale = () => {}; });
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
    await page.evaluate(() => { window.__coldgas.S.paused = true; });   // held at the start line while the HUD fades in
    // The flight is stepped in one task, where no CSS transition advances: start once the HUD has faded in.
    await page.waitForFunction(() => {
      for (let e = document.querySelector('[data-hud-box=mission]'); e && e.nodeType === 1; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.99) return false;
      return true;
    }, null, { timeout: 30_000 });
    const r = await page.evaluate(fly);
    console.log(name, JSON.stringify(r));
    expect(r.air).toBeGreaterThan(20);
    // Every frame saw the top HUD: the mission block (on a touch screen held sideways it docks at the bottom,
    // and the top bar is what stands at the top).
    expect(r.minTop).toBeGreaterThan(opts.viewport.width > opts.viewport.height && opts.hasTouch ? 50 : 100);
    // And never in the top 15 % of the screen, whatever stands there (the critic's iPad bar).
    expect(r.minY).toBeGreaterThanOrEqual(0.15);
    // The car's centre is below the top HUD's bottom + 24 px in every air frame, and the car is in frame.
    expect(r.aboveTop, `centre y above ${Math.round(r.topBottom + 24)}`).toEqual([]);
    expect(r.offscreen).toEqual([]);
    // On a phone no more than a tenth of the car's box is under any HUD box or the top bar.
    if (phone) expect(r.covered).toEqual([]);
    // 0026's bar holds: the car's centre is never inside the telemetry strip.
    expect(r.inStrip).toBe(0);
    // Over the parked row a roof is always in frame (the reason the carry camera is low and wide).
    expect(r.overRow).toBeGreaterThan(20);
    expect(r.noRoof).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
}
