import { test, expect } from '@playwright/test';
import { SHOW_BOXES } from '../../src/sim/courses.js';

// The drop off the ledge stays in frame (0063). Through the Show reference, every frame the car is in
// the air: project the car (its centre, and the box of every visible mesh) through the director's
// camera and compare it with the HUD's rects. The sim is stepped from the test at 60 fps (liveStep,
// then director.update with the same arguments the frame loop passes), all in one task, so software
// GL's slow frames don't decide what gets sampled and no animation frame steps the run unsampled.
// Every test has its own page: let the runner spread them over its workers.
test.describe.configure({ mode: 'parallel' });

const ROOFS = SHOW_BOXES.map((b) => [(b.minX + b.maxX) / 2, b.maxY, b.cz]);
const ROW = [SHOW_BOXES[SHOW_BOXES.length - 1].minZ, SHOW_BOXES[0].maxZ];

const fly = (page) => page.evaluate(({ ROOFS, ROW }) => {
  const g = window.__coldgas, S = g.S, cam = g.camera, THREE_V = cam.position.constructor;
  const W = innerWidth, H = innerHeight, v = new THREE_V();
  const rect = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0).map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }));
  const proj = (x, y, z) => {
    v.set(x, y, z).project(cam);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, front: v.z < 1 };
  };
  // The hero's visible meshes (geometry bounds through the camera).
  const meshes = [];
  g.hero.group.traverse((o) => { if (o.isMesh) { o.geometry.boundingBox || o.geometry.computeBoundingBox(); meshes.push(o); } });
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const corner = new THREE_V();
  const carBox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of meshes) {
      if (!shown(m)) continue;
      const b = m.geometry.boundingBox;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld).project(cam);
        const x = (corner.x + 1) / 2 * W, y = (1 - corner.y) / 2 * H;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1 };
  };
  // Share of the box (a 12×12 grid of its cells) under any of the rects.
  const under = (b, rs) => {
    let n = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      const x = b.x0 + (i + 0.5) / 12 * (b.x1 - b.x0), y = b.y0 + (j + 0.5) / 12 * (b.y1 - b.y0);
      if (rs.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) n++;
    }
    return n / 144;
  };

  g.startRun('reveal'); g.skipCountdown();
  const dt = 1 / 60, out = [];
  let last = -1;
  for (let i = 0; i < 3000 && S.mode === 'live' && S.run.phase !== 'done'; i++) {
    g.liveStep(dt);
    S.time += dt;
    g.director.update(dt, S.time, { carPos: g.carRoot.position, carVel: S.run.car.vel, phase: S.run.phase, mode: 'live', course: g.stage.course });
    const run = S.run;
    if (run.phase !== 'air' || run.tick === last) continue;
    last = run.tick;
    cam.updateMatrixWorld(); g.carRoot.updateMatrixWorld(true);
    const mission = rect('[data-hud-box=mission]')[0], strip = rect('.h-strip')[0];
    const hud = [...rect('[data-hud-box]'), ...rect('[data-hud-toggle]'), ...rect('.top-actions')];
    const c = proj(g.carRoot.position.x, g.carRoot.position.y, g.carRoot.position.z), box = carBox();
    const z = g.carRoot.position.z, overRow = g.stage.course === 'show' && z >= ROW[0] && z <= ROW[1];
    const roofs = overRow ? ROOFS.filter(([x, y, rz]) => { const p = proj(x, y, rz); return p.front && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H; }).length : -1;
    out.push({
      tick: run.tick, cx: Math.round(c.x), cy: Math.round(c.y), missionBottom: Math.round(mission.y1), missionTop: Math.round(mission.y0),
      inStrip: !!strip && c.x >= strip.x0 && c.x <= strip.x1 && c.y >= strip.y0 && c.y <= strip.y1,
      cover: under(box, hud), box: [box.x0, box.y0, box.x1, box.y1].map(Math.round), roofs, z: +z.toFixed(1), y: +g.carRoot.position.y.toFixed(1),
    });
  }
  return { W, H, out, course: g.stage.course };
}, { ROOFS, ROW });

const VIEWS = [
  { name: '1440×900', viewport: { width: 1440, height: 900 }, phone: false },
  { name: '1280×720', viewport: { width: 1280, height: 720 }, phone: false },
  { name: '390×844', viewport: { width: 390, height: 844 }, phone: true },
  { name: '844×390', viewport: { width: 844, height: 390 }, phone: true },
];
// The Show at every viewport; the Wall's fall (its own rig, no row) at a desktop and a phone.
const CASES = [...VIEWS.map((vw) => ({ ...vw, course: 'show' })), ...[VIEWS[0], VIEWS[2]].map((vw) => ({ ...vw, course: 'wall' }))];

for (const vw of CASES) {
  test(`the drop off the ledge stays in frame, clear of the top HUD (${vw.course}, ${vw.name})`, async ({ browser }) => {
    test.slow();   // the whole reference, stepped in the page
    const page = await browser.newPage({ viewport: vw.viewport, ...(vw.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/coldgas/?gfx=low&course=${vw.course}`);
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
    // physicsReady is a function: until it says yes, startRun defers to a later task.
    await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
    const { W, H, out, course } = await fly(page);
    expect(course).toBe(vw.course);
    expect(out.length, 'air frames sampled').toBeGreaterThan(60);

    // The top HUD is the mission block when it sits at the top of the screen (on a compact landscape
    // phone it sits at the bottom, and the band's top is the screen's top 15 %).
    const missionTop = out[0].missionTop < H / 2;
    const band = (s) => (missionTop ? s.missionBottom + 24 : 0.15 * H);
    const high = out.filter((s) => s.cy < band(s));
    const covered = out.filter((s) => s.cover > 0.10);
    const offBottom = out.filter((s) => s.cy > H);
    const strip = out.filter((s) => s.inStrip).length;
    const over = out.filter((s) => s.roofs >= 0);
    const noRoof = over.filter((s) => s.roofs === 0);
    const sum = { course: vw.course, view: vw.name, W, H, air: out.length, high: high.length, covered: covered.length, peakCover: +Math.max(...out.map((s) => s.cover)).toFixed(2),
      minCy: Math.min(...out.map((s) => s.cy)), strip, overRow: over.length, noRoof: noRoof.length, offBottom: offBottom.length };
    test.info().annotations.push({ type: '0063', description: JSON.stringify(sum) });
    console.log(`[0063] ${JSON.stringify(sum)}`);

    expect(high.map((s) => `t${s.tick} y${s.cy} band ${band(s)}`), 'car centre above the band under the top HUD').toEqual([]);
    expect(offBottom.length, 'car centre below the screen').toBe(0);
    if (vw.phone) expect(covered.map((s) => `t${s.tick} ${(s.cover * 100).toFixed(0)}% ${s.box}`), 'car box > 10 % under the HUD').toEqual([]);
    if (vw.course === 'show') expect(over.length, 'frames over the row').toBeGreaterThan(0);
    expect(noRoof.map((s) => `t${s.tick} z${s.z}`), 'over the row, a parked roof in frame').toEqual([]);
    // 0026: the strip covering the car on a portrait phone does not get worse (main: 0 frames at 60 fps).
    if (vw.name === '390×844' && vw.course === 'show') expect(strip, 'frames with the car centre in the strip').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  });
}
