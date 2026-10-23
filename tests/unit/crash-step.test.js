// The timeline's last step (ticket 0072): a run the judge scores as a crash ends on the crash (the
// end the sim called, or what the judge saw), never TOUCHDOWN; a clean end keeps TOUCHDOWN ('').
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, INPUT_KEYS } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun, WRECK_PCT } from '../../src/sim/judge.js';
import { crashStep } from '../../src/ui.js';

// The Show reference, every input zeroed from the release + 0.125 s (the critic's wreck), or as flown.
function show(zeroAfterRelease) {
  const run = createRun('show');
  const ap = createAutopilot('show');
  let rel = -1;
  while (run.phase !== 'done') {
    const inp = ap(run);
    // The release as src/main.js marks it: LIFT on the deck, or the first tick in the air.
    if (rel < 0 && ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air')) rel = run.tick;
    if (zeroAfterRelease && rel >= 0 && run.tick - rel >= 0.125 * 240) for (const k of INPUT_KEYS) inp[k] = 0;
    stepRun(run, inp);
  }
  return scoreRun(run.t, { assist: true });
}

describe('crashStep: what the timeline calls a crashed end', () => {
  it('the zeroed-input Show wreck ends on Flipped; the reference as flown ends clean', () => {
    const wreck = show(true);
    expect(wreck.facts.endReason).toBe('flipped');
    expect(wreck.facts.crashed).toBe(true);
    expect(crashStep(wreck)).toBe('Flipped');
    const clean = show(false);
    expect(clean.facts.crashed).toBe(false);
    expect(crashStep(clean)).toBe('');
  });

  it('the end reason first, then what the judge saw', () => {
    const f = (o) => ({ facts: { crashed: true, endReason: 'settled', flipped: false, contact: false, fellOff: false, damagePct: 0, ...o } });
    expect(crashStep(f({ endReason: 'flipped', flipped: true }))).toBe('Flipped');
    expect(crashStep(f({ endReason: 'contact', contact: true }))).toBe('Contact');
    expect(crashStep(f({ contact: true }))).toBe('Contact');             // hit the row, then settled
    expect(crashStep(f({ damagePct: WRECK_PCT }))).toBe('Wrecked');      // settled upright, but a wreck
    expect(crashStep(f({ endReason: 'runout', fellOff: true }))).toBe('Fell off');
    expect(crashStep(f({}))).toBe('Crash');                              // e.g. at rest on its side
    expect(crashStep({ facts: { crashed: false, endReason: 'settled' } })).toBe('');
    expect(crashStep(null)).toBe('');
  });
});
