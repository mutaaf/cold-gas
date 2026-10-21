import { test, expect } from '@playwright/test';

// What you see is what you hit (Free Drive, the endless world): every tree the renderer draws near
// the car has a solid trunk in the physics, at the same place and size, and every trunk or boulder
// the physics has is drawn; and a car driven at a drawn tree stops at it. CI's software GL renders a
// few frames a second, so the sim is stepped in 0.1 s frames; test.slow() for the world's build and
// shader compile on that GL, not for anything waiting on wall-clock time.
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  return errors;
};

// In the page: the drawn props near the car (instanced meshes by material/pool name, world
// positions and widths) against the physics' solids in the cells it has built.
const compare = (kinds) => {
  const d = window.__coldgas.drive, w = d.car.world, F = w.free, R = 16;
  const key = (x, z) => `${Math.floor(x / R)},${Math.floor(z / R)}`;
  const built = new Set([...F.cells.values()].map((c) => `${c.ix},${c.iz}`));
  const solids = [];
  for (const c of F.cells.values()) for (const col of c.cols) {
    const info = w.info.get(col.handle);
    if (!info || info.approx || (info.mat.id !== 'wood' && info.mat.id !== 'rock')) continue;   // the props (not the ground's heightfield)
    const t = col.translation();
    solids.push({ x: t.x + w.ox, z: t.z + w.oz, kind: info.mat.id, r: info.mat.id === 'wood' ? col.radius() : 0 });
  }
  const drawn = [];
  const M = new (window.__coldgas.stage.camera.matrixWorld.constructor)(), P = new (window.__coldgas.stage.camera.position.constructor)();
  window.__coldgas.stage.scene.traverse((o) => {
    if (!o.isInstancedMesh || !kinds.includes(o.material.name === 'endless-rock' ? 'rock' : o.name || o.material.name)) return;
    o.updateMatrixWorld(true);
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, M);
      if (M.elements[15] === 0 || (M.elements[0] === 0 && M.elements[2] === 0)) continue;   // a free pool slot
      M.premultiply(o.matrixWorld);
      P.setFromMatrixPosition(M);
      if (!built.has(key(P.x, P.z))) continue;
      drawn.push({ x: P.x, z: P.z, kind: o.material.name === 'endless-rock' ? 'rock' : 'wood', w: Math.hypot(M.elements[0], M.elements[2]) });
    }
  });
  const near = (a, list) => list.find((b) => b.kind === a.kind && Math.hypot(a.x - b.x, a.z - b.z) < 0.05);
  return {
    solids: solids.length, drawn: drawn.length,
    unsolid: drawn.filter((a) => !near(a, solids)).length,         // drawn, not solid
    unseen: solids.filter((a) => !near(a, drawn)).length,          // solid, not drawn (an invisible wall)
    tree: drawn.find((a) => a.kind === 'wood' && Math.hypot(a.x - d.car.pos.x, a.z - d.car.pos.z) < 60 && near(a, solids)?.r > 0.25) ?? null,
  };
};

// In the page: put the car 12 m short of (x, z) on the ground, facing it at 12 m/s, hold the
// throttle, step 2.5 s; how far past the trunk's centre it got and how fast it is going.
const ram = async (page, tree) => {
  await page.evaluate((t) => {
    const d = window.__coldgas.drive, c = d.car, course = d.course, o = {};
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
    const ground = (x, z) => { let lo = c.pos.y - 300, hi = c.pos.y + 300; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (course.sdf(x, m, z, o) > 0) hi = m; else lo = m; } course.sdf(x, hi + 0.01, z, o); return { y: hi, ny: o.y }; };
    // The approach with the flattest ground.
    let best = null;
    for (const [dx, dz] of dirs) {
      const a = ground(t.x - dx * 12, t.z - dz * 12), b = ground(t.x - dx * 6, t.z - dz * 6), e = ground(t.x, t.z);
      const score = Math.min(a.ny, b.ny) - Math.abs(a.y - e.y) * 0.05;
      if (!best || score > best.score) best = { dx, dz, y: a.y, score };
    }
    const yaw = Math.atan2(best.dx, best.dz);
    c.pos.x = t.x - best.dx * 12; c.pos.y = best.y + 0.45; c.pos.z = t.z - best.dz * 12;
    c.quat.x = 0; c.quat.y = Math.sin(yaw / 2); c.quat.z = 0; c.quat.w = Math.cos(yaw / 2);
    c.vel.x = best.dx * 12; c.vel.y = 0; c.vel.z = best.dz * 12;
    c.angVel.x = 0; c.angVel.y = 0; c.angVel.z = 0; c.angMom.x = 0; c.angMom.y = 0; c.angMom.z = 0;
    for (const wh of c.wheels) wh.omega = 12 / 0.35;
    window.__ram = { ...t, dx: best.dx, dz: best.dz, past: -Infinity };
  }, tree);
  await page.keyboard.down('ArrowUp');
  for (let k = 0; k < 25; k++) {
    await page.evaluate(() => {
      const d = window.__coldgas.drive, c = d.car, r = window.__ram;
      d.frame(0.1, performance.now() / 1000);
      const ex = c.pos.x - r.x, ez = c.pos.z - r.z, lat = Math.abs(ex * r.dz - ez * r.dx);
      if (lat < 1.5) r.past = Math.max(r.past, ex * r.dx + ez * r.dz);
    });
  }
  await page.keyboard.up('ArrowUp');
  return page.evaluate(() => ({ past: window.__ram.past, v: Math.hypot(window.__coldgas.drive.car.vel.x, window.__coldgas.drive.car.vel.z) }));
};

test('Free Drive (Stelvio): the trees drawn near the car are its solid trunks, and one stops the car', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=stelvio&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  // Drive a little way up the road (the pilot), into the woods, and let the near tiles draw.
  await page.evaluate(() => { const d = window.__coldgas.drive; d.goto(2400); d.autopilot(true, { vmax: 15 }); for (let n = 0; n < 30; n++) d.frame(0.1, performance.now() / 1000); d.autopilot(false); });
  let r = null;
  for (let k = 0; k < 20; k++) {
    r = await page.evaluate(compare, ['tree']);
    if (r.solids > 0 && r.unsolid === 0 && r.unseen === 0) break;
    await page.evaluate(() => window.__coldgas.drive.frame(0.05, performance.now() / 1000));
  }
  expect(r.solids).toBeGreaterThan(5);
  expect(r.unsolid).toBe(0);
  expect(r.unseen).toBe(0);
  expect(r.tree).not.toBeNull();
  const hit = await ram(page, r.tree);
  expect(hit.past).toBeLessThan(-1);            // stopped short of the trunk: the car's nose is ≈ 2.4 m ahead of its centre
  expect(hit.v).toBeLessThan(5);
  expect(errors).toEqual([]);
});

test('Endless: trees and boulders drawn near the car are solid, and none are solid unseen', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=endless&seed=forest&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  await page.evaluate(() => { const d = window.__coldgas.drive; d.autopilot(true, { vmax: 20 }); for (let n = 0; n < 60; n++) d.frame(0.1, performance.now() / 1000); d.autopilot(false); });
  let r = null;
  for (let k = 0; k < 40; k++) {
    r = await page.evaluate(compare, ['conifer', 'conifer-hi', 'broad', 'rock']);
    if (r.solids > 0 && r.unsolid === 0 && r.unseen === 0) break;
    await page.evaluate(() => window.__coldgas.drive.frame(0.05, performance.now() / 1000));
  }
  expect(r.solids).toBeGreaterThan(5);
  expect(r.unsolid).toBe(0);
  expect(r.unseen).toBe(0);
  expect(r.tree).not.toBeNull();
  const hit = await ram(page, r.tree);
  expect(hit.past).toBeLessThan(-1);
  expect(hit.v).toBeLessThan(5);
  expect(errors).toEqual([]);
});
