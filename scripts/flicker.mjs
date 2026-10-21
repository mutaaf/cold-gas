// Temporal flicker probe: drives the real game frame by frame on a synthetic 60 Hz clock and
// measures how much each pixel *jitters* between consecutive frames, by region.
//
//   node scripts/flicker.mjs [url] [--engine=chromium|webkit] [--phone] [--only=a,b] [--json=out.json]
//
// Smooth motion (a camera dolly, a beam sweeping) changes a pixel along a straight line from one
// frame to the next; flicker (z-fighting, shadow-texel crawl, texture moire, a bloom sparkle that
// pops) makes it zig-zag. So the metric is the temporal second difference of luma,
// |f(t) - 2 f(t-1) + f(t-2)| in 0–255 units, averaged per region, plus the share of pixel-frames
// where it exceeds 24 (a visible pop). Regions come from an ID pass rendered with the same camera:
// ground (the slab, the approach and everything painted on it), wall (deck, truss, LEDs), car
// (the hero), row (the parked vehicles), sky, backdrop (the launch complex). Frame triples that
// straddle a director hard cut are skipped.
//
// requestAnimationFrame is stubbed before the game loads, so every run sees the same timestamps;
// the scene clock (S.time) is pinned at the start of each scenario. Real GPU flags (Metal ANGLE)
// as in scripts/shots-show.mjs; --engine=webkit runs Playwright's WebKit.
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:4320/coldgas/';
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const engine = opt('engine', 'chromium');
const phone = args.includes('--phone');
const only = opt('only', '');
const jsonOut = opt('json', '');
const heatDir = opt('heat', '');   // write a per-pixel jitter heatmap + a frame per scenario here

const launcher = engine === 'webkit' ? webkit : chromium;
const browser = await launcher.launch(engine === 'webkit' ? {} : { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: engine !== 'webkit' ? true : undefined, hasTouch: true }
  : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/|404/.test(m.text())) errors.push(m.text()); });

await page.addInitScript(() => {
  const native = window.requestAnimationFrame.bind(window);
  const F = (window.__flk = { manual: false, q: [], now: 0 });
  window.requestAnimationFrame = (cb) => { if (F.manual) { F.q.push(cb); return 1; } return native(cb); };
});
await page.goto(url);
await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 30000 });
await page.evaluate(() => window.__coldgas.stage.ready);
await page.evaluate(() => window.__coldgas.stage.backdrop);   // the streamed-in backdrop (src/render/rocket.js), if any
await page.waitForTimeout(3000);   // and its lights up

// In-page harness: capture, ID pass, accumulators.
await page.evaluate(() => {
  const F = window.__flk, G = window.__coldgas, stage = G.stage;
  const renderer = stage.renderer, gl = renderer.getContext(), scene = stage.scene, camera = stage.camera;
  const REG = ['other', 'ground', 'wall', 'car', 'row', 'sky', 'backdrop'];
  // Region of each mesh, decided once from where it sits.
  const regionOf = new Map();
  const heroSet = new Set(); G.hero.group.traverse((o) => heroSet.add(o));
  const classify = () => {
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || regionOf.has(o)) return;
      let r = 0;
      if (heroSet.has(o)) r = 3;
      else if (o.geometry?.parameters?.radius >= 1000) r = 5;
      else {
        let p = o, inCourse = false, inRow = false, inBackdrop = false;
        while (p) { if (p.userData?.setBodies) inRow = true; if (p.name?.startsWith('course:')) inCourse = true; if (p.name?.startsWith('backdrop:')) inBackdrop = true; p = p.parent; }
        if (inBackdrop) r = 6;
        else if (inRow) r = 4;
        else if (inCourse) {
          o.geometry.computeBoundingBox?.();
          const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          r = b.max.y - b.min.y < 0.05 && b.max.y < 0.1 ? 1 : 2;
        }
      }
      regionOf.set(o, r);
    });
  };
  // Plain unlit ID materials (MeshBasicMaterial is reachable from any basic mesh in the scene).
  let Basic = null;
  scene.traverse((o) => { if (!Basic && o.material?.isMeshBasicMaterial) Basic = o.material.constructor; });
  const ids = REG.map((_, i) => new Basic({ color: (i * 40) << 16, toneMapped: false, fog: false, side: 2 }));
  let W = 0, H = 0, buf = null, luma = [], idb = [], k = 0;
  const alloc = () => {
    W = gl.drawingBufferWidth; H = gl.drawingBufferHeight;
    buf = new Uint8Array(W * H * 4);
    luma = [0, 1, 2].map(() => new Float32Array(W * H));
    F.heat = new Float32Array(W * H);
    idb = [0, 1, 2].map(() => new Uint8Array(W * H));
    k = 0;
  };
  const acc = () => ({ sum: Object.fromEntries(REG.map((r) => [r, 0])), pops: Object.fromEntries(REG.map((r) => [r, 0])), n: Object.fromEntries(REG.map((r) => [r, 0])), shots: [] });
  F.acc = acc();
  F.reset = () => { F.acc = acc(); k = 0; F.heat?.fill(0); F.frames = 0; };
  // Heatmap (jitter summed over the scenario, white = 24+ per frame) beside the last frame.
  F.heatPNG = () => {
    const c = document.createElement('canvas'); c.width = W * 2; c.height = H;
    const x = c.getContext('2d'), img = x.createImageData(W * 2, H), L = luma[(k - 1) % 3], fr = Math.max(1, F.frames);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const i = (H - 1 - yy) * W + xx, o = (yy * W * 2 + xx) * 4, o2 = o + W * 4;
      const h = Math.min(255, (F.heat[i] / fr) * (255 / 24));
      img.data[o] = h; img.data[o + 1] = h * 0.6; img.data[o + 2] = 0; img.data[o + 3] = 255;
      img.data[o2] = img.data[o2 + 1] = img.data[o2 + 2] = L[i]; img.data[o2 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
  F.capture = false;
  const grab = () => {
    if (gl.drawingBufferWidth !== W || gl.drawingBufferHeight !== H) alloc();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const L = luma[k % 3];
    for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.2126 * buf[j] + 0.7152 * buf[j + 1] + 0.0722 * buf[j + 2];
    // ID pass: same camera, opaque geometry only, flat colours.
    classify();
    const saved = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite)) return;
      saved.push([o, o.material, o.visible]);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!o.isMesh || m?.transparent || m?.blending === 2) { o.visible = false; return; }
      o.material = ids[regionOf.get(o) ?? 0];
    });
    const fog = scene.fog; scene.fog = null;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    scene.fog = fog;
    for (const [o, m, v] of saved) { o.material = m; o.visible = v; }
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const I = idb[k % 3];
    for (let i = 0, j = 0; i < I.length; i++, j += 4) I[i] = Math.round(buf[j] / 40);
    const shot = G.director.state.shot + ':' + G.director.state.mode;
    // staticOnly: a triple counts only if the camera didn't move (the replay's locked-off rigs).
    F.acc.shots[k % 3] = F.staticOnly ? shot + G.camera.matrixWorld.elements.join(',') : shot;
    k++;
    if (k < 3) return;
    const s = F.acc.shots;
    if (s[0] !== s[1] || s[1] !== s[2]) return;
    const a = luma[(k - 3) % 3], b = luma[(k - 2) % 3], c = luma[(k - 1) % 3], id = idb[(k - 2) % 3];
    F.frames++;
    const sum = new Float64Array(REG.length), pops = new Float64Array(REG.length), n = new Float64Array(REG.length);
    for (let i = 0; i < c.length; i++) {
      const d = Math.abs(c[i] - 2 * b[i] + a[i]), r = id[i] < REG.length ? id[i] : 0;
      sum[r] += d; n[r]++; if (d > 24) pops[r]++;
      if (F.heatReg == null || F.heatReg === r) F.heat[i] += d;
    }
    REG.forEach((r, i) => { F.acc.sum[r] += sum[i]; F.acc.pops[r] += pops[i]; F.acc.n[r] += n[i]; });
  };
  const orig = stage.render;
  stage.render = (t) => { orig(t); if (F.capture) grab(); };
  // Z-fight probe: render each pose, then the same view shifted 0.1 mm four ways. Honest edges move
  // a few thousandths of a pixel; a surface losing a depth tie to a coplanar one flips outright.
  F.nudge = (poses) => {
    const cam = G.camera;
    if (cam.view?.enabled) cam.clearViewOffset();
    const read = () => {
      if (gl.drawingBufferWidth !== W || gl.drawingBufferHeight !== H) alloc();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const L = new Float32Array(W * H);
      for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.2126 * buf[j] + 0.7152 * buf[j + 1] + 0.0722 * buf[j + 2];
      return L;
    };
    const pose = (p, dx, dy) => { cam.position.set(p[0] + dx, p[1] + dy, p[2]); cam.lookAt(p[3] + dx, p[4] + dy, p[5]); cam.updateMatrixWorld(); orig(4); return read(); };
    let pops = 0, n = 0, sum = 0;
    const each = [];
    F.nudgeHeat = [];
    for (const p of poses) {
      const A = pose(p, 0, 0), heat = new Float32Array(A.length);
      let pp = 0;
      for (const [dx, dy] of [[1e-4, 0], [0, 1e-4], [-1e-4, 0], [0, -1e-4]]) {
        const B = pose(p, dx, dy);
        for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); sum += d; n++; if (d > 24) { pops++; pp++; } heat[i] += d; }
      }
      each.push(+((1000 * pp) / (A.length * 4)).toFixed(2));
      F.nudgeHeat.push([heat, A]);
    }
    return { meanDelta: +(sum / n).toFixed(4), popsPerMille: +((1000 * pops) / n).toFixed(4), perPose: each };
  };
  F.step = (n, before) => {
    for (let i = 0; i < n; i++) {
      before?.(i);
      F.now += 1000 / 60;
      const cbs = F.q.splice(0);
      for (const cb of cbs) cb(F.now);
    }
  };
  F.take = async () => { F.manual = true; await new Promise((r) => setTimeout(r, 200)); F.now = performance.now() + 1000; F.step(3); };
  F.report = () => Object.fromEntries(REG.filter((r) => F.acc.n[r] > 0).map((r) => [r, {
    jitter: +(F.acc.sum[r] / F.acc.n[r]).toFixed(4),
    popsPerMille: +((1000 * F.acc.pops[r]) / F.acc.n[r]).toFixed(4),
    share: 0,
    px: F.acc.n[r],
  }]));
});

async function scenario(name, setup, frames, perFrame) {
  if (only && !only.split(',').includes(name)) return null;
  await page.evaluate(`(${setup})()`);
  await page.evaluate(({ frames, perFrame }) => {
    const F = window.__flk;
    const fn = perFrame ? new Function('i', 'G', perFrame) : null;
    F.step(4, fn ? (i) => fn(i - 4, window.__coldgas) : null);
    F.reset(); F.capture = true;
    F.step(frames, fn ? (i) => fn(i, window.__coldgas) : null);
    F.capture = false;
  }, { frames, perFrame });
  const rep = await page.evaluate(() => window.__flk.report());
  if (heatDir) {
    const png = await page.evaluate(() => window.__flk.heatPNG());
    (await import('node:fs')).writeFileSync(`${heatDir}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  }
  const tot = Object.values(rep).reduce((s, r) => s + r.px, 0);
  for (const r of Object.values(rep)) { r.share = +(r.px / tot).toFixed(3); delete r.px; }
  return rep;
}

await page.evaluate(() => window.__flk.take());
if (process.env.FLK_PRE) await page.evaluate(process.env.FLK_PRE);   // experiments: JS run once before the scenarios
const results = {};
const free = 'G.director.update = G.director.__u || G.director.update;';
// 1. The Show's title: the slow side sway over the car, the curl and the row.
results['show-title'] = await scenario('show-title', `() => { const G = window.__coldgas; ${free} G.toTitle(); G.S.time = 4; }`, 150);
// 2. A slow landscape dolly down the approach at chase height, the curl ahead. The camera
//    moves well under a pixel a frame, so honest motion is nearly linear and what remains is
//    shimmer: z-fighting, aliasing, texture crawl.
const dolly = (z0, y, look) => `
  if (!G.director.__u) G.director.__u = G.director.update;
  G.director.update = () => {};
  const z = ${z0} + i * 0.03; G.camera.position.set(0.6, ${y}, z); G.camera.lookAt(0, ${look}, z + 30);
  if (G.camera.fov !== 52) { G.camera.fov = 52; G.camera.updateProjectionMatrix(); }
  if (G.camera.view?.enabled) G.camera.clearViewOffset();`;
results['show-approach'] = await scenario('show-approach', '() => { window.__coldgas.S.time = 4; }', 150, dolly(-150, 2.2, 3.5));
// 3. A slow wide orbit over the whole stage: distant slab, decals and markings at grazing angles.
results['show-wide'] = await scenario('show-wide', '() => { window.__coldgas.S.time = 4; }', 150, `
  if (!G.director.__u) G.director.__u = G.director.update;
  G.director.update = () => {};
  const a = 0.9 + i * 0.0006; G.camera.position.set(Math.sin(a) * 70, 16, -40 - Math.cos(a) * 70); G.camera.lookAt(0, 4, -20);
  if (G.camera.view?.enabled) G.camera.clearViewOffset();`);
// 4. The reference replay with the director's own cuts (frame triples across a cut are skipped).
results['show-replay'] = await scenario('show-replay', `() => {
  const G = window.__coldgas; ${free}
  G.toTitle(); window.__flk.step(1);   // let the director see a fresh run
  G.startRun('reveal'); G.fastForward(); G.S.replayT = 0; G.S.time = 4;
}`, 600);
// 4b. The same replay, counting only frames where the rig is locked off: anything that changes
//     there is the scene itself (lights, plumes, bloom), not the camera.
results['show-replay-rigs'] = await scenario('show-replay-rigs', `() => {
  const G = window.__coldgas; ${free}
  G.toTitle(); window.__flk.step(1);   // let the director see a fresh run
  G.startRun('reveal'); G.fastForward(); G.S.replayT = 0; G.S.time = 4; window.__flk.staticOnly = true;
}`, 600);
await page.evaluate(() => { window.__flk.staticOnly = false; });
// 5. The Lineup's title turntable (blue hour, the painted pad).
results['lineup-title'] = await scenario('lineup-title', `() => {
  const G = window.__coldgas; ${free}
  G.toTitle(); document.querySelector('[data-course="lineup"]')?.click(); G.S.time = 4;
}`, 150);
results['lineup-approach'] = await scenario('lineup-approach', '() => { window.__coldgas.S.time = 4; }', 150, dolly(-130, 2.0, 1.2));

// 7. Z-fight probe (see F.nudge) over chase, replay, landing and wide poses, on both stages.
const nudge = {};
if (!only || only.split(',').includes('nudge')) {
  nudge.lineup = await page.evaluate(() => {
    const G = window.__coldgas;
    if (G.stage.course !== 'lineup') { G.toTitle(); document.querySelector('[data-course="lineup"]').click(); }
    const P = G.stage.titlePose();
    return window.__flk.nudge([
      [P.x + 9.6, 1.45, P.z, P.x, 0.55, P.z], [0, 2, -120, 0, 1, -90], [0, 2, -60, 0, 1, -30], [0, 2, -10, 0, 1, 20],
      [26, 3.6, P.z - 60, 0, 1, P.z - 40], [6, 1.1, P.z + 22, P.x, 0.3, P.z], [40, 16, P.z - 80, P.x, 2, P.z - 30],
    ]);
  });
  nudge.show = await page.evaluate(() => {
    const G = window.__coldgas;
    G.toTitle(); document.querySelector('[data-course="show"]').click();
    return window.__flk.nudge([
      [15, 2.4, -13, -1, 6.2, -4], [0.6, 2.2, -200, 0, 3.5, -170], [0.6, 2.2, -120, 0, 3.5, -90], [0.6, 2.2, -60, 0, 3.5, -30],
      [0.6, 2.2, -30, 0, 3.5, 0], [-3.4, 0.55, -40, 0, 0.4, -49], [5.5, 1, -54, 0, 0.5, -32], [1.9, 0.45, -2.6, 0, 8, 5],
      [31, 8.5, -9, 0.5, 11.5, 5.5], [30, 8.5, -19, 0, 3, -24], [55, 16, -83, 0, 4, -20],
    ]);
  });
  results.nudge = nudge;
}

const label = `${engine}${phone ? ' phone' : ' desktop'}`;
console.log(`\n${label}  jitter = mean |Δ²luma| (0–255), pops = ‰ pixel-frames with |Δ²luma| > 24`);
for (const [sc, rep] of Object.entries(results)) {
  if (!rep || sc === 'nudge') continue;
  const cells = Object.entries(rep).map(([r, v]) => `${r} ${v.jitter.toFixed(3)}/${v.popsPerMille.toFixed(2)}‰ (${Math.round(v.share * 100)}%)`);
  console.log(`${sc.padEnd(16)} ${cells.join('  ')}`);
}
for (const [c, v] of Object.entries(nudge)) console.log(`z-fight ${c.padEnd(8)} mean |Δluma| ${v.meanDelta.toFixed(3)}, ${v.popsPerMille.toFixed(2)}‰ px flip > 24 under a 0.1 mm camera shift  per pose ‰ [${v.perPose.join(" ")}]`);
if (errors.length) console.log('errors:', errors.slice(0, 5).join(' | '));
if (jsonOut) (await import('node:fs')).writeFileSync(jsonOut, JSON.stringify({ label, url, results }, null, 2));
await browser.close();
