// 0362: on the Lineup in Assist, a LIFT pressed on the run-up is a lift-off command (src/lift-off.js): the down-jets burn to
// the kickflip's height and stop by themselves, however long the key is down. Before it, one second of "Space at the line"
// flew the car to 45 m and it touched down at 17 m/s, Wrecked (docs/critique/2026-11-23-2136/lineup-lift-sweep.txt).
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput, CAR } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';
import { scoreRun } from '../../src/sim/judge.js';
import { coach } from '../../src/sim/coach.js';
import { createLiftOff, LIFT_OFF_APEX } from '../../src/lift-off.js';
import { sample, keyDown, keyUp, freshRun } from '../../src/input.js';
import { pickPointer, coachWords } from '../../src/pointer.js';

// The critic's keyboard player (lineup-lift-sweep.mjs): a 7.5 m/s run-up, Space from z −4 for `hold` s, then ← for `rollS`
// s, then Shift (LAND) to the ground. `rollAt`: 'after' rolls once Space is let go (the critic's order); 'cue' rolls a beat
// before the apex whatever Space is doing (as the cue calls it), Space still down if the hold is long.
function fly(hold, { tier = 'assist', rollAt = 'after', rollS = 0.8, gate = createLiftOff(), course = 'lineup', again = null } = {}) {
  const run = createRun(course), log = [];
  let tLift = null, tRoll = null, rose = false;
  while (run.phase !== 'done' && run.tick < 240 * 40) {
    const c = run.car, inp = newInput(), now = run.tick / 240;
    inp.assist = tier === 'assist' ? 1 : 0;
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (tLift === null && c.pos.z >= -4) tLift = now;
    const held = tLift !== null && now - tLift < hold;
    if (tLift === null) inp.throttle = Math.hypot(c.vel.x, c.vel.z) < 7.5 ? 1 : 0;
    if (held) inp.lift = 1;
    if (again && tLift !== null && now - tLift >= again[0] && now - tLift < again[1]) inp.lift = 1;
    if (run.phase === 'air') {
      if (c.vel.y > 5) rose = true;
      const go = rollAt === 'after' ? !held : rose && c.vel.y < 4;
      if (tRoll === null && go) tRoll = now;
      if (tRoll !== null) { if (now - tRoll < rollS) inp.roll = -1; else inp.level = 1; }
    } else if (tLift !== null && run.phase !== 'drive') inp.brake = 1;
    if (gate) gate(run.phase, c, inp);
    log.push(inp.lift);
    stepRun(run, inp);
  }
  const card = scoreRun(run.t, { assist: tier === 'assist' });
  return { run, card, t: run.t, gas: (run.car.air / CAR.airMass) * 100, log };
}

// The same player through src/input.js, as the page's key listeners drive it (the roll is the keys' own ramp, and the
// lift-off is the page's): ↑ eased to `speed`, Space at z −4 for `hold` s, then ← 0.8 s (rollAt 'after': from the first
// tick in the air once Space is let go; 'cue': a beat before the apex, Space still down if the hold is long), then Shift.
function flyKeys(hold, { tier = 'assist', rollAt = 'after', speed = 7.5 } = {}) {
  freshRun();
  const run = createRun('lineup'), inp = newInput(), v = () => Math.hypot(run.car.vel.x, run.car.vel.z);
  let up = false, t0 = -1, tRoll = -1, rose = false, spaceUp = false, shift = false;
  while (run.phase !== 'done' && run.tick < 240 * 40) {
    const c = run.car, t = run.tick;
    if (t0 < 0) {
      const want = v() < speed;
      if (want !== up) { if (want) keyDown('ArrowUp'); else keyUp('ArrowUp'); up = want; }
      if (c.pos.z >= -4) { t0 = t; if (up) { keyUp('ArrowUp'); up = false; } keyDown('Space'); }
    } else if (!spaceUp && t - t0 >= hold * 240) { keyUp('Space'); spaceUp = true; }
    if (run.phase === 'air') {
      if (c.vel.y > 5) rose = true;
      if (tRoll < 0 && (rollAt === 'after' ? spaceUp : rose && c.vel.y < 4)) { tRoll = t; keyDown('ArrowLeft'); }
      if (tRoll >= 0 && !shift && t - tRoll >= 0.8 * 240) { keyUp('ArrowLeft'); keyDown('ShiftLeft'); shift = true; }
    } else if (shift) { keyUp('ShiftLeft'); keyDown('ArrowDown'); }
    stepRun(run, sample(run.phase, tier, inp, run.phase === 'air', c));
  }
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'Space', 'ShiftLeft']) keyUp(k);
  const card = scoreRun(run.t, { assist: tier === 'assist' });
  return { run, card, t: run.t, gas: (run.car.air / CAR.airMass) * 100, apexH: run.t.apex - SPEC.comHeight };
}

describe('0362: the lift-off burn (Assist, the Lineup, keys)', () => {
  it('Space held 0.4, 0.6 and 1.0 s from z −4, then ← 0.8 s, then Shift: the kickflip\'s height and a landing', () => {
    // Before: 8.3 m Stuck it, 12.3 m Stuck it, 45.0 m Wrecked (sink 17.1; lineup-lift-sweep.txt). The reveal's 7–9 m
    // (§2.2): over the ground the three peak at 8.2, 9.1 and 8.6 m.
    for (const speed of [7.5, 9]) for (const hold of [0.4, 0.6, 1.0]) {
      const { t, card, apexH } = flyKeys(hold, { speed });
      expect(apexH, `${hold} s`).toBeGreaterThanOrEqual(7);
      expect(apexH, `${hold} s`).toBeLessThanOrEqual(9.25);
      expect(t.settledUpright).toBe(true);
      expect(t.contact).toBe(false);
      expect(t.sink).toBeLessThanOrEqual(2);
      expect(card.verdict).not.toMatch(/Wrecked|Crash|Contact|Splash/);
    }
  });

  it('held 1.5 and 3.0 s it still stops at the kickflip\'s height, with the gas the landing needs', () => {
    // Before: 82.6 m with 6 % left, 112.4 m+ with 4 %. (Rolled only once Space is let go, these two roll on the way down
    // and the 1.5 s one can't finish it: the next test rolls them where the cue does.)
    for (const hold of [1.5, 3.0]) {
      const { apexH, gas } = flyKeys(hold);
      expect(apexH).toBeGreaterThanOrEqual(7);
      expect(apexH).toBeLessThanOrEqual(9.25);
      expect(gas).toBeGreaterThan(40);
    }
  });

  it('rolled at the cue, every hold from 0.4 s to 3 s flies the same flight to the same landing', () => {
    // (Plain inputs, full stick at once: the point is that the hold changes nothing once the burn is spent.)
    const base = fly(0.4, { rollAt: 'cue' });
    expect(base.card.verdict).not.toMatch(/Wrecked|Crash|Contact|Splash/);
    expect(base.t.sink).toBeLessThanOrEqual(2);
    for (const hold of [0.6, 1.0, 1.5, 3.0]) {
      const o = fly(hold, { rollAt: 'cue' });
      expect(o.t.apex, `${hold} s`).toBe(base.t.apex);
      expect(o.card.total, `${hold} s`).toBe(base.card.total);
    }
  });

  it('a tap is a lift-off too: the burn runs on after the key is let go', () => {
    const tap = fly(0.05, { rollAt: 'cue' }), held = fly(0.4, { rollAt: 'cue' });
    expect(tap.t.apex).toBe(held.t.apex);
  });

  it('stops where the reference rule says: the projected apex at LIFT_OFF_APEX', () => {
    const { log } = fly(3.0);
    const burn = log.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / 240;
    expect(burn).toBeGreaterThan(0.3);
    expect(burn).toBeLessThan(0.6);
    expect(LIFT_OFF_APEX).toBe(7.25);
  });

  it('a LIFT pressed afresh in the air is LIFT as it always was', () => {
    const once = fly(3.0, { rollAt: 'cue' });
    // Let go at 1.0 s and pressed again from 1.1 to 1.4 s: the second press climbs.
    const twice = fly(1.0, { rollAt: 'cue', again: [1.1, 1.4] });
    expect(twice.t.apex).toBeGreaterThan(once.t.apex + 0.5);
  });

  it('Pro is unchanged: a 1.0 s hold still flies past 30 m (the gate leaves its input alone)', () => {
    const gated = fly(1.0, { tier: 'pro' }), raw = fly(1.0, { tier: 'pro', gate: null });
    expect(gated.t.apex).toBeGreaterThan(30);
    expect(gated.t.apex).toBe(raw.t.apex);
    expect(flyKeys(1.0, { tier: 'pro' }).t.apex).toBeGreaterThan(30);
  });

  it('off the Lineup, and on Advanced, the gate passes the input through', () => {
    const gate = createLiftOff();
    for (const [id, assist, manual] of [['show', 1, 0], ['wall', 1, 0], ['lineup', 0, 1]]) {
      const run = createRun(id);
      for (let i = 0; i < 2400; i++) {
        const inp = newInput(); inp.assist = assist; inp.manual = manual; inp.lift = 1;
        run.car.vel.y = 20;   // a projected apex far past the burn's: the gate would cut it on the Lineup in Assist
        gate('drive', run.car, inp);
        expect(inp.lift).toBe(1);
      }
    }
  });

  it('through src/input.js: Space held on the run-up reads as let go once the burn ends; freshRun() starts over', () => {
    freshRun();
    const run = createRun('lineup'), inp = newInput();
    while (run.car.pos.z < -4) { keyDown('ArrowUp'); stepRun(run, sample(run.phase, 'assist', inp, false, run.car)); }
    keyUp('ArrowUp'); keyDown('Space');
    let on = 0, off = 0;
    for (let i = 0; i < 240 * 2 && run.phase !== 'done'; i++) {
      const s = sample(run.phase, 'assist', inp, run.phase === 'air', run.car);
      if (s.lift > 0) { if (off) throw new Error('LIFT came back on without a fresh press'); on++; } else off++;
      stepRun(run, s);
    }
    expect(on / 240).toBeGreaterThan(0.3);
    expect(on / 240).toBeLessThan(0.6);
    expect(off).toBeGreaterThan(0);
    expect(run.t.apex).toBeLessThan(9.5);
    keyUp('Space');
    freshRun();
  });
});

describe('0362: the coach on Pro, where LIFT is still a throttle', () => {
  const PRO = { device: 'key', scheme: 'classic', tier: 'pro', course: 'lineup' };
  it('a lift-off held past the kickflip\'s height leads with the held LIFT, in the coach and in NEXT RUN', () => {
    const { run, card } = flyKeys(1.0, { tier: 'pro' });
    card.tier = 'pro';
    const c = coach(run.inputLog, 'lineup', card, 0, coachWords(PRO));
    const top = c.items[0];
    expect(top.id).toBe('held-lift');
    expect(top.detail).toMatch(/^You held LIFT \(Space\) 1 s from the line: the car climbed to \d+(\.\d)? m/);
    expect(top.fix).toMatch(/^Let go of LIFT \(Space\) sooner: about 0\.5 s at the line/);
    const p = pickPointer(c.items, PRO, { card, flight: c.flight, crashed: true });
    expect(p.text).toBe('Lift less: hold Space about 0.5 s at the line, then let go');
    // Never what they didn't do (the critic's 11-23 sheet): no boost to cut, no LAND to keep holding.
    for (const x of c.items) expect(`${x.detail} ${x.fix}`).not.toMatch(/[Bb]oost less|keep holding Shift/);
  });

  it('a Pro lift that stays near the kickflip is not named', () => {
    const { run, card } = fly(0.4, { tier: 'pro' });
    card.tier = 'pro';
    const c = coach(run.inputLog, 'lineup', card, 0, coachWords(PRO));
    expect(c.items.map((x) => x.id)).not.toContain('held-lift');
  });

  it('Assist never reads a held-lift finding: its press is the lift-off', () => {
    const { run, card } = fly(3.0, { gate: null });   // a log from before the gate: 112 m on Assist
    card.tier = 'assist';
    const c = coach(run.inputLog, 'lineup', card);
    expect(c.items.map((x) => x.id)).not.toContain('held-lift');
  });

  it('NEXT RUN never tells a player who held LAND to keep holding it', () => {
    const ASSIST = { device: 'key', scheme: 'classic', tier: 'assist', course: 'show' };
    expect(pickPointer([{ id: 'ran-out' }], ASSIST, { flight: { levelHeld: 400 } }).text).not.toMatch(/keep holding/);
    expect(pickPointer([{ id: 'ran-out' }], ASSIST, { flight: { levelHeld: 0 } }).text).toMatch(/keep holding Shift/);
  });
});
