// COLD GAS — entry. Owns the state machine (title → countdown → live → results ⇄ replay), the
// fixed-step sim clock, and syncing the sim to the scene. Rendering lives in src/render/, the
// physics and judging in src/sim/ (pure, shared with the Worker).
// Latin subsets only: the copy is English, and every @font-face rule is inlined into index.html.
import '@fontsource/michroma/latin-400.css';
// Geist as one variable font (every weight from 200 to 500 in a single 29 kB latin file).
import '@fontsource-variable/geist/wght.css';
import '@fontsource/geist-mono/latin-400.css';
import './styles.css';
import * as THREE from 'three';
import { createStage } from './render/scene.js';
import { createPlumes } from './render/plumes.js';
import { createDirector } from './render/director.js';
import { landingImpact } from './render/impact.js';
import { createCrash } from './render/crash.js';
import { makeGhost, ghostMat, wheelCenterY } from './render/cars.js';
import { createRun, stepRun, FRAME_EVERY, BODY_FRAME } from './sim/run.js';
import { DT, CAR, NOZZLES, WHEELS, bodyRates, worldPoint } from './sim/vehicle.js';
import { scoreRun } from './sim/judge.js';
import { createAutopilot } from './sim/autopilot.js';
import { COURSES, surface } from './sim/courses.js';
import { SPEC } from './sim/spec.js';
import { bindInput, sample, usingTouch } from './input.js';
import { initAudio, updateAudio, thud, setMuted, isMuted } from './audio.js';
import { createUI } from './ui.js';
import { localWords, postScore, fetchBoard } from './panel.js';
import { loadAI } from './ai/config.js';
import { openSettings, aiLabel } from './ai/settings.js';
import { packFrames, ghostAt, isBetter, newGhostPose, loadBest, saveBest, ghostEnabled, setGhostEnabled } from './ghost.js';

const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const tier = params.get('gfx') || (coarse ? 'mid' : 'high');

const canvas = document.getElementById('stage');
let stage;
try {
  // [stage] ?course=wall|lineup practises one stunt; the Show (one flight off the Wall) is the default.
  stage = createStage(canvas, { tier, course: ['wall', 'lineup'].includes(params.get('course')) ? params.get('course') : 'show' });
} catch (err) {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', '<p class="noscript">COLD GAS needs WebGL. Try a current browser.</p>');
  throw err;
}
const { scene, camera, hero } = stage;
const ui = createUI();

// The car's root sits at the physics centre of mass; the model hangs below it.
const carRoot = new THREE.Group();
hero.group.position.y = -hero.comY;
carRoot.add(hero.group);
scene.add(carRoot);
// The ghost of your best run rides alongside in the next attempt (src/ghost.js).
const ghostRoot = new THREE.Group();
const ghostModel = makeGhost(hero);
ghostModel.position.y = -hero.comY;
ghostRoot.add(ghostModel);
scene.add(ghostRoot);
ghostRoot.visible = false;   // its shader is still warmed with the scene's (stage.ready), so "Go" doesn't hitch
const plumes = createPlumes(scene, carRoot, { maxMist: tier === 'low' ? 500 : 1800 });
const director = createDirector(camera);
// Crashes: sparks, chips, dents, torn-off parts, lamps, shake, slow motion, the crash cut and the
// crunch, all keyed to the sim's impact events (src/render/crash.js).
const crash = createCrash({ scene, hero, carRoot, director, tier, course: () => stage.course });

// --- State -------------------------------------------------------------------------------
const S = {
  mode: 'title',          // title | countdown | live | results | replay
  run: null, autopilot: null, card: null, words: null,
  assist: true, acc: 0, countT: 0, doneT: 0, paused: false,
  replayT: 0, prevPhase: '', time: 0,
  impacts: 0, impact: null,   // touchdowns this run, and the last one's cues (src/render/impact.js)
  idleThrottles: new Float64Array(NOZZLES.length),
};
try { S.assist = localStorage.getItem('coldgas_assist') !== '0'; } catch { /* storage blocked */ }
// One ghost per course, loaded on first use.
S.ghosts = {}; S.ghostOn = ghostEnabled();
const ghostLoads = {};
const ghostLoaded = (course) => (ghostLoads[course] ??= loadBest(course).then((g) => { if (g && isBetter(S.ghosts[course], g)) S.ghosts[course] = g; }));
ghostLoaded(stage.course);
const gpose = newGhostPose();
// Shown only in your own live runs; it fades out where it overlaps the car (the start line).
function syncGhost() {
  const live = (S.mode === 'live' || S.mode === 'countdown') && !S.autopilot;
  ghostRoot.visible = live && S.ghostOn && ghostAt(S.ghosts[S.run.course], S.run.tick, gpose);
  if (!ghostRoot.visible) return;
  ghostRoot.position.set(gpose.x, gpose.y, gpose.z);
  ghostRoot.quaternion.set(gpose.qx, gpose.qy, gpose.qz, gpose.qw);
  const d = ghostRoot.position.distanceTo(carRoot.position);
  ghostMat.opacity = 0.18 * Math.min(1, Math.max(0, (d - 1.5) / 2.5));
}

const qv = new THREE.Vector3(), rates = { x: 0, y: 0, z: 0 };
const zeroVel = new THREE.Vector3();

function placeOnPad() {
  const tp = stage.titlePose();   // [stage] the course decides where the car sits on the title
  carRoot.position.set(tp.x, hero.comY, tp.z);
  carRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tp.yaw);
  for (const w of hero.wheels) { w.pivot.position.y = w.baseY; w.pivot.rotation.y = 0; }
}

function syncCar(pos, quat, comps, spins, steer) {
  carRoot.position.set(pos.x, pos.y, pos.z);
  carRoot.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  for (let i = 0; i < 4; i++) {
    const w = hero.wheels[i];
    w.pivot.position.y = wheelCenterY(comps[i], CAR.restLen, i);
    w.spin.rotation.x = spins[i];
    if (i < 2) w.pivot.rotation.y = steer;
  }
}

// --- Flow --------------------------------------------------------------------------------
// Everything layered over the stage that belongs to the last run: the judges' theatre (and its
// call), the AI settings sheet, cues. A restart, a new run or the title clears it all at once.
let panelAbort = null;
function closeOverlays() {
  panelAbort?.abort(); panelAbort = null;
  const th = document.querySelector('[data-theatre]');
  th.hidden = true; th.classList.remove('on', 'out');
  const ai = document.querySelector('[data-ai-modal]');
  if (ai && !ai.hidden) ai.hidden = true;
  S.paused = false;
  ui.clearCue();
}

function toTitle() {
  closeOverlays();
  S.mode = 'title'; S.run = null;
  ui.only('title');
  ui.touch.hidden = true;
  ui.clearCue(); ui.countdown(0);
  plumes.clear();
  crash.reset();
  placeOnPad();
  history.replaceState(null, '', stage.course === 'show' ? location.pathname : `${location.pathname}?course=${stage.course}`);
}

function startRun(kind = 'jump') {
  closeOverlays();
  initAudio();
  S.run = createRun(stage.course);
  S.autopilot = kind === 'reveal' ? createAutopilot(stage.course) : null;
  S.released = false;
  ghostLoaded(stage.course);
  S.mode = 'countdown'; S.countT = 0; S.acc = 0; S.card = null; S.words = null; S.prevPhase = '';
  S.impacts = 0; S.impact = null;
  ui.only('hud');
  ui.touch.hidden = !(coarse || usingTouch()) || !!S.autopilot;
  plumes.clear();
  crash.reset();
  const c = S.run.car;
  const sag = c.wheels[0].compression;
  syncCar(c.pos, c.quat, [sag, sag, sag, sag], [0, 0, 0, 0], 0);
  director.snap();
  if (S.autopilot) ui.cue_({ show: 'The reference run: the Wall, then the lineup', wall: 'The reference run: up the Wall' }[stage.course] || 'The reference jump', 2400);
}

function finishRun() {
  const run = S.run;
  S.card = scoreRun(run.t, { assist: S.autopilot ? true : S.assist });
  S.mode = 'results';
  ui.only('results');
  ui.touch.hidden = true;
  ui.clearCue();
  ui.results(S.card);
  // Your best run becomes the ghost for the next attempt (the reference jump only until you
  // finish one of your own). Storage keeps whichever is better, even across tabs.
  if (run.frames.length) {
    const g = packFrames(run.frames, S.card.total, !!S.autopilot, run.course);
    ghostLoaded(run.course).then(() => { if (isBetter(S.ghosts[run.course], g)) { S.ghosts[run.course] = g; saveBest(g); } });
  }
  // The judges' theatre: the server re-simulates the log, then a model writes the words, all of
  // it shown live (src/ai/theatre.js, a lazy chunk with the aurora-field particle engine).
  runPanel(run);
  // Replay plays behind the sheet.
  S.replayT = 0;
}

const theatreRoot = document.querySelector('[data-theatre]');
const liftLabel = document.querySelector('[data-lift-label]'), stickHint = document.querySelector('[data-stick-hint]'), goLabel = document.querySelector('[data-go-label]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
async function runPanel(run, replay = null) {
  const assist = !!(S.assist || S.autopilot);
  const card = S.card;
  if (!replay) { panelAbort?.abort(); panelAbort = new AbortController(); }
  const signal = panelAbort?.signal;
  let mod;
  try { mod = await import('./ai/theatre.js'); } catch { S.words = localWords(card); ui.words(S.words); return; }
  if (S.run !== run) return;
  const { words, meta, aborted } = await mod.runTheatre(theatreRoot, {
    log: run.inputLog, assist, ai: loadAI(), card, course: run.course, fallbackWords: localWords, reduced: reducedMotion, replay, abort: signal,
  });
  if (aborted || S.run !== run) return;
  if (!replay) {
    if (meta.verify?.card && Math.abs(meta.verify.card.total - card.total) > 0.05) console.warn('server card differs', meta.verify.card.total, card.total);
    S.words = words; S.callMeta = meta;
  }
  ui.words(S.words);
  ui.receipt(S.callMeta, { onReplay: () => runPanel(run, S.callMeta.events), onChange: () => openAI() });
}

const aiChip = document.querySelector('[data-ai-open]');
const syncAiChip = () => { aiChip.textContent = aiLabel(); };
function openAI() { openSettings(document.querySelector('[data-ai-modal]'), { onChange: syncAiChip }); }
aiChip.addEventListener('click', openAI);
syncAiChip();

// The Wall's fan is a car system, not a button: it spools up before the foot of the ramp and holds
// the car to the deck. On the deck, LIFT is the release: suction off, lift jets push you clear.
function wallAssist(run, input) {
  if (run.course === 'lineup') { input.fan = 0; return input; }
  const c = run.car;
  if (run.phase === 'ramp' && input.lift > 0) S.released = true;
  input.fan = !S.released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
  return input;
}

const sn = { x: 0, y: 0, z: 0 };
// Height above the ground, unless something nearer is under the floor (the Lineup's kicker, a roof).
function heightAboveSurface(c) {
  const d = surface(COURSES[stage.course], c.pos.x, c.pos.y, c.pos.z, sn);
  const h = sn.y > 0.9 ? d : c.pos.y;
  return Math.max(0, h - SPEC.comHeight);
}
// Felt g-load, smoothed (the occupant's view: specific force, not coordinate acceleration).
const gState = { vx: 0, vy: 0, vz: 0, g: 1 };
function feltG(c, dt) {
  if (dt <= 0) return gState.g;
  const ax = (c.vel.x - gState.vx) / dt, ay = (c.vel.y - gState.vy) / dt + 9.81, az = (c.vel.z - gState.vz) / dt;
  gState.vx = c.vel.x; gState.vy = c.vel.y; gState.vz = c.vel.z;
  gState.g += (Math.min(12, Math.hypot(ax, ay, az) / 9.81) - gState.g) * Math.min(1, dt * 6);
  return gState.g;
}

// The touchdown felt in the body: camera, mist from each tyre and the thud, all scaled by sink rate.
const contactPts = new Float32Array(12), wp = { x: 0, y: 0, z: 0 };
function touchdown(run) {
  const c = run.car;
  const k = landingImpact(run.t.sink, reducedMotion);
  S.impacts++; S.impact = k;
  thud(k);
  director.shake(k.shake);
  director.impact(k.dip, k.fovPunch);
  for (let i = 0; i < 4; i++) {
    worldPoint(c, WHEELS[i], wp);
    contactPts[i * 3] = wp.x; contactPts[i * 3 + 1] = Math.max(0, wp.y - 0.24 - SPEC.wheelRadius); contactPts[i * 3 + 2] = wp.z;
  }
  plumes.burst(contactPts, k.mist, k.mistSpeed);
}

// --- Live step -----------------------------------------------------------------------------
function liveStep(dt) {
  const run = S.run;
  S.acc += Math.min(dt, 0.1);
  let input = null;
  while (S.acc >= DT && run.phase !== 'done') {
    input = S.autopilot ? S.autopilot(run) : wallAssist(run, sample(run.phase, S.assist));
    stepRun(run, input);
    S.acc -= DT;
  }
  const c = run.car;
  for (let i = 0; i < 4; i++) { fcomp[i] = c.wheels[i].compression; fspin[i] = c.wheels[i].spin; }
  syncCar(c.pos, c.quat, fcomp, fspin, c.steer);
  stage.setBodies(c.world.bodies);
  crash.feed(run.impacts, run.tick, c.vel);

  // Phase cues and moments.
  // Touch layout follows the phase: pedals on the ground and up the wall, LIFT/LAND in the air.
  const tp = run.phase === 'air' ? 'air' : run.phase === 'ramp' ? 'ramp' : 'ground';
  if (ui.touch.dataset.phase !== tp) {
    ui.touch.dataset.phase = tp;
    liftLabel.textContent = tp === 'ramp' ? 'RELEASE' : 'LIFT';
    stickHint.textContent = tp === 'air' ? 'ROLL · PITCH' : 'STEER';
    goLabel.textContent = tp === 'air' ? 'BOOST' : 'GO';
  }
  if (run.phase !== S.prevPhase) {
    if (run.phase === 'air' && !reducedMotion) director.shake(0.15);
    S.prevPhase = run.phase;
  }
  // Touchdown, once per run (keyed on the sim's touch tick, so a fast-forward that steps past the
  // 'landed' phase in one frame still lands).
  if (run.t.touchTick >= 0 && S.impacts === 0) touchdown(run);
  if (!S.autopilot) cues(run, c);

  const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  bodyRates(c, rates);
  qv.set(0, 1, 0).applyQuaternion(carRoot.quaternion);
  ui.hud({
    speed, air: (c.air / CAR.airMass) * 100, rollDeg: Math.abs(run.t.rollAccum) * 180 / Math.PI,
    rollAngle: Math.atan2(qv.x, qv.y), alt: heightAboveSurface(c),
    sink: -c.vel.y, phase: { drive: 'Run-up', ramp: c.fanForce > 1000 ? 'On the wall · fan' : 'On the wall', air: 'Airborne', landed: 'Touchdown', done: 'Settled' }[run.phase],
    throttles: c.throttles, fan: c.fan, g: feltG(c, dt),
  });
  hero.setFan?.(c.fan);
  hero.setWing?.(Math.min(1, Math.max(0, (speed - 20) / 20)));
  plumes.update(dt, S.time, c.throttles, c.vel, 0);
  updateAudio({ speed, grounded: c.grounded > 0, throttles: c.throttles });

  if (run.phase === 'done') {
    S.doneT += dt;
    if (S.doneT > 1.4) finishRun();
  } else S.doneT = 0;
}

const kbd = (touchLabel, keyLabel) => `<kbd>${usingTouch() ? touchLabel : keyLabel}</kbd>`;
function cues(run, c) {
  const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  if (run.phase === 'drive' && v < 2) return ui.cue_(`Hold ${kbd('GO', '↑')} to drive`, 600);
  if (run.course !== 'lineup') {
    const show = run.course === 'show';
    if (run.phase === 'drive' && c.pos.z > -40) return ui.cue_(`Fan spooling · crawl in, about 20 km/h`, 600);
    if (run.phase === 'ramp' && run.t.progress < 0.85) return ui.cue_(`Feather ${kbd('GO', '↑')}: crawl up on suction`, 500);
    if (run.phase === 'ramp') return ui.cue_(`Hang it upside down · ${kbd('LIFT', 'Space')} to let go`, 500);
    // The Show: the row is under you. The rear jets carry you out over it (≈30 km/h is enough).
    if (show && run.phase === 'air' && !run.t.crossedRow && -c.vel.z < 8.5 && c.pos.z > COURSES.show.rowNear) return ui.cue_(`${kbd('BOOST', 'F')} · carry out over the row`, 400);
    if (run.phase === 'air' && c.vel.y > -1) return ui.cue_(`Roll upright: ${kbd('stick', '← →')}`, 500);
    if (run.phase === 'air') return ui.cue_(`Hold ${kbd('LAND', 'Shift')}: it levels and slows the fall`, 500);
    return;
  }
  const lz = c.pos.z;
  if (run.phase === 'drive' && lz > -14 && lz < COURSES.lineup.lineupZ0) return ui.cue_(`Hold ${kbd('LIFT', 'Space')} at the line`, 600);
  if (run.phase === 'air' && Math.abs(run.t.rollAccum) < 0.3 && c.vel.y < 4) return ui.cue_(`${kbd('stick sideways', '← →')} to roll`, 500);
  if (run.phase === 'air' && Math.abs(run.t.rollAccum) > 5.6 && c.vel.y < 0) return ui.cue_(`Hold ${kbd('LAND', 'Shift')}`, 500);
}

// --- Replay (behind the results sheet, and on demand) ----------------------------------------
const fpos = { x: 0, y: 0, z: 0 }, fquat = { x: 0, y: 0, z: 0, w: 1 };
const fcomp = [0, 0, 0, 0], fspin = [0, 0, 0, 0];
const fthr = new Float64Array(NOZZLES.length);
const fvel = new THREE.Vector3();
const replayBodies = [];
function replayStep(dt) {
  const frames = S.run?.frames;
  if (!frames?.length) return;
  while (replayBodies.length < (frames[0].length - BODY_FRAME) / 3) replayBodies.push({ cx: 0, cz: 0, yaw: 0 });
  replayBodies.length = (frames[0].length - BODY_FRAME) / 3;
  const n = frames.length;
  const i0 = Math.min(n - 1, Math.floor(S.replayT));
  const f = frames[i0];
  // Slow motion where it matters: over the lineup, or up the wall and through the roll.
  const L = COURSES.lineup;
  const slow = stage.course !== 'lineup' ? (f[1] > 3 ? 0.45 : 1) : (f[2] > L.liftOffZ - 2 && f[2] < L.pad.z - 6 ? 0.42 : 1);
  S.replayT += dt * (240 / FRAME_EVERY) * slow;
  if (S.replayT >= n + 90) S.replayT = 0;   // hold a beat, loop
  const i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, S.replayT - i0);
  const g = frames[i1];
  fpos.x = f[0] + (g[0] - f[0]) * k; fpos.y = f[1] + (g[1] - f[1]) * k; fpos.z = f[2] + (g[2] - f[2]) * k;
  fquat.x = f[3]; fquat.y = f[4]; fquat.z = f[5]; fquat.w = f[6];
  for (let w = 0; w < 4; w++) { fcomp[w] = f[7 + w]; fspin[w] = f[11 + w]; }
  for (let j = 0; j < NOZZLES.length; j++) fthr[j] = f[15 + j];
  fvel.set(g[0] - f[0], g[1] - f[1], g[2] - f[2]).multiplyScalar(60);
  syncCar(fpos, fquat, fcomp, fspin, f[15 + NOZZLES.length] || 0);
  for (let b = 0; b < replayBodies.length; b++) { const o = BODY_FRAME + 3 * b; replayBodies[b].cx = f[o]; replayBodies[b].cz = f[o + 1]; replayBodies[b].yaw = f[o + 2]; }
  stage.setBodies(replayBodies);
  // The crash, re-shown from the run's impact events at the tick on screen.
  crash.feed(S.run.impacts, Math.floor((S.replayT + 1) * FRAME_EVERY), fvel);
  hero.setFan?.(f[16 + NOZZLES.length] || 0);
  plumes.update(dt * slow, S.time, fthr, fvel, 0);
  updateAudio({ speed: fvel.length() * slow, grounded: fpos.y < 0.7, throttles: fthr });
}

// --- Title idle: an occasional breath from the lift jets --------------------------------------
function titleStep(dt) {
  stage.setBodies(null);
  const t = S.time % 9;
  const puff = t > 6.2 && t < 6.9 ? Math.sin(((t - 6.2) / 0.7) * Math.PI) * 0.35 : 0;
  for (let i = 0; i < 4; i++) S.idleThrottles[i] = puff;
  plumes.update(dt, S.time, S.idleThrottles, zeroVel, 0);
  updateAudio({ title: true, throttles: S.idleThrottles });
}

// --- Main loop ------------------------------------------------------------------------------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!S.paused) {
    // A crash's slow-motion beat scales the game clock (live and replay); the effects run on it too.
    const slow = S.mode === 'live' || S.mode === 'results' || S.mode === 'replay' ? crash.timeScale() : 1;
    crash.update(dt);
    S.time += dt;
    if (S.mode === 'title') titleStep(dt);
    else if (S.mode === 'countdown') {
      const before = Math.ceil(3 - S.countT);
      S.countT += dt;
      const after = Math.ceil(3 - S.countT);
      if (S.countT < 0.02 || after !== before) ui.countdown(after > 0 ? after : 0);
      if (S.countT >= 3) { S.mode = 'live'; ui.countdown(0); ui.cue_(S.autopilot ? 'The reference jump' : 'Go', 900); }
      plumes.update(dt, S.time, S.idleThrottles.fill(0), zeroVel, 0);
    } else if (S.mode === 'live') liveStep(dt * slow);
    else if (S.mode === 'results' || S.mode === 'replay') replayStep(dt * slow);

    syncGhost();
    const live = S.mode === 'live' || S.mode === 'countdown';
    director.update(dt, S.time, {
      carPos: carRoot.position, carVel: live && S.run ? S.run.car.vel : zeroVel,
      phase: S.run?.phase || 'drive',
      mode: S.mode === 'title' ? 'title' : S.mode === 'results' || S.mode === 'replay' ? 'replay' : 'live',
      course: stage.course,   // [stage]
    });
    stage.render(S.time);
  }
  requestAnimationFrame(frame);
}

// --- Wiring ---------------------------------------------------------------------------------
function pause(on = !S.paused) {
  if (S.mode !== 'live' && S.mode !== 'countdown') return;
  S.paused = on;
  ui.show('pause', on);
  lastT = performance.now();
}

bindInput(document.body, { onPause: () => pause() });
const on = (sel, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
on('[data-start]', () => startRun('jump'));
on('[data-reveal]', () => startRun('reveal'));
on('[data-again]', () => startRun('jump'));
on('[data-replay]', () => { S.replayT = 0; director.snap(); });
on('[data-home]', () => { S.paused = false; toTitle(); });
on('[data-resume]', () => pause(false));
on('[data-restart]', () => { S.paused = false; ui.show('pause', false); startRun(S.autopilot ? 'reveal' : 'jump'); });
on('[data-share]', async () => {
  if (!S.card) return;
  const f = S.card.facts;
  const text = f.course === 'show'
    ? `COLD GAS ${S.card.total.toFixed(1)}: ${S.card.verdict}. Up a ${f.height} m wall, ${f.invertedS} s inverted${f.crossedRow ? `, ${f.clearance} m over five parked vehicles, ${f.sink} m/s touchdown` : ''}.`
    : `COLD GAS ${S.card.total.toFixed(1)}: ${S.card.verdict}. ${f.rollDeg}° roll, ${f.apex} m apex, ${f.sink} m/s touchdown.`;
  const url = `${location.origin}${import.meta.env.BASE_URL}`;
  try {
    if (navigator.share) await navigator.share({ title: 'COLD GAS', text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); ui.cue_('Copied', 1400); }
  } catch { /* cancelled */ }
});

// Event picker on the title (also ?course=wall|lineup; the Show is the default).
const courseBtns = document.querySelectorAll('[data-course]');
function syncCourseBtns() { courseBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.course === stage.course))); }
courseBtns.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.course === stage.course) return;
  stage.setCourse(b.dataset.course);
  syncCourseBtns();
  placeOnPad();
  director.snap();
  const u = new URL(location.href); u.searchParams.set('course', stage.course); history.replaceState(null, '', u);
}));
syncCourseBtns();

const assistBtn = document.querySelector('[data-assist]');
const syncAssist = () => assistBtn.setAttribute('aria-pressed', String(S.assist));
syncAssist();
assistBtn.addEventListener('click', () => {
  S.assist = !S.assist; syncAssist();
  try { localStorage.setItem('coldgas_assist', S.assist ? '1' : '0'); } catch { /* storage blocked */ }
  ui.cue_(S.assist ? 'Assist: the flight computer holds rates and levels for landing' : 'Pro: raw thrust, +8% on every score', 2600);
});
const ghostBtn = document.querySelector('[data-ghost]');
const syncGhostBtn = () => ghostBtn.setAttribute('aria-pressed', String(S.ghostOn));
syncGhostBtn();
function toggleGhost() {
  S.ghostOn = !S.ghostOn; syncGhostBtn(); setGhostEnabled(S.ghostOn);
  const ghost = S.ghosts[stage.course];
  const who = ghost?.ref ? 'the reference run' : 'your best run';
  ui.cue_(S.ghostOn ? (ghost ? `Ghost on: ${who} rides alongside` : 'Ghost on: finish a run to set one') : 'Ghost off', 1600);
}
ghostBtn.addEventListener('click', toggleGhost);
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target?.closest?.('input, select, textarea, [contenteditable], dialog, [data-ai-modal]')) return;
  toggleGhost();
});
const muteBtn = document.querySelector('[data-mute]');
muteBtn.setAttribute('aria-pressed', String(isMuted()));
muteBtn.addEventListener('click', () => { initAudio(); setMuted(!isMuted()); muteBtn.setAttribute('aria-pressed', String(isMuted())); });

document.querySelector('[data-r-submit]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.initials;
  const initials = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  const msg = document.querySelector('[data-r-submit-msg]');
  if (initials.length !== 3) { msg.textContent = 'Three letters.'; return; }
  if (S.autopilot) { msg.textContent = 'The reference jump can’t be posted.'; return; }
  try { localStorage.setItem('coldgas_initials', initials); } catch { /* storage blocked */ }
  msg.textContent = 'Verifying…';
  const res = await postScore(S.run.inputLog, S.assist, initials, S.run.course);
  msg.textContent = res.ok ? `Posted. #${res.rank} today.` : res.status === 429 ? 'Slow down a little.' : 'The board is offline.';
});
try { document.getElementById('initials').value = localStorage.getItem('coldgas_initials') || ''; } catch { /* storage blocked */ }

let boardKind = 'today';
async function openBoard(kind = boardKind) {
  boardKind = kind;
  ui.show('board', true);
  document.querySelectorAll('[data-board]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.board === kind)));
  ui.board(await fetchBoard(kind));
}
on('[data-board-open]', () => openBoard());
on('[data-board-close]', () => ui.show('board', false));
document.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard(b.dataset.board)));

addEventListener('resize', () => { stage.resize(); plumes.setScale(innerHeight); crash.setScale(innerHeight); director.reframe(); });
plumes.setScale(innerHeight); crash.setScale(innerHeight);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

// Deep links: ?play=jump|reveal, ?board=today|all.
toTitle();
const play = params.get('play');
if (play === 'jump' || play === 'reveal') startRun(play);
if (params.get('board')) openBoard(params.get('board') === 'all' ? 'all' : 'today');

// e2e hooks. fastForward() runs the sim to the end without waiting on the wall clock, so slow
// software-GL runners exercise the same flow (countdown → live → results) in seconds.
function fastForward() {
  if (S.mode === 'countdown') { S.mode = 'live'; ui.countdown(0); }
  if (S.mode !== 'live') return;
  for (let i = 0; i < 4000 && S.mode === 'live'; i++) liveStep(0.1);
}
function skipCountdown() { if (S.mode === 'countdown') { S.mode = 'live'; ui.countdown(0); } }
window.__coldgas = { S, stage, startRun, toTitle, camera, carRoot, ghostRoot, hero, director, plumes, crash, createAutopilot, fastForward, skipCountdown };
requestAnimationFrame(frame);
