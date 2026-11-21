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

// The page's own frame loop calls drive.frame with the wall-clock dt between the test's evaluates, so on a
// slow runner the car coasts (or, with ↑ down, drives) an unknown way between them: main's CI on
// d77eeaa rammed the same tree to -0.79 m where a fast runner gets -1.32 (reproduced at 8× CPU
// throttle). Hold the loop at dt 0 (it still draws, and the near tiles still stream in) and step the
// sim only from the test, through the frame kept as drive.step. The waits for the near tiles step it at
// dt 0 too (they draw, the car stays), so how many a runner needs can't move the car or the tree it picks.
const hold = (page) => page.evaluate(() => {
  const d = window.__coldgas.drive;
  if (d.step) return;
  const frame = d.frame;
  d.step = frame;
  d.frame = (dt, time) => frame(0, time);
});

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

// The car's nose is ≈ 2.4 m ahead of its centre (src/sim/vehicle.js's hull); a trunk the car is stopped by keeps its
// centre at least that far back, less what the nose may crush (≤ 0.35 m) plus the trunk's radius.
const NOSE = 2.4;

// In the page, in one evaluate (so the page's loop can't step the car between set-up and run): a fresh car (and a
// fresh world) on the ground 12 m short of the trunk, on the flattest of eight approaches, facing it at 12 m/s; a
// pilot holds full throttle and steers for the trunk's centre (or for a point `off` m to its side, the negative
// control); 25 frames of 0.1 s. Per frame: how far along the line past the trunk's centre the car is, and how far off
// it; the frame the car lost the most speed is the contact.
const ram = async (page, tree, off = 0) => page.evaluate(({ t, off }) => {
  const d = window.__coldgas.drive, course = d.course, o = {};
  let c = d.car;
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const ground = (x, z) => { let lo = c.pos.y - 300, hi = c.pos.y + 300; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (course.sdf(x, m, z, o) > 0) hi = m; else lo = m; } course.sdf(x, hi + 0.01, z, o); return { y: hi, ny: o.y }; };
  // The approach with the flattest ground (picked for the trunk itself, so the control runs the same line, beside it).
  let best = null;
  for (const [dx, dz] of dirs) {
    const a = ground(t.x - dx * 12, t.z - dz * 12), b = ground(t.x - dx * 6, t.z - dz * 6), e = ground(t.x, t.z);
    const score = Math.min(a.ny, b.ny) - Math.abs(a.y - e.y) * 0.05;
    if (!best || score > best.score) best = { dx, dz, score };
  }
  const { dx, dz } = best, lx = dz, lz = -dx;            // the line's direction, and its side
  const gx = t.x + lx * off, gz = t.z + lz * off;        // where the pilot aims
  const sx = gx - dx * 12, sz = gz - dz * 12;
  d.place({ x: sx, y: ground(sx, sz).y, z: sz, yaw: Math.atan2(dx, dz) });
  c = d.car;
  c.vel.x = dx * 12; c.vel.z = dz * 12;
  for (const wh of c.wheels) wh.omega = 12 / 0.35;
  d.state.acc = 0;
  // Pure pursuit on the aim point, full throttle (a test's pilot: nothing a player has).
  const pin = { throttle: 1, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 };
  d.state.pilot = (car) => {
    const q = car.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const ex = gx - car.pos.x, ez = gz - car.pos.z, right = -(ex * fz - ez * fx), ahead = ex * fx + ez * fz;
    const v2 = car.vel.x * car.vel.x + car.vel.z * car.vel.z, lock = Math.min(0.5, (2.825 * 1.25 * 9.81) / Math.max(1, v2) + 0.04);   // vehicle.js rackLock (wheelbase, μ 1.25, steerLock 0.5)
    const delta = Math.atan((2 * 2.825 * Math.sin(Math.atan2(right, ahead))) / Math.max(1, Math.hypot(ex, ez)));
    pin.steer = ahead > 0.5 ? Math.max(-1, Math.min(1, (delta / lock) * 1.1)) : 0;
    return pin;
  };
  const frames = [];
  let past = -Infinity, vMin = Infinity, v0 = Math.hypot(c.vel.x, c.vel.z), drop = 0, contact = null;
  try {
    for (let k = 0; k < 25; k++) {
      d.step(0.1, k * 0.1);
      c = d.car;
      const ex = c.pos.x - t.x, ez = c.pos.z - t.z, along = ex * dx + ez * dz, lat = ex * lx + ez * lz, v = Math.hypot(c.vel.x, c.vel.z);
      past = Math.max(past, along); vMin = Math.min(vMin, v);
      if (v0 - v > drop) { drop = v0 - v; contact = { k, along, lat, before: v0, after: v }; }
      frames.push([+along.toFixed(3), +lat.toFixed(3), +v.toFixed(3)]);
      v0 = v;
    }
  } finally { d.state.pilot = null; }
  return { past, vMin, drop, contact, frames };
}, { t: tree, off });

// A hit on this trunk, not just a slow car: the car lost ≥ 3 m/s in one frame, at the trunk (its centre a nose plus at
// most a trunk's radius and a metre's slack short of it along the line, so something else on the run-in can't count)
// and within 1 m of the line (dead on: the glancing blow 0304 found was 1.58 m off), it never got closer along the line
// than its nose (less a crush), and it ended slow.
const isHit = (h) => !!h.contact && h.drop >= 3 && h.contact.along > -(NOSE + 1.5) && Math.abs(h.contact.lat) < 1.0 &&
  h.past < -(NOSE - 0.2) && h.vMin < 3;

// Dead on, the trunk stops the car (the same, bit for bit, after the page's loop has run 1.5 s more); the same run
// aimed 1.5 m beside the trunk (a glancing blow, or a graze) and 3 m beside it (a clean miss) is no hit.
const rams = async (page, tree) => {
  const hit = await ram(page, tree);
  expect(isHit(hit), JSON.stringify({ ...hit, frames: undefined })).toBe(true);
  await page.waitForTimeout(1500);
  expect(await ram(page, tree)).toEqual(hit);
  for (const off of [1.5, 3]) {
    const miss = await ram(page, tree, off);
    expect(isHit(miss), JSON.stringify({ off, ...miss, frames: undefined })).toBe(false);
  }
};

test('@heavy Free Drive (Stelvio): the trees drawn near the car are its solid trunks, and one stops the car', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=stelvio&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  await hold(page);
  // Drive a little way up the road (the pilot), into the woods, and let the near tiles draw.
  await page.evaluate(() => { const d = window.__coldgas.drive; d.goto(2400); d.autopilot(true, { vmax: 15 }); for (let n = 0; n < 30; n++) d.step(0.1, performance.now() / 1000); d.autopilot(false); });
  let r = null;
  for (let k = 0; k < 20; k++) {
    r = await page.evaluate(compare, ['tree']);
    if (r.solids > 0 && r.unsolid === 0 && r.unseen === 0) break;
    await page.evaluate(() => window.__coldgas.drive.step(0, performance.now() / 1000));
  }
  expect(r.solids).toBeGreaterThan(5);
  expect(r.unsolid).toBe(0);
  expect(r.unseen).toBe(0);
  expect(r.tree).not.toBeNull();
  await rams(page, r.tree);
  expect(errors).toEqual([]);
});

test('@heavy Endless: trees and boulders drawn near the car are solid, and none are solid unseen', async ({ page }) => {
  test.slow();
  const errors = watch(page);
  await page.goto('/coldgas/?drive=endless&seed=forest&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  await hold(page);
  await page.evaluate(() => { const d = window.__coldgas.drive; d.autopilot(true, { vmax: 20 }); for (let n = 0; n < 60; n++) d.step(0.1, performance.now() / 1000); d.autopilot(false); });
  let r = null;
  for (let k = 0; k < 40; k++) {
    r = await page.evaluate(compare, ['conifer', 'conifer-hi', 'broad', 'rock']);
    if (r.solids > 0 && r.unsolid === 0 && r.unseen === 0) break;
    await page.evaluate(() => window.__coldgas.drive.step(0, performance.now() / 1000));
  }
  expect(r.solids).toBeGreaterThan(5);
  expect(r.unsolid).toBe(0);
  expect(r.unseen).toBe(0);
  expect(r.tree).not.toBeNull();
  await rams(page, r.tree);
  expect(errors).toEqual([]);
});
