// THE SANDBOX: a flat 400 m concrete apron to build on, fly off and run side quests in (a lazy
// chunk, deep link ?drive=sandbox). The same car and physics as everywhere (src/sim/vehicle.js);
// the build layer (src/build/layer.js) adds the pieces, power-ups and quests. Unscored: nothing
// here touches the Show, the Wall or the Lineup.
import '../drive/drive.css';
import { createVehicle, step, DT } from '../sim/vehicle.js';
import { freeWorld } from '../sim/world.js';
import { loadPhysics } from '../sim/engine-web.js';
import { quatFromYaw } from '../sim/m3.js';
import { SPEC } from '../sim/spec.js';
import { createDriveCamera } from '../drive/camera.js';
import { createArenaCourse, inArena, ARENA } from './arena.js';
import { createArenaWorld } from './arena-render.js';
import { createBuildLayer } from './layer.js';

const D2R = Math.PI / 180;
const START = { x: 0, z: -165, yaw: 0 };
const ANCHOR = { x: 0, z: -150 };

export function createSandbox(ctx) {
  const { stage, carRoot, plumes, crash, syncCar, ui, audio, input, tier } = ctx;
  const camera = stage.camera;
  const st = { active: false, paused: false, car: null, course: null, world: null, layer: null, cam: null, acc: 0, airT: 0, flipT: 0, fan: false, hud: null, ground: 0 };
  const comps = [0, 0, 0, 0], spins = [0, 0, 0, 0];
  let hudRoot = null;

  // The build layer's view of this world.
  const host = {
    id: 'sandbox', kind: 'sandbox', name: 'Sandbox',
    base: createArenaCourse(),
    groundAt: () => 0,
    inBounds: (x, z) => inArena(x, z, 2),
    get scene() { return stage.scene; }, camera, get canvas() { return stage.renderer.domElement; }, carRoot,
    getCar: () => st.car,
    placeCar: (p) => place(p.x, p.z, p.yaw),
    // Quests start from the south end of the apron, facing north (+z): x right, z ahead.
    questFrame() {
      const map = (x, z, yawDeg = 0, y = 0) => ({ x: ANCHOR.x - x, y: Math.max(0, y), z: ANCHOR.z + z, yaw: -yawDeg * D2R });
      map.start = { x: START.x, y: 0, z: START.z, yaw: START.yaw };
      return map;
    },
  };

  function place(x, z, yaw = 0) {
    if (st.car) freeWorld(st.car.world);
    const car = createVehicle(st.course);
    car.pos.x = x; car.pos.y = SPEC.comHeight + 0.04; car.pos.z = z;
    quatFromYaw(car.quat, yaw);
    st.car = car; st.airT = 0; st.flipT = 0;
    st.layer?.reset();
    crash.reset(); plumes.clear();
    comps.fill(car.wheels[0].compression); spins.fill(0);
    syncCar(car.pos, car.quat, comps, spins, 0);
    st.cam?.snap();
  }

  async function start() {
    if (st.active) return;
    audio.initAudio();
    await Promise.all([stage.ready, loadPhysics()]);   // the rigid-body engine (src/sim/engine.js)
    st.world = createArenaWorld({ renderer: stage.renderer, tier });
    stage.setLook(st.world.look);
    st.layer = createBuildLayer(host, { ui, audio, tier, coarse: ctx.coarse, usingTouch: input.usingTouch, onEditing: onEditing });
    st.course = st.layer.course;
    st.cam = createDriveCamera(camera, null, (x, y, z, o) => st.course.sdf(x, y, z, o));
    camera.near = 0.3; camera.far = 4000; camera.updateProjectionMatrix();
    place(START.x, START.z, START.yaw);
    hud(true);
    ui.only();
    document.body.classList.add('driving');
    ui.touch.hidden = !(ctx.coarse || input.usingTouch());
    ui.touch.dataset.phase = 'ground';
    st.active = true; st.paused = false; st.acc = 0;
    ctx.setMode('drive');
    await stage.renderer.compileAsync?.(stage.scene, camera).catch?.(() => {});
    ui.cue_(`Sandbox · <kbd>B</kbd> build · <kbd>J</kbd> quests`, 3200);
    addEventListener('keydown', onKey);
  }

  function onEditing(on) {
    ui.touch.hidden = on || !(ctx.coarse || input.usingTouch());
    if (hudRoot) hudRoot.hidden = on;
    if (!on) st.cam?.snap();
  }

  function hud(on) {
    if (!on) { hudRoot?.remove(); hudRoot = null; return; }
    hudRoot = document.createElement('section');
    hudRoot.className = 'fd-hud sb-hud';
    hudRoot.innerHTML = `
      <div class="fd-road"><p class="fd-road-name">Sandbox</p><p class="fd-road-sub">${ARENA.half * 2} m of concrete · build, fly, quest</p></div>
      <div class="fd-ctl">
        <button type="button" class="chip" data-s-cam title="Camera (C)">Chase</button>
        <button type="button" class="chip" data-s-fan aria-pressed="false" title="Suction fan (X)">Fan</button>
        <button type="button" class="chip" data-s-reset title="Back to the start (R)">Reset</button>
        <button type="button" class="chip" data-s-exit title="Leave the Sandbox">Exit</button>
      </div>
      <div class="fd-speed"><b data-s-speed>0</b><span>km/h</span></div>
      <dl class="fd-stats">
        <div><dt>Height</dt><dd><b data-s-h>0.0</b> m</dd></div>
        <div><dt>Gas</dt><dd><b data-s-gas>100</b> %</dd></div>
      </dl>
      <div class="fd-pause" data-s-pause hidden><div class="sheet"><h2>Paused</h2>
        <div class="actions"><button class="btn primary" data-s-resume>Resume</button><button class="btn ghost" data-s-start>Back to the start</button><button class="btn link" data-s-title>Title</button></div></div></div>`;
    document.body.appendChild(hudRoot);
    const $ = (s) => hudRoot.querySelector(s);
    st.hud = { speed: $('[data-s-speed]'), h: $('[data-s-h]'), gas: $('[data-s-gas]'), cam: $('[data-s-cam]'), fan: $('[data-s-fan]'), pause: $('[data-s-pause]'), last: { s: -1, h: -1, g: -1 } };
    $('[data-s-cam]').onclick = cycleCam;
    $('[data-s-fan]').onclick = toggleFan;
    $('[data-s-reset]').onclick = () => place(START.x, START.z, START.yaw);
    $('[data-s-exit]').onclick = exit;
    $('[data-s-resume]').onclick = () => pause(false);
    $('[data-s-start]').onclick = () => { pause(false); place(START.x, START.z, START.yaw); };
    $('[data-s-title]').onclick = exit;
  }
  function cycleCam() { const m = st.cam.cycle(); st.hud.cam.textContent = m === 'bumper' ? 'Bumper' : 'Chase'; }
  function toggleFan() { st.fan = !st.fan; st.hud.fan.setAttribute('aria-pressed', String(st.fan)); ui.cue_(st.fan ? 'Fan on' : 'Fan off', 900); }
  const onKey = (e) => {
    if (!st.active || e.repeat || e.metaKey || e.ctrlKey || e.altKey || st.layer?.editing) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyR') place(st.car.pos.x, st.car.pos.z, yawOf(st.car));
    else if (e.code === 'KeyC') cycleCam();
    else if (e.code === 'KeyX') toggleFan();
  };
  const yawOf = (c) => Math.atan2(2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y));

  function pause(on = !st.paused) {
    if (!st.active || st.layer?.editing) return;
    st.paused = on;
    st.hud.pause.hidden = !on;
    if (on) st.hud.pause.querySelector('[data-s-resume]').focus({ preventScroll: true });
  }

  function exit() {
    if (!st.active) return;
    removeEventListener('keydown', onKey);
    st.layer?.dispose(); st.layer = null;
    stage.setLook(null);
    st.world?.dispose(); st.world = null;
    hud(false);
    camera.near = 0.1; camera.far = 4000; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
    document.body.classList.remove('driving');
    if (st.car) freeWorld(st.car.world);
    st.active = false; st.car = null;
    crash.reset(); plumes.clear();
    ctx.onExit();
  }

  const inp = {};
  function frame(dt, time) {
    if (!st.active || !st.car) return;
    const layer = st.layer;
    if (!st.paused && !layer.editing) {
      st.acc += Math.min(dt, 0.1) * layer.timeScale;
      let c = st.car;
      while (st.acc >= DT) {
        const air = c.grounded === 0 && !c.hullContact;
        st.airT = air ? st.airT + DT : 0;
        const phase = st.airT > 0.25 ? 'air' : 'drive';
        Object.assign(inp, st.pilot ? st.pilot(c) : input.sample(phase, ctx.assist()));
        if (st.fan) inp.fan = 1;
        if (phase === 'drive') {
          const fz = 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y), fx = 2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y);
          const vf = c.vel.x * fx + c.vel.z * fz;
          if (inp.brake > 0 && inp.throttle === 0 && vf < 0.8) { inp.throttle = -0.35 * inp.brake; inp.brake = 0; }
        }
        layer.preStep(c, inp);
        step(c, inp);
        layer.postStep(c);
        st.acc -= DT;
      }
      c = st.car;
      for (let i = 0; i < 4; i++) { comps[i] = c.wheels[i].compression; spins[i] = c.wheels[i].spin; }
      syncCar(c.pos, c.quat, comps, spins, c.steer);
      crash.feed(c.impacts, c.tick, c.vel);
      watchdog(dt, c);
    }
    const c = st.car;
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    const L = st.hud.last;
    const sp = Math.round(speed * 3.6); if (sp !== L.s) { st.hud.speed.textContent = String(sp); L.s = sp; }
    const h = Math.round((c.pos.y - SPEC.comHeight) * 10); if (h !== L.h) { st.hud.h.textContent = (Math.max(0, h) / 10).toFixed(1); L.h = h; }
    const g = Math.round((100 * Math.max(0, c.air)) / ctx.CAR.airMass); if (g !== L.g) { st.hud.gas.textContent = String(g); L.g = g; }
    const tp = st.airT > 0.25 ? 'air' : 'ground';
    if (ui.touch.dataset.phase !== tp) ui.touch.dataset.phase = tp;
    st.ground = 0;
    ctx.hero.setFan?.(c.fan);
    ctx.hero.setWing?.(Math.min(1, Math.max(0, (speed - 20) / 20)));
    plumes.update(dt, time, c.throttles, c.vel, 0);
    audio.updateAudio({ speed, grounded: c.grounded > 0, throttles: c.throttles });
    if (!layer.editing) st.cam.update(dt, { pos: carRoot.position, quat: carRoot.quaternion, vel: c.vel }, time);
    layer.frame(dt, time);
  }

  function watchdog(dt, c) {
    const upY = 1 - 2 * (c.quat.x * c.quat.x + c.quat.z * c.quat.z);
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    st.flipT = upY < 0.25 && speed < 4 && (c.grounded > 0 || c.hullContact) ? st.flipT + dt : 0;
    if (st.flipT > 2) { place(c.pos.x, c.pos.z, yawOf(c)); ui.cue_('Back on your wheels', 1200); return; }
    if (!inArena(c.pos.x, c.pos.z, -150) || c.pos.y < -20) { place(START.x, START.z, START.yaw); ui.cue_('Back to the start', 1200); }
  }

  return {
    start, exit, frame, pause,
    get active() { return st.active; }, get course() { return st.course; }, get floor() { return st.ground; }, get paused() { return st.paused; },
    get car() { return st.car; }, get layer() { return st.layer; }, get cam() { return st.cam; },
    // Tests and screenshots.
    place: (x, z, yawDeg = 0) => place(x, z, yawDeg * D2R),
    pilot(fn) { st.pilot = fn; },
    stats: () => ({ ...(st.layer ? st.layer.api.render.stats() : {}), pieces: st.layer?.store.size || 0 }),
    state: st,
  };
}
