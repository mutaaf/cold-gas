// FREE DRIVE: the roadster on real roads (a lazy chunk; nothing here loads until it's picked).
//
// The same car and the same physics as the stunts (src/sim/vehicle.js: tyres, suspension,
// 1 MW, the fan, all ten thrusters) on a road course built from OpenStreetMap and open terrain
// (src/sim/roads.js). No score and no judges; a best time from the start to the end of the road
// is kept on this device. R puts the car back on the road, C changes the camera, T the time of
// day, X the suction fan.
import './drive.css';
import * as THREE from 'three';
import { ROADS } from './manifest.js';
import { loadRoad } from './load.js';
import { createRoadWorld } from '../render/road.js';
import { createRoadCourse, poseAt, nearestSample, roadSurface } from '../sim/roads.js';
import { createVehicle, step, DT, CAR } from '../sim/vehicle.js';
import { freeWorld } from '../sim/world.js';
import { loadPhysics } from '../sim/engine-web.js';
import { quatFromYaw } from '../sim/m3.js';
import { SPEC } from '../sim/spec.js';
import { createDriveCamera } from './camera.js';
import { renderPicker, createHud, createEndlessHud, randomSeed, fmtTime } from './hud.js';
import { createPilot } from './pilot.js';
import { createBuildLayer } from '../build/layer.js';
import { roadHost } from '../build/road-host.js';
import { createPoseLerp } from '../render/interp.js';
import { createReverse } from '../hands.js';

export { ROADS };
export const DEFAULT_ROAD = 'stelvio';
export const ENDLESS = 'endless';
const sanitizeSeed = (v) => String(v ?? '').trim().slice(0, 24).replace(/[^\w\-. ]/g, '');
const RESET_PENALTY = 5;     // s added to a timed run per reset

export function createDrive(ctx) {
  const { stage, hero, carRoot, plumes, crash, syncCar, ui, audio, input, tier } = ctx;
  const camera = stage.camera;
  const pickerRoot = document.querySelector('[data-drive-picker]');
  const hudRoot = document.querySelector('[data-drive-hud]');
  const pauseRoot = document.querySelector('[data-drive-pause]');
  let tod = 'day';
  try { tod = localStorage.getItem('coldgas_drive_tod') === 'dusk' ? 'dusk' : 'day'; } catch { /* storage blocked */ }
  let selected = DEFAULT_ROAD;
  try { const r = localStorage.getItem('coldgas_drive_road'); if (r === ENDLESS || ROADS.some((x) => x.id === r)) selected = r; } catch { /* storage blocked */ }
  let seed = '';
  try { seed = sanitizeSeed(localStorage.getItem('coldgas_drive_seed')); } catch { /* storage blocked */ }
  if (!seed) seed = randomSeed();

  const st = {
    active: false, loading: false, paused: false, road: null, info: null, world: null, course: null, car: null, cam: null, hud: null,
    acc: 0, hint: 0, fan: false, airT: 0, flipT: 0, stuckT: 0, timer: null, best: null, finished: false, penalty: 0, lastCue: 0,
    pilot: null, lamp: null, sn: { x: 0, y: 0, z: 0 }, ground: 0, startedAt: 0, frames: 0, fpsT: 0, fps: 0,
  };
  const comps = [0, 0, 0, 0], spins = [0, 0, 0, 0];
  const poseLerp = createPoseLerp(), reverse = createReverse();
  let picker = null;

  // --- The picker ------------------------------------------------------------------------------
  function openPicker() {
    pickerRoot.hidden = false;
    picker = renderPicker(pickerRoot, ROADS, {
      selected, tod, seed,
      onPick: (id) => { selected = id; picker.select(id); },
      onTod: (t) => { tod = t; picker.tod(t); },
      onSeed: (v) => { seed = sanitizeSeed(v) || seed; },
      onDrive: () => start(selected, { tod, seed }),
      onBack: closePicker,
    });
    pickerRoot.querySelector('[data-road][aria-checked="true"]')?.focus({ preventScroll: true });
  }
  function closePicker() { pickerRoot.hidden = true; pickerRoot.innerHTML = ''; picker = null; }

  // --- Start / stop ----------------------------------------------------------------------------
  async function start(id, opts = {}) {
    if (st.loading) return;
    if (id === ENDLESS) return startEndless(opts);
    const info = ROADS.find((r) => r.id === id) || ROADS[0];
    tod = opts.tod === 'dusk' ? 'dusk' : opts.tod === 'day' ? 'day' : tod;
    selected = info.id;
    try { localStorage.setItem('coldgas_drive_road', info.id); localStorage.setItem('coldgas_drive_tod', tod); } catch { /* storage blocked */ }
    st.loading = true;
    if (!picker) openPicker();
    const prog = (f, label) => picker?.loading(true, f, label);
    try {
      audio.initAudio();
      if (st.active) teardown();
      const [road] = await Promise.all([loadRoad(info.id, prog), loadPhysics()]);
      await stage.ready;
      prog(0.75, 'Raising the mountains');
      await new Promise((r) => setTimeout(r, 0));
      const world = createRoadWorld({ road, info, tier, renderer: stage.renderer, tod });
      const pose = poseAt(road, 18, 1);
      world.prime(pose.x, pose.z, (f) => prog(0.75 + f * 0.2, 'Laying the road'));
      prog(0.97, 'Warming up');
      await enter(road, info, world, createRoadCourse(road, { name: info.name }), 18);
      ui.cue_(`${info.name} · ${info.country}`, 2600);
    } catch (err) {
      console.error(err);
      picker?.loading(true, 0, 'Couldn’t load this road. Try again.');
      setTimeout(() => picker?.loading(false), 2400);
    } finally {
      st.loading = false;
    }
  }

  // Everything after the world is built, for a real road or the endless one: camera, light,
  // the car at distance s, the HUD, and into the drive.
  async function enter(road, info, world, course, s) {
    st.road = road; st.info = info; st.world = world; st.course = course;
    // The build / power-up / quest layer (src/build/): its pieces join the road's ground.
    st.layer = createBuildLayer(roadHost({ road, info, course: st.course, stage, carRoot, getCar: () => st.car, placeCar: placePose }), {
      ui, audio, tier, coarse: ctx.coarse, usingTouch: input.usingTouch,
      onEditing: (on) => { ui.touch.hidden = on || !(ctx.coarse || input.usingTouch()); hudRoot.hidden = on; if (!on) st.cam?.snap(); },
    });
    st.course = st.layer.course;
    st.cam = createDriveCamera(camera, road, (x, y, z, o) => st.course.sdf(x, y, z, o));
    camera.clearViewOffset?.();
    camera.near = 0.5; camera.far = 46000; camera.updateProjectionMatrix();
    stage.setLook(world.look);
    st.bias = [stage.key.shadow.bias, stage.key.shadow.normalBias];
    stage.key.shadow.normalBias = 0.12; stage.key.shadow.bias = -0.0008;
    // Headlamps that light the road at dusk.
    st.lamp = new THREE.SpotLight(0xfff1dc, 0, 140, 0.42, 0.55, 1.4);
    st.lamp.position.set(0, 0.15, 1.9); st.lamp.target.position.set(0, -1.2, 30);
    carRoot.add(st.lamp, st.lamp.target);
    setLamps();
    try { st.best = road.endless ? null : Number(localStorage.getItem(`coldgas_drive_best_${info.id}`)) || null; } catch { st.best = null; }
    placeAt(s, 1, true);
    const handlers = { onCamera: cycleCam, onTod: () => setTod(tod === 'day' ? 'dusk' : 'day'), onReset: () => respawn(), onExit: exit, onFan: toggleFan, onShare: shareSeed };
    st.hud = road.endless ? createEndlessHud(hudRoot, road, info, handlers) : createHud(hudRoot, road, info, handlers);
    st.hud.setTod(tod); st.hud.setCam(st.cam.mode); st.hud.setFan(st.fan);
    await stage.renderer.compileAsync?.(stage.scene, camera).catch?.(() => {});
    closePicker();
    ui.only();
    hudRoot.hidden = false;
    document.body.classList.add('driving');
    ui.touch.hidden = !(ctx.coarse || input.usingTouch());
    ui.touch.dataset.phase = 'ground'; ui.touch.dataset.scheme = 'classic'; ui.touch.dataset.course = 'drive';
    st.active = true; st.paused = false; st.acc = 0; st.driveT = 0;
    ctx.setMode('drive');
    bindKeys(true);
  }

  // THE ENDLESS ROAD: a world generated from its seed as you drive (src/sim/endless.js for the
  // land and the road, src/world/ to draw it). The world module loads only when it's picked.
  async function startEndless(opts = {}) {
    tod = opts.tod === 'dusk' ? 'dusk' : opts.tod === 'day' ? 'day' : tod;
    seed = sanitizeSeed(opts.seed) || seed || randomSeed();
    selected = ENDLESS;
    try { localStorage.setItem('coldgas_drive_road', ENDLESS); localStorage.setItem('coldgas_drive_tod', tod); localStorage.setItem('coldgas_drive_seed', seed); } catch { /* storage blocked */ }
    st.loading = true;
    if (!picker) openPicker();
    const prog = (f, label) => picker?.loading(true, f, label);
    try {
      audio.initAudio();
      if (st.active) teardown();
      prog(0.05, 'Laying out the land');
      const [{ createEndlessCourse, biomeName }, { createObjects }, { createEndlessWorld }] = await Promise.all([
        import('../sim/endless.js'), import('../sim/objects.js'), import('../world/endless-world.js'),
      ]);
      await stage.ready;
      // The course, and the registry of things placed in it (they sit on its ground, and collide).
      const course = createEndlessCourse(seed);
      const road = course.road;
      course.objects = createObjects({ seed: road.seed, groundY: (x, z) => course.world?.groundAt(x, z).y ?? road.dem(x, z, [0, 0, 0])[0] });
      const info = { id: ENDLESS, name: 'Endless', local: biomeName(road, 30), country: `Seed ${seed}`, seedLabel: seed, sun: { az: 205, el: 34 }, credit: { osm: '', dem: '' } };
      prog(0.15, 'Raising the land');
      const world = createEndlessWorld({ course, tier, renderer: stage.renderer, tod, info, idb: opts.idb !== false });
      course.world = world;
      const pose = poseAt(road, 60, 1);
      await world.prime(pose.x, pose.z, (f) => prog(0.15 + f * 0.8, f < 0.5 ? 'Raising the land' : 'Laying the road'));
      prog(0.97, 'Warming up');
      await enter(road, info, world, course, 60);
      ui.cue_(`Endless · seed ${seed}`, 2600);
    } catch (err) {
      console.error(err);
      picker?.loading(true, 0, 'Couldn’t build this world. Try again.');
      setTimeout(() => picker?.loading(false), 2400);
    } finally {
      st.loading = false;
    }
  }

  // A link to this world (same seed, same land, same road).
  function shareSeed(btn) {
    const url = new URL(location.href);
    url.search = ''; url.searchParams.set('drive', ENDLESS); url.searchParams.set('seed', seed);
    if (tod === 'dusk') url.searchParams.set('tod', 'dusk');
    const done = () => { ui.cue_('Link to this world copied', 1600); if (btn) btn.blur(); };
    try { navigator.clipboard?.writeText(url.toString()).then(done, () => ui.cue_(url.toString(), 4000)); } catch { ui.cue_(url.toString(), 4000); }
  }

  function teardown() {
    bindKeys(false);
    st.layer?.dispose(); st.layer = null;
    if (st.lamp) { carRoot.remove(st.lamp, st.lamp.target); st.lamp.dispose(); st.lamp = null; }
    stage.setLook(null);
    if (st.bias) { stage.key.shadow.bias = st.bias[0]; stage.key.shadow.normalBias = st.bias[1]; st.bias = null; }
    st.world?.dispose();
    if (st.car) freeWorld(st.car.world);
    st.world = null; st.road = null; st.course = null; st.car = null;
    camera.near = 0.1; camera.far = 4000; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
    hudRoot.hidden = true; hudRoot.innerHTML = '';
    pauseRoot.hidden = true;
    document.body.classList.remove('driving');
    st.active = false;
  }

  function exit() {
    if (!st.active) { closePicker(); return; }
    teardown();
    crash.reset();
    plumes.clear();
    ctx.onExit();
  }

  // --- The car ---------------------------------------------------------------------------------
  // Put a fresh car on the road at distance s (m), facing dir (+1 up the road, −1 back down).
  function placeAt(s, dir, resetTimer) {
    const road = st.road;
    const p = poseAt(road, s, dir);
    if (st.car) freeWorld(st.car.world);
    const car = createVehicle(st.course);
    car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
    quatFromYaw(car.quat, p.yaw);
    st.car = car; st.hint = p.i;
    st.airT = 0; st.flipT = 0; st.stuckT = 0;
    if (resetTimer) { st.timer = null; st.finished = false; st.penalty = 0; }
    st.layer?.reset();
    crash.reset(); plumes.clear();
    const sag = car.wheels[0].compression;
    comps.fill(sag); spins.fill(0);
    syncCar(car.pos, car.quat, comps, spins, 0);
    st.cam?.snap();
  }

  // A fresh car at a pose (a quest's start): { x, y, z, yaw }.
  function placePose(p) {
    if (st.car) freeWorld(st.car.world);
    const car = createVehicle(st.course);
    car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
    quatFromYaw(car.quat, p.yaw);
    st.car = car; st.hint = nearestSample(st.road, p.x, p.z);
    st.airT = 0; st.flipT = 0; st.stuckT = 0;
    st.layer?.reset();
    crash.reset(); plumes.clear();
    comps.fill(car.wheels[0].compression); spins.fill(0);
    syncCar(car.pos, car.quat, comps, spins, 0);
    st.cam?.snap();
  }

  // Back on the road at the nearest point, facing the way the car was going.
  function respawn() {
    if (!st.car) return;
    const road = st.road, c = st.car;
    const i = road.endless ? nearestSample(road, c.pos.x, c.pos.z, st.hint, 2000) : nearestSample(road, c.pos.x, c.pos.z);
    const fx = 2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), fz = 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y);
    const m = Math.min(i, road.m - 1);
    const dir = road.dx[m] * (Math.abs(c.vel.x) + Math.abs(c.vel.z) > 2 ? c.vel.x : fx) + road.dz[m] * (Math.abs(c.vel.x) + Math.abs(c.vel.z) > 2 ? c.vel.z : fz) >= 0 ? 1 : -1;
    const s = Math.max(6, Math.min(road.length - 6, i * road.meta.spacing));
    placeAt(s, dir, false);
    if (st.timer != null && !st.finished) { st.penalty += RESET_PENALTY; ui.cue_(`Back on the road · +${RESET_PENALTY} s`, 1600); }
    else ui.cue_('Back on the road', 1200);
  }

  function restart() { placeAt(st.road?.endless ? 60 : 18, 1, true); pause(false); ui.cue_('From the start', 1200); }

  // --- Controls --------------------------------------------------------------------------------
  function cycleCam() { const m = st.cam.cycle(); st.hud.setCam(m); ui.cue_(`Camera · ${m}`, 1000); }
  function setTod(t) {
    tod = t;
    try { localStorage.setItem('coldgas_drive_tod', t); } catch { /* storage blocked */ }
    stage.setLook(st.world.setTod(t));
    setLamps();
    st.hud.setTod(t);
  }
  function setLamps() { if (st.lamp) st.lamp.intensity = st.world.look.lamps ? 25 : 0; }
  function toggleFan() {
    st.fan = !st.fan; st.hud?.setFan(st.fan);
    ui.cue_(st.fan ? 'Fan armed · suction follows the grade and the grip, up to 46 kN' : 'Fan off', 1600);
  }
  const onKey = (e) => {
    if (!st.active || e.repeat || e.metaKey || e.ctrlKey || e.altKey || st.layer?.editing) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyR') respawn();
    else if (e.code === 'KeyC') cycleCam();
    else if (e.code === 'KeyT') setTod(tod === 'day' ? 'dusk' : 'day');
    else if (e.code === 'KeyX') toggleFan();
  };
  function bindKeys(on) { if (on) addEventListener('keydown', onKey); else removeEventListener('keydown', onKey); }

  function pause(on = !st.paused) {
    if (!st.active || st.layer?.editing) return;
    st.paused = on;
    pauseRoot.hidden = !on;
    if (on && !pauseRoot.dataset.wired) {
      pauseRoot.dataset.wired = '1';
      pauseRoot.querySelector('[data-dp-resume]').addEventListener('click', () => pause(false));
      pauseRoot.querySelector('[data-dp-reset]').addEventListener('click', () => { pause(false); respawn(); });
      pauseRoot.querySelector('[data-dp-restart]').addEventListener('click', restart);
      pauseRoot.querySelector('[data-dp-roads]').addEventListener('click', () => { exit(); openPicker(); });
      pauseRoot.querySelector('[data-dp-exit]').addEventListener('click', exit);
    }
    if (on) pauseRoot.querySelector('[data-dp-resume]').focus({ preventScroll: true });
  }

  // --- Per frame -------------------------------------------------------------------------------
  const inp = {};
  const q = new THREE.Quaternion(), upv = new THREE.Vector3(), fw = new THREE.Vector3();
  function frame(dt, time) {
    if (!st.active || !st.car) return;
    const road = st.road;
    const layer = st.layer;
    if (!st.paused && !layer?.editing) {
      // The arcade layer's slow-mo runs fewer 240 Hz ticks per second (the step stays the same).
      st.acc += Math.min(dt, 0.1) * (layer ? layer.timeScale : 1);
      let c = st.car;
      // The endless road: generated well ahead of the car (pure: the same whenever it's done).
      if (road.endless) road.ensure(c.pos.z + 800);
      // The perf probe's cruise: the car carried along the road at a fixed speed (no physics), to
      // show the world keeps up at 250 km/h whatever the curves would allow.
      if (st.cruise) {
        const cr = st.cruise;
        cr.s += cr.v * Math.min(dt, 0.1);
        const p = poseAt(road, cr.s, 1);
        if (road.endless) road.ensure(p.z + 800);
        c.pos.x = p.x; c.pos.y = p.y + SPEC.comHeight; c.pos.z = p.z;
        quatFromYaw(c.quat, p.yaw);
        const fxx = Math.sin(p.yaw), fzz = Math.cos(p.yaw);
        c.vel.x = fxx * cr.v; c.vel.y = 0; c.vel.z = fzz * cr.v;
        st.acc = 0;
        poseLerp.before(c);   // carried, not stepped: drawn where it is
      }
      while (st.acc >= DT) {
        const air = c.grounded === 0 && !c.hullContact;
        st.airT = air ? st.airT + DT : 0;
        const phase = st.airT > 0.25 ? 'air' : 'drive';
        Object.assign(inp, st.pilot ? st.pilot(c) : input.sample(phase, ctx.assist(), undefined, false, c));
        inp.fan = st.fan ? 1 : 0;
        // Reverse: hold the brake at a standstill (src/hands.js: a stop holds before it backs up).
        if (phase === 'drive') reverse(c, inp);
        layer?.preStep(c, inp);
        poseLerp.before(c);
        step(c, inp);
        layer?.postStep(c);
        st.acc -= DT;
      }
      c = st.car;
      for (let i = 0; i < 4; i++) { comps[i] = c.wheels[i].compression; spins[i] = c.wheels[i].spin; }
      const drawn = poseLerp.pose(c, st.acc / DT);
      syncCar(drawn.pos, drawn.quat, comps, spins, c.steer);
      crash.feed(c.impacts, c.tick, c.vel);
      watchdog(dt, c);
    }
    const c = st.car;
    // Where on the road: nearest sample (local search), heading, grade.
    const i = (st.hint = nearestSample(road, c.pos.x, c.pos.z, st.hint, road.endless ? 120 : 40));
    const m = Math.min(i, road.m - 1);
    q.set(c.quat.x, c.quat.y, c.quat.z, c.quat.w);
    fw.set(0, 0, 1).applyQuaternion(q);
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    const dirSign = road.dx[m] * fw.x + road.dz[m] * fw.z >= 0 ? 1 : -1;
    if (road.endless) {
      if (!st.paused && !layer?.editing) st.driveT += dt;
      if (!st.biomeAt || Math.abs(i - st.biomeAt) > 20) { st.biomeAt = i; st.biome = ['Mountain pass', 'Coast road', 'Desert', 'Forest'][road.biome[i]]; }
      st.hud.update({ speed, ele: c.pos.y - SPEC.comHeight, grade: road.grade[m] * dirSign, i, heading: Math.atan2(fw.x, -fw.z), time: st.driveT, biome: st.biome });
    } else {
      // Timer: from moving off the start to the end of the road.
      if (st.timer == null && !st.finished && i * road.meta.spacing > 30 && i * road.meta.spacing < 300 && speed > 1) st.timer = 0;
      if (st.timer != null && !st.finished && !st.paused && !layer?.editing) st.timer += dt;
      if (st.timer != null && !st.finished && i >= road.n - 8) finishRun();
      const shown = st.timer != null ? st.timer + st.penalty : null;
      st.hud.update({
        speed, ele: c.pos.y - SPEC.comHeight, grade: road.grade[m] * dirSign, i, heading: Math.atan2(fw.x, -fw.z),
        time: st.finished ? st.finalTime : shown, best: st.best,
      });
    }
    // Touch layout follows the car: pedals on the ground, LIFT/LAND in the air.
    const tp = st.airT > 0.25 ? 'air' : 'ground';
    if (ui.touch.dataset.phase !== tp) ui.touch.dataset.phase = tp;
    // Ground under the car for the jets' mist and the crash debris.
    const d = roadSurface(road, c.pos.x, c.pos.y, c.pos.z, st.sn);
    st.ground = st.sn.y > 0.5 ? c.pos.y - d : c.pos.y - SPEC.comHeight;
    hero.setFan?.(c.fan);
    hero.setWing?.(Math.min(1, Math.max(0, (speed - 20) / 20)));
    plumes.update(dt, time, c.throttles, c.vel, st.ground);
    audio.updateAudio({ speed, grounded: c.grounded > 0, throttles: c.throttles });
    if (!layer?.editing) st.cam.update(dt, { pos: carRoot.position, quat: carRoot.quaternion, vel: c.vel }, time);
    layer?.frame(dt, time, st.acc / DT);
    st.world.update(camera, time, dt);
    // A rough FPS meter for the perf probe (window.__coldgas.drive.stats()).
    st.frames++; st.fpsT += dt;
    if (st.fpsT > 1) { st.fps = st.frames / st.fpsT; st.frames = 0; st.fpsT = 0; }
  }

  // Upside down, lost in the sea, or fallen off the mountain: back on the road.
  function watchdog(dt, c) {
    const road = st.road;
    upv.set(0, 1, 0).applyQuaternion(q.set(c.quat.x, c.quat.y, c.quat.z, c.quat.w));
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    st.flipT = upv.y < 0.25 && speed < 4 && (c.grounded > 0 || c.hullContact) ? st.flipT + dt : 0;
    if (st.flipT > 2) { respawn(); return; }
    const i = nearestSample(road, c.pos.x, c.pos.z, st.hint, 40);
    if (road.meta.coast && c.pos.y < 0.2) { ui.cue_('Into the sea', 1400); respawn(); return; }
    if (c.pos.y < road.y[i] - 150 || c.pos.y < -50) { respawn(); return; }
    st.stuckT = speed < 0.6 && c.grounded === 0 ? st.stuckT + dt : 0;
    if (st.stuckT > 3) { respawn(); return; }
    const off = Math.hypot(c.pos.x - road.x[i], c.pos.z - road.z[i]);
    if (off > 120 && performance.now() - st.lastCue > 6000) { st.lastCue = performance.now(); ui.cue_(`${input.usingTouch() ? 'RESET' : '<kbd>R</kbd>'} puts you back on the road`, 2400); }
  }

  function finishRun() {
    st.finished = true;
    st.finalTime = st.timer + st.penalty;
    const isBest = !st.best || st.finalTime < st.best;
    if (isBest) { st.best = st.finalTime; try { localStorage.setItem(`coldgas_drive_best_${st.info.id}`, String(st.best)); } catch { /* storage blocked */ } }
    st.hud.finish(st.finalTime, st.best, isBest);
    ui.cue_(`${st.info.name} in ${fmtTime(st.finalTime)}${isBest ? ' · best' : ''}`, 4200);
  }

  function stats() {
    return { fps: Math.round(st.fps), ...(st.world ? st.world.stats() : {}), road: st.info?.id, i: st.hint, speed: st.car ? Math.hypot(st.car.vel.x, st.car.vel.z) : 0, y: st.car?.pos.y, seed: st.road?.endless ? seed : undefined };
  }

  return {
    openPicker, closePicker, start, exit, frame, pause, respawn, restart, stats,
    // Test and screenshot hooks: a driver that follows the road, and a teleport along it.
    autopilot(on = true, opts) { st.pilot = on && st.road ? createPilot(st.road, opts) : null; },
    cruise(v) { st.cruise = v ? { v, s: st.hint * st.road.meta.spacing } : null; },
    goto(s, dir = 1) { if (st.road) placeAt(s, dir, true); },
    get active() { return st.active; }, get course() { return st.course; }, get layer() { return st.layer; }, get floor() { return st.ground; }, get paused() { return st.paused; },
    get car() { return st.car; }, get road() { return st.road; }, get world() { return st.world; }, get cam() { return st.cam; }, get seed() { return seed; },
    setTod: (t) => setTod(t), cycleCam, state: st, CAR,
  };
}
