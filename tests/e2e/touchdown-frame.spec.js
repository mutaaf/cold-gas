import { test, expect } from '@playwright/test';

// Ticket 0108: the touchdown is the payoff of the Show, and on an upright phone the landed rig (11 m from the
// car, a 40° vertical lens whatever the aspect) drew it 1.2–1.45 screens wide: the nose and the tail cut off at
// both edges, and the wreck the same under the crash cut. On a screen narrower than it is tall the landed rig
// and the crash cut now hold the horizontal lens a square screen has (src/render/director.js `lens`); at
// aspect ≥ 1 nothing changes.
// The probe is 0063's (frame-probe.js), carried past the touchdown: the run, the director and the probe are
// stepped together at 30 frames a second with the frame loop held, and every frame from the sim's touch tick
// to the results measures the hero's projected box (each visible mesh's bounding box, through the camera).
// Rendering never enters. One page per input kind flies every shape in turn (a resize between flights), so the
// thirteen shapes cost two boots, not thirteen.
test.describe.configure({ mode: 'parallel' });

function touchdown([crash, shoot]) {
  const g = window.__coldgas, S = g.S, cam = g.camera, car = g.carRoot;
  const c = new car.position.constructor();
  const w = innerWidth, h = innerHeight;
  const carBox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    car.updateMatrixWorld(true);
    g.hero.group.traverseVisible((o) => {
      const bb = o.isMesh && o.geometry && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox));
      if (!bb || o.isInstancedMesh) return;
      for (let i = 0; i < 8; i++) {
        c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
        const px = ((c.x + 1) / 2) * w, py = ((1 - c.y) / 2) * h;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
    });
    return { x0, y0, x1, y1 };
  };
  const overlap = (b, r) => Math.max(0, Math.min(b.x1, r.right) - Math.max(b.x0, r.left)) * Math.max(0, Math.min(b.y1, r.bottom) - Math.max(b.y0, r.top));
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  g.startRun('reveal'); g.skipCountdown();
  S.time = 0;   // the shake's phase: the same on every flight
  if (crash) {
    // The critic's crash: the Show reference with every input zeroed from the release + 0.125 s.
    const ap = S.autopilot;
    S.autopilot = (run) => {
      const i = ap(run);
      if (S.released && run.tick - S.releaseTick >= 0.125 * 240) for (const k of g.inputKeys) i[k] = 0;
      return i;
    };
  }
  const out = { frames: 0, minShare: 1, minW: Infinity, maxW: 0, covered: 0, cut: false, reason: '', minCy: 1, maxCy: 0, cam: [], dark: [] };
  // 0119: the share of the lower 40 % of the drawn scene (the GL buffer, no HTML over it) under luminance 12, on a real
  // frame rendered there and then. The probe stops the stage's own rendering; `__render` is the real one (boot()).
  const gl = g.stage.renderer.getContext();
  const dark = () => {
    window.__render(S.time, 'live');
    const W = gl.drawingBufferWidth, rows = Math.floor(gl.drawingBufferHeight * 0.4), px = new Uint8Array(W * rows * 4);
    gl.readPixels(0, 0, W, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);   // GL's rows run from the bottom
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] < 12) n++;
    return Math.round((n / (W * rows)) * 1000) / 1000;
  };
  let touchT = -1;
  S.paused = true;   // the frame loop stands still; the probe steps the run and the director itself
  const DT = 1 / 30;
  for (let f = 0; f < 30 * 60 && S.mode === 'live'; f++) {
    g.liveStep(DT);
    if (S.mode !== 'live') break;
    S.time += DT;
    g.director.update(DT, S.time, { carPos: car.position, carVel: S.run.car.vel, phase: S.run.phase, mode: 'live', course: g.stage.course });
    cam.updateMatrixWorld(true);
    if (S.run.t.touchTick < 0) continue;
    out.frames++;
    if (touchT < 0) touchT = S.time;
    const since = S.time - touchT;
    // The landed rig's camera at touchdown + 0.3 s and + 1.0 s (the desktop must not move), and those frames drawn.
    for (const at of [0.3, 1.0]) {
      if (since + 1e-9 < at || out.cam.length > (at < 0.5 ? 0 : 1)) continue;
      out.cam.push(cam.position.toArray().map((v) => Math.round(v * 1000) / 1000));
      if (shoot) out.dark.push(dark());
    }
    if (shoot && crash && since + 1e-9 >= 0.3) out.darkLast = dark();   // ends as the wreck's last frame before the results
    if (g.director.state.cutT > 0) out.cut = true;
    const b = carBox(), area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
    const share = overlap(b, { left: 0, top: 0, right: w, bottom: h }) / area, bw = (b.x1 - b.x0) / w;
    if (since + 1e-9 >= 0.3) { const cy = (b.y0 + b.y1) / 2 / h; out.minCy = Math.min(out.minCy, cy); out.maxCy = Math.max(out.maxCy, cy); }
    out.minShare = Math.min(out.minShare, share); out.minW = Math.min(out.minW, bw); out.maxW = Math.max(out.maxW, bw);
    for (const el of document.querySelectorAll('[data-hud-box], .top-actions')) {
      if (vis(el) && overlap(b, el.getBoundingClientRect()) / area > 0.1) { out.covered++; break; }
    }
  }
  S.paused = false;
  out.reason = S.run.t.endReason;
  out.mode = S.mode;
  for (const k of ['minShare', 'minW', 'maxW', 'minCy', 'maxCy']) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre
  await page.goto('/coldgas/?gfx=low&course=show');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.evaluate(() => { const s = window.__coldgas.stage; s.setPixelScale(0.5); s.setPixelScale = () => {}; window.__render = s.render; s.render = () => {}; });
  return errors;
}

async function flyAt(page, [width, height], crash, shoot = false) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // the resize handlers ran
  const r = await page.evaluate(touchdown, [crash, shoot]);
  console.log(`${width}×${height} ${crash ? 'crash' : 'reference'}`, JSON.stringify(r));
  expect(r.mode, `${width}×${height}: the results came up`).toBe('results');
  expect(r.frames, `${width}×${height}: frames from the touch tick`).toBeGreaterThan(8);
  // Back to the title for the next flight.
  await page.evaluate(() => window.__coldgas.toTitle());
  return r;
}

// Upright: the whole touchdown in frame (≥ 0.95 of the box on screen in every frame), at most 0.85 of the width.
const UPRIGHT = [[390, 844], [360, 800], [360, 748], [382, 580], [820, 1180]];
// 0119: on these the landed frames are drawn and read (the probe boots at `?gfx=low`).
const SHOT = ['390×844', '360×800'];
// The other foldable shapes (scripts/audit-plan.mjs FOLD / FLIP): the whole car on screen, at most 0.85 wide.
const FOLDS = [[669, 871], [466, 498], [360, 380], [424, 360], [594, 368], [800, 300]];
// As wide as tall or wider: today's framing. Main's box width / screen width before 0108 on this probe, as
// [narrowest, widest] over the frames, [the reference, the crash]; each must hold within ±0.02.
const WIDE = {
  '844×390': [[0.262, 0.282], [0.219, 0.252]], '594×368': [[0.351, 0.377], [0.293, 0.337]], '800×300': [[0.212, 0.228], [0.177, 0.204]],
  '424×360': [[0.481, 0.517], [0.402, 0.463]], '1440×900': [[0.354, 0.381], [0.296, 0.341]], '1280×720': [[0.319, 0.343], [0.266, 0.307]],
};
const unchanged = (r, name, crash) => {
  const [lo, hi] = WIDE[name][crash ? 1 : 0];
  expect(r.minW, `${name}: narrowest box`).toBeGreaterThanOrEqual(lo - 0.02);
  expect(r.minW, `${name}: narrowest box`).toBeLessThanOrEqual(lo + 0.02);
  expect(r.maxW, `${name}: widest box`).toBeGreaterThanOrEqual(hi - 0.02);
  expect(r.maxW, `${name}: widest box`).toBeLessThanOrEqual(hi + 0.02);
};

for (const crash of [false, true]) {
  const what = crash ? 'the valves-shut crash' : 'the Show reference';
  test(`touch: ${what}'s touchdown fits every upright and folding screen`, async ({ browser }) => {
    test.setTimeout(480_000);   // eleven whole flights, stepped in the page
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = await boot(page);
    for (const v of [...UPRIGHT, ...FOLDS, [844, 390]]) {
      const name = v.join('×');
      const r = await flyAt(page, v, crash, SHOT.includes(name));
      if (SHOT.includes(name)) {
        // 0119: the car on a lit pad, not over black floor. Before: the car's centre at 0.51 of the height and 0.98 of
        // the lower 40 % black at `low` (0.78 at the default tier, scripts measured in the PR).
        expect(r.minCy, `${name}: the car's centre from touchdown + 0.3 s, highest`).toBeGreaterThanOrEqual(0.5);
        expect(r.maxCy, `${name}: the car's centre from touchdown + 0.3 s, lowest`).toBeLessThanOrEqual(0.7);
        if (crash) expect(typeof r.darkLast, `${name}: the wreck drawn after touchdown + 0.3 s`).toBe('number');
        else expect(r.dark.length, `${name}: frames drawn at touchdown + 0.3 s and + 1.0 s`).toBe(2);
        for (const d of [...r.dark, ...(crash ? [r.darkLast] : [])]) expect(d, `${name}: lower 40 % under luminance 12 (${r.dark}, last ${r.darkLast})`).toBeLessThanOrEqual(0.5);
      }
      if (crash) {
        expect(r.reason, name).not.toBe('settled');
        expect(r.cut, `${name}: the crash cut ran`).toBe(true);
      }
      if (UPRIGHT.some((u) => u.join('×') === name)) expect(r.minShare, `${name}: share of the box on screen`).toBeGreaterThanOrEqual(0.95);
      else expect(r.minShare, `${name}: share of the box on screen`).toBe(1);
      if (WIDE[name]) unchanged(r, name, crash);
      else expect(r.maxW, `${name}: box width / screen width`).toBeLessThanOrEqual(0.85);
      // 0063's rule on the ground: never more than a tenth of the box under a HUD box or the top bar.
      if (name === '390×844') expect(r.covered, `${name}: frames with the car under the HUD`).toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  });
}

// Main's landed camera before 0119 (stepped probe), [the reference, the crash] × [touchdown + 0.3 s, + 1.0 s]: the same at
// 1440×900 and 1280×720 (the crash's first sample is its crash cut).
const MAIN_CAM = [[[8.681, 1.316, -37.081], [7.4, 1.259, -38.681]], [[12.19, 4.57, -17.991], [7.968, 1.25, -34.597]]];
test('desktop: the touchdown framing is unchanged at 1440×900 and 1280×720', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = await boot(page);
  for (const crash of [false, true]) {
    for (const v of [[1440, 900], [1280, 720]]) {
      const r = await flyAt(page, v, crash);
      const name = v.join('×');
      expect(r.minShare, name).toBe(1);
      unchanged(r, name, crash);
      // 0119: the landed rig's camera at touchdown + 0.3 s and + 1.0 s is main's before 0119, to 1 mm.
      const want = MAIN_CAM[crash ? 1 : 0];
      expect(r.cam.length, `${name}: camera samples`).toBe(2);
      r.cam.forEach((p, i) => p.forEach((v, j) => expect(Math.abs(v - want[i][j]), `${name}: camera ${JSON.stringify(r.cam)} vs ${JSON.stringify(want)}`).toBeLessThanOrEqual(0.001)));
    }
  }
  expect(errors).toEqual([]);
  await page.close();
});
