// SIDE QUESTS: running one, and what finishing them unlocks. The quest itself is validated data
// (src/build/quest-schema.js); this tracks its objectives from what the car does, which the build
// layer reports as events: rings flown through, pickups collected, touchdowns (with the flight's
// distance, airtime and rotation, and what the car landed on), speed, where the car is.
import { PIECES, PAINTS } from './catalogue.js';

const STORE = 'coldgas_quests_v1';

// --- Progress on this device ---------------------------------------------------------------------
export function loadProgress() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { /* storage blocked or corrupt */ }
  const base = { done: {}, pieces: [], paints: ['silver'], titles: [], paint: 'silver', title: '' };
  if (!p || typeof p !== 'object') return base;
  return {
    done: p.done && typeof p.done === 'object' ? p.done : {},
    pieces: Array.isArray(p.pieces) ? p.pieces.filter((id) => PIECES[id]?.locked) : [],
    paints: ['silver', ...(Array.isArray(p.paints) ? p.paints.filter((id) => PAINTS[id] && !PAINTS[id].base) : [])],
    titles: Array.isArray(p.titles) ? p.titles.filter((t) => typeof t === 'string').slice(0, 64) : [],
    paint: PAINTS[p.paint] ? p.paint : 'silver',
    title: typeof p.title === 'string' ? p.title : '',
  };
}
export function saveProgress(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage blocked */ }
}
export const isUnlocked = (p, pieceId) => !PIECES[pieceId]?.locked || p.pieces.includes(pieceId);

// Apply a reward ("piece:loop", "paint:ice", "title:Courier"); → a line for the HUD, or null.
export function applyReward(p, reward) {
  const m = /^(piece|paint|title):(.+)$/.exec(reward || '');
  if (!m) return null;
  if (m[1] === 'piece' && PIECES[m[2]] && !p.pieces.includes(m[2])) { p.pieces.push(m[2]); return `Unlocked: ${PIECES[m[2]].name}`; }
  if (m[1] === 'paint' && PAINTS[m[2]] && !p.paints.includes(m[2])) { p.paints.push(m[2]); return `Unlocked paint: ${PAINTS[m[2]].name}`; }
  if (m[1] === 'title' && !p.titles.includes(m[2])) { p.titles.push(m[2]); p.title ||= m[2]; return `New title: ${m[2]}`; }
  return null;
}

// --- A quest in progress -------------------------------------------------------------------------
// `objs` maps the quest's piece indices to the placed objects (src/build/objects.js).
export function createQuestRun(quest, objs) {
  const st = {
    t: 0, done: false, failed: false, rings: new Set(), collected: 0, carrying: false, carryT: 0, delivered: false,
    found: false, best: { jump: 0, airtime: 0, flip: 0, speed: 0 }, landedOn: new Set(),
  };
  const ob = quest.objectives.map((o) => ({ ...o, ok: false }));

  function check() {
    for (const o of ob) {
      if (o.ok) continue;
      switch (o.type) {
        case 'rings': o.ok = st.rings.size >= o.count; break;
        case 'land': o.ok = st.landedOn.has(o.target); break;
        case 'jump': o.ok = st.best.jump >= o.min; break;
        case 'airtime': o.ok = st.best.airtime >= o.min; break;
        case 'flip': o.ok = st.best.flip >= o.count; break;
        case 'speed': o.ok = st.best.speed >= o.min; break;
        case 'deliver': o.ok = st.delivered; break;
        case 'find': o.ok = st.found; break;
        case 'collect': o.ok = st.collected >= o.count; break;
        default: break;
      }
    }
    if (!st.done && ob.every((o) => o.ok)) st.done = true;
  }

  return {
    quest, st, objectives: ob,
    // Sim time passes (s). Fails on the time limit; drops a crate that took too long.
    tick(dt) {
      if (st.done || st.failed) return;
      st.t += dt;
      if (st.carrying) {
        st.carryT += dt;
        const d = ob.find((o) => o.type === 'deliver');
        if (d && st.carryT > d.within) { st.carrying = false; st.carryT = 0; this.onDrop?.(); }
      }
      if (quest.timeLimit && st.t > quest.timeLimit) st.failed = true;
    },
    ring(index) { if (quest.pieces[index]?.t === 'ring') { st.rings.add(index); check(); } },
    pickup() { st.collected++; check(); },
    crate() { if (!st.carrying && !st.delivered) { st.carrying = true; st.carryT = 0; return true; } return false; },
    // Grounded on piece `index` (any touch, not just a landing): deliveries and finds.
    on(index) {
      if (st.carrying && ob.some((o) => o.type === 'deliver' && o.to === index)) { st.delivered = true; st.carrying = false; }
      check();
    },
    near(index) { if (ob.some((o) => o.type === 'find' && o.target === index)) { st.found = true; check(); } },
    // A touchdown after a flight: { dist, airtime, rotations, upright, on: [piece indices] }.
    land({ dist, airtime, rotations, upright, on }) {
      if (upright) {
        st.best.jump = Math.max(st.best.jump, dist);
        st.best.airtime = Math.max(st.best.airtime, airtime);
        st.best.flip = Math.max(st.best.flip, rotations);
        for (const i of on) st.landedOn.add(i);
      }
      check();
    },
    speed(kmh) { if (kmh > st.best.speed) { st.best.speed = kmh; check(); } },
    // One line per objective for the HUD.
    lines() {
      return ob.map((o) => {
        let label = '', val = '';
        switch (o.type) {
          case 'rings': label = `Fly through ${o.count} ring${o.count > 1 ? 's' : ''}`; val = `${Math.min(st.rings.size, o.count)}/${o.count}`; break;
          case 'land': label = `Land on the ${PIECES[quest.pieces[o.target].t].name.toLowerCase()}`; break;
          case 'jump': label = `Jump ${o.min} m`; val = `${Math.round(st.best.jump)} m`; break;
          case 'airtime': label = `${o.min} s in the air`; val = `${st.best.airtime.toFixed(1)} s`; break;
          case 'flip': label = `${o.count} full rotation${o.count > 1 ? 's' : ''} in one flight`; val = `${st.best.flip.toFixed(1)}`; break;
          case 'speed': label = `Reach ${o.min} km/h`; val = `${Math.round(st.best.speed)}`; break;
          case 'deliver': label = `Deliver the crate in ${o.within} s`; val = st.carrying ? `${Math.max(0, o.within - st.carryT).toFixed(0)} s` : st.delivered ? '' : 'find it'; break;
          case 'find': label = `Find the hidden ${PIECES[quest.pieces[o.target].t].name.toLowerCase()}`; break;
          case 'collect': label = `Collect ${o.count} power-ups`; val = `${Math.min(st.collected, o.count)}/${o.count}`; break;
          default: break;
        }
        return { label, val, ok: o.ok };
      });
    },
    get done() { return st.done; }, get failed() { return st.failed; }, get time() { return st.t; },
    get left() { return quest.timeLimit ? Math.max(0, quest.timeLimit - st.t) : null; },
    objs,
  };
}
