import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { numbersIn, checkWords, faithfulWords, liveFaithful, replacedLine } from '../../src/check-words.js';
import { localWords } from '../../src/panel.js';
import { userPrompt } from '../../src/worker/ai/prompt.js';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';

// 0282: a judge's remark never shows the player a number the run didn't make. The cards are the Show's and the Wall's
// reference runs (autopilot, Assist) as scoreRun scores them today; the remarks are the edge model's own, recorded on
// production by the critic on 2026-11-18 (docs/critique/2026-11-18-0936/judge-sample.txt).
const SHOW = {"course":"show","total":97.3,"judges":[{"id":"engineer","score":9.7},{"id":"coordinator","score":9.7},{"id":"designer","score":9.8}],"tier":"assist","multiplier":1,"categories":{"climb":10,"inversion":10,"rotation":9.8,"landing":9.4,"precision":10,"efficiency":10,"clearance":8.8,"damage":10},"facts":{"course":"show","height":26.9,"progressPct":100,"invertedS":3.7,"launchHeight":27.4,"launchKmh":27,"entryKmh":22,"apex":27.4,"maxG":3.3,"brakeG":3,"brakeH":2.3,"rollDeg":177,"pitchDeg":14,"rotations":0,"sink":0.8,"tiltDeg":1.1,"headingDeg":6.5,"wheelSpreadMs":58,"padMiss":1.5,"airPct":48,"zeroToSixty":null,"bottomOut":false,"bodyStrike":false,"contact":false,"clearance":5.1,"crossedRow":true,"apexOverRoof":null,"flipped":false,"fellOff":false,"landedOnRamp":false,"crashed":false,"jumped":true,"endReason":"settled","damagePct":0,"integrity":100,"damageZones":{"nose":0,"tail":0,"left":0,"right":0,"roof":0,"floor":0,"susp":0},"splash":false,"splashKmh":0,"mudS":0},"verdict":"Perfect 10"};
const WALL = {"course":"wall","total":97.7,"judges":[{"id":"engineer","score":9.8},{"id":"coordinator","score":9.8},{"id":"designer","score":9.7}],"tier":"assist","multiplier":1,"categories":{"climb":9.7,"inversion":10,"rotation":9.7,"landing":9.8,"precision":10,"efficiency":8.9,"damage":10},"facts":{"course":"wall","height":26.8,"progressPct":98,"invertedS":5.2,"launchHeight":27.1,"launchKmh":8,"entryKmh":17,"apex":27.1,"maxG":3.3,"brakeG":3,"brakeH":3.4,"rollDeg":177,"pitchDeg":17,"rotations":0,"sink":0.8,"tiltDeg":0.1,"headingDeg":6.8,"wheelSpreadMs":4,"padMiss":3.5,"airPct":44,"zeroToSixty":null,"bottomOut":false,"bodyStrike":false,"contact":false,"clearance":null,"crossedRow":null,"apexOverRoof":null,"flipped":false,"fellOff":false,"landedOnRamp":false,"crashed":false,"jumped":true,"endReason":"settled","damagePct":0,"integrity":100,"damageZones":{"nose":0,"tail":0,"left":0,"right":0,"roof":0,"floor":0,"susp":0}},"verdict":"Perfect 10"};
const CARDS = { show: SHOW, wall: WALL };
const brief = (card) => userPrompt(card);   // the facts the model read (the prompt event's `user`)
const SAMPLE = readFileSync(new URL('../../docs/critique/2026-11-18-0936/judge-sample.txt', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => { const m = /^(\w+) (\d+) 200 (.*)$/.exec(l); return { course: m[1], i: +m[2], words: JSON.parse(m[3]) }; });

describe('numbersIn: every number a remark states', () => {
  it('reads digits, per cents, units and spelled-out numbers', () => {
    expect(numbersIn('Sink rate of 0.8 m/s, 48% gas, wheels within 4 ms')).toEqual([0.8, 48, 4]);
    expect(numbersIn('That thirty-six second hang')).toEqual([36]);
    expect(numbersIn('forty-eight percent, forty four left, over five seconds, a 1,200 m run')).toEqual([48, 44, 5, 1200]);
    expect(numbersIn('seventeen and seven, nineteen, ninety')).toEqual([17, 7, 19, 90]);
    expect(numbersIn('someone often tones it down: none')).toEqual([]);
  });
});

describe('checkWords (0282)', () => {
  it('the Show reference (invertedS 3.7): "thirty-six second hang" fails; "nearly four seconds" and "3.7 seconds" pass', () => {
    expect(SHOW.facts.invertedS).toBe(3.7);
    const bad = { headline: 'A PERFECT TEN', engineer: 'Sink rate of 0.8 m/s.', coordinator: 'That thirty-six second hang under the ledge was pure nerve and absolute theater.', designer: '48% left.' };
    expect(checkWords(bad, SHOW, brief(SHOW))).toEqual(['coordinator']);
    expect(checkWords(bad, SHOW)).toEqual(['coordinator']);   // without the brief too
    expect(checkWords({ ...bad, coordinator: 'That 36 second hang' }, SHOW, brief(SHOW))).toEqual(['coordinator']);
    for (const ok of ['Hanging inverted for nearly four seconds before that massive leap.', 'Hanging inverted for 3.7 seconds showed nerve.']) {
      expect(checkWords({ ...bad, coordinator: ok }, SHOW, brief(SHOW))).toEqual([]);
    }
  });
  it('every remark the edge model wrote for the references passes unchanged (12/12 sets, Show and Wall)', () => {
    expect(SAMPLE).toHaveLength(12);
    expect(new Set(SAMPLE.map((s) => s.course))).toEqual(new Set(['show', 'wall']));
    for (const s of SAMPLE) expect(checkWords(s.words, CARDS[s.course], brief(CARDS[s.course])), `${s.course} ${s.i}`).toEqual([]);
    // …and without the brief (a recorded call that carried none).
    for (const s of SAMPLE) expect(checkWords(s.words, CARDS[s.course]), `${s.course} ${s.i}`).toEqual([]);
  });
  it('the crash card: US conversions are accepted ("10.8 ft/s 3.3 m/s", "60 feet 18.2 meter")', () => {
    const crash = { ...SHOW, total: 29.7, verdict: 'Contact', facts: { ...SHOW.facts, sink: 3.3, padMiss: 18.2, clearance: -0.1, apex: 27, airPct: 20, brakeG: 3.2, crashed: true, contact: true } };
    const words = { headline: 'Disastrous contact during the Show', engineer: 'A 10.8 ft/s 3.3 m/s sink rate and 60 feet 18.2 meter deviation from the mark resulted in catastrophic vehicle contact.', coordinator: 'The inversion was breathtaking.', designer: 'Excellent climb.' };
    expect(checkWords(words, crash, brief(crash))).toEqual([]);
    // A unit swapped onto the wrong quantity is not excused: the sink in feet is 10.8, not 33.
    expect(checkWords({ ...words, engineer: 'A 33 ft/s sink rate.' }, crash, brief(crash))).toEqual(['engineer']);
  });
  it('a speed may be said in mph and a height in feet, as src/units.js shows them', () => {
    // launchKmh 27 → 16.8 mph; height 26.9 m → 88 ft
    expect(checkWords({ engineer: 'Off the ledge at 17 mph.', coordinator: 'Eighty-eight feet up.', designer: '', headline: '' }, SHOW, brief(SHOW))).toEqual([]);
    expect(checkWords({ engineer: 'Off the ledge at 130 mph.', coordinator: '', designer: '', headline: '' }, SHOW, brief(SHOW))).toEqual(['engineer']);
  });
});

describe('faithfulWords: the sheet shows the judge’s own line instead', () => {
  it('swaps only the unfaithful remark for the same judge’s localWords line', () => {
    const words = { headline: 'A PERFECT TEN', engineer: 'Sink rate of 0.8 m/s.', coordinator: 'That thirty-six second hang was pure nerve.', designer: '48% left.', source: 'ai' };
    const { words: out, replaced } = faithfulWords(words, SHOW, localWords, brief(SHOW));
    expect(replaced).toEqual(['coordinator']);
    expect(out.coordinator).toBe(localWords(SHOW).coordinator);
    expect(out.engineer).toBe(words.engineer);
    expect(out.designer).toBe(words.designer);
    expect(out.source).toBe('ai');
    expect(words.coordinator).toMatch(/thirty-six/);   // the model's own words are not touched
    expect(faithfulWords(SAMPLE[0].words, SHOW, localWords, brief(SHOW)).words).toBe(SAMPLE[0].words);
  });
  it('the local line it swaps in is itself faithful', () => {
    for (const card of [SHOW, WALL]) expect(checkWords(localWords(card), card, brief(card))).toEqual([]);
  });
  it('the receipt says so in a line', () => {
    expect(replacedLine(1)).toBe('1 remark replaced with the game’s own line: it stated a number the run didn’t make');
    expect(replacedLine(2)).toMatch(/^2 remarks replaced/);
  });
});

describe('a number with a unit is held to its own quantity', () => {
  it('the ticket’s slip for any hang: "twenty-seven seconds" fails on a 3.7 s hang even though the climb was 26.9 m', () => {
    const w = (coordinator) => ({ headline: '', engineer: '', designer: '', coordinator });
    for (const bad of ['A twenty-seven second hang.', 'Twenty-eight seconds inverted.', 'Nine seconds inverted.', 'Two seconds upside down.', 'A 37 s hang.'])
      expect(checkWords(w(bad), SHOW, brief(SHOW)), bad).toEqual(['coordinator']);
    for (const good of ['Over three and a half seconds? No: 3.7 s inverted.', 'Twenty-seven metres up.', 'A 360-degree roll.', 'Peak load 3.3 g.', 'Forty-eight percent left.'])
      expect(checkWords(w(good), SHOW, brief(SHOW)), good).toEqual([]);
    expect(checkWords(w('Twenty-seven percent left.'), SHOW, brief(SHOW))).toEqual(['coordinator']);
    expect(checkWords(w('Wheels within 40 ms.'), WALL, brief(WALL))).toEqual(['coordinator']);   // 4 ms
  });
  it('the Lineup reference: its own facts and remarks pass; a made-up apex fails', () => {
    const run = createRun('lineup'), ap = createAutopilot('lineup');
    while (run.phase !== 'done') stepRun(run, ap(run));
    const card = scoreRun(run.t, { assist: true }), f = card.facts;
    expect(checkWords(localWords(card), card, brief(card))).toEqual([]);
    const said = { headline: card.verdict, engineer: `Touchdown at ${f.sink} m/s, ${f.wheelSpreadMs} ms between wheels.`, coordinator: `${f.apex} metres and a ${f.rollDeg}° roll.`, designer: `${f.airPct}% in the tanks.` };
    expect(checkWords(said, card, brief(card))).toEqual([]);
    expect(checkWords({ ...said, coordinator: `${Math.round(f.apex * 10)} metres up.` }, card, brief(card))).toEqual(['coordinator']);
  });
  it('the splash and wreck lines the game swaps in are faithful to their own cards', () => {
    const splash = { ...SHOW, facts: { ...SHOW.facts, splash: true, splashKmh: 31, padMiss: 12.4, crashed: true } };
    const wreck = { ...SHOW, facts: { ...SHOW.facts, damagePct: 72, integrity: 28, crashed: true } };
    for (const card of [splash, wreck]) expect(checkWords(localWords(card), card, brief(card))).toEqual([]);
  });
  it('two bad remarks are both replaced, and the receipt says so in the plural', () => {
    const words = { headline: 'A Perfect Ten', engineer: 'Sink rate of 50 m/s.', coordinator: 'A thirty-six second hang.', designer: '48% left.', source: 'ai' };
    const { replaced } = faithfulWords(words, SHOW, localWords, brief(SHOW));
    expect(replaced).toEqual(['engineer', 'coordinator']);
    expect(replacedLine(replaced.length)).toBe('2 remarks replaced with the game’s own lines: they stated numbers the run didn’t make');
  });
});

describe('liveFaithful: the words as they stream', () => {
  const w = (coordinator) => ({ headline: '', engineer: '', designer: '', coordinator });
  const live = (t, done = false) => liveFaithful(w(t), SHOW, brief(SHOW), done).coordinator;
  it('never shows the word still being written', () => {
    expect(live('That thirty')).toBe('That');
    expect(live('Hanging for 3.')).toBe('Hanging for');
    expect(live('Hanging for 3.7 seconds')).toBe('Hanging for 3.7');
    expect(live('Hanging for 3.7 seconds', true)).toBe('Hanging for 3.7 seconds');
  });
  it('a stream split mid-word (" thirty", "-six", " second") never shows the wrong number', () => {
    let text = 'That', shown = [];
    for (const t of [' thirty', '-six', ' second', ' hang', ' under', ' the', ' ledge.']) { text += t; shown.push(live(text)); }
    shown.push(live(text, true));
    expect(shown.filter((x) => /thirty|36/i.test(x))).toEqual([]);
    expect(shown.at(-1)).toBe('That');   // held just before the wrong number until the final words land
    const digits = ['That 3', 'That 36', 'That 36 s', 'That 36 seconds', 'That 36 seconds of'].map((x) => live(x));
    expect(digits.filter((x) => /3/.test(x))).toEqual([]);
  });
});
