import { test, expect } from '@playwright/test';

// The drop off the ledge in frame (0063's probe, shared with 0107's foldables): flies the Show reference with the
// frame loop held, steps the run, the director and the probe together at 30 frames a second, and measures every
// air frame against the HUD's rects (see tests/e2e/release-frame.spec.js).
export function fly() {
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
  const out = { air: 0, aboveTop: [], covered: [], offscreen: [], inStrip: 0, topBottom: 0, minTop: Infinity, overRow: 0, noRoof: [], carry: 0, rowCover: 0, rowCoverAt: '', rowCovered: [], rowShown: 1,
    rowMean: 0, fewBodies: [], midBodies: 0, midZ: Infinity, bodies: 0, carW: [], cuts: 0 };
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
  // The row under the HUD (0113): each parked body's box (footprint × 0…h) through the camera, clipped to the
  // screen, sampled on a 16 × 16 grid; the share of those samples, over all bodies, under any HUD rect.
  // Also the share of the row's boxes on the screen at all (LESSONS 2026-10-29: 0 % under the HUD is not in sight).
  let full = 0, shown = 0;
  const bodyBox = (b) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? b.x1 : b.x0, i & 2 ? b.h : 0, i & 4 ? b.z1 : b.z0).project(cam);
      if (c.z >= 1) return null;
      const [px, py] = toPx(c);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    full += (x1 - x0) * (y1 - y0);
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    if (x1 - x0 > 0.5 && y1 - y0 > 0.5) shown += (x1 - x0) * (y1 - y0);
    return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? { x0, y0, x1, y1 } : null;
  };
  const rowCover = (rects) => {
    let all = 0, under = 0;
    full = 0; shown = 0;
    for (const b of row) {
      const p = bodyBox(b);
      if (!p) continue;
      const a = (p.x1 - p.x0) * (p.y1 - p.y0) / 256;
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
        const x = p.x0 + (i + 0.5) * (p.x1 - p.x0) / 16, y = p.y0 + (j + 0.5) * (p.y1 - p.y0) / 16;
        all += a;
        if (rects.some(([, r]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) under += a;
      }
    }
    return all > 0 ? under / all : 0;
  };
  // The share of one body's projected box on the screen (0116: the row cut by the edges of an upright screen).
  const onScreen = (b) => {
    full = 0; shown = 0;
    bodyBox(b);
    return full > 0 ? shown / full : 0;
  };
  let rowSum = 0;
  const camAt = new V(Infinity, 0, 0);   // the carry's camera in the frame before: a jump is a cut (0118)
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
    // Over the row in the tracking carry (after the hold's cut): car z from 1 m before the row's front to its back.
    if (g.director.state.shot === 'carry' && car.position.z <= rowZ1 + 1 && car.position.z >= rowZ0) {
      out.carry++;
      // 0118: the car's width across the screen, with where it is (z, y), every carry frame.
      if (camAt.x !== Infinity && camAt.distanceTo(cam.position) > 0.01) out.cuts++;
      camAt.copy(cam.position);
      out.carW.push([Math.round(((b.x1 - b.x0) / w) * 1000) / 1000, Math.round(car.position.z * 10) / 10, Math.round(car.position.y * 10) / 10]);
      const s = rowCover(rects);
      if (s > out.rowCover) { out.rowCover = s; out.rowCoverAt = `z ${car.position.z.toFixed(1)}`; }
      out.rowShown = Math.min(out.rowShown, full > 0 ? shown / full : 0);
      if (s > 0.25) out.rowCovered.push(`${Math.round(s * 100)}% z ${car.position.z.toFixed(1)}`);
      rowSum += full > 0 ? shown / full : 0;
      // 0116: how many of the bodies are half or more on the screen, every frame and at mid-row (z −13.7).
      const n = row.filter((rb) => onScreen(rb) >= 0.5).length;
      if (n < row.length - 1) out.fewBodies.push(`${n} z ${car.position.z.toFixed(1)}`);
      if (Math.abs(car.position.z + 13.7) < Math.abs(out.midZ + 13.7)) { out.midZ = car.position.z; out.midBodies = n; }
    }
    if (inside < 0.9) out.offscreen.push(`${Math.round(inside * 100)}% ${Math.round(b.x0)},${Math.round(b.y0)} ${Math.round(b.x1)},${Math.round(b.y1)} y ${car.position.y.toFixed(1)}`);
  }
  S.paused = false;
  out.rowMean = out.carry ? rowSum / out.carry : 0;
  out.bodies = row.length;
  out.rowMid = (rowZ0 + rowZ1) / 2;
  out.phase = S.run.phase;
  return out;
}

// One test per view: { name, phone, minTop (the top HUD at least this far down), ...newPage options }.
// `carW`: 0118's bar for the car's mean width / screen width over the carry frames; `grow`: its growth bar alone.
export function releaseFrameTests(VIEWS) {
  for (const { name, phone, minTop, carW, grow, ...opts } of VIEWS) {
    test(`${name}: the drop off the ledge stays in frame, below the top HUD`, async ({ browser }) => {
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
      // The flight is stepped in one task, where no CSS transition advances: start once the HUD has faded in.
      await page.waitForFunction(() => {
        for (let e = document.querySelector('[data-hud-box=mission]'); e && e.nodeType === 1; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.99) return false;
        return true;
      }, null, { timeout: 30_000 });
      const r = await page.evaluate(fly);
      console.log(name, JSON.stringify(r));
      expect(r.air).toBeGreaterThan(20);
      // Every frame saw the top HUD: the mission block (on a landscape touch screen it docks at the bottom or
      // sits a single line high, and the top bar is what stands at the top).
      expect(r.minTop).toBeGreaterThan(minTop ?? (opts.viewport.width > opts.viewport.height && phone ? 50 : 90));
      // The car's centre is below the top HUD's bottom + 24 px in every air frame, and the car is in frame.
      expect(r.aboveTop, `centre y above ${Math.round(r.topBottom + 24)}`).toEqual([]);
      expect(r.offscreen).toEqual([]);
      // On a touch screen (a phone, an iPad) no more than a tenth of the car's box is under any HUD box or the top bar.
      if (phone) expect(r.covered).toEqual([]);
      // 0026's bar holds: the car's centre is never inside the telemetry strip.
      expect(r.inStrip).toBe(0);
      // Over the parked row a roof is always in frame (the reason the carry camera is low and wide).
      expect(r.overRow).toBeGreaterThan(20);
      expect(r.noRoof).toEqual([]);
      // 0113: over the row in the tracking carry, no more than a quarter of the parked bodies' projected pixels are under
      // a HUD box in any frame, and on a screen wider than tall the row is on the screen (an upright screen's width is 0116's).
      expect(r.carry).toBeGreaterThan(20);
      expect(r.rowCovered, `row under the HUD (worst ${Math.round(r.rowCover * 100)}% at ${r.rowCoverAt})`).toEqual([]);
      if (opts.viewport.width > opts.viewport.height) expect(r.rowShown).toBeGreaterThanOrEqual(0.9);
      // 0116: on an upright screen the carry fits the row's length across the screen: on average nine tenths of the
      // bodies' pixels on the screen, never fewer than four of the five half on it, and all five at mid-row.
      else {
        expect(r.rowMean, 'row on screen, mean over the carry').toBeGreaterThanOrEqual(0.9);
        expect(r.fewBodies, 'carry frames with fewer than four bodies half on screen').toEqual([]);
        expect(r.midBodies, `bodies half on screen at z ${r.midZ.toFixed(1)}`).toBe(r.bodies);
      }
      // 0118: the car reads through the carry. On a screen wider than tall the frame placed for the car at its highest
      // over the row's front cuts closer as the car comes down: locked off between cuts, at most two of them over the row
      // (three frames in ≈ 1.9 s; any more is choppy; an upright screen keeps 0116's placements). Where a view sets
      // `carW`, the car's mean width / screen over the carry meets that bar, and with `grow` (or a bar) past the row's
      // middle it is at least 1.4× its width at the cut.
      if (opts.viewport.width > opts.viewport.height) expect(r.cuts, 'cuts inside the carry').toBeLessThanOrEqual(2);
      const ws = r.carW.map(([cw]) => cw);
      if (carW) {
        const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
        expect(mean, `car width / screen, mean over the carry: ${JSON.stringify(r.carW)}`).toBeGreaterThanOrEqual(carW);
      }
      if (carW || grow) {
        const late = r.carW.filter(([, z]) => z < r.rowMid).map(([cw]) => cw);
        expect(late.length).toBeGreaterThan(5);
        expect(Math.min(...late) / ws[0], 'car width past the row\'s middle / at the cut').toBeGreaterThanOrEqual(1.4);
      }
      expect(errors).toEqual([]);
      await page.close();
    });
  }
}
