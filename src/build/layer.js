// BUILD · POWER-UPS · SIDE QUESTS: the layer that sits on a driving world (Free Drive's real roads,
// the Sandbox, and, through the same host interface, the infinite world). It owns the placed
// objects, folds their colliders into the world's ground for the sim, runs the sensors (rings,
// pickups, boost pads, crates) and the quest in progress, and hands the build editor and the
// quest board their data. Never constructed for a scored event.
//
// The host a world provides (src/build/sandbox.js and src/drive/index.js build one):
//   id            'sandbox' | a road id: where builds are saved and what a share link opens
//   kind          'sandbox' | 'road' (quest bounds and frame, src/build/quest-schema.js)
//   base          the world's own course (an `sdf`)
//   groundAt(x,z) the world's ground height there (no pieces)
//   inBounds(x,z) whether a piece may go there
//   questFrame(car) → (x, z, yawDeg, y) → { x, y, z, yaw }: the quest frame anchored at the car
//                 (on a road it follows the road), and .start: the pose the quest starts the car at
//   placeCar(pose) put a fresh car at { x, y, z, yaw }
//   rescue()      the mode's own reset, with a cue (the ground-effect ceiling's last resort, 0080)
//   scene, camera, canvas, carRoot, getCar()
import { PIECES, POWERUPS, BUDGET, pieceCost } from './catalogue.js';
import { createObjectStore, composeCourse, toLocal } from './objects.js';
import { shapeBounds } from './colliders.js';
import { createPowerups } from './powerups.js';
import { createCeiling } from './ceiling.js';
import { createQuestRun, loadProgress, saveProgress, applyReward, isUnlocked } from './quests.js';
import { encodeBuild, decodeBuild } from './encode.js';
import { createBuildRender } from './render.js';
import { createBuildUI } from './ui.js';
import { createEditor } from './editor.js';
import { DT } from '../sim/vehicle.js';
import { generateWithAI } from './ai-quest.js';
import { aiLabel } from '../ai/settings.js';

const ARCADE_KEY = 'coldgas_arcade';
const SAVES_KEY = 'coldgas_builds_v1';
const TAU = Math.PI * 2;

export function createBuildLayer(host, { ui: gameUi, audio, tier = 'high', coarse = false, usingTouch = () => false, onEditing } = {}) {
  const store = createObjectStore();
  const course = composeCourse(host.base, store);
  const render = createBuildRender(host.scene, { tier });
  const power = createPowerups();
  // The jets hop and hover near the ground; they don't fly the car into the sky (src/build/ceiling.js).
  const ceiling = createCeiling(() => course.sdf);
  const progress = loadProgress();
  const st = {
    arcade: false, editing: false, quest: null, questObjs: [], cleared: new Set(), taken: new Set(), respawn: new Map(),
    boostCool: 0, prev: { x: 0, y: 0, z: 0 }, hasPrev: false,
    flight: { on: false, t: 0, x: 0, z: 0, rot: 0 }, cueT: 0, rev: 0, questArcade: false, result: null,
  };
  try { st.arcade = localStorage.getItem(ARCADE_KEY) === '1'; } catch { /* storage blocked */ }
  const near = [], lp = [0, 0, 0], lq = [0, 0, 0], bb = new Float64Array(6);
  const cue = (html, ms) => gameUi?.cue_?.(html, ms);
  const chime = () => { try { audio?.chime?.(); } catch { /* audio optional */ } };

  // --- The build -----------------------------------------------------------------------------------
  const buildCost = () => store.all().reduce((a, o) => a + (o.tag === 'build' ? (o.pickup ? 1 : pieceCost(o.type)) : 0), 0);
  function canPlace(type, t, ignoreId = null) {
    const isPickup = String(type).startsWith('pickup:');
    if (!isPickup && !PIECES[type]) return { ok: false, why: 'Unknown piece' };
    if (!isPickup && !isUnlocked(progress, type)) return { ok: false, why: `${PIECES[type].name} is locked: finish a quest to unlock it` };
    const cost = isPickup ? 1 : pieceCost(type), was = ignoreId ? (store.get(ignoreId)?.pickup ? 1 : pieceCost(store.get(ignoreId)?.type)) : 0;
    if (buildCost() - was + cost > BUDGET.build) return { ok: false, why: `Over the build budget (${BUDGET.build})` };
    if (!host.inBounds(t.x, t.z)) return { ok: false, why: 'Out of bounds' };
    // Never on top of the car.
    const car = host.getCar();
    if (car && !isPickup) {
      shapeBounds(PIECES[type].shape, bb);
      const dx = car.pos.x - t.x, dz = car.pos.z - t.z, c = Math.cos(t.yaw), s = Math.sin(t.yaw);
      const lx = (c * dx - s * dz) / t.scale, lz = (s * dx + c * dz) / t.scale;
      if (lx > bb[0] - 1.5 && lx < bb[3] + 1.5 && lz > bb[2] - 2.6 && lz < bb[5] + 2.6 && car.pos.y < t.y + bb[4] * t.scale + 2) return { ok: false, why: 'The car is in the way' };
    }
    return { ok: true };
  }
  const specOf = (o) => ({ id: o.id, type: o.type, transform: { ...o.transform }, material: o.material, tag: o.tag, hidden: o.hidden });
  function add(spec) { const o = store.addObject({ tag: 'build', ...spec }); autosave(); return o; }
  function remove(id) { const ok = store.removeObject(id); autosave(); return ok; }

  // --- Saves: this device, and the URL ----------------------------------------------------------
  const autoKey = () => `coldgas_build_${host.id}`;
  let saveTimer = 0;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(autoKey(), encodeBuild(host.id, buildItems())); } catch { /* storage blocked */ } }, 250);
  }
  const buildItems = () => store.all().filter((o) => o.tag === 'build').map(specOf);
  function loadCode(code, { replace = true } = {}) {
    const b = decodeBuild(code);
    if (!b) return 0;
    if (replace) store.clear('build');
    let n = 0;
    for (const it of b.items) { try { store.addObject({ ...it, tag: 'build' }); n++; } catch { /* skip unknown */ } }
    autosave();
    return n;
  }
  function restore() {
    let code = null;
    const m = /(?:^|[#&])b=([\w-]+)/.exec(location.hash);
    if (m) {
      const b = decodeBuild(m[1]);
      if (b && (b.arena === host.id || !b.arena)) { code = m[1]; cue(`Loaded a shared build · ${b.items.length} pieces`, 2400); }
    }
    if (!code) { try { code = localStorage.getItem(autoKey()); } catch { /* storage blocked */ } }
    if (code) loadCode(code);
  }
  function saves() { try { return JSON.parse(localStorage.getItem(SAVES_KEY) || '[]').filter((s) => s && typeof s.code === 'string'); } catch { return []; } }
  function saveAs(name) {
    const list = saves().filter((s) => !(s.name === name && s.arena === host.id));
    list.unshift({ name: String(name).slice(0, 32) || 'Untitled', arena: host.id, code: encodeBuild(host.id, buildItems()), at: Date.now(), n: buildItems().length });
    try { localStorage.setItem(SAVES_KEY, JSON.stringify(list.slice(0, 24))); } catch { /* storage blocked */ }
    return list[0];
  }
  function deleteSave(at) { try { localStorage.setItem(SAVES_KEY, JSON.stringify(saves().filter((s) => s.at !== at))); } catch { /* storage blocked */ } }
  function shareUrl() {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    if (host.id === 'sandbox') u.searchParams.set('drive', 'sandbox'); else u.searchParams.set('drive', host.id);
    return `${u.toString()}#b=${encodeBuild(host.id, buildItems())}`;
  }

  // --- Arcade (power-ups) ------------------------------------------------------------------------
  function setArcade(on, { persist = true } = {}) {
    st.arcade = !!on;
    if (!st.arcade) power.reset();
    if (persist) { try { localStorage.setItem(ARCADE_KEY, st.arcade ? '1' : '0'); } catch { /* storage blocked */ } }
    bui.setArcade(st.arcade || st.questArcade);
    st.rev++;
  }
  const arcadeOn = () => st.arcade || st.questArcade;

  // --- Quests ------------------------------------------------------------------------------------
  // A quest runs on a clear field: the player's build steps aside (kept, not saved over) and comes
  // back when the quest ends.
  function startQuest(q) {
    endQuest(false);
    if (!st.stash) { st.stash = buildItems(); store.clear('build'); }
    const car = host.getCar();
    const map = host.questFrame(car);
    host.placeCar(map.start);
    const objs = q.pieces.map((p, i) => {
      const w = map(p.x, p.z, p.yaw, p.y);
      return store.addObject({ id: `q:${i}`, type: p.t, tag: 'quest', hidden: p.hidden, material: p.m, transform: { x: w.x, y: w.y, z: w.z, yaw: w.yaw, scale: p.s } });
    });
    q.pickups.forEach((p, i) => { const w = map(p.x, p.z, 0, p.y); store.addObject({ id: `qp:${i}`, type: `pickup:${p.t}`, tag: 'quest', transform: { x: w.x, y: w.y, z: w.z, yaw: 0, scale: 1 } }); });
    st.questObjs = objs;
    st.quest = createQuestRun(q, objs);
    st.quest.onDrop = () => { render.carry(false, host.carRoot); cue('Too slow · the crate’s back where it was', 2200); };
    st.cleared.clear(); st.taken.clear(); st.result = null;
    st.questArcade = q.pickups.length > 0;
    if (st.questArcade && !st.arcade) cue('Arcade layer on for this quest: power-ups are live', 2600);
    bui.setArcade(arcadeOn());
    setBeacons();
    bui.quest(st.quest);
    bui.closeBoard();
    cue(`<b>${esc(q.title)}</b>${q.brief ? ` · ${esc(q.brief)}` : ''}`, 4200);
    st.rev++;
  }
  function setBeacons() {
    const q = st.quest;
    if (!q) { render.setBeacons([]); return; }
    const pts = [];
    q.objectives.forEach((o) => {
      if (o.ok) return;
      const idx = o.type === 'land' ? o.target : o.type === 'deliver' ? (q.st.carrying ? o.to : o.from) : -1;
      const ob = idx >= 0 ? st.questObjs[idx] : null;
      if (ob) pts.push({ x: ob.transform.x, y: ob.transform.y, z: ob.transform.z, color: o.type === 'deliver' ? 0xffd27a : 0xbfe6ff });
    });
    render.setBeacons(pts);
  }
  function endQuest(keepObjects = false) {
    if (!keepObjects) store.clear('quest');
    if (st.stash && !keepObjects) { for (const it of st.stash) { try { store.addObject({ ...it, tag: 'build' }); } catch { /* skip */ } } st.stash = null; }
    render.carry(false, host.carRoot);
    st.quest = null; st.questObjs = []; st.questArcade = false; st.cleared.clear(); st.taken.clear();
    render.setBeacons([]);
    bui.quest(null);
    bui.setArcade(st.arcade);
    st.rev++;
  }
  function finishQuest(ok) {
    const q = st.quest;
    if (!q || st.result) return;
    let line = null;
    if (ok) {
      progress.done[q.quest.id] = (progress.done[q.quest.id] || 0) + 1;
      line = applyReward(progress, q.quest.reward);
      saveProgress(progress);
      chime();
    }
    st.result = { ok, line, time: q.time };
    bui.questResult(q, st.result);
    render.setBeacons([]);
  }

  // --- The sim hooks: before and after each 240 Hz tick ------------------------------------------
  function preStep(car, inp) {
    render.before(car.world);   // the loose pieces' poses before this tick (drawn between ticks)
    if (arcadeOn()) power.preStep(car, inp);
    else { st.airBefore = car.air; }
    ceiling.preStep(car, inp);   // last: a power-up's BOOST fades with height too
  }
  function postStep(car) {
    if (arcadeOn()) power.postStep(car, DT);
    ceiling.postStep(car, DT);
    const p = car.pos;
    if (!st.hasPrev) { st.prev.x = p.x; st.prev.y = p.y; st.prev.z = p.z; st.hasPrev = true; }
    if (st.boostCool > 0) st.boostCool -= DT;
    // Sensors near the car.
    store.objectsNear(p.x, p.z, 4, near);
    for (let k = 0; k < near.length; k++) {
      const o = near[k];
      if (!o.sensor || st.taken.has(o.id)) continue;
      if (o.type === 'ring') ringCheck(o, car);
      else if (o.pickup) {
        const t = o.transform, dx = p.x - t.x, dy = p.y - (t.y + 1.4), dz = p.z - t.z;
        if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) collect(o, car);
      } else if (o.type === 'boost' && st.boostCool <= 0) {
        toLocal(o, p.x, p.y, p.z, lp);
        const sh = PIECES.boost.shape;
        if (Math.abs(lp[0]) < sh.w / 2 + 0.4 && Math.abs(lp[2]) < sh.d / 2 + 0.4 && lp[1] < 1.4 && car.grounded > 0) {
          car.vel.x += Math.sin(o.transform.yaw) * 8; car.vel.z += Math.cos(o.transform.yaw) * 8;
          st.boostCool = 0.8;
          cue('Boost · +8 m/s', 900);
        }
      } else if (o.type === 'crate' && st.quest) {
        const t = o.transform, dx = p.x - t.x, dz = p.z - t.z;
        if (dx * dx + dz * dz < 3.2 * 3.2 && p.y < t.y + 3 && st.quest.crate()) {
          st.taken.add(o.id); render.carry(true, host.carRoot); cue('Crate aboard · get it to the pad', 2000); setBeacons(); st.rev++;
        }
      }
    }
    st.prev.x = p.x; st.prev.y = p.y; st.prev.z = p.z;
    // The flight: takeoff, rotation, touchdown.
    const air = car.grounded === 0 && !car.hullContact, f = st.flight;
    if (air) {
      if (!f.on) { f.on = true; f.t = 0; f.x = p.x; f.z = p.z; f.rot = 0; }
      f.t += DT;
      f.rot += Math.hypot(car.angVel.x, car.angVel.y, car.angVel.z) * DT;
    } else if (f.on && car.grounded >= 2) {
      f.on = false;
      if (f.t > 0.35) landed(car, f);
    }
    if (st.quest && !st.result) {
      const q = st.quest;
      q.tick(DT);
      q.speed(Math.hypot(car.vel.x, car.vel.y, car.vel.z) * 3.6);
      if (car.grounded >= 2) for (const o of q.quest.objectives) {
        if (o.type === 'deliver' && q.st.carrying) { if (onTop(st.questObjs[o.to], p)) { q.on(o.to); if (q.st.delivered) { render.carry(false, host.carRoot); cue('Delivered', 1600); setBeacons(); } } }
      }
      for (const o of q.quest.objectives) if (o.type === 'find' && !q.st.found) {
        const t = st.questObjs[o.target].transform, dx = p.x - t.x, dz = p.z - t.z;
        if (dx * dx + dz * dz < 10 * 10) { q.near(o.target); cue('Found it', 1600); }
      }
      if (q.done) finishQuest(true); else if (q.failed) finishQuest(false);
    }
  }
  function onTop(o, p) {
    if (!o) return false;
    toLocal(o, p.x, p.y, p.z, lq);
    shapeBounds(o.shape, bb);
    return lq[0] > bb[0] - 0.4 && lq[0] < bb[3] + 0.4 && lq[2] > bb[2] - 0.4 && lq[2] < bb[5] + 0.4 && lq[1] > bb[4] - 0.3 && lq[1] < bb[4] + 2.5;
  }
  function landed(car, f) {
    const p = car.pos, dist = Math.hypot(p.x - f.x, p.z - f.z);
    const upY = 1 - 2 * (car.quat.x * car.quat.x + car.quat.z * car.quat.z);
    const rotations = f.rot / TAU;
    if (dist > 12 || f.t > 1.2) cue(`${Math.round(dist)} m · ${f.t.toFixed(1)} s${rotations > 0.9 ? ` · ${rotations.toFixed(1)} rot` : ''}`, 1500);
    if (st.quest && !st.result) {
      const on = [];
      st.questObjs.forEach((o, i) => { if (!o.sensor && onTop(o, p)) on.push(i); });
      st.quest.land({ dist, airtime: f.t, rotations, upright: upY > 0.7, on });
    }
  }
  function ringCheck(o, car) {
    const p = car.pos;
    toLocal(o, st.prev.x, st.prev.y, st.prev.z, lq);
    toLocal(o, p.x, p.y, p.z, lp);
    if ((lq[2] < 0) === (lp[2] < 0)) return;
    const sh = PIECES.ring.shape, dy = lp[1] - sh.lift;
    if (lp[0] * lp[0] + dy * dy > sh.r * sh.r) return;
    if (st.cleared.has(o.id)) return;
    st.cleared.add(o.id); st.rev++;
    chime();
    if (st.quest && o.tag === 'quest') {
      st.quest.ring(st.questObjs.indexOf(o));
      const need = st.quest.objectives.find((x) => x.type === 'rings');
      cue(`Ring ${st.quest.st.rings.size}${need ? `/${need.count}` : ''}`, 1100);
    } else cue('Ring', 900);
    // A build's rings light again after a few seconds, for another lap.
    if (o.tag === 'build') setTimeout(() => { st.cleared.delete(o.id); st.rev++; }, 4000);
  }
  function collect(o, car) {
    if (!arcadeOn()) return;
    const id = o.pickup;
    power.grant(id, car);
    st.taken.add(o.id); st.rev++;
    chime();
    cue(`${POWERUPS[id].name} · ${POWERUPS[id].blurb}`, 1800);
    if (st.quest && o.tag === 'quest') st.quest.pickup();
    if (o.tag === 'build') st.respawn.set(o.id, 10);
  }

  // --- Per rendered frame --------------------------------------------------------------------------
  const activeList = [];
  let liftBtn = null;
  // The ceiling, said once and shown while it bites: the LIFT button dims (DOM on change only).
  function ceilingFrame() {
    if (ceiling.takeRescue()) { host.rescue?.(); return; }
    const bite = ceiling.biting;
    if (bite && !st.ceilingSaid) { st.ceilingSaid = true; cue('Ground effect · the jets only lift you near the ground', 2600); }
    if (liftBtn === null) liftBtn = gameUi?.touch?.querySelector?.('[data-btn-lift]') || false;
    if (liftBtn && bite !== st.liftDim) { st.liftDim = bite; liftBtn.toggleAttribute('data-faded', bite); }
  }
  function frame(dt, time, alpha = 1) {
    ceilingFrame();
    for (const [id, t] of st.respawn) { const n = t - dt; if (n <= 0) { st.respawn.delete(id); st.taken.delete(id); st.rev++; } else st.respawn.set(id, n); }
    render.sync(store, { cleared: st.cleared, taken: st.taken, rev: st.rev });
    render.poses(host.getCar()?.world, alpha);   // the loose pieces where their bodies are
    render.frame(time);
    bui.powerups(power.active(activeList));
    // The tracker (text) five times a second; the beacons twice.
    if (st.quest) { st.cueT += dt; if (st.cueT > 0.2) { bui.questTick(st.quest); st.beaconT = (st.beaconT || 0) + st.cueT; st.cueT = 0; if (st.beaconT > 0.5) { st.beaconT = 0; setBeacons(); } } }
    editor.frame(dt, time);
  }

  // --- UI ------------------------------------------------------------------------------------------
  const api = {
    host, store, course, render, power, ceiling, progress, get arcade() { return arcadeOn(); },
    canPlace, add, remove, specOf, buildCost, setArcade, saves, saveAs, deleteSave, loadCode, shareUrl, buildItems,
    startQuest, endQuest, get quest() { return st.quest; },
    retryQuest: () => { const q = st.quest?.quest; if (q) startQuest(q); },
    get questActive() { return !!st.quest; },
    clearBuild: () => { store.clear('build'); autosave(); },
    usingTouch, coarse, cue,
    aiLabel: () => aiLabel(),
    // Ask the player's AI for a quest (theatre and all); the local generator if it can't.
    async generate(wish) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const r = await generateWithAI({ wish, arena: host.kind, theatreRoot: document.querySelector('[data-theatre]'), reduced });
      if (!r) return null;
      if (r.source === 'local') cue(`${r.meta?.error ? esc(r.meta.error) : 'No AI quest'} · the local generator laid out “${esc(r.quest.title)}”`, 3400);
      return r.quest;
    },
  };
  const bui = createBuildUI(api, { coarse });
  const editor = createEditor(api, bui, { onEditing: (on) => { st.editing = on; onEditing?.(on); } });
  api.editor = editor;
  bui.setArcade(arcadeOn());
  restore();

  return {
    course, store, preStep, postStep, frame, api,
    get timeScale() { return arcadeOn() ? power.timeScale : 1; },
    get editing() { return st.editing; },
    toggleBuild: () => editor.toggle(),
    openQuests: () => bui.openBoard(),
    // Tests and screenshots.
    place(type, x, z, { yaw = 0, scale = 1, material, y } = {}) {
      return add({ type, material, transform: { x, y: y ?? host.groundAt(x, z), z, yaw, scale } });
    },
    reset() { power.reset(); ceiling.reset(); st.flight.on = false; st.hasPrev = false; },
    dispose() {
      if (liftBtn) liftBtn.removeAttribute('data-faded');
      clearTimeout(saveTimer);
      endQuest(false);
      editor.dispose(); bui.dispose(); render.dispose();
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
