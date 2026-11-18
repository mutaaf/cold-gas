// 0275: ↑/W and ↓/S held across a take-off or a touchdown mean nothing on the new side until pressed again. The keyboard
// guide says "Keep holding ↑" up the curl; held on, ↑ was nose down in the air and throttle off the mark after touchdown.
import { describe, it, expect, afterEach } from 'vitest';
import { sample, keyDown, keyUp, freshRun } from '../../src/input.js';
import { sweep } from '../../scripts/keys-literal.mjs';

afterEach(() => freshRun());

const ground = (tier = 'assist', ctx = null) => sample('ramp', tier, undefined, false, null, ctx);
const air = (tier = 'assist', ctx = null) => sample('air', tier, undefined, true, null, ctx);
// A key held a while (0.25 s and more is a hold, not a press that came with the change).
const hold = (fn, n = 60) => { let o; for (let i = 0; i < n; i++) o = fn(); return o; };

describe('a pitch key carried across the change of ground', () => {
  it('↑ held from the climb does not pitch the car until it is let go and pressed again', () => {
    freshRun();
    keyDown('ArrowUp');
    expect(hold(ground).throttle).toBeGreaterThan(0);
    expect(air().pitch + 0).toBe(0);                        // the release: still held from the climb
    keyDown('ArrowUp', true);                           // the key's auto-repeat is not a press
    expect(air().pitch + 0).toBe(0);
    keyUp('ArrowUp');
    expect(air().pitch + 0).toBe(0);
    keyDown('ArrowUp');                                 // a fresh press in the air: nose down, as before
    expect(air().pitch).not.toBe(0);
  });

  it('↑ held from the air is not throttle after the touchdown until pressed again; ↓ the same', () => {
    freshRun();
    expect(ground().throttle).toBe(0);
    expect(air().pitch + 0).toBe(0);
    keyDown('ArrowUp');                                  // pressed in the air
    const nose = hold(air).pitch;
    expect(nose).not.toBe(0);
    const landed = () => sample('landed', 'assist', undefined, true);
    expect(hold(landed, 240).throttle).toBe(0);          // the touchdown: not throttle (the pedal eases off to rest)
    keyUp('ArrowUp'); keyDown('ArrowUp');
    expect(sample('landed', 'assist', undefined, true).throttle).toBeGreaterThan(0);
    keyUp('ArrowUp');
    keyDown('KeyS');                                     // ↓ from the ground into the air: no nose up
    expect(hold(() => sample('landed', 'assist', undefined, true)).brake).toBeGreaterThan(0);
    expect(air().pitch + 0).toBe(0);
    keyUp('KeyS'); keyDown('KeyS');
    expect(air().pitch).toBe(-nose);
  });

  it('W and the arrow are one key each: a fresh W flies while a carried ↑ waits', () => {
    freshRun();
    keyDown('ArrowUp');
    hold(ground);
    expect(air().pitch + 0).toBe(0);
    keyDown('KeyW');
    expect(air().pitch).not.toBe(0);
  });

  it('Pro keeps its keys, and Free Drive never cuts a throttle over a crest', () => {
    for (const [tier, ctx] of [['pro', null], ['assist', { free: true }]]) {
      freshRun();
      keyDown('ArrowUp');
      hold(() => ground(tier, ctx));
      expect(air(tier, ctx).pitch, tier).not.toBe(0);
      expect(ground(tier, ctx).throttle, tier).toBeGreaterThan(0);
    }
  });

  it('a key pressed with Space on the ledge is the player\'s choice for the air, not a leftover', () => {
    freshRun();
    hold(ground);
    keyDown('ArrowDown');                                // ↓ with the release: nose up at once
    hold(ground, 3);
    expect(air().pitch).not.toBe(0);
  });

  it('the Lineup\'s hop back onto the run-up is not a touchdown: a held ↑ stays throttle', () => {
    freshRun();
    keyDown('ArrowUp');
    hold(ground);
    hold(air);
    expect(hold(() => sample('drive', 'assist', undefined, false), 30).throttle).toBeGreaterThan(0.2);
  });

  it('a key pressed while one thumb flew is fresh when the keys take over', async () => {
    const { sampleThumb } = await import('../../src/input.js');
    const { createRun } = await import('../../src/sim/run.js');
    freshRun();
    hold(ground);                                        // the keys drive the run-up
    sampleThumb(createRun('show'), false);               // a tap: the thumb flies the climb
    keyDown('ArrowDown');
    hold(air, 2);
    expect(air().pitch).not.toBe(0);
  });

  it('a run that opens in the air (a drill) carries nothing in from before its first tick', () => {
    freshRun();
    keyDown('ArrowDown');
    expect(air().pitch).not.toBe(0);
  });

  it('a new run forgets what the last one carried', () => {
    freshRun();
    keyDown('ArrowUp'); hold(ground); air();
    freshRun();
    keyDown('ArrowUp');
    expect(ground().throttle).toBeGreaterThan(0);
  });
});

// The population the guide's words create, through the browser's own key mapping: before 0275 the Show landed 8/36 and
// the Wall 15/36 with ↑ held to the end.
describe('the keyboard newcomer who keeps holding ↑', () => {
  it('lands ≥ 34/36 on the Show and on the Wall', () => {
    for (const course of ['show', 'wall']) {
      const r = sweep(course, 'never');
      expect(r.landed, course).toBeGreaterThanOrEqual(34);
    }
  }, 120_000);
});
