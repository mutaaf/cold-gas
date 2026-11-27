// The coach's pointers in this device's words (0079). Pure, no DOM: the vocabulary of controls per
// device and scheme, the "how to fly" card's rows, and the one pointer after a run (from the coach's
// fixes, src/sim/coach.js), with "Better: …" once a fix is fixed and never the same pointer more than
// twice in a row. src/main.js reads the device (src/input.js lastDevice) and draws the lines.
//
// ctx: { device: 'touch' | 'key' | 'pad', scheme: 'thumb' | 'classic', tier: 'assist' | 'pro' | 'advanced', course }

// The device a player is on, from src/input.js's lastDevice ('touch' | 'key' | 'pad' | 'mouse' | 'none'):
// a mouse or nothing yet is a desktop, so its keyboard.
import { AIM_LEAN, AIM_THUMB, RANOUT_LEAN, RANOUT_THUMB, LINEUP_RUNUP_KMH, LINEUP_LIFT_HOLD, LINEUP_SPEED_SLACK, LINEUP_LIFT_LATE, ringMiss } from './sim/aim-words.js';
import { LANDING, SHOW_MARK_RING, CLEARANCE, SHOW_GAS_FULL, WALL_GAS_FULL, LINEUP_FULL, TIERS, PANEL, SHOW_W, WALL_W, DAMAGE_W } from './sim/judge.js';

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
  if (thumbOn(ctx)) return { drive: 'the pad', land: 'the pad', lift: 'the pad', release: 'the pad', boost: 'the pad', roll: 'the pad', aim: AIM_THUMB, ranOut: RANOUT_THUMB };
  if (ctx.device === 'touch') return { drive: v.drive[1], land: 'LAND', lift: adv ? v.brakeAdv[1] : 'LIFT', release: 'RELEASE', boost: 'BOOST', roll: adv ? v.rollAdv[1] : v.roll[1], aim: AIM_LEAN, ranOut: RANOUT_LEAN };
  const named = (name, act) => `${name} (${v[act][1]})`;
  return { drive: v.drive[1], land: named('LAND', 'land'), lift: named('LIFT', 'lift'), release: named('RELEASE', 'release'), boost: named('BOOST', 'boost'), roll: adv ? v.rollAdv[1] : v.roll[1], aim: AIM_LEAN, ranOut: RANOUT_LEAN };
}

// The "how to fly" card: the inputs that matter, per phase, on this device. Each row:
// { phase, ctl: the control as shown (a key cap), verb, what }.
export function howtoRows(ctx) {
  const v = vocab(ctx), row = (phase, act, what) => ({ phase, verb: v[act][0], ctl: v[act][1], what });
  if (ctx.course === 'lineup' && thumbOn(ctx)) {   // 0181: the Lineup on one thumb
    return [
      row('Drive', 'drive', 'Drives you down the runway; let go to stop.'),
      { phase: 'Lift & roll', verb: 'keep holding', ctl: 'the pad', what: 'At the line it lifts you over the row and rolls 360°. Slide up early on the way for 720°.' },
      row('Land', 'land', 'Levels and brakes for you. Late? It lands for you.'),
      { phase: 'Aim & brake', verb: 'hold, slide', ctl: 'the pad', what: 'Slide onto the amber dot to hit the mark.' },
    ];
  }
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
      // 0188: the computer lands it either way (Assist's auto-land); the pad's hold in the air is the aim (Aim & brake, below; the pad says "Hold · Aim").
      row('Roll & land', 'land', 'Rolls you out and over the row. Late? It lands for you.'),
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
export function pointerText(id, ctx, flight = null, card = null) {
  const b = brakeAct(ctx), assist = ctx.tier === 'assist';
  // 0181: the Lineup on one thumb has no let-go (and a thumb told to "let go" lifts it off the pad): LAND comes on as the roll ends.
  const after = thumbOn(ctx) && ctx.course === 'lineup' ? 'as the roll ends' : 'right after you let go';
  switch (id) {
    case 'fell-off': return thumbOn(ctx) ? 'Stay on the Wall: hold the pad and let it crawl; let go to stop' : `Crawl up the Wall: ${ctl(ctx, 'drive')} gently, about 20 km/h, small steering`;
    // 0189: stopped on the curl before the ledge (a thumb lifted on the climb): the step before the let-go.
    case 'stopped-climb': return thumbOn(ctx) ? 'Climb to the ledge: keep holding the pad until you’re upside down on it' : `Climb to the ledge: ${ctl(ctx, 'drive')} until you’re upside down on it`;
    case 'no-release': return `Let go on the ledge: ${ctl(ctx, 'release')} when you’re upside down`;
    case 'early-release': return `Wait for the ledge: ${ctl(ctx, 'release')} only once you’re upside down on it`;
    case 'short': return thumbOn(ctx) ? 'Over the row: hold the pad right after you let go' : `Boost over the row: ${ctl(ctx, 'boost')} right after you let go`;
    case 'no-brake': return assist ? `Brake on the way down: ${ctl(ctx, 'land')} ${after}` : `Brake on the way down: ${ctl(ctx, b)} at the BRAKE line`;
    case 'late-land': return `Land sooner: ${ctl(ctx, 'land')} ${after}`;
    case 'late-brake': {
      if (assist) return `Land sooner: ${ctl(ctx, 'land')} ${after}`;
      const at = flight && flight.needH > 0 ? `, ${Math.ceil(flight.needH)} m up` : '';
      return `Brake sooner: ${ctl(ctx, b)} at the BRAKE line${at}`;
    }
    // One thumb (0125): the pad is the brake (0164: the slide no longer costs braking).
    case 'ran-out': if (thumbOn(ctx)) return 'Brake to the ground: keep holding the pad all the way down';
      // 0362: on the Lineup, a LAND held with the tanks near empty (the coach's < 25 %) was never the fix: the gas went on
      // the climb. Elsewhere, and with gas left, the brake let go early is still the step.
      if (assist) return ctx.course === 'lineup' && flight?.levelHeld > 0 && flight.gasAtTouch < 25 ? 'Save gas for the brake: spend less of it before the fall' : `Stay on the brake to the ground: keep holding ${keyOf(ctx, 'land')}`;
      return 'Brake once, hard, at the BRAKE line, and stay on it to the ground';
    // 0362: Pro's LIFT held from the line flew the car past the kickflip's height (src/sim/coach.js heldLift).
    case 'held-lift': return `Lift less: ${ctl(ctx, 'lift')} about ${LINEUP_LIFT_HOLD} s at the line, then let go`;
    case 'late-roll': return assist ? `Roll out sooner: ${ctl(ctx, 'land')} straight after you let go` : `Roll out sooner: ${ctl(ctx, rollAct(ctx))} straight after you let go`;
    case 'over-roll': return `Stop the roll early: let go of ${keyOf(ctx, rollAct(ctx))} about 40° before level`;
    case 'no-roll': return assist ? `Roll upright: ${ctl(ctx, 'land')} after you let go` : `Roll upright: ${ctl(ctx, rollAct(ctx))} after you let go`;
    case 'tilt': return assist ? `Level it for the last 2 m: ${ctl(ctx, 'land')} and stop steering` : 'Level it by the dial before the last 2 m';
    case 'mark': if (thumbOn(ctx) && oneTurnLineup(ctx, flight)) return `For Gold: ${LINEUP_CALL}, then hold in the air and slide onto the amber dot`;
      return thumbOn(ctx) ? 'Aim for the rings: holding the pad in the air, slide onto the amber dot' : 'Aim for the rings: lean toward the pad above 5 m, then level';
    case 'gas': return 'Save gas: shorter boosts, one hard late brake';
    case 'flipped': return assist ? `Touch down level and slow: ${ctl(ctx, 'land')} all the way down` : 'Touch down level and slow: keep the sink in the green band';
    // 0367: the Lineup's two wrecks, as the coach's fix says them. The hold decides it; a keyboard, a pad or two thumbs
    // also pace the run-up, so a speed clearly off the band is named with the band (the one-thumb pad paces it, and
    // past the line commits the lift itself). A press that began over LINEUP_LIFT_LATE past the line is named (0370);
    // a run-up and a hold that were both right aren't told to do them again, and a crash never is.
    case 'no-lift': case 'row': {
      const [lo, hi] = LINEUP_RUNUP_KMH, lead = id === 'row' ? 'Over the row' : 'Lift over the roofs';
      if (thumbOn(ctx)) return `${lead}: keep holding the pad through the line`;
      const adv = ctx.tier === 'advanced', lift = ctl(ctx, adv ? 'brakeAdv' : 'lift');
      // 0362: on Assist a press is the lift-off (src/lift-off.js): no hold to time.
      const cmd = ctx.tier === 'assist', then = cmd ? `press ${keyOf(ctx, 'lift')}` : `${lift} about ${LINEUP_LIFT_HOLD} s`;
      const kmh = flight && flight.lineSpeed >= 0 ? Math.round(flight.lineSpeed * 3.6) : -1;
      const off = kmh >= 0 && (kmh < lo - LINEUP_SPEED_SLACK[0] || kmh > hi + LINEUP_SPEED_SLACK[1]);
      // Each number with its unit: src/units.js puts mph beside every one (it reads no ranges).
      if (off) return `${lead}: ${kmh} km/h at the line, aim for ${lo} km/h to ${hi} km/h, then ${then}`;
      if (kmh < 0) return `${lead}: ${lo} km/h to ${hi} km/h at the line, then ${then}`;
      // 0370: a press that began past the line is named, with how far; a crash is never told to fly the same again.
      if (!adv && flight.liftHeld >= 0 && flight.liftAtZ > LINEUP_LIFT_LATE) return `${lead}: press ${keyOf(ctx, 'lift')} on the line, not ${Math.round(flight.liftAtZ * 10) / 10} m past it`;
      if (!adv && (cmd ? flight.liftHeld >= 0 : flight.liftHeld >= LINEUP_LIFT_HOLD - 0.05)) return card?.facts?.crashed ? pointerText('crash', ctx) : `${lead}: the same run-up and ${keyOf(ctx, 'lift')} again`;
      return cmd ? `${lead}: press ${keyOf(ctx, 'lift')} at the line` : `${lead}: ${lift} at the line for about ${LINEUP_LIFT_HOLD} s`;
    }
    case 'crash': return 'Run it again and follow the cues: each one calls its step as you reach it';
    case 'clean': if (thumbOn(ctx)) return thumbClean(ctx, flight, card);
      return cleanLine(ctx, card);
    default: return '';
  }
}

// 0156: one thumb's clean line names the step after this flight. A touchdown inside the mark ring the slide is for
// (3.5 m, the mark Daily's bar, src/daily.js) names its distance and the next step the score shows: on the Show the
// mark costed under the coach's MARK_POINTS (0360: full marks only inside the 2 m ring now, judge.js SHOW_PRECISION; a
// thumb 2.1–3.5 m off is named "mark" once it costs 3 points, ≈ 2.2 m on the Show), so Pro (one thumb is Assist only, and the coach's
// own clean fix is "Try Pro"); the Wall reads the same rings since 0182 (it paid to 0.8 m and named the 2 m ring first). The miss is
// read at the card's 0.1 m (judge.js r1), so the line and the Daily agree at the edges. Short of the ring, the slide.
export const THUMB_MARK_RING = 3.5;
// 0191: on the Lineup one thumb flies one turn unless it calls two (src/onethumb.js LINEUP_TWICE: slid up on the run-up),
// and no 360 reaches its Gold (src/medals.js: 92.5, a 360 tops out at 91.7). So a one-turn flight's next step is the call,
// in the pad's words ("↑ for 720"), before the aim or Pro: the one thing that earns Gold on one thumb. A 720 keeps the
// lines below (the aim, then Pro). Two turns read ≥ 540° on the flight (rollDeg); no flight read: as before.
export const LINEUP_CALL = 'slide up on the run-up for two turns';
function oneTurnLineup(ctx, flight) {
  return ctx.course === 'lineup' && flight != null && Number.isFinite(flight.rollDeg) && flight.rollDeg < 540;
}
function thumbClean(ctx, flight, card = null) {
  const raw = flight?.touch?.padMiss;
  const miss = Math.round(raw * 10) / 10;
  const call = oneTurnLineup(ctx, flight);
  if (!(miss <= THUMB_MARK_RING)) return call ? `Clean. Next: ${LINEUP_CALL}, then slide onto the amber dot` : 'Clean. Next: hold in the air and slide onto the amber dot to land on the mark';
  const d = miss.toFixed(1);
  if (call) return `Clean, ${d} m from the mark. Next: ${LINEUP_CALL}, then aim for the mark`;
  // 0371: a card marked down for missing the 2 m bullseye names the ring, as the coach's clean fix does (coach.js
  // ringMiss), with the card's own distance; Pro is the step only once the mark pays full marks.
  const ring = ringMiss(card);
  if (ring >= 0) return `Clean, ${ring.toFixed(1)} m from the mark: inside the ${SHOW_MARK_RING} m ring pays full marks. Next: slide onto the amber dot`;
  return `Clean, ${d} m from the mark. Next: try Pro and fly the landing yourself`;
}

// 0261: keys, a pad and two thumbs. The clean line names the category with the most points left on this run's card
// (judge.js pointsLeft), with the scorer's own full-marks threshold and this run's number, and never one already at 10.
// With under 0.1 point anywhere a player steers, it says what What happened says (src/sim/coach.js's clean fix: on Assist,
// try Pro). No card (a drill): the scorer's thresholds for the touchdown and the mark.
export const CLEAN_MIN_POINTS = 0.1;
// The categories a player steers on each course (Assist's computer flies the climb, the hang and the roll-out the same
// for everyone; the Lineup's height and roll are the pilot's).
const STEERED = { show: ['clearance', 'landing', 'precision', 'efficiency'], wall: ['landing', 'precision', 'efficiency'], lineup: ['height', 'rotation', 'clearance', 'landing', 'precision', 'efficiency'] };
// The full-marks ring around the mark, per course: the rings' curve on the Show and the Wall, the Lineup's band.
export const markRing = (course) => (course === 'lineup' ? LINEUP_FULL.padMiss : SHOW_MARK_RING);   // 0360: the 2 m bullseye
// The Show's clearance pays full marks between its curve's first and last 1.
const CLEAR_FULL = CLEARANCE.filter(([, v]) => v === 1).map(([x]) => x);
const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
// The touchdown's parts a pilot steers: on Assist LAND levels the car (src/sim/vehicle.js flightComputer: pitch and roll
// to level, so the tilt and the wheels' spread are the computer's), while the sink (when LAND goes on) and the heading
// (the yaw keys; the computer only damps the yaw rate) are the pilot's.
const LANDING_STEERED = { assist: ['sink', 'headingDeg'] };

// What each category could still add to this card's total, had it scored 10 with everything else as flown: the judges'
// own weights, damage share, tier factor and 10 cap (src/sim/judge.js), from the card's categories (read at the card's
// 0.1, so a few hundredths off the exact). A crashed or capped card (crash, no jump, short of the row, the Lineup with
// no full turn) has no headroom to name. Returns { [category]: points of the total }.
export function pointsLeft(card) {
  const c = card?.categories, f = card?.facts;
  if (!c || !f || f.crashed || !f.jumped || f.crossedRow === false) return {};
  const course = card.course || f.course || 'lineup';
  if (course === 'lineup' && f.rotations === 0) return {};
  const W = course === 'show' ? SHOW_W : course === 'wall' ? WALL_W : null;
  const factor = TIERS[card.tier]?.factor || 1;
  const judgeOf = (j, cc) => {
    const w = W ? W[j.id] : j.w;
    let s = 0;
    for (const k of Object.keys(w)) s += w[k] * (cc[k] || 0);
    s = s * (1 - DAMAGE_W[j.id]) + DAMAGE_W[j.id] * (cc.damage ?? 10);
    return Math.min(10, s * factor);
  };
  const base = PANEL.reduce((a, j) => a + judgeOf(j, c), 0);
  const out = {};
  for (const k of Object.keys(W ? W.engineer : PANEL[0].w)) {
    if (!(c[k] < 10)) { out[k] = 0; continue; }
    const up = PANEL.reduce((a, j) => a + judgeOf(j, { ...c, [k]: 10 }), 0);
    out[k] = Math.max(0, ((up - base) * 10) / 3);
  }
  return out;
}
const headingOf = (f, course) => { const h = Math.abs(f.headingDeg || 0); return course !== 'lineup' && h > 90 ? 180 - h : h; };
// Each landing part's share of the landing's 10 lost on this card: { part: lost weight }.
function landingLoss(f, course) {
  const v = { sink: f.sink, tiltDeg: f.tiltDeg, headingDeg: headingOf(f, course), wheelSpreadMs: f.wheelSpreadMs }, out = {};
  for (const k of Object.keys(LANDING)) {
    const [bad, good, w] = LANDING[k], x = v[k];
    out[k] = Number.isFinite(x) ? w * (1 - Math.min(1, Math.max(0, (x - bad) / (good - bad)))) : 0;
  }
  return out;
}
function landingPhrase(f, course, tier) {
  const heading = headingOf(f, course), loss = landingLoss(f, course), parts = LANDING_STEERED[tier] || Object.keys(LANDING);
  let best = null, lost = 0;
  for (const k of parts) if (loss[k] > lost) { lost = loss[k]; best = k; }
  // A bottomed-out suspension costs 45 % of the landing and a body strike 40 %: more than any one part.
  if (f.bottomOut) return 'a touchdown that doesn’t bottom out the suspension';
  if (f.bodyStrike) return 'a touchdown on the wheels, not the body';
  const g = best && LANDING[best][1];
  switch (best) {
    case 'sink': return `a touchdown under ${g} m/s (this one ${n1(f.sink)} m/s)`;
    case 'tiltDeg': return `touch down level, within ${g}° (this one ${n1(f.tiltDeg)}°)`;
    case 'headingDeg': return `touch down straight, within ${g}° of the line (this one ${n1(heading)}°)`;
    case 'wheelSpreadMs': return `all four wheels down within ${g} ms (this one ${Math.round(f.wheelSpreadMs)} ms)`;
    default: return 'a cleaner touchdown';
  }
}
function cleanPhrase(id, f, course, tier) {
  switch (id) {
    case 'clearance': {
      if (course === 'lineup') return `skim the roofs at ${LINEUP_FULL.clearance} m (this one ${n1(f.clearance)} m)`;
      const [lo, hi] = CLEAR_FULL;
      return f.clearance < lo ? `clear the roofs by at least ${lo} m (this one ${n1(f.clearance)} m)` : `cross the roofs within ${hi} m (this one ${n1(f.clearance)} m)`;
    }
    case 'landing': return landingPhrase(f, course, tier);
    case 'precision': return `land within ${markRing(course)} m of the mark (this one ${n1(f.padMiss)} m)`;
    case 'efficiency': return `keep ${course === 'show' ? SHOW_GAS_FULL : course === 'wall' ? WALL_GAS_FULL : LINEUP_FULL.airPct} % of the gas (this one ${Math.round(f.airPct)} %)`;
    case 'height': return `an apex of ${LINEUP_FULL.apex} m (this one ${n1(f.apex)} m)`;
    case 'rotation': return (f.rotations || 0) < 2 ? 'two full turns: a 720' : 'finish the roll exactly on the turn';
    default: return '';
  }
}
// The category this card would gain most from, among those a player steers, or null under CLEAN_MIN_POINTS.
// The landing counts only the share of its points lost in the parts this tier steers (a bottom-out or a body strike is
// always the pilot's: it comes from the sink).
export function cleanTarget(card, course, tier = card?.tier) {
  const left = { ...pointsLeft(card) }, list = STEERED[course] || STEERED.show, f = card.facts;
  const parts = LANDING_STEERED[tier];
  if (parts && left.landing > 0 && !f.bottomOut && !f.bodyStrike) {
    const loss = landingLoss(f, course), all = Object.values(loss).reduce((a, b) => a + b, 0);
    const mine = parts.reduce((a, k) => a + loss[k], 0);
    left.landing = all > 0 ? (left.landing * mine) / all : 0;
  }
  // No number to quote (the Show's clearance unread), or gas the turn scaled down (efficiency × the turn, judge.js):
  // the threshold wouldn't be the whole story, so it isn't named.
  if (!Number.isFinite(f.clearance)) left.clearance = 0;
  const turned = Math.max(f.rollDeg || 0, f.pitchDeg || 0);
  if (course === 'lineup' ? (f.rollDeg || 0) < 330 : turned < 120) left.efficiency = 0;
  let best = null;
  for (const k of list) if ((left[k] || 0) >= CLEAN_MIN_POINTS && (card.categories[k] ?? 10) < 10 && (!best || left[k] > left[best])) best = k;
  return best;
}
function cleanLine(ctx, card) {
  // The card's own tier (what was flown; an Adapt step or the picker may already have moved S.tier), as What happened reads it.
  const course = ctx.course || card?.course || 'show', tier = card?.tier || ctx.tier;
  if (!card || !card.categories || !card.facts) {
    return tier === 'assist' ? `Clean. Next: a touchdown under ${LANDING.sink[1]} m/s, within ${markRing(course)} m of the mark`
      : `Clean. Next: under ${LANDING.sink[1]} m/s and inside the ${markRing(course)} m ring`;
  }
  const k = cleanTarget(card, course, tier);
  if (k) return `Clean. Next: ${cleanPhrase(k, card.facts, course, tier)}`;
  if (tier === 'assist') return `Clean. Next: try Pro and fly the landing yourself (×${TIERS.pro.factor})`;
  if (tier === 'pro') return `Clean. Next: try Advanced, ten valves by hand (×${TIERS.advanced.factor})`;
  return 'Clean. Nothing left on this card the score pays for';
}

// What "fixed" reads as: the number that moved, from the card.
const BETTER = {
  'no-brake': 'sink', 'late-brake': 'sink', 'late-land': 'sink', 'ran-out': 'sink', flipped: 'sink', tilt: 'tilt',
  short: 'clear', 'no-release': 'release', 'early-release': 'release', 'late-roll': 'roll', 'no-roll': 'roll', 'over-roll': 'roll',
  mark: 'mark', gas: 'gas', 'fell-off': 'height', 'stopped-climb': 'height', row: 'clear', 'no-lift': 'clear',
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
// `daily` (0150): the missed Daily's own line (src/daily.js dailyCoach), which stands in for the coach's.
export function pickPointer(items, ctx, { history = [], card = null, flight = null, crashed = false, daily = '' } = {}) {
  const list = (items || []).filter((it) => pointerText(it.id, ctx, flight, card));
  const last = history[history.length - 1], prev = history[history.length - 2];
  // Fixed: last time's pointer isn't among this run's fixes, and this run didn't crash.
  const better = last && BETTER[last] && !crashed && !list.some((it) => it.id === last) ? betterText(last, card) : '';
  if (daily) return { id: 'daily', text: daily, better };
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
  return { id: pick.id, text: pointerText(pick.id, ctx, flight, card), better };
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
