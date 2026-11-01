import { test, expect } from '@playwright/test';

// The drop off the ledge in frame (0063's probe, shared with 0107's foldables): flies the Show reference with the
// frame loop held, steps the run, the director and the probe together at 30 frames a second, and measures every
// air frame against the HUD's rects (see tests/e2e/release-frame.spec.js).
// `{ thumb: true }` (0128): the flight is a one-thumb player's, not the autopilot's, so the touch controls are on the
// screen: hold the pad up the curl, tap on the ledge, hold it to the ground. Every air frame then also measures the
// share of the car's box under the pad's circle (`padCover`, sampled 21 × 11), as the held pad is opaque.
export function fly(opts = {}) {
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
    rowMean: 0, fewBodies: [], midBodies: 0, midZ: Infinity, bodies: 0 };
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
  // The one-thumb pad's circle (0128) and the share of a projected box inside it.
  const padEl = document.querySelector('[data-onethumb]');
  const padCircle = () => {
    if (!padEl || !vis(padEl)) return null;
    const r = padEl.getBoundingClientRect();
    return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, r: r.width / 2 };
  };
  const inCircle = (b, p) => {
    let n = 0;
    for (let i = 0; i < 21; i++) for (let j = 0; j < 11; j++) {
      const x = b.x0 + (i + 0.5) * (b.x1 - b.x0) / 21 - p.cx, y = b.y0 + (j + 0.5) * (b.y1 - b.y0) / 11 - p.cy;
      if (x * x + y * y <= p.r * p.r) n++;
    }
    return n / 231;
  };
  out.pad = 0; out.padCover = []; out.padWorst = 0; out.padWorstAt = ''; out.carW = []; out.thumbHeld = 0;
  let rowSum = 0;
  S.paused = true;   // the frame loop stands still; the probe steps the run and the director itself
  const DT = 1 / 30;
  if (opts.thumb) {
    // Hold up the curl (the pad's governor stops on the ledge), then tap: let go and hold again, held to the ground.
    g.thumb.down();
    let tapped = false;
    for (let f = 0; f < 30 * 60 && S.mode === 'live' && S.run.phase !== 'air'; f++) {
      const cv = S.run.car.vel;
      if (!tapped && S.run.phase === 'ramp' && S.run.t.progress >= 0.92 && Math.hypot(cv.x, cv.y, cv.z) < 0.3) {
        g.thumb.up(); g.liveStep(DT); g.thumb.down(); tapped = true;
      }
      g.liveStep(DT);
      S.time += DT;
      g.director.update(DT, S.time, { carPos: car.position, carVel: S.run.car.vel, phase: S.run.phase, mode: 'live', course: g.stage.course });
    }
    padEl?.classList.add('on');   // what the player sees: the held pad (src/input.js marks a pressed one)
  }
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
    // 0128: the car under the pad the player's thumb is holding.
    const pc = padCircle();
    if (pc) {
      out.pad++;
      if (g.thumb.held) out.thumbHeld++;
      const s = inCircle(b, pc);
      if (s > out.padWorst) { out.padWorst = s; out.padWorstAt = `z ${car.position.z.toFixed(1)} y ${car.position.y.toFixed(1)}`; }
      if (s > 0.1) out.padCover.push(`${Math.round(s * 100)}% z ${car.position.z.toFixed(1)} ${g.director.state.shot}`);
    }
    if (g.director.state.shot === 'carry') out.carW.push(b.x1 - b.x0);
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
  if (opts.thumb) { g.thumb.up(); padEl?.classList.remove('on'); }
  out.carWMean = out.carW.length ? out.carW.reduce((a, x) => a + x, 0) / out.carW.length : 0;
  out.carW = undefined;
  out.rowMean = out.carry ? rowSum / out.carry : 0;
  out.bodies = row.length;
  out.phase = S.run.phase;
  return out;
}

// One test per view: { name, phone, minTop (the top HUD at least this far down), ...newPage options }.
export function releaseFrameTests(VIEWS) {
  for (const { name, phone, minTop, ...opts } of VIEWS) {
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
      expect(errors).toEqual([]);
      await page.close();
    });
  }
}

// 0128: the carry on one thumb. A first visit on an upright phone flies the Show with the one-thumb pad, and the pad
// is held (opaque) from the tap on the ledge to the ground: the car must cross the row in sight, not under it.
// { name, hand, ...newPage options }.
export function thumbFrameTests(VIEWS) {
  for (const { name, hand, ...opts } of VIEWS) {
    test(`${name}: on one thumb the car crosses the row clear of the held pad`, async ({ browser }) => {
      test.slow();   // a whole one-thumb flight, stepped in the page
      const page = await browser.newPage(opts);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/coldgas/?gfx=low&course=show');
      await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
      await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
      await page.evaluate((h) => {
        const g = window.__coldgas;
        g.stage.setPixelScale(0.5); g.stage.setPixelScale = () => {};
        g.touch.set('scheme', 'thumb'); g.touch.set('hand', h); g.setTier('assist');
        g.startRun('jump'); g.skipCountdown();
      }, hand || 'right');
      await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 60_000 });
      await page.waitForFunction(() => {
        const t = document.querySelector('[data-touch]');
        if (!t || t.hidden || t.dataset.scheme !== 'thumb') return false;
        for (let e = document.querySelector('[data-hud-box=mission]'); e && e.nodeType === 1; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.99) return false;
        return true;
      }, null, { timeout: 30_000 });
      const r = await page.evaluate(fly, { thumb: true });
      console.log(name, 'thumb', JSON.stringify(r));
      expect(r.air).toBeGreaterThan(20);
      // The pad was on the screen and held in every air frame.
      expect(r.pad).toBe(r.air);
      expect(r.thumbHeld).toBe(r.air);
      // No more than a tenth of the car's box under the pad's circle in any air frame (0128: 29 frames ≥ 50 % before).
      expect(r.padCover, `car under the held pad (worst ${Math.round(r.padWorst * 100)}% at ${r.padWorstAt})`).toEqual([]);
      // 0113/0116 hold: the car under the top HUD's line, a roof in frame over the row, the row across the screen.
      expect(r.aboveTop).toEqual([]);
      expect(r.offscreen).toEqual([]);
      expect(r.covered).toEqual([]);
      expect(r.noRoof).toEqual([]);
      expect(r.carry).toBeGreaterThan(20);
      expect(r.rowCovered).toEqual([]);
      expect(r.rowMean, 'row on screen, mean over the carry').toBeGreaterThanOrEqual(0.9);
      expect(r.fewBodies).toEqual([]);
      expect(r.midBodies).toBe(r.bodies);
      expect(errors).toEqual([]);
      await page.close();
    });
  }
}
