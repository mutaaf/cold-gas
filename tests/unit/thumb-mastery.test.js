// 0121 thumb mastery: the one-thumb touchdown slide (src/onethumb.js) is plain sim input (it replays and
// scores bit-exactly), a thumb that never slides flies exactly as before, a careful slide lands nearer
// the mark and scores more, and no slide, however wild, puts the car on the row. Plus the medals
// (src/medals.js): bars, the next-target line, and storage that may not be there.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage, markOffset, THUMB, AIM_PX_PER_M } from '../../src/onethumb.js';
import { coach } from '../../src/sim/coach.js';
import { coachWords, pickPointer } from '../../src/pointer.js';
import { MEDALS, MEDAL_KEY, thresholds, medalFor, nextMedal, nextTargetText, getMedals, recordRun, _resetMedalCache } from '../../src/medals.js';

// The Show the way main.js flies it: hold up the curl, stop on the ledge, a short tap to let go
// (the drive-off and the push-off), then press and hold in the air; `slide(run, th)` moves the thumb.
// `again` (s, 0165; LESSONS 2026-11-06: the tapped thumb is most phone players): lifted 20 ticks after the tap and
// pressed again that long after it (gtrace.test.js's thumbBurn).
function flyThumb({ slide = null, holdAt = 'tap', course = 'show', again = -1 } = {}) {
  const run = createRun(course), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (tapT > 0 && run.tick === tapT + 24 && holdAt !== 'tap') th.up();
    if (again >= 0 && tapT > 0) {
      if (run.tick === tapT + 20) th.up();
      if (run.tick === tapT + Math.round(again * 240)) th.down();
    }
    if (released && holdAt !== 'tap' && !th.held && c.vel.y < 0 && c.pos.y < holdAt) th.down();
    if (slide && released && run.phase === 'air' && th.held) slide(run, th);
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  run.tapT = tapT;   // 0177: when the ledge tap was
  return run;
}
// A careful thumb: on the sight's dot, re-read every 0.3 s (the pad's own markOffset).
function careful() {
  const pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
  let next = 0, want = null;
  return (run, th) => {
    if (run.tick >= next) {
      predict(run.car, Math.max(0, run.car.pos.y - SPEC.comHeight), pr);
      markOffset(run.car, pr, 'show', off, th.ref, th.refA, th.canA);
      want = { x: off.x, y: -off.y };
      next = run.tick + 72;
    }
    th.move(want.x, want.y);
  };
}
const pitchRoll = (run) => run.inputLog.some((e) => e[4] !== 0 || e[5] !== 0);   // [tick, throttle, brake, steer, pitch, roll, …]

describe('one-thumb touchdown slide (0121)', () => {
  it('a thumb that never slides writes no pitch or roll (it flies as before)', () => {
    const run = flyThumb({ holdAt: 12 });
    expect(pitchRoll(run)).toBe(false);
    const s = scoreRun(run.t);
    expect(s.facts.crashed).toBe(false);
    expect(s.facts.padMiss).toBeGreaterThan(4);   // the computer's touchdown, off the mark
  });

  it('a careful slide onto the dot lands nearer the mark and scores no less, and replays bit-exactly', () => {
    const base = scoreRun(flyThumb({ holdAt: 12 }).t);
    const run = flyThumb({ holdAt: 12, slide: careful() });
    const s = scoreRun(run.t);
    expect(pitchRoll(run)).toBe(true);
    expect(s.facts.crashed).toBe(false);
    expect(s.facts.padMiss).toBeLessThan(base.facts.padMiss - 0.5);
    expect(s.total).toBeGreaterThanOrEqual(base.total);
    const again = simulate(run.inputLog, 'show');   // the Worker's path
    expect(again.car.pos).toEqual(run.car.pos);
    expect(scoreRun(again.t).total).toBe(s.total);
  });

  it('no held slide, however wild, lands on the row or rolls it', () => {
    for (const [x, y] of [[60, 0], [-60, 0], [0, 60], [0, -60], [60, 60], [-60, -60], [60, -60], [-60, 60]]) {
      for (const [holdAt, again] of [['tap', -1], [12, -1], ['tap', 1], ['tap', 2]]) {   // 0164: and the tapped thumb
        const s = scoreRun(flyThumb({ holdAt, again, slide: (run, th) => th.move(x, y) }).t);
        expect(s.facts.contact, `${x},${y} ${holdAt} ${again}`).toBe(false);
        expect(s.facts.crashed, `${x},${y} ${holdAt} ${again}`).toBe(false);
        expect(s.facts.clearance, `${x},${y} ${holdAt} ${again}`).toBeGreaterThan(0);   // 0165: shorter never brings it down on a roof
      }
    }
  });

  it('the slide never flies the car upside down or into the set-down', () => {
    const run = createRun('show'), th = createOneThumb(), inp = newInput();
    th.down(); th.move(48, 48);
    run.phase = 'air'; run.t.crossedRow = true;
    run.car.pos.z = -32; run.car.pos.y = 6;
    run.car.quat.w = 0; run.car.quat.z = 1;   // inverted
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
    run.car.quat.w = 1; run.car.quat.z = 0;   // upright: the roll (0164: a place, flown) toward it, never past a full one
    // 0165: along the run the slide is a place once the brake has turned the fall (the sink 0.5 m/s past its peak):
    // a pitch toward it, further (+), never past a full one.
    run.car.vel.y = -12; Object.assign(inp, newInput()); th.sample(run, true, inp);
    run.car.vel.y = -9;
    // 0164: sideways the place is taken once it has held still for 0.2 s (two 0.1 s windows); before that, nothing.
    Object.assign(inp, newInput());
    th.sample(run, true, inp);
    expect(inp.roll).toBe(0);
    for (let i = 0; i < 48; i++) { Object.assign(inp, newInput()); th.sample(run, true, inp); }
    expect(inp.pitch).toBeGreaterThan(0); expect(inp.pitch).toBeLessThanOrEqual(THUMB.aimPitch + 1e-9);
    expect(inp.roll).toBeGreaterThan(0.05); expect(inp.roll).toBeLessThanOrEqual(THUMB.aimRoll + 1e-9);
    run.car.pos.y = SPEC.comHeight + THUMB.aimFloor - 0.1;   // the last metre: level
    Object.assign(inp, newInput());
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
  });

  it('a slide inside the dead zone moves nothing (a resting thumb keeps LAND\'s line hold)', () => {
    const run = createRun('show'), th = createOneThumb(), inp = newInput();
    th.down(); th.move(THUMB.aimPx * THUMB.aimDead * 0.9, -THUMB.aimPx * THUMB.aimDead * 0.9);
    run.phase = 'air'; run.t.crossedRow = true; run.car.pos.z = -32; run.car.pos.y = 6;
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
    expect(th.aim.x).toBe(0);
  });
});

// 0164 (critique 2026-11-05-1300 §1, sharpened 2026-11-06-0400 §2): a held sideways slide was a roll held open for 3 s,
// so the touchdown swung ±3 m every 2 px and the wrong way half the time (+12 px: 9.8 m off; the dot's own +36 px: a
// Rough landing 16.9 m off; −12 px: 17.9 m off; the Wall +12 px went 10 m right). Now it is a place: X px moves the
// touchdown about X / 6 m the way slid, inside the pad's outer ring, flown by LAND's own hold-the-line law.
describe('one thumb, a held sideways slide moves the touchdown the way it points, more for more (0164)', () => {
  // Held from the tap, slid sideways by `px` (and held) from the release.
  const held = (course, px) => {
    const run = flyThumb({ course, slide: (r, th) => th.move(px, 0) });
    return { run, card: scoreRun(run.t) };
  };
  const sweep = (course, step) => {
    const rows = [];
    for (let px = -48; px <= 48; px += step) rows.push({ px, ...held(course, px) });
    return rows;
  };
  const monotonic = (rows, label) => {
    let top = -Infinity;
    for (const { px, run } of rows) {
      expect(run.t.lateral, `${label} ${px} px`).toBeGreaterThanOrEqual(top - 0.3);
      top = Math.max(top, run.t.lateral);
    }
  };

  it('the Show, −48 … +48 px in 2 px steps: monotonic, on the pad (≤ 8 m), no Rough landing, no contact', () => {
    const rows = sweep('show', 2), none = rows.find((r) => r.px === 0).run.t.lateral;
    monotonic(rows, 'show');
    for (const { px, run, card } of rows) {
      expect(card.facts.padMiss, `${px} px`).toBeLessThanOrEqual(8);
      expect(card.verdict, `${px} px`).not.toBe('Rough landing');
      expect(card.facts.contact, `${px} px`).toBe(false);
      expect(card.facts.crashed, `${px} px`).toBe(false);
    }
    // More for more, about AIM_PX_PER_M px a metre where the pad leaves room: ±8 … +24 px move it 0.5–1.5 × X / 6 m.
    for (const px of [-8, 8, 16, 24]) {
      const moved = rows.find((r) => r.px === px).run.t.lateral - none;
      expect(moved / (px / AIM_PX_PER_M), `${px} px`).toBeGreaterThan(0.5);
      expect(moved / (px / AIM_PX_PER_M), `${px} px`).toBeLessThan(1.5);
    }
  }, 240000);

  it('the Wall, −48 … +48 px in 4 px steps: monotonic and in proportion, no contact', () => {
    const rows = sweep('wall', 4), none = rows.find((r) => r.px === 0).run.t.lateral;
    monotonic(rows, 'wall');
    for (const { px, card } of rows) expect(card.facts.contact, `${px} px`).toBe(false);
    for (const px of [-8, -16, -24, -48]) {
      const moved = rows.find((r) => r.px === px).run.t.lateral - none;
      expect(moved / (px / AIM_PX_PER_M), `${px} px`).toBeGreaterThan(0.5);
      expect(moved / (px / AIM_PX_PER_M), `${px} px`).toBeLessThan(1.5);
    }
  }, 240000);

  it('a full slide let back to the middle 10 m or 5 m up comes back to the computer\'s touchdown, on the pad', () => {
    // (Self-review: re-reading `ref` mid-drift and handing back to LAND's 0.2 rad hold put this 8.9 m wide, off the ring.)
    const none = held('show', 0).run.t.lateral;
    for (const px of [-48, 48]) for (const hc of [10, 5]) {
      const run = flyThumb({ slide: (r, th) => th.move(r.car.pos.y - SPEC.comHeight > hc ? px : 0, 0) });
      const card = scoreRun(run.t);
      // 0190: ≤ 1 → ≤ 1.5 m. LAND's hold now keeps flying down to 1.5 m, and a full slide let back at 10 m hands it a car still
      // carrying the slide's drift: −48 px centred at 10 m lands 1.32 m from no slide (the refit τ that met 1 m there, 1.5 s,
      // put the 5 m line 1.33 m off). Still inside the 2 m ring of no slide.
      expect(Math.abs(run.t.lateral - none), `${px} px, centred at ${hc} m`).toBeLessThanOrEqual(1.5);
      expect(card.facts.padMiss, `${px} px, centred at ${hc} m`).toBeLessThanOrEqual(7);
      expect(card.facts.contact).toBe(false);
    }
  }, 120000);

  // Critic re-review 2026-11-06 16:00 (bounce) and 2026-11-09 15:40: the tapped thumb (tap, lift at +20 ticks, press again
  // 1.0–2.5 s after the tap; most phone thumbs) slid the wrong way: Show +8 px landed 3.7 m left of no slide, Wall −12 px
  // 3.8 m right. `ref` was taken on the first roof-up tick, while the tapped car is still rolling out and drifting (13.3 m
  // against the ≈9 it reaches), and on the Show an inward slide kept that stale place through its wait for the semi.
  // Now the place is taken only once it has held still for 0.2 s and the slide can act on it.
  const tapped = (course, px, again) => flyThumb({ course, again, slide: (r, th) => th.move(px, 0) }).t;
  for (const course of ['show', 'wall']) {
    it(`the tapped thumb on the ${course === 'show' ? 'Show' : 'Wall'}, pressed again 1.0–2.5 s after the tap, −48 … +48 px: monotonic, never the wrong way`, () => {
      for (const again of [1, 1.5, 2, 2.5]) {
        const rows = [];
        for (let px = -48; px <= 48; px += 8) {
          const t = tapped(course, px, again), card = scoreRun(t), label = `${course} again ${again} s, ${px} px`;
          expect(card.facts.contact, label).toBe(false);
          expect(card.verdict, label).not.toBe('Rough landing');
          rows.push({ px, lat: t.lateral, label });
        }
        let top = -Infinity;
        for (const { lat, label } of rows) { expect(lat, label).toBeGreaterThanOrEqual(top - 0.3); top = Math.max(top, lat); }
        const none = rows.find((r) => r.px === 0).lat;
        for (const { px, lat, label } of rows) {
          // A slide that can't move it (the ring's clamp, a wait) leaves it where no slide does, never the other way.
          if (px > 0) expect(lat, label).toBeGreaterThanOrEqual(none - 0.3);
          if (px < 0) expect(lat, label).toBeLessThanOrEqual(none + 0.3);
        }
        // The Wall's right side is already past the ring's clamp; left, a slide has to act (not merely not go wrong).
        // 0190: from 1.0 to 2.0 s. Pressed again 2.5 s after the tap the car is ≈ 7.7 m up with LAND's brake on and its hold now
        // taking the drift off itself: −24 px moves it 0.27 m (−48 px 0.48 m); the bar above (never the wrong way) still holds.
        if (course === 'wall' && again <= 2) expect(rows.find((r) => r.px === -24).lat, `wall again ${again} s, −24 px`).toBeLessThanOrEqual(none - 1);
        if (course === 'show') for (const px of [8, 16, 24]) {
          const moved = rows.find((r) => r.px === px).lat - none;
          expect(moved / (px / AIM_PX_PER_M), `show again ${again} s, ${px} px`).toBeGreaterThan(0.5);
          expect(moved / (px / AIM_PX_PER_M), `show again ${again} s, ${px} px`).toBeLessThan(1.5);
        }
      }
    }, 300000);
  }

  // The sight as the pad draws it (src/thumb-aim.js: markOffset from the thumb's own `ref`).
  const sightNow = (run, th, course, pr, off) => {
    predict(run.car, Math.max(0, run.car.pos.y - SPEC.comHeight), pr);
    return markOffset(run.car, pr, course, off, th.ref, th.refA, th.canA);
  };
  it('a slide held where the sight puts the dot at its first frame lands ≤ 3.5 m from the mark (the mark Daily)', () => {
    for (const course of ['show', 'wall']) {
      const pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
      let want = null;
      const run = flyThumb({ course, slide: (r, th) => {
        if (!want && th.aimLive) { sightNow(r, th, course, pr, off); want = { x: off.x, y: -off.y }; }
        if (want) th.move(want.x, want.y);
      } });
      const card = scoreRun(run.t);
      expect(want, course).not.toBe(null);
      expect(card.facts.padMiss, course).toBeLessThanOrEqual(3.5);
      expect(card.facts.contact, course).toBe(false);
    }
  }, 120000);

  it('a thumb that re-reads the dot 0.2–0.3 s late lands ≤ 3.5 m from the mark', () => {
    for (const course of ['show', 'wall']) for (const late of [48, 60, 70]) {
      const pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
      let next = 0, pend = null, at = 0, want = null;
      const run = flyThumb({ course, slide: (r, th) => {
        if (th.ref === th.ref && r.tick >= next) { sightNow(r, th, course, pr, off); pend = { x: off.x, y: -off.y }; at = r.tick + late; next = r.tick + 72; }
        if (pend && r.tick >= at) { want = pend; pend = null; }
        if (want) th.move(want.x, want.y);
      } });
      const card = scoreRun(run.t);
      expect(card.facts.padMiss, `${course} ${late}`).toBeLessThanOrEqual(3.5);
      expect(card.facts.contact, `${course} ${late}`).toBe(false);
    }
  }, 180000);
});

// 0177 (critique 2026-11-09-2150 §1): on the Wall the tapped thumb (pressed again in the air) came roof up 14 m up and
// falling at 16 m/s, still banked, so its sideways place read the fall as drift and the settle waited until 4 m up: its
// slide first acted 2.5–2.9 s after the tap (held: 1.9 s), and −24 and −48 px landed in the same place, 3.3–3.7 m from no
// slide. Now that hold reads the place with the fall taken out and acts on its first roof-up tick.
describe('on the Wall, a tapped thumb\'s slide acts as early as a held one\'s, and a full slide reaches (0177)', () => {
  const firstRoll = (run) => {   // s after the tap: [tick, throttle, brake, steer, pitch, roll, …]
    const e = run.inputLog.find((r) => r[0] > run.tapT && r[5] !== 0);
    return e ? (e[0] - run.tapT) / 240 : Infinity;
  };
  const fly = (px, again) => flyThumb({ course: 'wall', again, slide: (r, th) => th.move(px, 0) });
  it('pressed again at 0.75, 1.0, 1.5 and 2.0 s: the first roll ≤ 0.3 s after the held thumb\'s, and −48 px moves ≥ 1.6× −24 and ≥ 6 m, inside the 7 m ring', () => {
    const held = firstRoll(fly(-48, -1));
    expect(held).toBeLessThan(2);   // 1.90 s
    for (const again of [0.75, 1, 1.5, 2]) {
      const none = fly(0, again).t.lateral, half = fly(-24, again), full = fly(-48, again), label = `again ${again} s`;
      expect(firstRoll(full), label).toBeLessThanOrEqual(held + 0.3);
      const mHalf = none - half.t.lateral, mFull = none - full.t.lateral;
      expect(mFull, label).toBeGreaterThanOrEqual(1.6 * mHalf);
      expect(mFull, label).toBeGreaterThanOrEqual(0.75 * 8);
      for (const r of [half, full]) {
        expect(Math.abs(r.t.lateral), label).toBeLessThanOrEqual(7);   // the pad's outer ring (src/sim/courses.js)
        const card = scoreRun(r.t);
        expect(card.facts.contact, label).toBe(false);
        expect(card.verdict, label).not.toBe('Rough landing');
      }
    }
  }, 240000);

  it('pressed again at 0.75 s (the line the 0164 sweep doesn\'t fly): −48 … +48 px in 8 px steps, monotonic and never the wrong way', () => {
    const rows = [];
    for (let px = -48; px <= 48; px += 8) rows.push({ px, lat: fly(px, 0.75).t.lateral });
    const none = rows.find((r) => r.px === 0).lat;
    let top = -Infinity;
    for (const { px, lat } of rows) {
      expect(lat, `${px} px`).toBeGreaterThanOrEqual(top - 0.3);
      top = Math.max(top, lat);
      if (px > 0) expect(lat, `${px} px`).toBe(none);   // past the ring already: an outward slide leaves LAND's hold be (review: it pulled 0.26 m in)
      if (px < 0) expect(lat, `${px} px`).toBeLessThanOrEqual(none + 0.3);
    }
  }, 120000);

  it('a slide let back to the middle keeps what it moved, the way slid, never the other way (review)', () => {
    // Slid from its first aimable tick for 0.1–0.6 s, then centred: LAND's own hold from there, not a fly to the estimate.
    for (const again of [0.75, 1, 1.5]) {
      const none = fly(0, again).t.lateral;
      for (const ticks of [24, 72, 144]) {
        let live = -1;
        const run = flyThumb({ course: 'wall', again, slide: (r, th) => { if (live < 0 && th.aimLive) live = r.tick; th.move(live >= 0 && r.tick - live < ticks ? -48 : 0, 0); } });
        expect(run.t.lateral, `again ${again} s, ${ticks} ticks`).toBeLessThanOrEqual(none + 0.05);
        expect(scoreRun(run.t).facts.contact).toBe(false);
      }
    }
  }, 120000);

  // 0182 (critique 2026-11-10-0950 §2): the slide that finds the Wall's mark earned +1.3–2.0 points (the Wall read its
  // mark on a line from 1 to 20 m, at precision weights 0.16 · 0.06 · 0.14). It now shows in the score.
  it('pressed again at 1.25 and 2.25 s: the best slide in −48 … 0 px scores ≥ 5 points more than no slide (0182)', () => {
    for (const again of [1.25, 2.25]) {
      const none = scoreRun(fly(0, again).t).total;
      let best = -Infinity;
      for (let px = -48; px < 0; px += 8) best = Math.max(best, scoreRun(fly(px, again).t).total);
      expect(best - none, `again ${again} s: none ${none}, best ${best}`).toBeGreaterThanOrEqual(5);
    }
    // And the coach weighs a Wall miss inside 7 m by what it cost, as on the Show (it named only misses past 7 m).
    const run = fly(-16, 2.25), card = scoreRun(run.t);   // 0190: −16 px (6.2 m); −40 px now lands 2.9 m, inside the 4 m ring
    expect(card.facts.padMiss).toBeGreaterThan(4); expect(card.facts.padMiss).toBeLessThanOrEqual(7);
    expect(coach(run.inputLog, 'wall', card).items.map((i) => i.id)).toContain('mark');
  }, 180000);

  it('the held Wall thumb and the tapped Show thumb fly the logs pinned here (0177; re-pinned for 0190)', () => {
    // A slide held from the tap on the Wall, and a tapped thumb on the Show: the logs 0164 shipped (#282) still come out.
    const wall = fly(-24, -1), show = flyThumb({ again: 1.5, slide: (r, th) => th.move(-24, 0) });
    // 0190 re-pinned: the Wall's computer now aims along the run (its pitch from the brake) and LAND's hold flies on to
    // 1.5 m, so these logs changed on purpose (1.9 s, +0.6 m and −6.2 m before). They pin today's flights.
    expect(firstRoll(wall)).toBeCloseTo(1.8, 1);
    expect(wall.t.lateral).toBeCloseTo(2.1, 1);
    expect(show.t.lateral).toBeCloseTo(-6.6, 1);
  }, 60000);
});

// 0190 (critique 2026-11-10-2130 §3): on the Wall the thumb that did what the pad says set down 11.0–11.4 m off the mark,
// 4 m outside the outer ring (landZ −17 to −19 against the pad's −9; `t.lateral` +6.1 to +7.2). The one-thumb's computer
// now flies its along-run touchdown onto the mark as the reference does, and LAND's line hold, once it has rolled the car
// out of the release, keeps taking the roll's sideways drift off through the set-down (no longer off below 4 m).
describe('on the Wall, the thumb that does what the pad says lands inside the painted rings (0190)', () => {
  const PATTERNS = [['held from the tap', {}], ['tapped, never pressed again', { holdAt: -99 }], ['pressed again 0.5 s', { again: 0.5 }], ['pressed again 1.0 s', { again: 1 }], ['pressed again 2.0 s', { again: 2 }]];
  it('every no-slide flight: ≤ 7 m from the mark, Clean or better, set down on the reveal\'s numbers', () => {
    for (const [label, o] of PATTERNS) {
      const run = flyThumb({ course: 'wall', ...o }), card = scoreRun(run.t), t = run.t;
      expect(card.facts.padMiss, label).toBeLessThanOrEqual(7);
      expect(['Perfect 10', 'Stuck it', 'Clean'], label).toContain(card.verdict);
      expect(card.facts.crashed, label).toBe(false);
      expect(card.facts.damagePct, label).toBe(0);
      expect(t.sink, label).toBeLessThanOrEqual(1.3);
      const air = (t.touchTick - t.airStartTick) / 240;   // off the ledge → wheels down (the reveal: ≈ 4.5 s)
      expect(air, label).toBeGreaterThanOrEqual(4.1);
      expect(air, label).toBeLessThanOrEqual(4.95);
    }
  }, 60000);
});

// 0165 (critique 2026-11-05-1300 §2): on the Show the pitch was gated until the row was 2.5 m behind, a few ticks under
// 2.5 m up, so a slide straight up or down did nothing (landZ −32.7 for none, ±12, ±24, +36 px) while the sight drew the
// mark 2.7 m short. Now along the run the slide is a place too, from when the brake turns the fall: up = further,
// down = shorter (never onto the row: shorter waits for room past the roofs it would cross), and the sight draws the
// mark along the run only as far as the slide can act.
describe('on the Show, sliding up or down moves the touchdown along the run, as the sight draws it (0165)', () => {
  const PAD_Z = -30;
  const along = (run) => PAD_Z - run.t.landZ;   // + = the touchdown is past the mark (further along the run)
  const fly = (y, again = -1) => {
    const run = flyThumb({ again, slide: (r, th) => th.move(0, y) });
    return { run, card: scoreRun(run.t) };
  };
  const safe = (card, label) => {
    expect(card.facts.contact, label).toBe(false);
    expect(card.facts.crashed, label).toBe(false);
    expect(card.facts.clearance, label).toBeGreaterThan(0);
    expect(card.verdict, label).not.toBe('Rough landing');
  };

  it('held from the tap: ±24 px moves the touchdown ≥ 1.5 m the way slid, on the pad, clear of the row', () => {
    const none = fly(0), short = fly(-24), long = fly(24);
    for (const [r, l] of [[none, '0'], [short, '-24'], [long, '+24']]) safe(r.card, l);
    expect(along(short.run), 'down = shorter').toBeLessThanOrEqual(along(none.run) - 1.5);
    expect(along(long.run), 'up = further').toBeGreaterThanOrEqual(along(none.run) + 1.5);
    expect(Math.abs(short.run.t.landZ - PAD_Z), 'shorter lands nearer the mark').toBeLessThan(Math.abs(none.run.t.landZ - PAD_Z));
  }, 60000);

  it('the tapped thumb, pressed again at 1.0 … 2.5 s: −48 … +48 px in steps of 8 are monotonic along the run, ±24 px move ≥ 1.5 m', () => {
    for (const again of [1, 1.5, 2, 2.5]) {
      let top = -Infinity, none = NaN;
      const at = {};
      for (let y = -48; y <= 48; y += 8) {
        const { run, card } = fly(y, again), a = along(run), label = `again ${again} s, ${y} px`;
        safe(card, label);
        // ≤ 8 m: the along clamp is 1-D like 0164's sideways one, and the tapped touchdown is already ≈6 m wide, so a full
        // straight-up slide (+48) reaches 7.0–7.4 m. Kept: a 2-D clamp on predict's sideways miss blocked +24 outright.
        expect(card.facts.padMiss, label).toBeLessThanOrEqual(8);
        expect(a, label).toBeGreaterThanOrEqual(top - 0.3);
        top = Math.max(top, a);
        at[y] = a;
        if (y === 0) none = a;
      }
      expect(at[-24], `again ${again} s, −24 px`).toBeLessThanOrEqual(none - 1.5);
      expect(at[24], `again ${again} s, +24 px`).toBeGreaterThanOrEqual(none + 1.5);
    }
  }, 300000);

  it('a thumb that never slides up or down flies exactly as before (no pitch in the log)', () => {
    for (const again of [-1, 1.5]) {
      const run = flyThumb({ again, slide: (r, th) => th.move(24, 0) });
      expect(run.inputLog.some((e) => e[4] !== 0), `again ${again}`).toBe(false);
    }
  }, 60000);

  // Held from the tap (the ticket's thumb): ≤ 2 m (main: 2.0). Tapped and pressed again: ≤ 2.5 m (main: 2.0–3.1; the
  // again-at-1 s line lands 2.1–2.4, its along-run window opening only once the car is off the semi).
  it('a thumb that re-reads the dot 0.2–0.3 s late lands nearer the mark, held or tapped', () => {
    for (const again of [-1, 1, 1.5, 2.5]) for (const late of [48, 60, 70]) {
      const pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
      let next = 0, pend = null, at = 0, want = null;
      const run = flyThumb({ again, slide: (r, th) => {
        if (th.ref === th.ref && r.tick >= next) {
          predict(r.car, Math.max(0, r.car.pos.y - SPEC.comHeight), pr);
          markOffset(r.car, pr, 'show', off, th.ref, th.refA, th.canA);
          pend = { x: off.x, y: -off.y }; at = r.tick + late; next = r.tick + 72;
        }
        if (pend && r.tick >= at) { want = pend; pend = null; }
        if (want) th.move(want.x, want.y);
      } });
      const card = scoreRun(run.t), label = `again ${again} s, ${late} ticks late`;
      safe(card, label);
      // 0190: held ≤ 2 → ≤ 2.2 m (2.1 at 48–60 ticks late; every τ from 1.3 to 1.5 s read 2.0–2.1). Still a full precision mark.
      expect(card.facts.padMiss, label).toBeLessThanOrEqual(again < 0 ? 2.2 : 2.5);
    }
  }, 300000);

  it('the sight draws the mark along the run only where the slide can act on it', () => {
    // markOffset itself: without canA it draws nothing along, and the miss is still the whole miss.
    const run = createRun('show'), pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
    run.car.pos.z = -20; run.car.pos.y = 6;
    run.car.quat.x = 0; run.car.quat.y = 1; run.car.quat.z = 0; run.car.quat.w = 0;   // nose along the run (−z), as in the air
    pr.landX = 0; pr.landZ = -34;   // the touchdown 4 m past the mark: the mark is shorter (y > 0, down the glass)
    expect(markOffset(run.car, pr, 'show', off, NaN, NaN, true).y).toBeCloseTo(24, 6);
    expect(markOffset(run.car, pr, 'show', off, NaN, NaN, false).y).toBe(0);
    expect(off.m).toBeCloseTo(4, 6);
    expect(markOffset(run.car, pr, 'show', off, NaN, 31, true).y).toBeCloseTo(6, 6);   // laid out from refA (m along the nose: 1 m past the mark), not pr
    // In flight, held and tapped: before the brake turns the fall, and over a roof, the sight draws nothing along (nothing
    // could act), and every pitch the thumb writes is on a tick the sight drew it.
    // Self-review: once open it stays open (an edge read each tick made the dot blink 10 px and back), and the thumb writes
    // no pitch on a tick it couldn't act.
    for (const again of [-1, 1, 1.5]) {
      let seenOff = false, seenOn = false, wasOn = false, opened = Infinity;
      const run = flyThumb({ again, slide: (r, th) => {
        predict(r.car, Math.max(0, r.car.pos.y - SPEC.comHeight), pr);
        markOffset(r.car, pr, 'show', off, th.ref, th.refA, th.canA);
        if (!th.canA) { seenOff = true; expect(off.y).toBe(0); expect(wasOn, `again ${again}: closed again at ${r.tick}`).toBe(false); } else {
          seenOn = true; wasOn = true; opened = Math.min(opened, r.tick - 1);   // the hook runs before this tick's sample
        }
        th.move(0, -24);
      } });
      expect(seenOff, `again ${again}`).toBe(true);
      expect(seenOn, `again ${again}`).toBe(true);
      expect(scoreRun(run.t).facts.contact).toBe(false);
      // No pitch before it opened ([tick, throttle, brake, steer, pitch, …]).
      expect(run.inputLog.filter((e) => e[4] !== 0 && e[0] < opened), `again ${again}`).toEqual([]);
    }
  }, 60000);
});

// A localStorage stand-in for Node.
function fakeStorage({ throws = false } = {}) {
  const m = new Map();
  return { getItem: (k) => { if (throws) throw new Error('denied'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (throws) throw new Error('denied'); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), _m: m };
}

// 0156: the critic's sheet (2026-11-05 §3): a thumb that slides onto the dot and holds lands ≤ 3.5 m, a Perfect 10
// on run 1, and the sheet told it to slide onto the dot. NEXT RUN and the coach's first item now name one next step.
describe('one thumb, a landing on the mark: the sheet names the next step (0156)', () => {
  it('the held +24 px slide (Perfect 10, ≤ 3.5 m): NEXT RUN and What happened agree on Pro', () => {
    const run = flyThumb({ slide: (r, th) => th.move(24, 0) });
    const card = scoreRun(run.t);
    expect(card.facts.crashed).toBe(false);
    expect(card.facts.padMiss).toBeLessThanOrEqual(3.5);
    const ctx = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' };
    const c = coach(run.inputLog, 'show', card, 0, coachWords(ctx));
    expect(c.items[0].id).toBe('clean');
    const p = pickPointer(c.items, ctx, { card, flight: c.flight });
    expect(p.id).toBe('clean');
    expect(p.text).not.toMatch(/slide onto the amber dot/);
    expect(p.text).toMatch(new RegExp(`^Clean, ${card.facts.padMiss.toFixed(1)} m from the mark`));
    expect(c.items[0].fix).toMatch(/Try Pro/);
    expect(p.text).toMatch(/try Pro/);
  });
});

describe('medals (0121)', () => {
  beforeEach(() => { globalThis.localStorage = fakeStorage(); _resetMedalCache(); });

  it('bars rise bronze → silver → gold for every event and tier, and gold is under 100', () => {
    for (const c of Object.keys(MEDALS)) for (const t of ['assist', 'pro', 'advanced']) {
      const th = thresholds(c, t);
      expect(th.bronze).toBeLessThan(th.silver);
      expect(th.silver).toBeLessThan(th.gold);
      expect(th.gold).toBeLessThan(100);
    }
    // Pro and Advanced ask more than Assist, on every event (0191 moved the Lineup's Assist gold: it stays under Pro's).
    for (const c of Object.keys(MEDALS)) for (const k of ['bronze', 'silver', 'gold']) {
      expect(thresholds(c, 'pro')[k], `${c} ${k}`).toBeGreaterThan(thresholds(c, 'assist')[k]);
      expect(thresholds(c, 'advanced')[k], `${c} ${k}`).toBeGreaterThan(thresholds(c, 'pro')[k]);
    }
  });

  it('a never-slide one-thumb run is bronze on the Show, and the reference flight is gold', () => {
    expect(medalFor('show', 'assist', 83.7)).toBe('bronze');   // the never-aiming median (v27)
    expect(medalFor('show', 'assist', 97.7)).toBe('gold');     // the reference
    expect(medalFor('show', 'assist', 50)).toBe(null);
  });

  it('the next-target line reads "Silver at 90 · 3.2 to go"', () => {
    const { silver } = thresholds('show', 'assist');
    expect(nextTargetText('show', 'assist', 87.8, 87.8)).toBe(`Silver at ${silver} · ${(silver - 87.8).toFixed(1)} to go`);
    expect(nextMedal('show', 'assist', 99)).toBe(null);
    expect(nextTargetText('show', 'assist', 99)).toMatch(/Gold held/);
  });

  it('keeps the best per event and tier on this device, and says when a medal is new', () => {
    expect(getMedals('show', 'assist').best).toBe(null);
    let r = recordRun('show', 'assist', 88);
    expect(r.isNew).toBe(true); expect(r.after.medal).toBe('bronze');
    r = recordRun('show', 'assist', 80);
    expect(r.isNew).toBe(false); expect(r.after.best).toBe(88);
    r = recordRun('show', 'assist', 95.4);
    expect(r.after.medal).toBe('gold'); expect(r.isNew).toBe(true);
    expect(getMedals('show', 'pro').best).toBe(null);   // tiers apart
    expect(JSON.parse(globalThis.localStorage.getItem(MEDAL_KEY))['show:assist']).toBe(95.4);
    _resetMedalCache();
    expect(getMedals('show', 'assist').medal).toBe('gold');   // back from storage
  });

  it('runs on without storage (private mode) and ignores junk', () => {
    globalThis.localStorage = fakeStorage({ throws: true }); _resetMedalCache();
    expect(() => recordRun('wall', 'assist', 91)).not.toThrow();
    expect(getMedals('wall', 'assist').medal).toBe('silver');   // this session still counts
    globalThis.localStorage = fakeStorage(); globalThis.localStorage.setItem(MEDAL_KEY, '{"show:assist":"x","bad key":5,"wall:pro":101}'); _resetMedalCache();
    expect(getMedals('show', 'assist').best).toBe(null);
    expect(getMedals('wall', 'pro').best).toBe(null);
  });
});
