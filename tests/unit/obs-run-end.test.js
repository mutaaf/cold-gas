// 0138: a Jump run's end in the players' funnel says how it was flown (ctl-*, fly-*) and, for a wreck, what
// wrecked it (wreck-*: the coach's first finding). Once per run; counts only.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, INPUT_KEYS } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { coach } from '../../src/sim/coach.js';
import { up } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';
import { PLAY_EVENTS, CTL_EVENTS, FLY_EVENTS, WRECK_EVENTS, wreckCause, ctlOf, flyOf } from '../../src/obs/signature.js';
import { createRunEnd } from '../../src/obs/run-end.js';
import { cleanObs, OBS_LIMITS } from '../../src/worker/obs.js';

const fly = (opts, mut) => {
  const run = createRun('show'), ap = createAutopilot('show', opts);
  while (run.phase !== 'done') { const inp = ap(run); if (mut) mut(run, inp); stepRun(run, inp); }
  return run;
};
const first = (run) => coach(run.inputLog, 'show', scoreRun(run.t)).items[0].id;
// Every coach finding id (src/sim/coach.js), as tests/unit/pointer.test.js lists them.
const COACH_IDS = ['fell-off', 'no-release', 'early-release', 'short', 'no-brake', 'late-land', 'late-brake', 'ran-out', 'late-roll', 'over-roll', 'no-roll', 'tilt', 'mark', 'gas', 'flipped', 'clean'];

describe('0138: what wrecked it', () => {
  it('folds every coach finding into one wreck event on the list; no coach is "other"', () => {
    for (const id of COACH_IDS) expect(WRECK_EVENTS).toContain(wreckCause([{ id }]));
    expect(wreckCause([{ id: 'short' }, { id: 'tilt' }])).toBe('wreck-short');
    expect(['no-brake', 'late-brake', 'late-land'].map((id) => wreckCause([{ id }]))).toEqual(['wreck-brake', 'wreck-brake', 'wreck-brake']);
    expect(wreckCause([{ id: 'flipped' }])).toBe('wreck-flipped');
    expect(wreckCause([{ id: 'fell-off' }])).toBe('wreck-fell-off');
    expect(wreckCause([{ id: 'ran-out' }])).toBe('wreck-ran-out');
    expect(wreckCause([{ id: 'mark' }])).toBe('wreck-other');
    expect(wreckCause(null)).toBe('wreck-other');
    expect(wreckCause([])).toBe('wreck-other');
  });

  it('three wrecks flown in Node: into the row, a hard landing and a flip, each named by its coach', () => {
    const row = fly({ carry: 4 });
    expect(scoreRun(row.t).facts.crashed).toBe(true);
    expect(first(row)).toBe('short');
    // Never braked: the reference to the release, then hands off the brake with the car upright.
    const hard = fly({}, (run, inp) => {
      run.st = run.st || {};
      if (run.phase !== 'air') return;
      if (up(run.car, { x: 0, y: 0, z: 0 }).y > 0.9) run.st.up = true;
      if (run.st.up) { inp.assist = 0; inp.level = 0; inp.roll = 0; inp.pitch = 0; inp.lift = run.car.pos.y - SPEC.comHeight < 0 ? 1 : 0; }
    });
    expect(scoreRun(hard.t).facts.crashed).toBe(true);
    expect(first(hard)).toBe('no-brake');
    // Every input zeroed 0.375 s after the release: it lands on its roof (the coach leads with what caused it).
    let rel = -1;
    const flip = fly({}, (run, inp) => {
      if (rel < 0 && ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air')) rel = run.tick;
      if (rel >= 0 && run.tick - rel >= 90) for (const k of INPUT_KEYS) inp[k] = 0;
    });
    expect(scoreRun(flip.t).facts.endReason).toBe('flipped');

    const coachOf = (run, card) => coach(run.inputLog, run.course, card).items;
    const expected = { row: 'wreck-short', hard: 'wreck-brake', flip: wreckCause(coachOf(flip, scoreRun(flip.t))) };
    for (const [name, run] of Object.entries({ row, hard, flip })) {
      const plays = [];
      const end = createRunEnd((n) => plays.push(n), coachOf);
      end.start(run);
      end.settle(run, scoreRun(run.t), true, { device: 'touch', scheme: 'thumb', tier: 'assist' });
      expect(plays).toEqual(['run-wrecked', 'ctl-thumb', 'fly-assist', expected[name]]);
    }
  });
});

describe('0138: how it was flown, once per run', () => {
  const card = (crashed, tier = 'assist') => ({ tier, facts: { crashed } });
  const make = () => {
    const plays = [], coached = [];
    const end = createRunEnd((n) => plays.push(n), (run) => { coached.push(run); return [{ id: 'late-brake' }]; });
    return { plays, coached, end };
  };

  it('a wreck counts its cause from the results\' coach, once; leaving afterwards adds nothing', () => {
    const { plays, coached, end } = make();
    const run = {};
    end.start(run);
    end.settle(run, card(true), false, { device: 'touch', scheme: 'thumb' });   // the sheet
    expect(plays).toEqual(['run-wrecked', 'ctl-thumb', 'fly-assist']);
    expect(end.owed).toBe(true);
    end.coached(run, [{ id: 'short' }]);    // the results' own coach, a beat later
    end.coached(run, [{ id: 'short' }]);
    end.settle(run, card(true), true);       // Retry / the page going
    expect(plays).toEqual(['run-wrecked', 'ctl-thumb', 'fly-assist', 'wreck-short']);
    expect(coached).toEqual([]);             // no second re-fly
  });

  it('a wreck left before its coach ran is re-flown then, once', () => {
    const { plays, coached, end } = make();
    const run = {};
    end.start(run);
    end.settle(run, card(true), true, { device: 'key' });   // R in the aftermath, or the page going
    end.settle(run, card(true), true, { device: 'key' });
    end.coached(run, [{ id: 'short' }]);
    expect(plays).toEqual(['run-wrecked', 'ctl-keys', 'fly-assist', 'wreck-brake']);
    expect(coached).toEqual([run]);
  });

  it('a coach that throws still counts one cause (other)', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => { throw new Error('boom'); });
    const run = {};
    end.start(run);
    end.settle(run, card(true), true, { device: 'touch', scheme: 'thumb' });
    expect(plays.filter((p) => p.startsWith('wreck-'))).toEqual(['wreck-other']);
  });

  it('a landed run counts its ctl and fly and no cause; a quit counts neither', () => {
    const { plays, end } = make();
    const a = {}, b = {};
    end.start(a);
    end.settle(a, card(false, 'pro'), false, { device: 'touch', scheme: 'classic' });
    end.settle(a, card(false, 'pro'), true, { device: 'touch', scheme: 'classic' });
    end.start(b);
    end.settle(b, null, true, { device: 'pad' });
    expect(plays).toEqual(['run-landed', 'ctl-classic', 'fly-pro', 'run-quit']);
    expect(end.owed).toBe(false);
  });

  it('a run that is not the open one (the reference, a drill) counts nothing', () => {
    const { plays, end } = make();
    end.start({});
    end.settle({}, card(true), true);
    expect(plays).toEqual([]);
  });

  it('the controls and the tier', () => {
    expect(ctlOf('touch', 'thumb')).toBe('ctl-thumb');
    expect(ctlOf('touch', 'classic')).toBe('ctl-classic');
    expect(ctlOf('key')).toBe('ctl-keys');
    expect(ctlOf('mouse')).toBe('ctl-keys');
    expect(ctlOf('none')).toBe('ctl-keys');
    expect(ctlOf('pad')).toBe('ctl-pad');
    expect(['assist', 'pro', 'advanced', undefined].map(flyOf)).toEqual(['fly-assist', 'fly-pro', 'fly-advanced', 'fly-assist']);
  });
});

describe('0138: the Worker takes the new names', () => {
  const batch = (play) => ({ v: 1, build: 'abc1234', dc: 'phone-lo', tier: 'high', scale: 0, first: true, errs: [], fr: null, rec: [], br: [], play });
  it('cleanObs accepts every new name and still drops near-misses', () => {
    const all = [...CTL_EVENTS, ...FLY_EVENTS, ...WRECK_EVENTS];
    for (const n of all) expect(PLAY_EVENTS).toContain(n);
    const play = Object.fromEntries(all.map((n) => [n, 1]));
    expect(cleanObs(batch({ ...play, 'ctl-thumbs': 1, 'wreck-': 1, 'fly-rookie': 1, 'wreck-short ': 1 })).play).toEqual(play);
  });
  it('a beacon with every play name at its cap stays ≤ 8 kB', () => {
    const play = Object.fromEntries(PLAY_EVENTS.map((n) => [n, 500]));
    expect(JSON.stringify(batch(play)).length).toBeLessThan(OBS_LIMITS.maxBytes / 4);
  });
});

describe('0138: a dropped run', () => {
  it('a trap or an escalation drops the open run uncounted (0130)', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => []);
    const run = {};
    end.start(run);
    end.drop();
    end.settle(run, null, true);
    expect(plays).toEqual([]);
  });
});
