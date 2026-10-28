#!/usr/bin/env node
// What the per-tick input path allocates (0049): input.js sample() on the ground, in the air and in
// Advanced, one-thumb's sampleThumb, the hands, and the input log's quantise + compare in run.js. Each
// path runs 200k ticks under V8's sampling heap profiler, which counts everything allocated, collected
// or not. Twice: keys and touch alone, where nothing may be allocated (a boxed number is 16 bytes, so the
// budget is under one per hundred ticks), then with a gamepad plugged in (getGamepads() returns a fresh
// array on every call, as Chrome's does), where V8 still boxes one stick number a tick in the air and
// one valve a tick in Advanced: the budget there is two (main before 0049: 750-1430 B a tick).
//   npm run alloc:bench   (exit 1 on any path over budget)
import { Session } from 'node:inspector/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each device in a process of its own: the JIT's state from one would carry into the other.
const MODE = process.env.ALLOC_MODE;
if (!MODE) {
  let code = 0;
  for (const mode of ['keys', 'pad']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, ALLOC_MODE: mode } });
    code ||= r.status ?? 1;
  }
  process.exit(code);
}

const pad = { axes: [0.3, -0.2, 0.1, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 7 ? 0.6 : i === 0 ? 1 : 0 })) };
const padIn = MODE === 'pad';
Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => (padIn ? [pad, null, null, null] : []), configurable: true });
const { sample, sampleThumb, pollPads } = await import('../src/input.js');
const { createHands } = await import('../src/hands.js');
const { newInput } = await import('../src/sim/vehicle.js');
const { createRun, logInput } = await import('../src/sim/run.js');
const { initPhysics } = await import('../src/sim/engine.js');
await initPhysics();

const N = 200_000;
const BUDGET = { keys: 0.16, pad: 33 };   // bytes per tick
const session = new Session();
session.connect();
async function bench(fn) {
  for (let i = 0; i < 100_000; i++) fn(i);   // warm: the JIT settles first
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  const t0 = performance.now();
  for (let i = 0; i < N; i++) fn(i);
  const ns = ((performance.now() - t0) / N) * 1e6;
  const { profile } = await session.post('HeapProfiler.stopSampling');
  // Only what the game's own modules allocated (not the profiler's session or this script).
  let bytes = 0;
  const where = new Map();
  const walk = (n) => {
    const url = n.callFrame.url;
    if (n.selfSize && url.includes('/src/')) {
      bytes += n.selfSize;
      const at = `${url.slice(url.indexOf('/src/') + 1)}:${n.callFrame.lineNumber + 1} ${n.callFrame.functionName}`;
      where.set(at, (where.get(at) || 0) + n.selfSize);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  return { ns, bytes: bytes / N, where: [...where].sort((a, b) => b[1] - a[1]).slice(0, 3) };
}

const run = createRun('show'), car = run.car;
car.vel.z = 12;   // rolling: the hands' speed-aware steering and the driving aids are awake
const out = newInput(), hands = createHands(), keysDown = { up: true, right: true }, raw = newInput();
// Free Drive on Stelvio, rolling in the lane: AI drive (0109, on by default) follows the road every tick.
const { loadRoad } = await import('./drive-feel.mjs');
const { createRoadCourse, poseAt } = await import('../src/sim/roads.js');
const { createVehicle } = await import('../src/sim/vehicle.js');
const { quatFromYaw } = await import('../src/sim/m3.js');
const road = await loadRoad('stelvio'), fdCar = createVehicle(createRoadCourse(road)), fdCtx = { free: true, road };
{ const p = poseAt(road, 200, 1); fdCar.pos.x = p.x; fdCar.pos.y = p.y + 0.5; fdCar.pos.z = p.z; quatFromYaw(fdCar.quat, p.yaw); fdCar.vel.x = 14 * Math.sin(p.yaw); fdCar.vel.z = 14 * Math.cos(p.yaw); }
const rows = {
  'sample ground': () => sample('drive', 'assist', out, false, car),
  'sample air': () => sample('air', 'pro', out, true, car),
  'sample advanced': () => sample('air', 'advanced', out, true, car),
  'sampleThumb': () => sampleThumb(run, false, out),
  'hands.keyboard': () => hands.keyboard(keysDown, car, 'assist', out),
  // The game's own chain, a tick of a live run: sample the devices, then quantise, compare and log
  // (logInput is stepRun less the physics; the pads are copied once a frame, not here).
  'sample → run log': () => { logInput(run, sample('air', 'pro', out, true, car)); run.tick++; },
  // Last: a road in the context makes sample() see a second shape of ctx, and the rows after it would measure that.
  'sample Free Drive (AI drive)': () => sample('drive', 'assist', out, false, fdCar, fdCtx),
};
let bad = 0;
pollPads();   // once a frame in the game: every tick of the frame samples the pads it copied
console.log(padIn ? 'With a gamepad' : 'Keys and touch');
for (const [name, fn] of Object.entries(rows)) {
  const r = await bench(fn);
  const ok = r.bytes <= BUDGET[MODE];
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(28)} ${r.ns.toFixed(0).padStart(5)} ns/tick  ${r.bytes.toFixed(3).padStart(7)} B/tick${ok ? '' : `   ${r.where.map(([w, b]) => `${w} ${(b / N).toFixed(1)} B`).join(' · ')}`}`);
}
session.disconnect();
process.exit(bad ? 1 : 0);
