// The coach's pointers in this device's words (0079). Pure, no DOM: the vocabulary of controls per
// device and scheme, the "how to fly" card's rows, and the one pointer after a run (from the coach's
// fixes, src/sim/coach.js), with "Better: …" once a fix is fixed and never the same pointer more than
// twice in a row. src/main.js reads the device (src/input.js lastDevice) and draws the lines.
//
// ctx: { device: 'touch' | 'key' | 'pad', scheme: 'thumb' | 'classic', tier: 'assist' | 'pro' | 'advanced', course }

// The device a player is on, from src/input.js's lastDevice ('touch' | 'key' | 'pad' | 'mouse' | 'none'):
// a mouse or nothing yet is a desktop, so its keyboard.
import { AIM_LEAN, AIM_THUMB } from './sim/coach.js';

export const deviceOf = (last) => (last === 'touch' ? 'touch' : last === 'pad' ? 'pad' : 'key');

// One control: what to do with what, as a player reads it ("hold Shift", "tap the pad").
const C = {
  key: {
    drive: ['hold', '↑'], steer: ['', '← →'], release: ['press', 'Space'], boost: ['hold', 'F'], land: ['hold', 'Shift'],
    brake: ['hold', 'Space'], brakeAdv: ['hold', 'Space'], roll: ['', '← →'], rollAdv: ['', 'Q+Z or E+C'], stop: ['hold', '↓'], lift: ['hold', 'Space'],
  },
  pad: {
    drive: ['hold', 'RT'], steer: ['', 'the left stick'], release: ['press', 'A'], boost: ['hold', 'RB'], land: ['hold', 'B'],
    brake: ['hold', 'A'], brakeAdv: ['hold', 'A'], roll: ['', 'the left stick'], rollAdv: ['', 'LB or RB'], stop: ['hold', 'LT'], lift: ['hold', 'A'],
  },
  touch: {
    drive: ['hold', 'GO'], steer: ['', 'the stick'], release: ['tap', 'RELEASE'], boost: ['hold', 'BOOST'], land: ['hold', 'LAND'],
    brake: ['hold', 'LIFT'], brakeAdv: ['hold', 'the four down-jet pads'], roll: ['', 'the stick'], rollAdv: ['', 'the side pads'], stop: ['hold', 'BRAKE'], lift: ['hold', 'LIFT'],
  },
  thumb: {
    drive: ['hold', 'the pad'], steer: ['', 'nothing: it holds the line'], release: ['tap', 'the pad'], boost: ['', 'nothing: it carries you'], land: ['hold', 'the pad'],
    brake: ['hold', 'the pad'], brakeAdv: ['hold', 'the pad'], roll: ['hold', 'the pad'], rollAdv: ['hold', 'the pad'], stop: ['', 'nothing: it stops'], lift: ['hold', 'the pad'],
  },
};
const vocab = (ctx) => (ctx.device === 'touch' && ctx.scheme === 'thumb' ? C.thumb : C[ctx.device] || C.key);
// The control alone ("Shift"), and with its verb ("hold Shift").
export const keyOf = (ctx, act) => vocab(ctx)[act][1];
export const ctl = (ctx, act, wrap = (k) => k) => { const [v, k] = vocab(ctx)[act]; return v ? `${v} ${wrap(k)}` : wrap(k); };
// Braking in the air: LAND on Assist (it governs the descent), LIFT by hand on Pro, the down-jets on Advanced.
const brakeAct = (ctx) => (ctx.tier === 'assist' ? 'land' : ctx.tier === 'advanced' ? 'brakeAdv' : 'brake');
const rollAct = (ctx) => (ctx.tier === 'assist' ? 'land' : ctx.tier === 'advanced' ? 'rollAdv' : 'roll');
const thumbOn = (ctx) => ctx.device === 'touch' && ctx.scheme === 'thumb';

// The coach's fixes (src/sim/coach.js) name controls in these words: the control's name and, on a keyboard or
// a pad, its key ("LAND (Shift)", "LAND (B)"); on touch the button itself ("LAND"); one-thumb, the pad. So the
// results' "What happened" says what the how-to card, the cue line and the pointer say, on every device.
// `aim` (0124): how this device walks the touchdown onto the mark, as the pointer's 'mark' line says it.
export function coachWords(ctx) {
  const v = vocab(ctx), adv = ctx.tier === 'advanced';
  if (thumbOn(ctx)) return { land: 'the pad', lift: 'the pad', release: 'the pad', boost: 'the pad', roll: 'the pad', aim: AIM_THUMB };
  if (ctx.device === 'touch') return { land: 'LAND', lift: adv ? v.brakeAdv[1] : 'LIFT', release: 'RELEASE', boost: 'BOOST', roll: adv ? v.rollAdv[1] : v.roll[1], aim: AIM_LEAN };
  const named = (name, act) => `${name} (${v[act][1]})`;
  return { land: named('LAND', 'land'), lift: named('LIFT', 'lift'), release: named('RELEASE', 'release'), boost: named('BOOST', 'boost'), roll: adv ? v.rollAdv[1] : v.roll[1], aim: AIM_LEAN };
}

// The "how to fly" card: the inputs that matter, per phase, on this device. Each row:
// { phase, ctl: the control as shown (a key cap), verb, what }.
export function howtoRows(ctx) {
  const v = vocab(ctx), row = (phase, act, what) => ({ phase, verb: v[act][0], ctl: v[act][1], what });
  if (ctx.course === 'lineup') {
    return [
      row('Drive', 'drive', `Down the runway; ${ctl(ctx, 'steer')} to steer.`),
      row('Lift off', 'lift', 'At the line: the down-jets lift you over the row.'),
      row('Roll', ctx.tier === 'advanced' ? 'rollAdv' : 'roll', 'A full 360° in the air.'),
      row('Land', ctx.tier === 'assist' ? 'land' : brakeAct(ctx), ctx.tier === 'assist' ? 'Levels and brakes for you.' : 'Brake at the BRAKE line on the descent tape.'),
    ];
  }
  if (thumbOn(ctx)) {
    return [
      row('Drive & climb', 'drive', 'Crawls you up the Wall on suction; let go to stop.'),
      row('Let go', 'release', 'On the ledge, upside down, when the cue says.'),
      row('Roll & land', 'land', 'Rolls you out, carries you over the row and levels.'),
      // 0121: the one skill input on one thumb, the touchdown slide (src/onethumb.js, src/thumb-aim.js).
      { phase: 'Aim & brake', verb: 'hold, slide', ctl: 'the pad', what: 'Slide onto the amber dot to hit the mark.' },
    ];
  }
  const assist = ctx.tier === 'assist';
  return [
    row('Drive & climb', 'drive', `Crawl up the Wall, about 20 km/h; ${ctl(ctx, 'steer')} to steer.`),
    row('Let go', 'release', 'On the ledge, upside down, when the cue says.'),
    assist ? { ...row('Roll & land', 'land', `Rolls you out and levels. Over the row, ${ctl(ctx, 'boost')} too.`) }
      : row('Roll out', rollAct(ctx), ctx.tier === 'advanced' ? 'Roll jets: watch the dial, stop early.' : 'Roll upright straight after you let go; stop early.'),
    assist ? row('Brake', 'land', 'Keep holding: it brakes to the ground. Late? It lands for you.')
      : row('Brake', brakeAct(ctx), 'At the BRAKE line on the descent tape, hard.'),
  ];
}
// The pause sheet's lines (0092): the same phases, short ("hold GO"), plus steering where the player
// steers. A touch screen or a pad is never handed the keyboard's key lists; the keyboard keeps them
// (index.html), and the full card is one tap away (How to fly).
export function pauseRows(ctx) {
  const rows = howtoRows(ctx).map((r) => ({ label: r.phase, text: r.verb ? `${r.verb} ${r.ctl}` : r.ctl }));
  if (!thumbOn(ctx) && ctx.device !== 'key') rows.push({ label: 'Steer', text: keyOf(ctx, 'steer') });
  return rows;
}
export const deviceTitle = (ctx) => (thumbOn(ctx) ? 'Touch · one thumb' : ctx.device === 'touch' ? 'Touch · two thumbs' : ctx.device === 'pad' ? 'Gamepad' : 'Keyboard');

// --- The pointer after a run --------------------------------------------------------------------
// One line, the fix that matters most, with this device's control in it. `item`: a coach fix
// ({ id, … }), `flight`: the coach's readFlight (for the numbers), `card`: the run's card.
export function pointerText(id, ctx, flight = null) {
  const b = brakeAct(ctx), assist = ctx.tier === 'assist';
  switch (id) {
    case 'fell-off': return thumbOn(ctx) ? 'Stay on the Wall: hold the pad and let it crawl; let go to stop' : `Crawl up the Wall: ${ctl(ctx, 'drive')} gently, about 20 km/h, small steering`;
    case 'no-release': return `Let go on the ledge: ${ctl(ctx, 'release')} when you’re upside down`;
    case 'early-release': return `Wait for the ledge: ${ctl(ctx, 'release')} only once you’re upside down on it`;
    case 'short': return thumbOn(ctx) ? 'Over the row: hold the pad right after you let go' : `Boost over the row: ${ctl(ctx, 'boost')} right after you let go`;
    case 'no-brake': return assist ? `Brake on the way down: ${ctl(ctx, 'land')} right after you let go` : `Brake on the way down: ${ctl(ctx, b)} at the BRAKE line`;
    case 'late-land': return `Land sooner: ${ctl(ctx, 'land')} right after you let go`;
    case 'late-brake': {
      if (assist) return `Land sooner: ${ctl(ctx, 'land')} right after you let go`;
      const at = flight && flight.needH > 0 ? `, ${Math.ceil(flight.needH)} m up` : '';
      return `Brake sooner: ${ctl(ctx, b)} at the BRAKE line${at}`;
    }
    case 'ran-out': return assist ? `Stay on the brake to the ground: keep ${thumbOn(ctx) ? 'holding the pad' : `holding ${keyOf(ctx, 'land')}`}` : 'Brake once, hard, at the BRAKE line, and stay on it to the ground';
    case 'late-roll': return assist ? `Roll out sooner: ${ctl(ctx, 'land')} straight after you let go` : `Roll out sooner: ${ctl(ctx, rollAct(ctx))} straight after you let go`;
    case 'over-roll': return `Stop the roll early: let go of ${keyOf(ctx, rollAct(ctx))} about 40° before level`;
    case 'no-roll': return assist ? `Roll upright: ${ctl(ctx, 'land')} after you let go` : `Roll upright: ${ctl(ctx, rollAct(ctx))} after you let go`;
    case 'tilt': return assist ? `Level it for the last 2 m: ${ctl(ctx, 'land')} and stop steering` : 'Level it by the dial before the last 2 m';
    case 'mark': return thumbOn(ctx) ? 'Aim for the rings: holding the pad in the air, slide onto the amber dot' : 'Aim for the rings: lean toward the pad above 5 m, then level';
    case 'gas': return 'Save gas: shorter boosts, one hard late brake';
    case 'flipped': return assist ? `Touch down level and slow: ${ctl(ctx, 'land')} all the way down` : 'Touch down level and slow: keep the sink in the green band';
    case 'clean': if (thumbOn(ctx)) return 'Clean. Next: hold in the air and slide onto the amber dot to land on the mark';
      return assist ? 'Clean. Next: a softer touchdown, closer to the mark' : 'Clean. Next: under 1 m/s and the 2 m ring';
    default: return '';
  }
}

// What "fixed" reads as: the number that moved, from the card.
const BETTER = {
  'no-brake': 'sink', 'late-brake': 'sink', 'late-land': 'sink', 'ran-out': 'sink', flipped: 'sink', tilt: 'tilt',
  short: 'clear', 'no-release': 'release', 'early-release': 'release', 'late-roll': 'roll', 'no-roll': 'roll', 'over-roll': 'roll',
  mark: 'mark', gas: 'gas', 'fell-off': 'height',
};
export function betterText(id, card) {
  const f = card?.facts || {};
  switch (BETTER[id]) {
    case 'sink': return `Better: sink ${f.sink} m/s`;
    case 'tilt': return `Better: ${f.tiltDeg}° at touchdown`;
    case 'clear': return f.clearance != null ? `Better: ${f.clearance} m over the roofs` : 'Better: over the row';
    case 'release': return `Better: let go at ${f.launchHeight} m`;
    case 'roll': return `Better: ${Math.max(f.rollDeg || 0, f.pitchDeg || 0)}° roll-out`;
    case 'mark': return `Better: ${f.padMiss} m from the mark`;
    case 'gas': return `Better: ${f.airPct}% gas left`;
    case 'height': return `Better: ${f.height} m up the Wall`;
    default: return '';
  }
}

// Which drill practises a fix, for the third time the same pointer would come up.
const DRILL_FOR = { 'fell-off': 'ledge', 'no-release': 'ledge', 'early-release': 'ledge', short: 'carry', 'no-brake': 'land', 'late-brake': 'land', 'late-land': 'land', 'ran-out': 'land', 'late-roll': 'release', 'no-roll': 'release', 'over-roll': 'release', tilt: 'land', flipped: 'land' };
const DRILL_LABEL = { ledge: 'On the ledge', release: 'Just let go', carry: 'Over the row', land: '10 m up' };

// The pointer after a run. `items`: the coach's fixes (most costly first), `history`: the pointer ids
// shown after the previous runs (most recent last). Returns { id, text, better }: `better` names the
// last pointer's fix, now fixed, with its number; `id` goes on the history.
export function pickPointer(items, ctx, { history = [], card = null, flight = null, crashed = false } = {}) {
  const list = (items || []).filter((it) => pointerText(it.id, ctx, flight));
  const last = history[history.length - 1], prev = history[history.length - 2];
  // Fixed: last time's pointer isn't among this run's fixes, and this run didn't crash.
  const better = last && BETTER[last] && !crashed && !list.some((it) => it.id === last) ? betterText(last, card) : '';
  let pick = list[0] || null;
  // Never the same pointer three times running: the next fix instead, or the drill for it.
  if (pick && pick.id === last && pick.id === prev) {
    const alt = list.find((it) => it.id !== last);
    if (alt) pick = alt;
    else if (DRILL_FOR[pick.id] && ctx.course !== 'lineup') {
      const d = DRILL_FOR[pick.id];
      return { id: `drill:${d}`, text: `Practise just this: Practice → ${DRILL_LABEL[d]}`, better, drill: d };
    }
  }
  if (!pick) return { id: better ? 'better' : '', text: '', better };
  return { id: pick.id, text: pointerText(pick.id, ctx, flight), better };
}

// The live pointer on the cue line, just before the mistake (src/main.js decides the moment from the
// predictor; read-only). One per phase per run. `wrap` dresses the control (the cue line's key cap).
export function livePointer(kind, ctx, wrap = (k) => k) {
  switch (kind) {
    case 'release': return `Let go now: ${ctl(ctx, 'release', wrap)}`;
    case 'land': return `Land now: ${ctl(ctx, 'land', wrap)}`;
    case 'brake': return `Brake now: ${ctl(ctx, brakeAct(ctx), wrap)}`;
    default: return '';
  }
}
