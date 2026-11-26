// 0138: a Jump run's end in the players' funnel says how it was flown (ctl-*, fly-*) and, for a wreck, what
// wrecked it (wreck-*: the coach's first finding). Once per run; counts only.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, INPUT_KEYS } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { coach } from '../../src/sim/coach.js';
import { up } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';
import { COURSES } from '../../src/sim/courses.js';
import { PLAY_EVENTS, CTL_EVENTS, FLY_EVENTS, WRECK_EVENTS, COURSE_EVENTS, wreckCause, wreckCauses, ctlOf, flyOf } from '../../src/obs/signature.js';
import { createRunEnd } from '../../src/obs/run-end.js';
import { cleanObs, OBS_LIMITS } from '../../src/worker/obs.js';

const fly = (opts, mut) => {
  const run = createRun('show'), ap = createAutopilot('show', opts);
  while (run.phase !== 'done') { const inp = ap(run); if (mut) mut(run, inp); stepRun(run, inp); }
  return run;
};
const first = (run) => coach(run.inputLog, 'show', scoreRun(run.t)).items[0].id;
// Every coach finding id (src/sim/coach.js), as tests/unit/pointer.test.js lists them.
const COACH_IDS = ['fell-off', 'stopped-climb', 'no-release', 'early-release', 'short', 'no-brake', 'late-land', 'late-brake', 'ran-out', 'late-roll', 'over-roll', 'no-roll', 'tilt', 'mark', 'gas', 'flipped', 'clean', 'row', 'no-lift', 'held-lift', 'crash'];

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
    const expected = { row: ['wreck-short'], hard: ['wreck-brake', 'wreck-no-brake'], flip: wreckCauses(coachOf(flip, scoreRun(flip.t))) };
    for (const [name, run] of Object.entries({ row, hard, flip })) {
      const plays = [];
      const end = createRunEnd((n) => plays.push(n), coachOf);
      end.start(run);
      end.settle(run, scoreRun(run.t), true, { device: 'touch', scheme: 'thumb', tier: 'assist' }, true);
      expect(plays).toEqual(['run-wrecked', 'ctl-thumb', 'fly-assist', 'on-show', 'wrecked-show', ...expected[name]]);
    }
  });
});

describe('0138: how it was flown, once per run', () => {
  const card = (crashed, tier = 'assist') => ({ tier, facts: { crashed } });
  const make = () => {
    const plays = [], coached = [], later = [];
    const end = createRunEnd((n) => plays.push(n), (run) => { coached.push(run); return [{ id: 'late-brake' }]; }, (fn) => later.push(fn));
    const flush = () => { while (later.length) later.shift()(); };
    return { plays, coached, end, flush, later };
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

  it('a wreck left by the page going is re-flown at once, onto its last beacon', () => {
    const { plays, coached, end, later } = make();
    const run = {};
    end.start(run);
    end.settle(run, card(true), true, { device: 'key' }, true);
    expect(plays).toEqual(['run-wrecked', 'ctl-keys', 'fly-assist', 'wreck-brake', 'wreck-late-brake']);
    expect(coached).toEqual([run]);
    expect(later).toEqual([]);
  });

  it('a wreck left by Retry or Home before its coach ran is re-flown after the tap, once', () => {
    const { plays, coached, end, flush } = make();
    const run = {}, next = {};
    end.start(run);
    end.settle(run, card(true), true, { device: 'key' });   // R in the aftermath
    end.start(next);                                         // the retry's run: nothing re-flown in the tap
    expect(coached).toEqual([]);
    expect(plays).toEqual(['run-wrecked', 'ctl-keys', 'fly-assist']);
    end.settle(next, null, true, {}, true);                  // …and the page goes before the deferred re-fly: paid now, once
    flush();
    end.coached(run, [{ id: 'short' }]);
    expect(plays).toEqual(['run-wrecked', 'ctl-keys', 'fly-assist', 'run-quit', 'wreck-brake', 'wreck-late-brake']);
    expect(coached).toEqual([run]);
  });

  it('a Retry within the coach\'s beat: the sheet owes it, the tap defers it, it is paid once', () => {
    const { plays, coached, end, flush } = make();
    const run = {};
    end.start(run);
    end.settle(run, card(true), false, { device: 'touch', scheme: 'thumb' });
    end.settle(run, card(true), true);
    flush(); flush();
    expect(plays.filter((p) => p.startsWith('wreck-'))).toEqual(['wreck-brake', 'wreck-late-brake']);
    expect(coached).toEqual([run]);
  });

  it('a coach that throws still counts one cause (other)', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => { throw new Error('boom'); });
    const run = {};
    end.start(run);
    end.settle(run, card(true), true, { device: 'touch', scheme: 'thumb' }, true);
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
    const all = [...CTL_EVENTS, ...FLY_EVENTS, ...WRECK_EVENTS, ...COURSE_EVENTS];
    for (const n of all) expect(PLAY_EVENTS).toContain(n);
    const play = Object.fromEntries(all.map((n) => [n, 1]));
    expect(cleanObs(batch({ ...play, 'ctl-thumbs': 1, 'wreck-': 1, 'fly-rookie': 1, 'wreck-short ': 1 })).play).toEqual(play);
  });
  it('a beacon with every play name at its cap stays ≤ 8 kB', () => {
    const play = Object.fromEntries(PLAY_EVENTS.map((n) => [n, 500]));
    expect(JSON.stringify(batch(play)).length).toBeLessThan(OBS_LIMITS.maxBytes / 4);
  });
});

describe('0276: which brake mistake, and which course', () => {
  it('a brake wreck counts the old fold and the coach\'s own id; every other cause counts one name', () => {
    expect(wreckCauses([{ id: 'late-land' }])).toEqual(['wreck-brake', 'wreck-late-land']);
    expect(wreckCauses([{ id: 'no-brake' }])).toEqual(['wreck-brake', 'wreck-no-brake']);
    expect(wreckCauses([{ id: 'late-brake' }, { id: 'tilt' }])).toEqual(['wreck-brake', 'wreck-late-brake']);
    expect(wreckCauses([{ id: 'short' }])).toEqual(['wreck-short']);
    expect(wreckCauses(null)).toEqual(['wreck-other']);
    expect(wreckCause([{ id: 'late-land' }])).toBe('wreck-brake');   // the fold stays for one release (as daily-run did)
    for (const n of ['wreck-no-brake', 'wreck-late-brake', 'wreck-late-land']) expect(WRECK_EVENTS).toContain(n);
  });

  it('a wreck whose coach leads with late-land counts wreck-late-land and wreck-brake, once', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => [{ id: 'late-land' }]);
    const run = { course: 'lineup' };
    end.start(run);
    end.settle(run, { tier: 'assist', facts: { crashed: true } }, true, { device: 'key' }, true);
    end.coached(run, [{ id: 'late-land' }]);
    expect(plays).toEqual(['run-wrecked', 'ctl-keys', 'fly-assist', 'on-lineup', 'wrecked-lineup', 'wreck-brake', 'wreck-late-land']);
  });

  it('a landed Show run counts on-show and landed-show; a wrecked Wall run on-wall and wrecked-wall; once per run', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => [{ id: 'short' }], () => {});
    const show = { course: 'show' }, wall = { course: 'wall' };
    end.start(show);
    end.settle(show, { tier: 'assist', facts: { crashed: false } }, false, { device: 'touch', scheme: 'thumb' });
    end.settle(show, { tier: 'assist', facts: { crashed: false } }, true, { device: 'touch', scheme: 'thumb' });
    end.start(wall);
    end.settle(wall, { tier: 'pro', facts: { crashed: true } }, false, { device: 'touch', scheme: 'thumb' });
    end.settle(wall, { tier: 'pro', facts: { crashed: true } }, true, { device: 'touch', scheme: 'thumb' });
    expect(plays.filter((p) => /^(on|landed|wrecked)-/.test(p))).toEqual(['on-show', 'landed-show', 'on-wall', 'wrecked-wall']);
  });

  it('a quit, or a run with no known course, counts no course', () => {
    const plays = [];
    const end = createRunEnd((n) => plays.push(n), () => []);
    const a = { course: 'show' }, b = { course: undefined };
    end.start(a);
    end.settle(a, null, true, {}, true);
    end.start(b);
    end.settle(b, { tier: 'assist', facts: { crashed: false } }, true, {}, true);
    expect(plays).toEqual(['run-quit', 'run-landed', 'ctl-keys', 'fly-assist']);
  });

  it('the course names are play events, for each of the three courses', () => {
    expect(COURSE_EVENTS).toEqual(['on-show', 'on-wall', 'on-lineup', 'landed-show', 'landed-wall', 'landed-lineup', 'wrecked-show', 'wrecked-wall', 'wrecked-lineup']);
    for (const n of COURSE_EVENTS) expect(PLAY_EVENTS).toContain(n);
    // A fourth course must be added here too, or its runs would count no course.
    expect([...new Set(COURSE_EVENTS.map((n) => n.split('-')[1]))].sort()).toEqual(Object.keys(COURSES).sort());
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
