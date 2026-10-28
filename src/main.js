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
import { createRun, stepRun, armAftermath, aftermathStep, FRAME_EVERY, BODY_FRAME, BODY_STRIDE } from './sim/run.js';
import { freeWorld } from './sim/world.js';
import { physicsReady, physicsMemoryBytes } from './sim/engine.js';
import { loadPhysics } from './sim/engine-web.js';
import { DT, G, CAR, NOZZLES, WHEELS, bodyRates, worldPoint, newInput } from './sim/vehicle.js';
import { scoreRun, TIERS, WRECK_PCT } from './sim/judge.js';
import { coach } from './sim/coach.js';
import { createLandingHud } from './hud-landing.js';
import { hudPitch, createGWindow, tankBar, gasState } from './hud-telemetry.js';
import { drillById, drillsFor, buildDrill, drillResult, drillCoach } from './practice.js';
import { createAutopilot } from './sim/autopilot.js';
import { COURSES, surface } from './sim/courses.js';
import { siteFloor } from './sim/complex.js';
import { SPEC } from './sim/spec.js';
import { bindInput, sample, sampleThumb, thumb, usingTouch, getNozzlePad, onDevice, lastDevice, resetInput, freshRun, pollPads, heldState, driving as drivingSettings, setDriving, onDriving, drivingState, onPadY } from './input.js';
import { LEVEL_INFO } from './driving.js';
import { isCrash, nextStreak, offerRookie, loadStreak, saveStreak } from './rookie.js';
import { loadPerf, savePerf, record, decide, outcomeOf, afterChange, coachLive, loadFlown, saveFlown, loadAdapt, saveAdapt, TIER_WORDS, factorText, stepDownBanner, offerWords } from './adapt.js';
import { deviceOf, howtoRows, pauseRows, deviceTitle, pickPointer, livePointer } from './pointer.js';
import { createPoseLerp, createBodiesLerp } from './render/interp.js';
import { newReplayPose, sampleReplay, stepReplayClock, slowTarget } from './render/replay.js';
import { thumbStage } from './onethumb.js';
import { settings as touchSet, setSetting, onSettings, buzz, hasHaptics, enableTilt, disableTilt, calibrateTilt, tiltSeen, tiltSteer } from './touch-settings.js';
import { wallProgress, INPUT_KEYS } from './sim/run.js';
import { initAudio as initAudio0, updateAudio as updateAudio0, thud as thud0, setMuted, isMuted, chime as chime0, suspendAudio, resumeAudio, audioState } from './audio.js';
import { syncWake, wakeHeld } from './wake.js';
import { createUI, crashStep } from './ui.js';
import { initFocusTrap } from './focus-trap.js';
import { wireUnitToggles, unitText } from './units.js';
import { drawShareCard, shareRun } from './share-card.js';
import { createInstruments } from './instruments.js';
import { localWords, postScore, fetchBoard } from './panel.js';
import { withDeadline } from './net.js';
import { loadAI } from './ai/config.js';
import { openSettings, aiLabel } from './ai/settings.js';
import { packFrames, ghostAt, isBetter, newGhostPose, loadBest, saveBest, ghostEnabled, setGhostEnabled } from './ghost.js';
import { obs, guard, deviceClass } from './obs/index.js';
import { installHeal } from './obs/heal.js';
import { createPacer } from './pace.js';
import { pickDeviceTier, pickAA, deviceKind, readDevice, isIOS } from './gfx-tier.js';

// The rigid-body engine's WASM (src/sim/engine.js), asked for before anything heavy starts: it
// streams and compiles off the main thread while the stage builds (1.2 MB gzip, after first paint).
const physicsLoad = loadPhysics();
physicsLoad.catch(() => {});
const params = new URLSearchParams(location.search);
const device = readDevice();
const coarse = device.coarse;
// Graphics defaults per device (src/gfx-tier.js): one look everywhere (0097). Desktops, phones and
// tablets start 'high'; only a phone reporting ≤ 2 GB starts 'low'. ?gfx= overrides.
// [obs] …then this device's own history (src/obs/ledger.js) moves it: down after a bad session, back up
// after several smooth ones. The reason shows in For nerds → Health.
const tier = obs.boot({ forced: params.get('gfx'), deviceTier: pickDeviceTier(device).tier }).tier;
obs.init({ deviceClass: deviceClass(navigator, coarse, deviceKind(device)) });
// Audio is a breaker-guarded subsystem: if it throws, the game goes quiet instead of stopping.
const initAudio = guard('audio', initAudio0), updateAudio = guard('audio', updateAudio0), thud = guard('audio', thud0), chime = guard('audio', chime0);
// The audio graph is built on the first touch, click or key anywhere (a user gesture, so the
// context may start), not inside the Jump tap: building it can take a long task of its own. Every
// later gesture brings back a context that stopped (iOS 'interrupted' too), unless it should be quiet.
let lastGesture = performance.now();
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, (e) => {
    if (e.repeat) return;
    lastGesture = performance.now();
    if (audioState() === 'none') initAudio();
    syncLife(true);   // inside the gesture: resumes only if it shouldn't be quiet
  }, { capture: true, passive: true });
}

const canvas = document.getElementById('stage');
let stage;
try {
  // [stage] ?course=wall|lineup practises one stunt; the Show (one flight off the Wall) is the default.
  stage = createStage(canvas, { tier, course: ['wall', 'lineup'].includes(params.get('course')) ? params.get('course') : 'show',
    aa: pickAA({ tier, touch: coarse || isIOS(device) }),
    backdrop: obs.breaker('rocket').allow(), onBackdropError: (err) => obs.fail('rocket', err),
    warm: params.get('warm') === '1' ? true : null });   // [stage] ?warm=1: warm the other courses even on software GL (e2e)
} catch (err) {
  console.error(err);
  obs.error('webgl', err);
  obs.flush('boot', { force: true });
  document.body.insertAdjacentHTML('beforeend', '<p class="noscript">COLD GAS needs WebGL. Try a current browser.</p>');
  throw err;
}
const { scene, camera, hero } = stage;
// [stage] the other courses are warmed only on the title: a run's or a drive's frames need the time (0046).
stage.warmGate = () => S.mode === 'title' && !S.paused;
// Runs wait for the engine (a beat on a cold load, nothing after). Only the latest start asked for
// while it loads goes ahead, and only if nothing else happened meanwhile: every mode change (and
// opening Free Drive or the Sandbox) retires the token, so a Start tapped during the load can't fire
// later into a drive, and several taps start one run.
const physics = () => loadPhysics().catch((err) => { console.error(err); ui.cue_('The physics engine couldn’t load', 2400); throw err; });
let startToken = 0;
const cancelPendingStart = () => { startToken++; };
function whenPhysics(fn) {
  return (...args) => {
    cancelPendingStart();
    if (physicsReady()) return fn(...args);
    const token = startToken;
    ui.cue_('Loading physics', 1200);
    physics().then(() => { if (token === startToken) fn(...args); }).catch(() => {});
  };
}
const ui = createUI();
// The modal sheets hold focus while they're up and hand it back when they close (0054, src/focus-trap.js).
initFocusTrap([ui.screens.pause, ui.screens.controls, ui.screens.howto, ui.screens.assist, ui.screens.board,
  document.querySelector('[data-drive-pause]'), document.querySelector('[data-ai-modal]')]);
// Units (src/units.js): US by default, metric a tap away on any unit readout, or U.
wireUnitToggles();
// Every HUD instrument answers a tap: peak G, burn time, splits, attitude, the valves, the damage map.
const instruments = createInstruments(ui, { getRun: () => S.run });

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
// The reference's ghost, warm-tinted, rides alongside too (in practice it starts exactly where you
// do). Same shader as the best-run ghost, so nothing new to compile.
const refGhostMat = ghostMat.clone();
refGhostMat.color.set(0xffd2a1);
const refGhostRoot = new THREE.Group();
const refGhostModel = makeGhost(hero);
refGhostModel.traverse((o) => { if (o.isMesh) o.material = refGhostMat; });
refGhostModel.position.y = -hero.comY;
refGhostRoot.add(refGhostModel);
scene.add(refGhostRoot);
refGhostRoot.visible = false;
const plumes = createPlumes(scene, carRoot, { maxMist: tier === 'low' ? 500 : tier === 'mid' ? 900 : 1800 });
const director = createDirector(camera);
// The landing HUD and its touchdown marker (src/hud-landing.js).
// Leaving the green band is a warning you can feel: one buzz (Android), once per change for the worse.
const landing = createLandingHud({ scene, onStatus: (s, prev) => { if ((s === 'amber' && prev === 'green') || (s === 'red' && prev !== 'red' && prev)) buzz('warn'); } });
// Crashes: sparks, chips, dents, torn-off parts, lamps, shake, slow motion, the crash cut and the
// crunch, all keyed to the sim's impact events (src/render/crash.js).
const crash = createCrash({ scene, hero, carRoot, director, tier,
  course: () => (S.mode === 'drive' && fd() ? fd().course : stage.course), floor: () => (S.mode === 'drive' && fd() ? fd().floor : 0) });

// --- State -------------------------------------------------------------------------------
const S = {
  mode: 'title',          // title | countdown | live | results | replay | drive (Free Drive, src/drive/)
  run: null, autopilot: null, card: null, words: null,
  assist: true, acc: 0, countT: 0, doneT: 0, paused: false,
  replayT: 0, replaySlow: 1, prevPhase: '', time: 0,   // the replay's clock (src/render/replay.js)
  impacts: 0, impact: null,   // touchdowns this run, and the last one's cues (src/render/impact.js)
  idleThrottles: new Float64Array(NOZZLES.length),
  tier: 'assist',             // flight tier for the next run: assist | pro | advanced (src/sim/judge.js TIERS)
  flyTier: 'assist',          // the tier of the run on screen: latched at its start, never changed mid-run (0079)
  drill: null, slowmo: 1, freezeT: 0, coach: null,   // practice (src/practice.js)
  countLen: 3,                // the countdown: 3 s from the title, 1 s on a retry (READY · GO)
  attempts: {},               // runs flown this session, per course (the results' "Run 4")
};
// The page knows the mode, so the quick Retry / Home buttons show only where they belong.
const setMode = (m) => { if (m !== S.mode) cancelPendingStart(); if (m !== 'results') peek(false); S.mode = m; document.body.dataset.mode = m; };
try {
  const saved = localStorage.getItem('coldgas_tier');
  S.tier = TIERS[saved] ? saved : localStorage.getItem('coldgas_assist') === '0' ? 'pro' : 'assist';
} catch { /* storage blocked */ }
S.assist = S.tier === 'assist';
S.flyTier = S.tier;
// A run's tier is the one in effect at its start: the picker, Rookie mode and Adapt to me change S.tier
// (the next run); everything a run flies, scores and posts reads S.flyTier.
const inRun = () => S.mode === 'live' || S.mode === 'countdown';
const runTier = () => (inRun() ? S.flyTier : S.tier);
function latchTier() { S.flyTier = S.tier; ui.screens.hud.dataset.tier = S.flyTier; }
// One ghost per course, loaded on first use.
S.ghosts = {}; S.ghostOn = ghostEnabled();
const ghostLoads = {};
const ghostLoaded = (course) => (ghostLoads[course] ??= loadBest(course).then((g) => { if (g && isBetter(S.ghosts[course], g)) S.ghosts[course] = g; }));
ghostLoaded(stage.course);
const gpose = newGhostPose();
// Shown only in your own live runs; it fades out where it overlaps the car (the start line).
// It rides on the same fractional tick the car is drawn at (src/render/interp.js: the previous tick's
// pose toward this one's), so the two glide together at 120/144 Hz instead of the ghost stepping.
function syncGhost() {
  const live = (S.mode === 'live' || S.mode === 'countdown') && !S.autopilot;
  const best = S.ghosts[S.run?.course];
  const tick = live && S.run ? (S.mode === 'live' && S.run.tick > 0 ? S.run.tick - 1 + Math.min(1, S.acc / DT) : S.run.tick) : 0;
  ghostRoot.visible = live && S.ghostOn && !!best && !best.ref && ghostAt(best, tick, gpose);
  if (ghostRoot.visible) placeGhost(ghostRoot, ghostMat);
  refGhostRoot.visible = live && S.ghostOn && ghostAt(refGhost(S.run.course, true), tick, gpose);
  if (refGhostRoot.visible) placeGhost(refGhostRoot, refGhostMat);
}
function placeGhost(root, mat) {
  root.position.set(gpose.x, gpose.y, gpose.z);
  root.quaternion.set(gpose.qx, gpose.qy, gpose.qz, gpose.qw);
  const d = root.position.distanceTo(carRoot.position);
  mat.opacity = 0.18 * Math.min(1, Math.max(0, (d - 1.5) / 2.5));
}
// The reference flight's frames, once per course: ≈3,450 engine ticks, 0.13 s on a desktop and
// ≈0.7 s on a phone. Flown in the background on the title (precomputeRefGhosts, ≤ 5 ms slices), so
// the first Jump starts at once; `peek` asks without flying (the ghost shows once it's ready). A
// drill asks without peeking and finishes the flight there and then if it isn't done.
const refGhosts = {}, refFlights = {};
function refFly(course, budgetMs) {
  const fl = (refFlights[course] ??= { run: createRun(course), ap: createAutopilot(course) });
  const { run, ap } = fl, t0 = performance.now();
  while (run.phase !== 'done') {
    for (let i = 0; i < 8 && run.phase !== 'done'; i++) stepRun(run, ap(run));
    if (performance.now() - t0 >= budgetMs) break;
  }
  if (run.phase !== 'done') return;
  refGhosts[course] = packFrames(run.frames, scoreRun(run.t).total, true, course);
  delete refFlights[course];
}
function refGhost(course, peek = false) {
  if (!course) return null;
  if (!refGhosts[course] && !peek) refFly(course, Infinity);
  return refGhosts[course] || null;
}
// The HUD's (and the touch controls') first style and layout, done once on the title while they're
// invisible: the first time they appear costs ≈40–60 ms on a 4×-throttled CPU (fonts, glyphs, a
// big subtree), which used to land in the Jump tap's frame. Caches persist once they're hidden again.
function warmHud() {
  if (S.mode !== 'title') return;
  for (const el of [ui.screens.hud, ui.touch]) {
    if (!el?.hidden) continue;
    el.style.visibility = 'hidden'; el.hidden = false;
    void el.offsetHeight;
    el.hidden = true; el.style.visibility = '';
  }
}
// Between frames on the title (and the countdown and results, which don't step the sim), the
// course on show first. Never during a live run or a drive: their frames need the time.
async function precomputeRefGhosts() {
  await Promise.all([stage.ready, physicsLoad]);
  warmHud();
  const idle = () => S.mode === 'title' || S.mode === 'countdown' || S.mode === 'results' || S.mode === 'replay';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const course = !refGhosts[stage.course] ? stage.course : ['show', 'wall', 'lineup'].find((c) => !refGhosts[c]);
    if (!course) return;
    if (idle()) refFly(course, 5);
    await (idle() ? (globalThis.scheduler?.yield?.() ?? wait(0)) : wait(250));
  }
}
precomputeRefGhosts().catch((err) => console.warn('reference ghost', err));

const rates = { x: 0, y: 0, z: 0 };
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
  instruments.close();
}

// The run's engine world goes back as soon as the run is left (a finished run already freed it;
// freeWorld is idempotent): retry mid-run, Home, a drill, a double-tapped Start each used to leak one.
function disposeRun() {
  if (S.run?.car?.world) freeWorld(S.run.car.world);
}

// Back to the title from anywhere, Free Drive and the Sandbox included (heal's escalation calls it
// too). Their exit() calls back into toTitle (onExit): the guard keeps that from recursing.
let leaving = false;
function toTitle() {
  if (!leaving) {
    leaving = true;
    try {
      if (sandbox?.active) sandbox.exit();
      if (drive?.active) drive.exit(); else drive?.closePicker();
    } catch (err) {
      console.error(err);
    } finally {
      leaving = false;
    }
    // Whatever a broken exit left behind, the title has no driving chrome.
    document.body.classList.remove('driving');
  }
  cancelPendingStart();
  closeOverlays();
  disposeRun();
  setMode('title'); S.run = null; S.drill = null;
  ui.only('title');
  drillBar.hidden = true;
  landing.show(false);
  getNozzlePad().show(false);
  ui.touch.hidden = true;
  ui.clearCue(); ui.countdown(0);
  plumes.clear();
  crash.reset();
  placeOnPad();
  history.replaceState(null, '', stage.course === 'show' ? location.pathname : `${location.pathname}?course=${stage.course}`);
}

const startRun = whenPhysics(startRunNow);
function startRunNow(kind = 'jump', quick = false) {
  closeOverlays();
  initAudio();
  disposeRun();
  // Armed for its aftermath: when it ends, the car finishes its crash before the results (0062).
  S.run = armAftermath(createRun(stage.course)); S.after = false; S.drillSnap = null;
  S.autopilot = kind === 'reveal' ? createAutopilot(stage.course) : null;
  S.runKind = kind;   // the reference jump never counts toward Rookie mode's streak (0074)
  latchTier();
  S.adaptNow = null;
  // Live pointers on the cue line (0079): a new player's first runs, or while Adapt to me says they're struggling.
  S.coachLive = kind === 'jump' && coachLive(S.perf, S.flown, S.adapt);
  S.released = false; S.drill = null; S.freezeT = 0; S.coach = null;
  ghostLoaded(stage.course);   // the reference ghost is flown on the title (precomputeRefGhosts)
  setMode('countdown'); S.countT = 0; S.countLen = quick ? 1 : 3; S.acc = 0; S.card = null; S.words = null; S.prevPhase = '';
  S.impacts = 0; S.impact = null;
  newFlight();
  ui.only('hud');
  drillBar.hidden = true;
  landing.show(false);
  getNozzlePad().show(false);
  director.setView(S.pilotView ? 'pilot' : 'broadcast');
  ui.touch.hidden = !usingTouch() || !!S.autopilot;
  syncScheme();
  syncTouchPhase(S.run);
  if (thumbActive()) syncThumb(S.run, S.run.car);
  plumes.clear();
  crash.reset();
  const c = S.run.car;
  const sag = c.wheels[0].compression;
  syncCar(c.pos, c.quat, [sag, sag, sag, sag], [0, 0, 0, 0], 0);
  director.restart(); hero.placed();
  syncHud(S.run, c, -S.countLen);   // READY shows this run's start, not the last run's end
  if (S.autopilot) ui.cue_({ show: 'The reference run: the Wall, then the lineup', wall: 'The reference run: up the Wall' }[stage.course] || 'The reference jump', 2400);
  // The last run's pointer, once more, as this one counts down (≈2.5 s: "Go" waits behind it on a retry).
  else if (S.tip) { ui.cue_(`Tip: ${S.tip}`, 2800, { hold: 2300 }); S.tip = ''; }
}

// The card is decided the moment the run ends (closeBook in src/sim/run.js); a drill's own card reads
// the car there too. Taken before the aftermath moves it (beginAftermath), shown after.
function closeCard(run) {
  S.card = scoreRun(run.t, { assist: S.autopilot ? true : S.flyTier === 'assist' });
  S.drillSnap = S.drill ? { result: drillResult(S.drill, run, S.card), coach: drillCoach(S.drill, run) } : null;
}
function finishRun() {
  const run = S.run;
  if (!S.card) closeCard(run);
  setMode('results');
  ui.only('results');
  ui.touch.hidden = true;
  drillBar.hidden = true;
  landing.show(false);
  getNozzlePad().show(false);
  ui.clearCue();
  countRun(run);
  // The coach re-flies the log (≈30–60 ms) a beat after the sheet slides in.
  const coachRun = () => setTimeout(() => {
    if (S.run !== run) return;
    try {
      const own = S.drill && S.drillSnap?.coach;
      S.coach = own ? { items: own } : coach(run.inputLog, run.course, S.card, run.drillStartTick || 0);
      ui.coaching(S.coach.items);
      if (!own && S.runKind === 'jump') showPointer(run);
    } catch (err) { console.warn('coach', err); }
  }, 450);
  if (S.drill) {
    // Practice: the drill's own card and the coach. No panel, no board, no ghost.
    ui.results(S.card, { drill: S.drill, result: S.drillSnap.result });
    pointerBox.hidden = true;
    coachRun();
    replayFrom(Math.max(0, (run.drillStartTick || 0) / FRAME_EVERY - 30));
    return;
  }
  ui.results(S.card);
  pointerBox.hidden = true;
  if (!S.autopilot) {
    // Run n, and how it stands against your best on this device (before this run counts).
    const n = (S.attempts[run.course] = (S.attempts[run.course] || 0) + 1);
    const best = S.ghosts[run.course];
    ui.runline(n, best && !best.ref ? best.total : null, S.card.total);
  } else ui.runline(0, null, S.card.total);
  if (!S.autopilot) coachRun();
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
  replayFrom(0);
}

// The coach's pointer (0079, src/pointer.js): the one fix that matters most, in this device's controls,
// as one large line on the sheet and again as the next run counts down ("Tip: …"). "Better: …" once
// last run's fix is fixed; never the same pointer three runs running.
const pointerBox = document.querySelector('[data-pointer]');
S.pointerHist = [];
S.tip = '';
function pointerCtx(course = S.run?.course || stage.course, tier = S.flyTier) {
  const device = deviceOf(lastDevice());
  const scheme = device === 'touch' && touchSet.scheme === 'thumb' && course !== 'lineup' && tier === 'assist' ? 'thumb' : 'classic';
  return { device, scheme, tier, course };
}
function showPointer(run) {
  // Worded for the tier the next run flies (an Adapt step down changes the controls that matter).
  const p = pickPointer(S.coach.items, pointerCtx(run.course, S.tier), { history: S.pointerHist, card: S.card, flight: S.coach.flight, crashed: !!S.card?.facts?.crashed });
  if (p.id) { S.pointerHist.push(p.id); if (S.pointerHist.length > 4) S.pointerHist.shift(); }
  const text = p.text || '';
  pointerBox.querySelector('[data-pointer-better]').textContent = '';
  if (p.better) unitText(pointerBox.querySelector('[data-pointer-better]'), p.better);
  pointerBox.querySelector('[data-pointer-better]').hidden = !p.better;
  unitText(pointerBox.querySelector('[data-pointer-text]'), text);
  pointerBox.dataset.fix = p.id;
  pointerBox.toggleAttribute('data-clean', p.id === 'clean');
  pointerBox.hidden = !text && !p.better;
  S.tip = p.id === 'clean' ? '' : text;
}

// Rookie mode (0074, src/rookie.js): crashed runs in a row, this session. From the third the results offer
// one button: Easy driving + Assist flight (auto-land), saved, and straight into the retry. Any clean run
// ends the streak, and so does a change of driving level or flight tier (the player chose; the offer
// waits for three new crashes).
// The theatre (full screen on a phone, over the sheet) carries the same button in its action bar (0076):
// one offer, drawn twice, both from syncRookie, both clicks through goRookie (delegated, below).
// Adapt to me (0079, src/adapt.js) is the same model, grown: per session it also counts crashes on this
// tier and good runs in a row. Between runs only, it steps the tier down after crashes (Adapt to me on,
// with Undo on the sheet) and offers a harder step after clean landings (never forced).
const rookieBox = document.querySelector('[data-rookie]'), rookieTheatre = document.querySelector('[data-theatre]');
S.perf = loadPerf();
S.crashStreak = loadStreak();
S.perf.crashes = S.crashStreak;   // one streak: Rookie's (0074) is the model's crash count
S.flown = loadFlown();            // runs ever finished on this device (a new player gets live pointers)
S.adapt = loadAdapt();
S.adaptNow = null;                // what this sheet shows: { stepDown: { from, to } | null, offer } (adapt.js decide)
let streakRun = null;
function setStreak(n) { S.crashStreak = n; S.perf.crashes = n; saveStreak(n); savePerf(S.perf); }
// A finished run of the player's own (not the reference, not a drill): the model hears it once.
function countRun(run) {
  if (run === streakRun || S.runKind === 'reveal' || !S.card) return syncRookie();
  streakRun = run;
  // A drill's crash counts toward Rookie's streak as it always did (0074); the rest is for real runs.
  if (S.runKind !== 'jump') { S.adaptNow = null; setStreak(nextStreak(S.crashStreak, isCrash(S.card))); return syncRookie(); }
  const best = S.ghosts[run.course];
  S.perf = record(S.perf, outcomeOf(S.card, { best: best && !best.ref ? best.total : null }));
  S.crashStreak = S.perf.crashes; saveStreak(S.crashStreak); savePerf(S.perf);
  saveFlown(++S.flown);
  const d = decide(S.perf, { tier: S.tier, level: drivingSettings.level, adapt: S.adapt });
  S.adaptNow = { stepDown: null, offer: d.offerLevel || d.offerTier ? d : null };
  // The step down happens here, between runs: the next run flies it; this run's card keeps its tier.
  if (d.stepDown) { const from = S.tier; setTier(d.stepDown, { auto: true }); S.adaptNow.stepDown = { from, to: S.tier }; }
  syncRookie();
}
let streakLevel = drivingSettings.level;
onDriving((d) => { if (d.level !== streakLevel) { streakLevel = d.level; S.perf = afterChange(S.perf); if (S.crashStreak) setStreak(0); else savePerf(S.perf); syncRookie(); } });
const adaptBox = document.querySelector('[data-adapt-box]'), adaptDown = document.querySelector('[data-adapt-down]'), adaptUp = document.querySelector('[data-adapt-up]');
function syncRookie() {
  const results = S.mode === 'results';
  const offer = results && !S.adaptNow?.stepDown && offerRookie(S.crashStreak, drivingSettings.level, S.tier);
  rookieBox.hidden = !offer;
  rookieTheatre.classList.toggle('th-rookie', offer);
  // Adapt to me: the step it took (and Undo), or the harder step it offers. Rookie's offer wins the sheet.
  const a = results ? S.adaptNow : null;
  const down = a?.stepDown || null, up = !offer && !down && a?.offer ? offerWords(a.offer) : null;
  adaptDown.hidden = !down;
  if (down) document.querySelector('[data-adapt-why]').textContent = stepDownBanner(down.from, down.to);
  adaptUp.hidden = !up;
  if (up) {
    document.querySelector('[data-adapt-label]').textContent = up.label;
    document.querySelector('[data-adapt-sub]').textContent = up.sub;
    document.querySelector('[data-adapt-up-why]').textContent = up.why;
  }
  adaptBox.hidden = !down && !up;
}
function goRookie() {
  setDriving({ level: 'easy' });
  setTier('assist');
  setStreak(0);
  syncRookie();
  ui.cue_('Rookie mode: Easy driving, Assist flying, auto-land', 2400);
  retry();
}
// Undo the step down: back to the tier the player had (their choice again: the counts start over).
document.querySelector('[data-adapt-undo]').addEventListener('click', () => {
  const down = S.adaptNow?.stepDown;
  if (!down) return;
  S.adaptNow.stepDown = null;
  setTier(down.from);
  syncRookie();
  ui.cue_(`${TIER_WORDS[down.from].name} again for the next run`, 2000);
  document.querySelector('.results [data-again]')?.focus({ preventScroll: true });
});
// The harder step, offered: one tap takes it and goes again.
document.querySelector('[data-adapt-go]').addEventListener('click', () => {
  const o = S.adaptNow?.offer;
  if (!o) return;
  S.adaptNow.offer = null;
  if (o.offerLevel) setDriving({ level: o.offerLevel }); else if (o.offerTier) setTier(o.offerTier);
  ui.cue_(o.offerLevel ? 'Standard driving' : `${TIER_WORDS[S.tier].name} · ${factorText(S.tier)}`, 2000);
  retry();
});

const theatreRoot = document.querySelector('[data-theatre]');
const liftLabel = document.querySelector('[data-lift-label]'), stickHint = document.querySelector('[data-stick-hint]'), goLabel = document.querySelector('[data-go-label]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const JUDGE_MS = 35_000;   // invariant 5½: no AI call may block the results longer than this
let replayingCall = false;
async function runPanel(run, replay = null) {
  const assist = !!(S.flyTier === 'assist' || S.autopilot);
  const card = S.card;
  if (!replay) { panelAbort?.abort(); panelAbort = new AbortController(); }
  const signal = panelAbort?.signal;
  let mod;
  // [obs] The judges are a breaker-guarded subsystem: after repeated failures the panel speaks local
  // lines for a while (a cooldown that doubles), then tries the call again.
  if (!replay && !obs.breaker('judge').allow()) { S.words = localWords(card); ui.words(S.words); ui.cue_('The judges are resting: local lines for now', 1800); return; }
  // [obs] The theatre is a lazy chunk, and loading it spends the same 35 s (invariant 5½). A chunk
  // that fails or stalls isn't the judges' fault (no breaker): local lines now, and the page is
  // marked stale so the next title checks for a new build (src/obs/heal.js).
  const t0 = performance.now();
  try { mod = await withDeadline(import('./ai/theatre.js'), JUDGE_MS, 'the judges’ chunk'); } catch (err) {
    obs.lazyFailed(err);
    try { heal.markStale('the judges’ chunk failed to load'); } catch { /* heal not installed yet */ }
    if (S.run === run && !signal?.aborted) { S.words = localWords(card); ui.words(S.words); }
    return;
  }
  if (S.run !== run || signal?.aborted) return;
  const { words, meta, aborted } = await mod.runTheatre(theatreRoot, {
    log: run.inputLog, t: run.t, assist, ai: loadAI(), card, course: run.course, fallbackWords: localWords, reduced: reducedMotion, replay, abort: signal,
    deadlineMs: replay ? JUDGE_MS : JUDGE_MS - (performance.now() - t0),
  });
  if (aborted || S.run !== run) return;
  if (!replay && /too long/.test(meta.error || '')) obs.fail('judge', new Error('judge deadline'), 'fetch');
  if (!replay) {
    if (meta.verify?.card && Math.abs(meta.verify.card.total - card.total) > 0.05) console.warn('server card differs', meta.verify.card.total, card.total);
    S.words = words; S.callMeta = meta;
  }
  ui.words(S.words);
  // Replay the call: one at a time (a second press while it plays does nothing).
  ui.receipt(S.callMeta, { onReplay: () => { if (replayingCall) return; replayingCall = true; runPanel(run, S.callMeta.events).finally(() => { replayingCall = false; }); }, onChange: () => openAI() });
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
  if (noteRelease(run, input)) buzz('release');
  input.fan = !S.released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
  return input;
}

// The release, read off the run for any pilot (a player, the reference, a drill): LIFT on the deck, or
// the first tick in the air. The timeline's RELEASE → CARRY → BRAKE keys off it (ticket 0022).
function noteRelease(run, input) {
  if (S.released || run.course === 'lineup' || !((run.phase === 'ramp' && input.lift > 0) || run.phase === 'air')) return false;
  S.released = true; S.releaseTick = run.tick;
  return true;
}

const sn = { x: 0, y: 0, z: 0 }, padP = { x: 0, y: 0, z: 0 };
// Height above the ground, unless something nearer is under the floor (the Lineup's kicker, a roof).
function heightAboveSurface(c) {
  const d = surface(COURSES[stage.course], c.pos.x, c.pos.y, c.pos.z, sn);
  // The launch complex is not in surface(): over the pad (or the mount's deck), measure from it.
  const h = Math.min(sn.y > 0.9 ? d : c.pos.y, c.pos.y - siteFloor(stage.course, c.pos.x, c.pos.y, c.pos.z, padP));
  return Math.max(0, h - SPEC.comHeight);
}
// G as the livestream read it: specific force over the last 0.5 s, fed every sim tick (src/hud-telemetry.js).
const gWindow = createGWindow();

// The touchdown felt in the body: camera, mist from each tyre and the thud, all scaled by sink rate.
const contactPts = new Float32Array(12), wp = { x: 0, y: 0, z: 0 };
function touchdown(run) {
  const c = run.car;
  const k = landingImpact(run.t.sink, reducedMotion);
  S.impacts++; S.impact = k;
  thud(k);
  // Felt in the hand too: a soft landing is a tap, a hard one a thump.
  if (run.t.sink > 4) buzz('crash'); else buzz(null, Math.round(Math.min(90, 14 + run.t.sink * 14)));
  director.shake(k.shake);
  director.impact(k.dip, k.fovPunch);
  for (let i = 0; i < 4; i++) {
    worldPoint(c, WHEELS[i], wp);
    contactPts[i * 3] = wp.x; contactPts[i * 3 + 1] = Math.max(0, wp.y - 0.24 - SPEC.wheelRadius); contactPts[i * 3 + 2] = wp.z;
  }
  plumes.burst(contactPts, k.mist, k.mistSpeed);
}

// --- Live step -----------------------------------------------------------------------------
const liveInput = newInput();
const poseLerp = createPoseLerp();   // the car drawn between 240 Hz ticks (src/render/interp.js)
const bodyLerp = createBodiesLerp(); // and the parked bodies with it
function liveStep(dt) {
  const run = S.run;
  // A drill opens on a beat with the car frozen at its start, so you see where you are first.
  if (S.freezeT > 0) { S.freezeT -= dt; if (S.freezeT <= 0) ui.cue_('Go', 600, { hold: 700 }); dt = 0; }
  S.acc += Math.min(dt, 0.1) * (S.drill ? S.slowmo : 1);
  let input = null;
  const oneThumb = thumbActive();
  const simT0 = performance.now(), tick0 = run.tick;
  while (S.acc >= DT && run.phase !== 'done' && !S.after) {
    if (S.autopilot) noteRelease(run, input = S.autopilot(run));
    else input = wallAssist(run, oneThumb ? sampleThumb(run, S.released, liveInput) : sample(run.phase, S.flyTier, liveInput, S.released, run.car));
    poseLerp.before(run.car);
    bodyLerp.before(run.car.world.bodies);
    stepRun(run, input);
    gWindow.push(run.car.vel);
    braking(run);
    S.acc -= DT;
  }
  // The aftermath (0062): the run is over and scored, the car isn't stopped. The same world steps on
  // the post-crash input (brakes through ABS, no drive, no fan, valves shut: src/sim/run.js) until it
  // is at rest, then frees it. Slow motion slows it with everything else.
  if (S.after && !run.after.done) {
    while (S.acc >= DT) {
      poseLerp.before(run.car);
      bodyLerp.before(run.car.world.bodies);
      gWindow.push(run.car.vel);
      S.acc -= DT;
      if (aftermathStep(run)) { S.acc = 0; break; }
    }
  }
  // The card is decided on the frame the run ends, before the HUD reads it: a crash ends the
  // timeline as a crash on that frame, not one frame of TOUCHDOWN first (0072).
  if (run.phase === 'done' && !S.card) closeCard(run);
  S.simMs = performance.now() - simT0; S.simTicks = run.tick - tick0;   // the nerds panel's clock
  if (run.t.contact && !S.contactBuzzed) { S.contactBuzzed = true; buzz('crash'); }
  const c = run.car;
  const drawn = poseLerp.pose(c, S.acc / DT);   // body and wheels at the clock's fraction of a tick
  syncCar(drawn.pos, drawn.quat, drawn.comp, drawn.spin, drawn.steer);
  stage.setBodies(bodyLerp.poses(c.world.bodies, S.acc / DT));
  stage.rocket?.simClock(run.tick * DT);   // the range's static fire, on the sim's schedule
  crash.feed(run.impacts, run.tick, c.vel);

  // Phase cues and moments.
  // Touch layout follows the phase: pedals on the ground and up the wall, LIFT/LAND in the air.
  // (Let go of the Wall, the air controls come up at once, not when the sim calls it airborne;
  // a hop off the ground swaps nothing until it has lasted AIR_HOLD, 0047.)
  const tp = syncTouchPhase(run);
  if (oneThumb) syncThumb(run, c);
  // Advanced on a touch screen: off the Wall the nozzle pad replaces the stick and the buttons.
  const pad = getNozzlePad();
  const padOn = S.flyTier === 'advanced' && !S.autopilot && !ui.touch.hidden && (tp === 'air' || (tp === 'ramp' && S.released));
  if (pad.active() !== padOn) { pad.show(padOn); ui.touch.classList.toggle('np-on', padOn); }
  if (padOn) pad.sync(c.throttles);
  if (run.phase !== S.prevPhase) {
    if (run.phase === 'air' && !reducedMotion) director.shake(0.15);
    S.prevPhase = run.phase;
  }
  // Touchdown, once per run (keyed on the sim's touch tick, so a fast-forward that steps past the
  // 'landed' phase in one frame still lands).
  if (run.t.touchTick >= 0 && S.impacts === 0) touchdown(run);
  if (!S.autopilot && !S.after) cues(run, c);

  const speed = syncHud(run, c);
  ui.damage(run.damage, c);
  hero.setFan?.(c.fan);
  hero.setWing?.(Math.min(1, Math.max(0, (speed - 20) / 20)));
  plumes.update(dt, S.time, c.throttles, c.vel, 0);
  updateAudio({ speed, grounded: c.grounded > 0, throttles: c.throttles });

  // The end: a finished run (or a drill's moment) goes straight into its aftermath, and the results
  // come up once the car is at rest, and no sooner than the beat they always had (1.4 s, a drill 0.5 s).
  if (S.after) {
    S.doneT += dt;
    if (run.after.done && S.doneT > (S.drill ? 0.5 : 1.4)) finishRun();
  } else if (run.phase === 'done' || (S.drill?.done && S.drill.done(run))) {
    S.doneT += dt;
    if (run.phase === 'done' || S.doneT > 0.5) beginAftermath(run);
  } else S.doneT = 0;
}
// The touch layout for where the run is (every live frame, and once as a run starts: a retry's READY
// shows the run-up's GO and BRAKE, not the last run's LAND or its landed BRAKE, 0099). Returns the phase.
function syncTouchPhase(run) {
  const tp = run.phase === 'landed' || run.phase === 'done' ? 'landed'
    : flying(run) || (run.phase === 'ramp' && S.released) ? 'air' : run.phase === 'ramp' ? 'ramp' : 'ground';
  if (ui.touch.dataset.phase !== tp) {
    ui.touch.dataset.phase = tp;
    liftLabel.textContent = tp === 'ramp' ? 'Release' : 'Lift';
    stickHint.textContent = tp === 'air' ? 'Roll · Pitch' : 'Steer';
    goLabel.textContent = tp === 'air' ? 'Boost' : 'Go';
  }
  // Only what this moment uses: RELEASE once you're near the top of the curl, BOOST until the row
  // is behind you (the Show).
  const ledge = run.phase === 'ramp' && !S.released && run.t.progress >= 0.8;
  if (ui.touch.hasAttribute('data-ledge') !== ledge) ui.touch.toggleAttribute('data-ledge', ledge);
  const rowDone = run.course === 'show' && (run.t.crossedRow || run.t.contact);
  if (ui.touch.hasAttribute('data-row-done') !== rowDone) ui.touch.toggleAttribute('data-row-done', rowDone);
  return tp;
}
function beginAftermath(run) {
  if (!S.card) closeCard(run);   // (a run's end has it already; a drill's moment decides it here)
  S.after = true;
}

// Flying, as the HUD and the touch layout show it (0047): a hop off the ground (the sim goes back to
// 'drive' if the wheels touch within 0.15 s of lift-off) swaps nothing; off the Wall it's at once.
const AIR_HOLD = 60;   // ticks from lift-off: 0.25 s
const flying = (run) => run.phase === 'air' && (S.released || run.tick - run.t.airStartTick >= AIR_HOLD);

// The HUD from the run as it stands (every live frame, and once before a countdown so READY shows
// this run's start). Returns the speed.
function syncHud(run, c, clock = ((run.after?.startTick >= 0 ? run.after.startTick : run.tick) - S.startTick) / 240) {
  const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  bodyRates(c, rates);
  const alt = heightAboveSurface(c);
  S.hudAlt = alt;   // the live pointer's BRAKE window reads it (cues, next frame)
  const air = flying(run);
  const phaseKey = flightPhase(run);
  // A crashed end reads as the crash (0072); before the run is called, a car on the ground that the
  // damage panel already calls wrecked isn't a TOUCHDOWN either (0065).
  const crash = run.phase === 'done' ? crashStep(S.card)
    : phaseKey === 'touchdown' && Math.round(run.damage.total) >= WRECK_PCT ? 'Wrecked' : '';
  landing.update(c, alt, !S.autopilot && air ? 'air' : run.phase === 'air' ? '' : run.phase, run.tick / 240);
  ui.hud({
    speed, air: (c.air / CAR.airMass) * 100, gasKg: c.air, tankBar: tankBar(c.air), gasState: gasState(c.air), rollDeg: Math.abs(run.t.rollAccum) * 180 / Math.PI, bankDeg: Math.abs(landing.prediction.rollOut) * 180 / Math.PI,
    alt, airborne: air,
    sink: -c.vel.y, phaseKey, clock, crash,
    pitch: hudPitch(c.quat, run.phase === 'ramp'),
    throttles: c.throttles, fan: c.fanForce / G, g: gWindow.read(),
  });
  return speed;
}

// --- The flight, as the HUD and the controls see it ---------------------------------------------
// A new attempt (or drill): the one-thumb control, the HUD's glide and the timeline start over.
function newFlight(startTick = 0) {
  // A restart lets go of everything, like pause (0099): every key, finger and pad held as the last run
  // ended (or as Retry was hit) counts again only on a fresh press; the one-thumb starts unheld.
  freshRun();
  thumb.reset();
  ui.resetHud(); ui.damageReset(); gWindow.reset();
  ui.timelineFor(stage.course);
  S.phaseMax = -1; S.brakeTicks = 0; S.braked = false; S.startTick = startTick; S.contactBuzzed = false;
  cueHys.slow = false; cueHys.tilted = false;
  S.ptr.release = 0; S.ptr.land = 0; S.ptr.brake = 0;
  S.ptrCtx = pointerCtx(S.run?.course || stage.course, S.flyTier);
  S.releaseTick = S.released ? startTick - 240 : -1;
}
// Where in the flight you are, for the timeline: run-up → climb → hang → release → carry → brake →
// touchdown (the Lineup: run-up → lift-off → roll → brake → touchdown). It only moves forward.
// BRAKE means the car is braking (0065): a sustained deceleration, read every sim tick by braking(),
// not a nozzle sum (the roll-out's attitude pulses pushed the lift jets' sum past 1.2 in free fall)
// and not a height (a car falling with its valves shut passes the BRAKE line too).
const PHASE_ORDER = { show: ['runup', 'climb', 'hang', 'release', 'carry', 'brake', 'touchdown'], lineup: ['runup', 'liftoff', 'roll', 'brake', 'touchdown'] };
function flightPhase(run) {
  const order = run.course === 'lineup' ? PHASE_ORDER.lineup : PHASE_ORDER.show;
  let key;
  if (run.phase === 'landed' || run.phase === 'done') key = 'touchdown';
  else if (run.course === 'lineup') key = run.phase === 'drive' ? 'runup' : S.braked ? 'brake' : Math.abs(run.t.rollAccum) > 0.3 ? 'roll' : 'liftoff';
  else if (run.phase === 'drive') key = 'runup';
  else if (!S.released) key = run.t.progress >= 0.92 ? 'hang' : 'climb';
  else if (run.tick - S.releaseTick < 0.6 * 240) key = 'release';
  else key = S.braked ? 'brake' : 'carry';
  const i = order.indexOf(key);
  if (i > S.phaseMax) S.phaseMax = i;
  return order[S.phaseMax];
}
// Braking, as the timeline names it (0065): in the air with no bodywork on anything (an impact is not
// a brake), sinking (> 0.5 m/s), the lift jets open, and the HUD's 0.5 s G window (Δv, LESSONS 0018)
// at ≥ 1.2 g for 0.15 s on end. Once seen it holds for the rest of the flight (the timeline is
// monotonic, 0047). Called after every sim tick; no allocation.
const BRAKE_G = 1.2, BRAKE_HOLD = 36;   // 0.15 s
function braking(run) {
  if (S.braked) return;
  const c = run.car, th = c.throttles;
  const on = run.phase === 'air' && !c.hullContact && c.vel.y < -0.5 && th[0] + th[1] + th[2] + th[3] > 0.1 && gWindow.read() >= BRAKE_G;
  S.brakeTicks = on ? S.brakeTicks + 1 : 0;
  if (S.brakeTicks >= BRAKE_HOLD) S.braked = true;
}

// One-thumb Assist: touch, the Show or the Wall, Assist, the scheme chosen (src/touch-settings.js).
const thumbPad = document.querySelector('[data-onethumb]');
const thumbVerb = document.querySelector('[data-thumb-verb]'), thumbAct = document.querySelector('[data-thumb-act]'), thumbArc = document.querySelector('[data-thumb-arc]');
const thumbActive = () => !ui.touch.hidden && ui.touch.dataset.scheme === 'thumb' && !S.autopilot;
function syncScheme() {
  const can = !!S.run && S.run.course !== 'lineup' && runTier() === 'assist';
  ui.touch.dataset.scheme = touchSet.scheme === 'thumb' && can ? 'thumb' : 'classic';
  ui.touch.dataset.hand = touchSet.hand;
  ui.touch.dataset.tier = runTier();
  ui.touch.dataset.course = S.run?.course || stage.course;
  document.querySelectorAll('[data-controls-label]').forEach((el) => { el.textContent = touchSet.scheme === 'thumb' ? 'One-thumb' : 'Classic'; });
}
const THUMB_WORDS = {
  climb: ['Hold', 'Climb'], climbing: ['Holding', 'Climb'], ledge: ['Tap', 'Let go'], fly: ['Hold', 'Land'], flying: ['Holding', 'Land'], landed: ['', 'Stopping'],
};
const thumbLast = { word: '', warn: null, arc: -1 };
function syncThumb(run, c) {
  const stage_ = thumbStage(run, S.released);
  const held = thumb.held;
  const word = stage_ === 'climb' && held ? 'climbing' : stage_ === 'fly' && held ? 'flying' : stage_;
  if (word !== thumbLast.word) {
    const [v, a] = THUMB_WORDS[word] || ['', ''];
    thumbVerb.textContent = v; thumbAct.textContent = a;
    thumbPad.dataset.stage = stage_;
    thumbLast.word = word;
  }
  // Not holding while the descent leaves green: the pad asks for the thumb (amber, a pulse).
  const warn = stage_ === 'fly' && !held && landing.status() !== 'green';
  if (warn !== thumbLast.warn) { thumbPad.toggleAttribute('data-warn', warn); thumbLast.warn = warn; }
  // The ring: how far up the curl; in the air, how far down to the ground.
  const k = stage_ === 'climb' || stage_ === 'ledge' ? (run.phase === 'ramp' ? wallProgress(c.pos) : 0)
    : stage_ === 'fly' ? 1 - Math.min(1, Math.max(0, c.pos.y - SPEC.comHeight) / 27) : 1;
  const q = Math.round(k * 100);
  if (q !== thumbLast.arc) { thumbArc.style.strokeDasharray = `${q} 100`; thumbLast.arc = q; }
}

// --- Touch controls sheet ----------------------------------------------------------------------
const ctlScreen = ui.screens.controls;
function syncControlsSheet() {
  ctlScreen.querySelectorAll('[data-scheme-opt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.schemeOpt === touchSet.scheme)));
  ctlScreen.querySelectorAll('[data-hand]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hand === touchSet.hand)));
  ctlScreen.querySelector('[data-tilt]').setAttribute('aria-checked', String(!!touchSet.tilt));
  ctlScreen.querySelector('[data-tilt-calibrate]').hidden = !touchSet.tilt;
  ctlScreen.querySelector('[data-haptics]').setAttribute('aria-checked', String(!!touchSet.haptics));
  ctlScreen.querySelector('[data-haptics-row]').hidden = !hasHaptics();
  syncScheme();
}
const tiltNote = ctlScreen.querySelector('[data-tilt-note]');
ctlScreen.querySelectorAll('[data-scheme-opt]').forEach((b) => b.addEventListener('click', () => {
  setSetting('scheme', b.dataset.schemeOpt);
  if (touchSet.scheme === 'thumb' && S.tier !== 'assist') { setTier('assist'); ui.cue_('One-thumb flies Assist', 1600); }
}));
ctlScreen.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => setSetting('hand', b.dataset.hand)));
ctlScreen.querySelector('[data-haptics]').addEventListener('click', () => { setSetting('haptics', !touchSet.haptics); buzz('tap'); });
ctlScreen.querySelector('[data-tilt]').addEventListener('click', async () => {
  if (touchSet.tilt) { disableTilt(); tiltNote.textContent = 'Off. Steer with the stick (or hold the line in One-thumb).'; return; }
  const ok = await enableTilt();
  tiltNote.textContent = ok ? 'On. Hold the phone how you play and press Calibrate. Tilt steers on the ground.' : 'Motion access was not given, or this device has no tilt sensor.';
  if (ok) setTimeout(() => { if (touchSet.tilt && !tiltSeen()) tiltNote.textContent = 'On, but no tilt readings yet: this device may not have the sensor.'; }, 600);
});
ctlScreen.querySelector('[data-tilt-calibrate]').addEventListener('click', () => { calibrateTilt(); buzz('tap'); tiltNote.textContent = 'Calibrated: this is straight ahead.'; });
onSettings(syncControlsSheet);
syncControlsSheet();
document.querySelectorAll('[data-controls-open]').forEach((b) => b.addEventListener('click', () => { syncControlsSheet(); ui.show('controls', true); }));

// Driving (0066, src/driving.js): Easy / Standard / Advanced on the ground in every mode, on this device.
// Radiogroups take the arrow keys (and Tab lands on the checked one).
const driveNote = ctlScreen.querySelector('[data-drive-note]');
function syncDriving() {
  const d = drivingSettings, adv = d.level === 'advanced';
  for (const [sel, key, val] of [['[data-drive-level]', 'driveLevel', d.level], ['[data-drive-tc]', 'driveTc', d.tc]]) {
    ctlScreen.querySelectorAll(sel).forEach((b) => { const on = b.dataset[key] === val; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  }
  ctlScreen.querySelector('[data-drive-abs]').setAttribute('aria-checked', String(d.abs));
  ctlScreen.querySelectorAll('[data-drive-adv]').forEach((el) => { el.hidden = !adv; });
  driveNote.textContent = LEVEL_INFO[d.level].blurb;
  document.querySelectorAll('[data-driving-label]').forEach((el) => { el.textContent = LEVEL_INFO[d.level].name; });
}
function radioKeys(group, sel, pick) {
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault(); e.stopPropagation();
    const opts = [...group.querySelectorAll(sel)], i = opts.indexOf(document.activeElement);
    const next = opts[(Math.max(0, i) + step + opts.length) % opts.length];
    pick(next); next.focus();
  });
}
const pickLevel = (b) => setDriving({ level: b.dataset.driveLevel });
const pickTc = (b) => setDriving({ tc: b.dataset.driveTc });
ctlScreen.querySelectorAll('[data-drive-level]').forEach((b) => b.addEventListener('click', () => pickLevel(b)));
ctlScreen.querySelectorAll('[data-drive-tc]').forEach((b) => b.addEventListener('click', () => pickTc(b)));
radioKeys(ctlScreen.querySelector('[data-drive-levels]'), '[data-drive-level]', pickLevel);
radioKeys(ctlScreen.querySelector('[data-drive-tcs]'), '[data-drive-tc]', pickTc);
ctlScreen.querySelector('[data-drive-abs]').addEventListener('click', () => setDriving({ abs: !drivingSettings.abs }));
onDriving(syncDriving);
syncDriving();
document.querySelectorAll('[data-driving-open]').forEach((b) => b.addEventListener('click', () => {
  syncControlsSheet(); ui.show('controls', true);
  ctlScreen.querySelector('[data-drive-level][aria-checked="true"]')?.focus({ preventScroll: true });
}));
ctlScreen.querySelector('[data-controls-close]').addEventListener('click', () => ui.show('controls', false));
// No page zoom or scroll from a stray gesture (iOS ignores user-scalable=no for pinch).
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); }, { passive: false });

// The cue's glyph follows the device last used: the touch button, the key, or the pad's button.
const PAD_GLYPH = { '↑': 'RT', Space: 'A', Shift: 'B', F: 'RB', '← →': 'stick', 'A or D': 'LB or RB' };
const kbd = (touchLabel, keyLabel) => {
  const dev = lastDevice();
  const pad = dev === 'pad' ? (keyLabel === 'F' && S.flyTier === 'advanced' ? 'A' : PAD_GLYPH[keyLabel]) : null;
  return `<kbd>${dev === 'touch' ? touchLabel : pad || keyLabel}</kbd>`;
};
// The cues teach the sequence for the tier you fly. With Assist: release, then hold BOOST and LAND
// together (the computer caps the carry and rolls you out). Pro and Advanced fly by the HUD: roll
// out by the dial, brake at the BRAKE line.
const cueHys = { slow: false, tilted: false };   // which side of each cue threshold the flight is on
// Live pointers (0079): for a new player (or a struggling one, S.coachLive), the one timely pointer
// just before the mistake, from the predictor (read-only): "Let go now" on the ledge, "Land now" as the
// descent leaves the green with LAND not held (Assist), "Brake now" at the BRAKE line (Pro, Advanced).
// One per phase per run: a window opens once, shows while it holds, and never reopens (0 → 1 → 2).
S.ptr = { release: 0, land: 0, brake: 0 };
function livePtr(kind, want) {
  const st = S.ptr[kind];
  if (st === 0 && want) S.ptr[kind] = 1;
  else if (st === 1 && !want) S.ptr[kind] = 2;
  return S.ptr[kind] === 1;
}
const kbdWrap = (k) => `<kbd>${k}</kbd>`;
function cues(run, c) {
  const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  const tier = S.flyTier, adv = tier === 'advanced';
  if (thumbActive()) return thumbCues(run, c, v);
  if (run.phase === 'drive' && v < 2) return ui.cue_(`Hold ${kbd('GO', '↑')} to drive`, 600);
  if (run.course !== 'lineup') {
    const show = run.course === 'show';
    if (run.phase === 'drive' && c.pos.z > -40) return ui.cue_(`Fan spooling · crawl in, about 20 km/h`, 600);
    if (run.phase === 'ramp' && run.t.progress < 0.88) return ui.cue_(tier === 'assist' ? `Hold ${kbd('GO', '↑')}: Assist holds a crawl on suction` : `Feather ${kbd('GO', '↑')}: crawl up on suction`, 500);
    if (run.phase === 'ramp' && !S.released && run.t.progress < 0.92) return ui.cue_('Onto the ledge, then stop', 500);
    if (run.phase === 'ramp' && !S.released) {
      if (S.coachLive && livePtr('release', true)) return ui.cue_(livePointer('release', S.ptrCtx, kbdWrap), 500);
      return ui.cue_(`Upside down on the ledge · ${kbd('RELEASE', 'Space')} to let go`, 500);
    }
    // The Show: the row is under you. The rear jets carry you out over it (≈10 m/s is enough).
    // Thresholds have an enter and an exit (hysteresis), so a speed or an attitude hovering on the
    // line can't flip the cue between two messages.
    const vh = Math.hypot(c.vel.x, c.vel.z);
    cueHys.slow = cueHys.slow ? vh < 10.5 : vh < 9.5;
    const boostCue = show && run.phase === 'air' && !run.t.crossedRow && cueHys.slow && c.pos.z > COURSES.show.rowNear;
    if (tier === 'assist') {
      if (boostCue) return ui.cue_(`Hold ${kbd('BOOST', 'F')} + ${kbd('LAND', 'Shift')} · over the row`, 400);
      // Assist's auto-land (src/sim/vehicle.js): LAND came too late to stop, so the computer started it.
      if (run.phase === 'air' && c.autoLand) return ui.cue_(`Auto-LAND · braking for you · ${kbd('LAND', 'Shift')} next time`, 500);
      if (S.coachLive && livePtr('land', run.phase === 'air' && !liveInput.level && landing.status() !== 'green')) return ui.cue_(livePointer('land', S.ptrCtx, kbdWrap), 500);
      if (run.phase === 'air') return ui.cue_(`Hold ${kbd('LAND', 'Shift')}: it rolls you out and brakes`, 500);
      return;
    }
    if (boostCue) return ui.cue_(adv ? `${kbd('BOOST', 'F')} the rear row · carry over the roofs` : `${kbd('BOOST', 'F')} · carry about 10 m/s over the row`, 400);
    const upY = landing.prediction.upY;
    cueHys.tilted = cueHys.tilted ? upY < 0.9 : upY < 0.85;
    if (run.phase === 'air' && cueHys.tilted) return ui.cue_(adv ? `Roll out: ${kbd('Q+Z or E+C', 'A or D')} · watch the dial` : `Roll out: ${kbd('stick', '← →')} · let go early`, 400);
    if (S.coachLive) {
      const lift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
      if (livePtr('brake', run.phase === 'air' && c.vel.y < -1 && lift < 1 && S.hudAlt <= landing.prediction.brakeBy + 1.5)) return ui.cue_(livePointer('brake', S.ptrCtx, kbdWrap), 400);
    }
    if (run.phase === 'air') return ui.cue_(`Brake: ${kbd('LIFT', 'Space')} at the BRAKE line`, 400);
    return;
  }
  const lz = c.pos.z;
  if (run.phase === 'drive' && lz > -14 && lz < COURSES.lineup.lineupZ0) return ui.cue_(`Hold ${kbd('LIFT', 'Space')} at the line`, 600);
  if (run.phase === 'air' && Math.abs(run.t.rollAccum) < 0.3 && c.vel.y < 4) return ui.cue_(`${kbd('stick sideways', '← →')} to roll`, 500);
  if (run.phase === 'air' && Math.abs(run.t.rollAccum) > 5.6 && c.vel.y < 0) return ui.cue_(`Hold ${kbd('LAND', 'Shift')}`, 500);
}

// One-thumb: the pad itself says hold / tap; the cue line names the moment.
function thumbCues(run, c, v) {
  const held = thumb.held;
  if (run.phase === 'drive') return ui.cue_(held || v > 2 ? 'Climbing · let go to stop' : 'Hold the pad to climb', 600);
  if (run.phase === 'ramp' && !S.released) return ui.cue_(run.t.progress >= 0.92 ? 'On the ledge · tap to let go' : 'Up the curl on suction', 600);
  if (run.phase === 'air' || S.released) {
    if (run.course === 'show' && !run.t.crossedRow && c.pos.z > COURSES.show.rowNear) return ui.cue_('Carrying you over the row', 500);
    if (!held && c.autoLand) return ui.cue_('Auto-land · braking for you', 500);
    if (!held) return ui.cue_('Hold to land: it rolls you out and brakes', 500);
  }
}

// --- Replay (behind the results sheet, and on demand) ----------------------------------------
// The clock advances first, then the pose is sampled between frames (src/render/replay.js).
const fcomp = [0, 0, 0, 0], fspin = [0, 0, 0, 0];
const fvel = new THREE.Vector3();
const replayBodies = [];
const rpose = newReplayPose();
// Start the replay at frame t, already at that moment's speed (no ease from wherever it was).
function replayFrom(t) {
  S.replayT = t;
  const fr = S.run?.frames;
  S.replaySlow = fr?.length ? slowTarget(fr[Math.min(fr.length - 1, Math.floor(t))], S.run.course) : 1;
  frameReplay();
}
// Replay on a phone (0068). Where the results sheet covers the screen (a phone upright), Replay folds it
// down to a peek (verdict, total, Retry · Home · Scores) and the replay plays full-frame above it; a tap on
// the peek, Scores, Esc or the replay's end brings the sheet back. The sheet is only moved and hidden, never
// re-rendered, so its scroll and the judges' typing carry on underneath. Wherever the sheet sits beside the
// replay, Replay leaves it there. Either way the director frames the replay in what the results leave.
const resultsEl = document.querySelector('[data-screen="results"]');
const sheetEl = resultsEl.querySelector('.sheet'), peekEl = resultsEl.querySelector('[data-peek]');
S.peek = false;
function peek(on) {
  if (on === !!S.peek) return;   // (setMode calls this from boot, before S.peek is set)
  // Only where the sheet leaves under a quarter of the width to the replay.
  if (on && innerWidth - sheetEl.offsetWidth >= innerWidth * 0.25) return;
  const hadFocus = resultsEl.contains(document.activeElement);
  S.peek = on;
  if (on) {
    peekEl.querySelector('[data-p-verdict]').textContent = resultsEl.querySelector('[data-r-verdict]').textContent;
    peekEl.querySelector('[data-p-total]').textContent = resultsEl.querySelector('[data-r-total]').textContent;
    resultsEl.dataset.peek = '';
  } else delete resultsEl.dataset.peek;
  peekEl.hidden = !on;
  document.body.toggleAttribute('data-peek', on);
  sheetEl.inert = on;
  if (hadFocus) (on ? peekEl.querySelector('[data-peek-back]') : sheetEl.querySelector('[data-replay]'))?.focus({ preventScroll: true });
  frameReplay();
}
// The region the replay is framed in: above the peek, left of a sheet beside it, or the whole screen.
function frameReplay() {
  const w = innerWidth, h = innerHeight;
  if (S.peek) director.setRegion(0, 0, w, h - peekEl.offsetHeight);
  else if (!resultsEl.hidden && sheetEl.offsetLeft >= w * 0.25) director.setRegion(0, 0, sheetEl.offsetLeft, h);
  else director.setRegion();
}
peekEl.addEventListener('click', (e) => { if (!e.target.closest('button') || e.target.closest('[data-peek-back]')) peek(false); });
function replayStep(dt) {
  const frames = S.run?.frames;
  if (!frames?.length) return;
  const nb = (frames[0].length - BODY_FRAME) / BODY_STRIDE;
  while (replayBodies.length < nb) replayBodies.push({ cx: 0, cy: 0, cz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
  replayBodies.length = nb;
  if (stepReplayClock(S, frames, dt, S.run.course)) { director.restart(); hero.placed(); peek(false); }   // hold a beat, loop (the sheet comes back)
  const slow = S.replaySlow;
  const p = sampleReplay(frames, S.replayT, rpose);
  const f = frames[p.i0], g = frames[p.i1], k = p.k;
  fvel.set(g[0] - f[0], g[1] - f[1], g[2] - f[2]).multiplyScalar(60);
  syncCar(p.pos, p.quat, p.comp, p.spin, p.steer);
  // The bodies between this frame and the next, as the car is (positions lerped, attitude nlerped).
  for (let b = 0; b < replayBodies.length; b++) {
    const o = BODY_FRAME + BODY_STRIDE * b, r = replayBodies[b], j = 1 - k;
    r.cx = f[o] * j + g[o] * k; r.cy = f[o + 1] * j + g[o + 1] * k; r.cz = f[o + 2] * j + g[o + 2] * k;
    const sg = f[o + 3] * g[o + 3] + f[o + 4] * g[o + 4] + f[o + 5] * g[o + 5] + f[o + 6] * g[o + 6] < 0 ? -1 : 1;
    const qx = f[o + 3] * j * sg + g[o + 3] * k, qy = f[o + 4] * j * sg + g[o + 4] * k, qz = f[o + 5] * j * sg + g[o + 5] * k, qw = f[o + 6] * j * sg + g[o + 6] * k;
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    r.qx = qx / l; r.qy = qy / l; r.qz = qz / l; r.qw = qw / l;
  }
  stage.setBodies(replayBodies);
  stage.rocket?.simClock((S.replayT * FRAME_EVERY) / 240);
  // The crash, re-shown from the run's impact events at the tick on screen.
  crash.feed(S.run.impacts, Math.floor((S.replayT + 1) * FRAME_EVERY), fvel);
  hero.setFan?.(p.fan);
  plumes.update(dt * slow, S.time, p.thr, fvel, 0);
  updateAudio({ speed: fvel.length() * slow, grounded: p.pos.y < 0.7, throttles: p.thr });
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
// The title draws at ~30 fps (src/pace.js, 0049): a skipped frame does nothing but keep the cue line's
// clock, and heal hears of it, so obs times the frame the title does draw against the display's interval.
const titlePace = createPacer();
// [obs] The loop is scheduled first, so nothing below can stop it; heal.frame times the frame and
// catches, records and recovers from anything it throws (src/obs/heal.js).
function frame(now) {
  requestAnimationFrame(frame);
  if (S.mode !== 'title') titlePace.reset();
  else if (!titlePace.due(now)) { heal.skip(now); syncLife(); ui.tickCue(); return; }
  heal.frame(now, frameBody);
  syncLife();
  // The cue line's deadlines (src/ui.js), after the frame has asked for its cues: a message asked
  // for every frame stays up however long a frame takes; paused, or if the frame threw, they still run.
  ui.tickCue();
}
function frameBody(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (pollPads()) lastGesture = now;   // a pad in use becomes the device; Start pauses (and resumes)
  if (!S.paused) {
    // A crash's slow-motion beat scales the game clock (live and replay); the effects run on it too.
    const slow = S.mode === 'live' || S.mode === 'results' || S.mode === 'replay' ? crash.timeScale() : 1;
    crash.update(dt);
    S.time += dt;
    if (S.mode === 'title') titleStep(dt);
    else if (S.mode === 'countdown') {
      const L = S.countLen;
      if (L < 3) {
        // A retry: one beat of READY, then go. The car is already on its mark.
        if (S.countT === 0) ui.countdown('Ready');
        S.countT += dt;
      } else {
        const before = Math.ceil(L - S.countT);
        S.countT += dt;
        const after = Math.ceil(L - S.countT);
        if (S.countT < 0.02 || after !== before) ui.countdown(after > 0 ? after : 0);
      }
      // "Go" holds for its moment (0.7 s) before the first live cue may replace it.
      if (S.countT >= L) { setMode('live'); ui.countdown(0); ui.cue_(S.autopilot ? 'The reference jump' : 'Go', 900, { hold: 700 }); }
      plumes.update(dt, S.time, S.idleThrottles.fill(0), zeroVel, 0);
      ui.setClock(S.countT - L);
    } else if (S.mode === 'live') liveStep(dt * slow);
    else if (S.mode === 'results' || S.mode === 'replay') replayStep(dt * slow);
    else if (S.mode === 'drive') fd().frame(dt * crash.timeScale(), S.time);   // Free Drive / the Sandbox run their own cameras

    if (S.mode !== 'drive') syncGhost();
    const live = S.mode === 'live' || S.mode === 'countdown';
    if (S.mode !== 'drive') director.update(dt, S.time, {
      carPos: carRoot.position, carVel: live && S.run ? S.run.car.vel : zeroVel,
      phase: S.run?.phase || 'drive',
      mode: S.mode === 'title' ? 'title' : S.mode === 'results' || S.mode === 'replay' ? 'replay' : 'live',
      course: stage.course,   // [stage]
    });
    stage.render(S.time, S.mode);
  }
}

// --- Pause, background and return (0060) --------------------------------------------------------
// Quiet: paused (a run or Free Drive), a hidden tab, or the title left alone for a minute; the context
// stops rather than holding the last gains. Awake: a run, the judging and the replay keep the screen on.
const TITLE_IDLE_MS = 60_000;
let quiet = false, awake = false;
function syncLife(force = false) {
  const hidden = document.hidden;
  const q = hidden || S.paused || (S.mode === 'drive' && !!fd()?.paused) || (S.mode === 'title' && performance.now() - lastGesture > TITLE_IDLE_MS);
  if (q !== quiet || force) { quiet = q; if (q) suspendAudio(); else resumeAudio(); }
  const a = !hidden && !S.paused && (S.mode === 'countdown' || S.mode === 'live' || S.mode === 'results' || S.mode === 'replay');
  if (a !== awake || force) { awake = a; syncWake(a); }
}
// Paused, the loop draws nothing: a rotation or a resize would leave the canvas blank (a resized
// buffer is cleared). Draw the frozen frame again, now in the new shape and once the buffer settles.
function redrawPaused() { if (S.paused && stage) stage.render(S.time, S.mode); }

// The pause sheet's controls (0092): a keyboard keeps its key lists; a touch screen or a pad gets its
// own controls for the scheme in use (src/pointer.js pauseRows), never a keyboard map.
function drawPauseKeys() {
  const el = ui.screens.pause, ctx = pointerCtx(S.run?.course || stage.course, S.flyTier), own = ctx.device !== 'key';
  el.dataset.device = ctx.device;
  el.querySelector('[data-pause-keys="key"]').hidden = own;
  const box = el.querySelector('[data-pause-keys="device"]');
  box.hidden = !own;
  if (own) box.replaceChildren(...pauseRows(ctx).map((r) => { const p = document.createElement('p'), b = document.createElement('b'); b.textContent = r.label; p.append(b, r.text); return p; }));
}

// --- Wiring ---------------------------------------------------------------------------------
function pause(on) {
  if (S.mode === 'drive') { on ??= !fd().paused; if (on) resetInput(); fd().pause(on); return; }
  on ??= !S.paused;
  if (S.mode !== 'live' && S.mode !== 'countdown') return;
  if (on) resetInput();   // nothing held comes back held from the pause sheet
  else ui.show('controls', false);   // P or a pad's Start resumes from under Controls too: it goes with the pause
  S.paused = on;
  if (on) { drawPauseKeys(); ui.screens.pause.querySelector('.sheet').scrollTop = 0; }   // Resume first, at the top
  ui.show('pause', on);
  lastT = performance.now();
}

bindInput(document.body, { onPause: () => pause(), running: () => S.mode === 'live' || S.mode === 'countdown' });
// The device changed mid-run (a key or a pad on an iPad, a finger on a touchscreen laptop): the touch
// controls follow it, and one-thumb with them (thumbActive reads the overlay).
onDevice(() => {
  if (S.mode !== 'live' && S.mode !== 'countdown') return;
  ui.touch.hidden = !usingTouch() || !!S.autopilot;
  syncScheme();
  S.ptrCtx = pointerCtx(S.run?.course || stage.course, S.flyTier);
  if (S.paused) drawPauseKeys();
});
const on = (sel, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
// The first Jump on this device shows how to fly first (skippable, remembered); a deep link never waits.
on('[data-start]', (e) => (howtoSeen() ? startRun('jump') : openHowto({ then: () => startRun('jump'), from: e.currentTarget })));
on('[data-reveal]', () => startRun('reveal'));
// Retry: straight back onto the mark with a one-beat READY (a drill restarts itself; the reference
// jump hands over to you). Home: the title. Both from anywhere in a run: the HUD's quick buttons,
// the results, the pause sheet, R / Enter and H.
function retry() {
  S.paused = false; ui.show('pause', false);
  if (S.drill) return retryDrill();
  startRun('jump', true);
}
function goHome() { S.paused = false; ui.show('pause', false); toTitle(); }
// Delegated: the judges' theatre builds its own Retry / Home / Rookie mode buttons after load.
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-again], [data-home], [data-rookie-go]');
  if (!b) return;
  if (b.hasAttribute('data-rookie-go')) goRookie(); else if (b.hasAttribute('data-again')) retry(); else goHome();
});
on('[data-replay]', () => { peek(true); replayFrom(0); director.restart(); hero.placed(); });
on('[data-resume]', () => pause(false));
on('[data-restart]', () => { if (S.autopilot) { S.paused = false; ui.show('pause', false); startRun('reveal', true); } else retry(); });
// Share (0081): the run as a card image (src/share-card.js) on the phone's share sheet; text + link
// where files can't go; else the link is copied. The card starts drawing on pointerdown, so it's
// ready by the click (the sheet must open inside the tap's activation), and it's drawn only then.
let shareCard = null;
const startCard = () => {
  if (!S.card) return null;
  if (shareCard?.card !== S.card) {
    shareCard = { card: S.card, promise: drawShareCard({ frame: canvas, render: () => stage.render(S.time, S.mode), card: S.card, url: shareUrl(), mark: `${import.meta.env.BASE_URL}favicon.svg` }) };
    shareCard.promise.catch(() => {});
  }
  return shareCard.promise;
};
const shareUrl = () => `${location.origin}${import.meta.env.BASE_URL}`;
document.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('pointerdown', startCard));
on('[data-share]', () => { if (S.card) shareRun({ card: S.card, url: shareUrl(), cardPromise: startCard() }); });

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

// The flight tier: Assist → Pro → Advanced, for the next run (a run keeps the tier it started with:
// latchTier). The top bar's chip says what the panel pays for it; the AI assist control on the title and
// the results says in words what the computer does (0079), and both open the tier picker, where every
// tier is explained and Adapt to me is a switch. Nothing about a tier lives only in a hover title.
const tierBtn = document.querySelector('[data-tier]');
const assistCtls = document.querySelectorAll('[data-assist-open]');
// `auto`: Adapt to me stepped it (the model's counts, not Rookie's streak: the player didn't choose).
function setTier(tier, { auto = false } = {}) {
  const was = S.tier;
  S.tier = TIERS[tier] ? tier : 'assist';
  if (S.tier !== was) {
    S.perf = afterChange(S.perf);
    if (!auto && S.crashStreak) setStreak(0); else savePerf(S.perf);
    syncRookie();
  }
  S.assist = S.tier === 'assist';
  const t = TIERS[S.tier];
  tierBtn.dataset.tier = S.tier;
  if (!inRun()) ui.screens.hud.dataset.tier = S.tier;
  const short = { assist: 'Assist', pro: 'Pro', advanced: 'Adv' }[S.tier];
  tierBtn.innerHTML = `<span class="tl">${t.label}</span><span class="ts">${short}</span>${t.factor > 1 ? ` <i>×${t.factor.toFixed(2)}</i>` : ''}`;
  tierBtn.setAttribute('aria-label', `AI assist: ${S.assist ? 'on' : `off, ${t.label} ×${t.factor.toFixed(2)}`}. Choose the flight tier`);
  try { localStorage.setItem('coldgas_tier', S.tier); localStorage.setItem('coldgas_assist', S.assist ? '1' : '0'); } catch { /* storage blocked */ }
  syncAssist();
  syncScheme();
}
// The labelled control: "AI ASSIST · ON — rolls you out, levels and brakes" (or OFF · PRO ×1.08 …).
function syncAssist() {
  const w = TIER_WORDS[S.tier], f = TIERS[S.tier].factor;
  const state = S.assist ? 'On' : `Off · ${w.name}`, sub = f > 1 ? `${w.sub} · ${factorText(S.tier)}` : w.sub;
  assistCtls.forEach((b) => {
    b.dataset.assistTier = S.tier;
    b.querySelector('[data-assist-state]').textContent = state;
    b.querySelector('[data-assist-sub]').textContent = sub;
  });
  assistScreen.querySelectorAll('[data-tier-opt]').forEach((b) => { const on = b.dataset.tierOpt === S.tier; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
const assistScreen = ui.screens.assist;
assistScreen.querySelectorAll('[data-tier-long]').forEach((el) => { el.textContent = TIER_WORDS[el.dataset.tierLong].long; });
let assistOpener = null;
function openAssist(from) {
  assistOpener = from || document.activeElement;
  syncAssist(); syncAdapt();
  ui.show('assist', true);
  assistScreen.querySelector('[data-tier-opt][aria-checked="true"]')?.focus({ preventScroll: true });
}
function closeAssist() {
  if (assistScreen.hidden) return;
  ui.show('assist', false);
  if (assistOpener?.isConnected && !assistOpener.closest('[hidden]')) assistOpener.focus({ preventScroll: true });
  assistOpener = null;
}
const pickTier = (b) => {
  if (b.dataset.tierOpt === S.tier) return;
  setTier(b.dataset.tierOpt);
  ui.cue_(`${TIER_WORDS[S.tier].name}${TIERS[S.tier].factor > 1 ? ` · ${factorText(S.tier)}` : ' · on'}${inRun() ? ' · from the next run' : ''}`, 2200);
};
assistScreen.querySelectorAll('[data-tier-opt]').forEach((b) => b.addEventListener('click', () => pickTier(b)));
radioKeys(assistScreen.querySelector('[data-tier-opts]'), '[data-tier-opt]', pickTier);
assistScreen.querySelector('[data-assist-close]').addEventListener('click', closeAssist);
assistScreen.addEventListener('click', (e) => { if (e.target === assistScreen) closeAssist(); });
tierBtn.addEventListener('click', () => openAssist(tierBtn));
assistCtls.forEach((b) => b.addEventListener('click', () => openAssist(b)));
// Adapt to me: one setting, two switches (the tier picker and the Controls sheet).
function syncAdapt() {
  document.querySelectorAll('[data-adapt]').forEach((b) => b.setAttribute('aria-checked', String(S.adapt)));
  document.querySelectorAll('[data-adapt-note]').forEach((el) => {
    el.textContent = S.adapt ? 'On: three crashes in a row on Pro or Advanced turn more AI assist on for the next run (Undo on the results); clean landings offer a harder step. Never mid-run.'
      : 'Off: the tier stays where you put it. Clean landings still offer a harder step.';
  });
}
document.querySelectorAll('[data-adapt]').forEach((b) => b.addEventListener('click', () => { S.adapt = !S.adapt; saveAdapt(S.adapt); syncAdapt(); }));
syncAdapt();
setTier(S.tier);

// --- How to fly (0079, src/pointer.js howtoRows): this device's controls, per phase --------------------
// Shown on the first Jump (before the run, skippable, remembered in localStorage) and any time from the
// title's "How to fly" or the pause sheet. The device is the one in use (src/input.js lastDevice): touch
// (the one-thumb or the two-thumb scheme actually active), a keyboard, or a gamepad.
// A browser under automation (navigator.webdriver) counts as a returning player, so the audits and the
// specs fly straight in; a spec that wants the first visit sets coldgas_howto = 'new'.
const howtoScreen = ui.screens.howto, HOWTO_KEY = 'coldgas_howto';
function howtoSeen() {
  try { const v = localStorage.getItem(HOWTO_KEY); if (v === 'seen') return true; if (v === 'new') return false; } catch { return true; }
  return !!navigator.webdriver;
}
let howtoThen = null, howtoOpener = null;
function openHowto({ then = null, from = null } = {}) {
  howtoThen = then; howtoOpener = from || document.activeElement;
  const ctx = pointerCtx(stage.course, S.tier);
  howtoScreen.querySelector('[data-howto-device]').textContent = deviceTitle(ctx);
  const ol = howtoScreen.querySelector('[data-howto-rows]');
  ol.innerHTML = '';
  for (const r of howtoRows(ctx)) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="hw-phase"></span><span class="hw-ctl"><i></i><kbd></kbd></span><span class="hw-what"></span>';
    li.querySelector('.hw-phase').textContent = r.phase;
    li.querySelector('.hw-ctl i').textContent = r.verb;
    li.querySelector('.hw-ctl kbd').textContent = r.ctl;
    unitText(li.querySelector('.hw-what'), r.what);
    ol.appendChild(li);
  }
  howtoScreen.querySelector('[data-howto-assist]').textContent = S.assist
    ? `AI assist is on: it ${TIER_WORDS.assist.sub}. Change it any time with the AI assist button.`
    : `AI assist is off (${TIER_WORDS[S.tier].name}). Turn it on with the AI assist button.`;
  howtoScreen.querySelector('[data-howto-go]').textContent = then ? 'Got it · Jump' : 'Got it';
  howtoScreen.querySelector('[data-howto-skip]').hidden = !then;
  ui.show('howto', true);
  howtoScreen.querySelector('[data-howto-go]').focus({ preventScroll: true });
}
function closeHowto() {
  if (howtoScreen.hidden) return;
  try { localStorage.setItem(HOWTO_KEY, 'seen'); } catch { /* storage blocked: it may show again */ }
  ui.show('howto', false);
  const then = howtoThen;
  howtoThen = null;
  if (then) return then();
  if (howtoOpener?.isConnected && !howtoOpener.closest('[hidden]')) howtoOpener.focus({ preventScroll: true });
}
on('[data-howto-open]', (e) => openHowto({ from: e.currentTarget }));
on('[data-howto-go]', closeHowto);
on('[data-howto-skip]', closeHowto);
howtoScreen.addEventListener('click', (e) => { if (e.target === howtoScreen) closeHowto(); });
// Escape closes the card, the tier picker, the controls or the board before the game reads it (Escape on
// the results goes Home, on a run the pause sheet toggles): the sheet on top goes, not what's under it.
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (!howtoScreen.hidden) closeHowto(); else if (!assistScreen.hidden) closeAssist();
  else if (!ctlScreen.hidden) ui.show('controls', false); else if (!ui.screens.board.hidden) ui.show('board', false); else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);

// --- Practice (src/practice.js) -----------------------------------------------------------------
const drillBar = document.querySelector('[data-drill-bar]');
const slowBtn = document.querySelector('[data-drill-slow]');
const viewBtns = document.querySelectorAll('[data-view]');
try { S.pilotView = localStorage.getItem('coldgas_view') === 'pilot'; S.viewChosen = !!localStorage.getItem('coldgas_view'); } catch { S.pilotView = false; }
const syncView = () => viewBtns.forEach((b) => { b.innerHTML = S.pilotView ? '<span class="tl">Pilot view</span><span class="ts">Pilot</span>' : '<span class="tl">Broadcast</span><span class="ts">TV</span>'; b.setAttribute('aria-pressed', String(S.pilotView)); });
function toggleView() {
  S.pilotView = !S.pilotView; S.viewChosen = true; syncView();
  director.setView(S.pilotView ? 'pilot' : 'broadcast');
  try { localStorage.setItem('coldgas_view', S.pilotView ? 'pilot' : 'broadcast'); } catch { /* storage blocked */ }
  if (S.mode === 'live') ui.cue_(S.pilotView ? 'Pilot view: behind the car' : 'Broadcast view', 1200);
}
syncView();
viewBtns.forEach((b) => b.addEventListener('click', toggleView));

const SLOWS = [1, 0.5, 0.25];
const slowLabel = (k) => (k === 1 ? '1×' : k === 0.5 ? '½×' : '¼×');
function setSlow(k) {
  S.slowmo = k;
  slowBtn.textContent = slowLabel(k);
  document.querySelectorAll('[data-slow]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.slow) === k)));
}
document.querySelectorAll('[data-slow]').forEach((b) => b.addEventListener('click', () => setSlow(Number(b.dataset.slow))));
slowBtn.addEventListener('click', () => setSlow(SLOWS[(SLOWS.indexOf(S.slowmo) + 1) % SLOWS.length]));

function openPractice() {
  const list = document.querySelector('[data-drills]');
  list.innerHTML = '';
  const drills = drillsFor(stage.course);
  if (!drills.length) list.innerHTML = '<li class="empty">The Lineup has no drills yet: pick the Show or the Wall.</li>';
  for (const d of drills) {
    const li = document.createElement('li');
    li.innerHTML = '<button type="button" class="drill-btn"><span class="n"></span><b></b><span class="d"></span></button>';
    li.querySelector('.n').textContent = d.n;
    li.querySelector('b').textContent = d.label;
    unitText(li.querySelector('.d'), d.blurb);
    const btn = li.querySelector('button');
    btn.dataset.drill = d.id;
    btn.addEventListener('click', () => startDrill(d.id));
    list.appendChild(li);
  }
  ui.show('practice', true);
}

const startDrill = whenPhysics(startDrillNow);
function startDrillNow(id) {
  const drill = drillById(id);
  if (!drill || !drill.courses.includes(stage.course)) return;
  closeOverlays();
  initAudio();
  disposeRun();
  const { run, released } = buildDrill(drill, stage.course);
  S.run = armAftermath(run); S.after = false; S.drillSnap = null;
  S.autopilot = null; S.released = released; S.drill = drill; S.coach = null; S.runKind = 'drill';
  latchTier();
  S.adaptNow = null; S.coachLive = false;
  setMode('live'); S.paused = false; S.freezeT = 0.8; S.acc = 0; S.card = null; S.words = null; S.prevPhase = run.phase; S.doneT = 0;
  S.impacts = 0; S.impact = null;
  newFlight(run.tick);
  ui.only('hud');
  ui.countdown(0);
  drillBar.hidden = false;
  document.querySelector('[data-drill-name]').textContent = `${drill.n} ${drill.label}`;
  document.querySelector('[data-drill-n]').textContent = drill.n;
  unitText(document.querySelector('[data-drill-goal]'), drill.goal);
  ui.touch.hidden = !usingTouch();
  syncScheme();
  plumes.clear();
  crash.reset();
  const c = run.car;
  for (let i = 0; i < 4; i++) { fcomp[i] = c.wheels[i].compression; fspin[i] = c.wheels[i].spin; }
  syncCar(c.pos, c.quat, fcomp, fspin, c.steer);
  // Practice defaults to the pilot view until you pick one (L).
  if (!S.viewChosen) { S.pilotView = true; syncView(); }
  director.setView(S.pilotView ? 'pilot' : 'broadcast');
  director.restart(); hero.placed();
  refGhost(stage.course);
  ui.cue_(`${drill.label} · ${drill.goal}`, 1500);
}
const retryDrill = () => { if (S.drill) startDrill(S.drill.id); };
on('[data-practice-open]', openPractice);
on('[data-practice-close]', () => ui.show('practice', false));
on('[data-drill-retry]', retryDrill);
on('[data-drill-again]', retryDrill);
on('[data-drill-exit]', () => { S.paused = false; toTitle(); openPractice(); });
on('[data-drill-menu]', () => { toTitle(); openPractice(); });
on('[data-drill-next]', () => {
  const list = drillsFor(stage.course), i = list.findIndex((d) => d.id === S.drill?.id);
  startDrill(list[(i + 1) % list.length].id);
});
addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, select, textarea, [data-ai-modal]')) return;
  if (e.code === 'KeyL' && (S.mode === 'live' || S.mode === 'countdown' || S.mode === 'title')) toggleView();
  const inRun = S.mode === 'live' || S.mode === 'countdown' || S.mode === 'results' || S.mode === 'replay';
  // Enter on a focused button is that button's click (Retry included): don't start a second run.
  const enterOnButton = e.code === 'Enter' && !!e.target?.closest?.('button, a, [role="button"]');
  if (inRun && !S.drill && (e.code === 'KeyR' || (e.code === 'Enter' && S.mode === 'results' && !enterOnButton))) { e.preventDefault(); retry(); return; }
  if (e.code === 'Escape' && S.peek) { e.preventDefault(); peek(false); return; }   // Esc on the peek: back to the scores (0068)
  if (inRun && (e.code === 'KeyH' || (e.code === 'Escape' && S.mode === 'results'))) { e.preventDefault(); goHome(); return; }
  if (!S.drill) return;
  if (e.code === 'KeyR' && (S.mode === 'live' || S.mode === 'results')) retryDrill();
  if (e.code === 'KeyT' && S.mode === 'live') slowBtn.click();
});

// --- For nerds: the live engineering readout (src/nerds.js, loaded on first open) -------------------
const nerdsBtn = document.querySelector('[data-nerds]'), nerdsRoot = document.querySelector('[data-nerds-root]');
let nerdsMod = null;
const nerdCtx = () => {
  const drv = S.mode === 'drive' ? fd() : null;
  return {
    mode: S.mode, car: drv ? drv.car : S.run?.car || null, run: drv ? null : S.run, renderer: stage.renderer,
    simMs: drv ? null : S.mode === 'live' ? S.simMs : 0, simTicks: drv ? null : S.mode === 'live' ? S.simTicks : 0,
    meta: S.callMeta || null, driveStats: drv?.stats ? () => drv.stats() : null, health: () => obs.snapshot(),
  };
};
async function toggleNerds(on) {
  nerdsMod ??= await import('./nerds.js');
  on ??= !nerdsMod.nerdsOpen();
  if (on) nerdsMod.openNerds(nerdsRoot, nerdCtx); else nerdsMod.closeNerds();
  nerdsBtn.setAttribute('aria-pressed', String(on));
}
nerdsBtn.addEventListener('click', () => toggleNerds());
nerdsRoot.addEventListener('click', (e) => { if (e.target.closest('[data-nerds-close]')) nerdsBtn.setAttribute('aria-pressed', 'false'); });
addEventListener('keydown', (e) => {
  if (e.code !== 'Backquote' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, select, textarea')) return;
  e.preventDefault(); toggleNerds();
});
if (params.get('nerds') === '1') toggleNerds(true);

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
// Pressed = sound on, so the Menu row's name ("Sound") and its On / Off word agree.
const muteBtn = document.querySelector('[data-mute]');
const syncMuteBtn = () => muteBtn.setAttribute('aria-pressed', String(!isMuted()));
syncMuteBtn();
muteBtn.addEventListener('click', () => { initAudio(); setMuted(!isMuted()); syncMuteBtn(); });

// --- Menu (0073): on a touch screen Ghost, Sound and For nerds sit behind one labelled disclosure.
// Escape or a tap outside closes it and gives focus back to the toggle; on a fine pointer the toggle
// is display: none and none of this ever fires.
const more = document.querySelector('[data-more]'), moreBtn = more.querySelector('[data-more-toggle]');
const moreOpen = () => more.hasAttribute('data-open');
function setMore(open, { refocus = false } = {}) {
  more.toggleAttribute('data-open', open);
  moreBtn.setAttribute('aria-expanded', String(open));
  if (!open && refocus) moreBtn.focus();
}
moreBtn.addEventListener('click', () => setMore(!moreOpen()));
nerdsBtn.addEventListener('click', () => { if (moreOpen()) setMore(false, { refocus: true }); });   // the panel takes the screen
// Capture, so Escape closes the menu before the game reads it (Escape on results goes Home).
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !moreOpen()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  setMore(false, { refocus: true });
}, true);
document.addEventListener('pointerdown', (e) => { if (moreOpen() && !more.contains(e.target)) setMore(false); }, true);
more.addEventListener('focusout', (e) => { if (moreOpen() && e.relatedTarget && !more.contains(e.relatedTarget)) setMore(false); });

document.querySelector('[data-r-submit]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.initials;
  const initials = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  const msg = document.querySelector('[data-r-submit-msg]');
  if (initials.length !== 3) { msg.textContent = 'Three letters.'; return; }
  if (S.autopilot) { msg.textContent = 'The reference jump can’t be posted.'; return; }
  // One post per run, one request in flight: a double click (or Enter twice) posts once.
  const run = S.run;
  if (!run || postingRun === run) return;
  if (postedRun === run) { msg.textContent = 'Already posted.'; return; }
  try { localStorage.setItem('coldgas_initials', initials); } catch { /* storage blocked */ }
  const btn = e.target.querySelector('button[type="submit"]');
  postingRun = run;
  if (btn) btn.disabled = true;
  msg.textContent = 'Verifying…';
  let res;
  try { res = await postScore(run.inputLog, S.flyTier === 'assist', initials, run.course); } finally { postingRun = null; if (btn) btn.disabled = false; }
  if (res.ok) postedRun = run;
  if (S.run !== run) return;   // a new run's sheet: this answer belongs to the last one
  msg.textContent = res.ok ? `Posted. #${res.rank} today.` : res.status === 429 ? 'Slow down a little.' : res.timeout ? 'The board didn’t answer. Try again.' : 'The board is offline.';
});
let postingRun = null, postedRun = null;
try { document.getElementById('initials').value = localStorage.getItem('coldgas_initials') || ''; } catch { /* storage blocked */ }

// The board: the latest request wins (a slow 'today' never overwrites the 'all' asked for after it).
let boardKind = 'today', boardSeq = 0, boardAbort = null;
async function openBoard(kind = boardKind) {
  boardKind = kind;
  ui.show('board', true);
  document.querySelectorAll('[data-board]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.board === kind)));
  const seq = ++boardSeq;
  boardAbort?.abort();
  boardAbort = new AbortController();
  const rows = await fetchBoard(kind, { signal: boardAbort.signal });
  if (seq !== boardSeq) return;
  boardAbort = null;
  try { ui.board(rows); } catch (err) { obs.error('app', err); ui.board(null); }
}
on('[data-board-open]', () => openBoard());
on('[data-board-close]', () => ui.show('board', false));
document.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard(b.dataset.board)));

// The window changed shape (a rotation, a folding phone opened or closed mid-anything, 0075): the
// camera re-fits now and the drawing buffer once the size settles (stage.reshape); nothing reloads,
// and the run, the replay or the title carries on.
addEventListener('resize', () => { stage.reshape(); director.reframe(); frameReplay(); redrawPaused(); });
// Mist and crash smoke size in drawing-buffer pixels, kept current through resizes and the
// resolution governor's steps (src/render/scene.js onResize).
stage.onResize((h) => { plumes.setScale(h); crash.setScale(h); redrawPaused(); });
// Hidden: pause, go quiet, let the screen go. Back: the browser dropped the wake lock, so ask again.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); syncLife(true); });

// --- Free Drive (a lazy chunk: real roads from open data, src/drive/) ------------------------------
let drive = null, driveLoad = null;
function loadDrive() {
  driveLoad ??= import('./drive/index.js').then((mod) => {
    drive = mod.createDrive({
      stage, hero, carRoot, plumes, crash, syncCar, ui, tier, coarse,
      audio: { initAudio, updateAudio, chime }, input: { sample, usingTouch, freshRun, driving: drivingSettings, setDriving, onDriving, onPadY },
      assist: () => S.tier,   // the flight tier (assist | pro | advanced): Advanced drives the valves on the road too
      setMode: (m) => { disposeRun(); setMode(m); S.run = null; S.paused = false; ui.show('pause', false); },
      onExit: () => { toTitle(); director.snap(); director.reframe(); },
    });
    return drive;
  });
  return driveLoad;
}
on('[data-drive-open]', () => { cancelPendingStart(); loadDrive().then((d) => d.openPicker()).catch((err) => { console.error(err); ui.cue_('Free Drive couldn’t load', 2000); }); });

// --- The Sandbox: build, power-ups, side quests (a lazy chunk, src/build/) ----------------------------
let sandbox = null, sandboxLoad = null;
// Whichever driving world is live: the Sandbox or Free Drive.
function fd() { return sandbox?.active ? sandbox : drive; }
function loadSandbox() {
  sandboxLoad ??= import('./build/sandbox.js').then((mod) => {
    sandbox = mod.createSandbox({
      stage, hero, carRoot, plumes, crash, syncCar, ui, tier, coarse, CAR,
      audio: { initAudio, updateAudio, chime }, input: { sample, usingTouch, freshRun },
      assist: () => S.tier,
      setMode: (m) => { disposeRun(); setMode(m); S.run = null; S.paused = false; ui.show('pause', false); },
      onExit: () => { toTitle(); director.snap(); director.reframe(); },
    });
    return sandbox;
  });
  return sandboxLoad;
}
on('[data-sandbox-open]', () => { cancelPendingStart(); loadSandbox().then((s) => s.start()).catch((err) => { console.error(err); ui.cue_('The Sandbox couldn’t load', 2000); }); });

// Deep links: ?play=jump|reveal, ?board=today|all, ?drive=<road>[&tod=dusk], ?drive=endless[&seed=…].
// One of them wins (AGENTS.md, URL parameters): ?drive= over ?play= over ?board=.
const bootHash = location.hash;   // a shared build (#b=…) rides on a ?drive= link
toTitle();
const play = params.get('play');
if (params.get('drive') !== null) {
  // Keep a ?drive= link (and its build) in the address bar, so a reload or a copy brings it back.
  history.replaceState(null, '', `${location.pathname}?drive=${encodeURIComponent(params.get('drive') || 'stelvio')}${params.get('seed') ? `&seed=${encodeURIComponent(params.get('seed'))}` : ''}${bootHash}`);
  if (params.get('drive') === 'sandbox') loadSandbox().then((s) => s.start());
  else loadDrive().then((d) => d.start(params.get('drive') || 'stelvio', { tod: params.get('tod') || undefined, seed: params.get('seed') || undefined, idb: params.get('idb') !== '0' }));
} else if (play === 'jump' || play === 'reveal') startRun(play);
else if (params.get('board')) openBoard(params.get('board') === 'all' ? 'all' : 'today');

// e2e hooks. fastForward() runs the sim to the end without waiting on the wall clock, so slow
// software-GL runners exercise the same flow (countdown → live → results) in seconds.
function fastForward() {
  if (S.mode === 'countdown') { setMode('live'); ui.countdown(0); }
  if (S.mode !== 'live') return;
  for (let i = 0; i < 4000 && S.mode === 'live'; i++) liveStep(0.1);
}
function skipCountdown() { if (S.mode === 'countdown') { setMode('live'); ui.countdown(0); } }
const heal = installHeal({ stage, canvas, ui, S, toTitle, pause, closeNerds: () => toggleNerds(false), activeWorld: () => fd()?.state?.world || null });
window.__coldgas = { S, stage, physicsReady, physicsMemoryBytes, refGhostReady: (c) => !!refGhost(c, true), startRun, toTitle, thumb, inputKeys: INPUT_KEYS, input: { held: heldState, device: lastDevice }, driving: { get: drivingState, set: setDriving, settings: drivingSettings }, touch: { set: setSetting, get: () => touchSet, sync: syncScheme, tilt: tiltSteer }, camera, carRoot, ghostRoot, refGhostRoot, hero, director, plumes, crash, createAutopilot, fastForward, skipCountdown, liveStep, startDrill, retryDrill, setTier, landing, loadDrive, get drive() { return drive; }, loadSandbox, get sandbox() { return sandbox; } };
Object.assign(window.__coldgas, { obs, heal, life: { audio: audioState, wake: wakeHeld } });   // [obs] e2e: tests/e2e/obs.spec.js
requestAnimationFrame(frame);
