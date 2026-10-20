// COLD GAS — entry. Owns the state machine (title → countdown → live → results ⇄ replay), the
// fixed-step sim clock, and syncing the sim to the scene. Rendering lives in src/render/, the
// physics and judging in src/sim/ (pure, shared with the Worker).
import '@fontsource/michroma/400.css';
import '@fontsource/geist-sans/200.css';
import '@fontsource/geist-sans/300.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import './styles.css';
import * as THREE from 'three';
import { createStage } from './render/scene.js';
import { createPlumes } from './render/plumes.js';
import { createDirector } from './render/director.js';
import { makeGhost, ghostMat } from './render/cars.js';
import { createRun, stepRun, FRAME_EVERY } from './sim/run.js';
import { DT, CAR, NOZZLES, bodyRates } from './sim/vehicle.js';
import { scoreRun } from './sim/judge.js';
import { createAutopilot } from './sim/autopilot.js';
import { RAMP, PAD, groundAt } from './sim/course.js';
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
  stage = createStage(canvas, { tier });
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
stage.renderer.compile(scene, camera);   // warm the ghost's shader so "Go" doesn't hitch
ghostRoot.visible = false;
const plumes = createPlumes(scene, carRoot, { maxMist: tier === 'low' ? 500 : 1800 });
const director = createDirector(camera);

// --- State -------------------------------------------------------------------------------
const S = {
  mode: 'title',          // title | countdown | live | results | replay
  run: null, autopilot: null, card: null, words: null,
  assist: true, acc: 0, countT: 0, doneT: 0, paused: false,
  replayT: 0, prevPhase: '', time: 0,
  idleThrottles: new Float64Array(NOZZLES.length),
};
try { S.assist = localStorage.getItem('coldgas_assist') !== '0'; } catch { /* storage blocked */ }
S.ghost = null; S.ghostOn = ghostEnabled();
const ghostLoaded = loadBest().then((g) => { if (g && isBetter(S.ghost, g)) S.ghost = g; });
const gpose = newGhostPose();
// Shown only in your own live runs; it fades out where it overlaps the car (the start line).
function syncGhost() {
  const live = (S.mode === 'live' || S.mode === 'countdown') && !S.autopilot;
  ghostRoot.visible = live && S.ghostOn && ghostAt(S.ghost, S.run.tick, gpose);
  if (!ghostRoot.visible) return;
  ghostRoot.position.set(gpose.x, gpose.y, gpose.z);
  ghostRoot.quaternion.set(gpose.qx, gpose.qy, gpose.qz, gpose.qw);
  const d = ghostRoot.position.distanceTo(carRoot.position);
  ghostMat.opacity = 0.18 * Math.min(1, Math.max(0, (d - 1.5) / 2.5));
}

const qv = new THREE.Vector3(), rates = { x: 0, y: 0, z: 0 };
const zeroVel = new THREE.Vector3();

function placeOnPad() {
  carRoot.position.set(PAD.x, hero.comY, PAD.z);
  carRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.6);
  for (const w of hero.wheels) { w.pivot.position.y = 0.33; w.pivot.rotation.y = 0; }
}

function syncCar(pos, quat, comps, spins, steer) {
  carRoot.position.set(pos.x, pos.y, pos.z);
  carRoot.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  for (let i = 0; i < 4; i++) {
    const w = hero.wheels[i];
    w.pivot.position.y = 0.234 + comps[i];
    w.spin.rotation.x = spins[i];
    if (i < 2) w.pivot.rotation.y = -steer;
  }
}

// --- Flow --------------------------------------------------------------------------------
function toTitle() {
  S.mode = 'title'; S.run = null;
  ui.only('title');
  ui.touch.hidden = true;
  ui.clearCue(); ui.countdown(0);
  plumes.clear();
  placeOnPad();
  history.replaceState(null, '', location.pathname);
}

function startRun(kind = 'jump') {
  initAudio();
  S.run = createRun();
  S.autopilot = kind === 'reveal' ? createAutopilot() : null;
  S.mode = 'countdown'; S.countT = 0; S.acc = 0; S.card = null; S.words = null; S.prevPhase = '';
  ui.only('hud');
  ui.touch.hidden = !(coarse || usingTouch()) || !!S.autopilot;
  plumes.clear();
  const c = S.run.car;
  syncCar(c.pos, c.quat, [0.096, 0.096, 0.096, 0.096], [0, 0, 0, 0], 0);
  director.snap();
  if (S.autopilot) ui.cue_('The reference jump', 2400);
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
    const g = packFrames(run.frames, S.card.total, !!S.autopilot);
    ghostLoaded.then(() => { if (isBetter(S.ghost, g)) { S.ghost = g; saveBest(g); } });
  }
  // The judges' theatre: the server re-simulates the log, then a model writes the words, all of
  // it shown live (src/ai/theatre.js, a lazy chunk with the aurora-field particle engine).
  runPanel(run);
  // Replay plays behind the sheet.
  S.replayT = 0;
}

const theatreRoot = document.querySelector('[data-theatre]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
async function runPanel(run, replay = null) {
  const assist = !!(S.assist || S.autopilot);
  const card = S.card;
  let mod;
  try { mod = await import('./ai/theatre.js'); } catch { S.words = localWords(card); ui.words(S.words); return; }
  if (S.run !== run) return;
  const { words, meta } = await mod.runTheatre(theatreRoot, {
    log: run.inputLog, assist, ai: loadAI(), card, fallbackWords: localWords, reduced: reducedMotion, replay,
  });
  if (S.run !== run) return;
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

// --- Live step -----------------------------------------------------------------------------
function liveStep(dt) {
  const run = S.run;
  S.acc += Math.min(dt, 0.1);
  let input = null;
  while (S.acc >= DT && run.phase !== 'done') {
    input = S.autopilot ? S.autopilot(run) : sample(run.phase, S.assist);
    stepRun(run, input);
    S.acc -= DT;
  }
  const c = run.car;
  for (let i = 0; i < 4; i++) { fcomp[i] = c.wheels[i].compression; fspin[i] = c.wheels[i].spin; }
  syncCar(c.pos, c.quat, fcomp, fspin, c.steer);

  // Phase cues and moments.
  if (run.phase !== S.prevPhase) {
    if (run.phase === 'air') director.shake(0.15);
    if (run.phase === 'landed') { thud(run.t.sink); director.shake(Math.min(1, run.t.sink / 4)); }
    S.prevPhase = run.phase;
  }
  if (!S.autopilot) {
    if (run.phase === 'drive' && c.pos.z > -40 && c.pos.z < RAMP.z0) ui.cue_(usingTouch() ? 'Hold <kbd>LIFT</kbd> at the lip' : 'Hold <kbd>Space</kbd> at the lip', 600);
    else if (run.phase === 'air' && Math.abs(run.t.rollAccum) < 0.3 && c.vel.y < 4) ui.cue_(usingTouch() ? 'Stick sideways to roll' : '<kbd>←</kbd> <kbd>→</kbd> to roll', 500);
    else if (run.phase === 'air' && Math.abs(run.t.rollAccum) > 5.6 && c.vel.y < 0) ui.cue_(usingTouch() ? 'Hold <kbd>LAND</kbd>' : 'Hold <kbd>Shift</kbd> to land', 500);
  }

  const speed = Math.hypot(c.vel.x, c.vel.z);
  bodyRates(c, rates);
  qv.set(0, 1, 0).applyQuaternion(carRoot.quaternion);
  ui.hud({
    speed, air: (c.air / CAR.airMass) * 100, rollDeg: Math.abs(run.t.rollAccum) * 180 / Math.PI,
    rollAngle: Math.atan2(qv.x, qv.y), alt: Math.max(0, c.pos.y - hero.comY - groundAt(c.pos.x, c.pos.z)),
    sink: -c.vel.y, phase: { drive: 'Run-up', air: 'Airborne', landed: 'Touchdown', done: 'Settled' }[run.phase],
    throttles: c.throttles,
  });
  plumes.update(dt, S.time, c.throttles, c.vel, 0);
  updateAudio({ speed, grounded: c.grounded > 0, throttles: c.throttles });

  if (run.phase === 'done') {
    S.doneT += dt;
    if (S.doneT > 1.4) finishRun();
  } else S.doneT = 0;
}

// --- Replay (behind the results sheet, and on demand) ----------------------------------------
const fpos = { x: 0, y: 0, z: 0 }, fquat = { x: 0, y: 0, z: 0, w: 1 };
const fcomp = [0, 0, 0, 0], fspin = [0, 0, 0, 0];
const fthr = new Float64Array(NOZZLES.length);
const fvel = new THREE.Vector3();
function replayStep(dt) {
  const frames = S.run?.frames;
  if (!frames?.length) return;
  const n = frames.length;
  const i0 = Math.min(n - 1, Math.floor(S.replayT));
  const f = frames[i0];
  // Slow motion over the lineup and the roll.
  const slow = f[2] > RAMP.z1 - 2 && f[2] < PAD.z - 6 ? 0.42 : 1;
  S.replayT += dt * (240 / FRAME_EVERY) * slow;
  if (S.replayT >= n + 90) S.replayT = 0;   // hold a beat, loop
  const i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, S.replayT - i0);
  const g = frames[i1];
  fpos.x = f[0] + (g[0] - f[0]) * k; fpos.y = f[1] + (g[1] - f[1]) * k; fpos.z = f[2] + (g[2] - f[2]) * k;
  fquat.x = f[3]; fquat.y = f[4]; fquat.z = f[5]; fquat.w = f[6];
  for (let w = 0; w < 4; w++) { fcomp[w] = f[7 + w]; fspin[w] = f[11 + w]; }
  for (let j = 0; j < NOZZLES.length; j++) fthr[j] = f[15 + j];
  fvel.set(g[0] - f[0], g[1] - f[1], g[2] - f[2]).multiplyScalar(60);
  syncCar(fpos, fquat, fcomp, fspin, 0);
  plumes.update(dt * slow, S.time, fthr, fvel, 0);
  updateAudio({ speed: fvel.length() * slow, grounded: fpos.y < 0.7, throttles: fthr });
}

// --- Title idle: an occasional breath from the lift jets --------------------------------------
function titleStep(dt) {
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
    S.time += dt;
    if (S.mode === 'title') titleStep(dt);
    else if (S.mode === 'countdown') {
      const before = Math.ceil(3 - S.countT);
      S.countT += dt;
      const after = Math.ceil(3 - S.countT);
      if (S.countT < 0.02 || after !== before) ui.countdown(after > 0 ? after : 0);
      if (S.countT >= 3) { S.mode = 'live'; ui.countdown(0); ui.cue_(S.autopilot ? 'The reference jump' : 'Go', 900); }
      plumes.update(dt, S.time, S.idleThrottles.fill(0), zeroVel, 0);
    } else if (S.mode === 'live') liveStep(dt);
    else if (S.mode === 'results' || S.mode === 'replay') replayStep(dt);

    syncGhost();
    const live = S.mode === 'live' || S.mode === 'countdown';
    director.update(dt, S.time, {
      carPos: carRoot.position, carVel: live && S.run ? S.run.car.vel : zeroVel,
      phase: S.run?.phase || 'drive',
      mode: S.mode === 'title' ? 'title' : S.mode === 'results' || S.mode === 'replay' ? 'replay' : 'live',
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
  const text = `COLD GAS ${S.card.total.toFixed(1)}: ${S.card.verdict}. ${f.rollDeg}° roll, ${f.apex} m apex, ${f.sink} m/s touchdown.`;
  const url = `${location.origin}${import.meta.env.BASE_URL}`;
  try {
    if (navigator.share) await navigator.share({ title: 'COLD GAS', text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); ui.cue_('Copied', 1400); }
  } catch { /* cancelled */ }
});

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
  const who = S.ghost?.ref ? 'the reference jump' : 'your best run';
  ui.cue_(S.ghostOn ? (S.ghost ? `Ghost on: ${who} rides alongside` : 'Ghost on: finish a run to set one') : 'Ghost off', 1600);
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
  const res = await postScore(S.run.inputLog, S.assist, initials);
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

addEventListener('resize', () => { stage.resize(); plumes.setScale(innerHeight); director.reframe(); });
plumes.setScale(innerHeight);
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
window.__coldgas = { S, startRun, toTitle, camera, carRoot, ghostRoot, hero, director, fastForward, skipCountdown };
requestAnimationFrame(frame);
