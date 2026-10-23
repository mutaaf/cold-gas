// The coach's pointers in this device's words (0079, src/pointer.js): the "how to fly" rows, the one
// pointer after a run (no third repeat, "Better: …" once fixed) and the live pointers.
import { describe, it, expect } from 'vitest';
import { deviceOf, ctl, howtoRows, deviceTitle, pointerText, pickPointer, betterText, livePointer } from '../../src/pointer.js';

const KEY = { device: 'key', scheme: 'classic', tier: 'assist', course: 'show' };
const PAD = { ...KEY, device: 'pad' };
const TOUCH = { ...KEY, device: 'touch' };
const THUMB = { ...KEY, device: 'touch', scheme: 'thumb' };
const PRO = { ...KEY, tier: 'pro' };
const item = (id) => ({ id, title: id, detail: '', fix: '' });

describe('the device', () => {
  it('a mouse or nothing yet reads as the keyboard', () => {
    expect(['touch', 'pad', 'key', 'mouse', 'none'].map(deviceOf)).toEqual(['touch', 'pad', 'key', 'key', 'key']);
  });
  it('names the control the player actually has', () => {
    expect(ctl(KEY, 'release')).toBe('press Space');
    expect(ctl(PAD, 'release')).toBe('press A');
    expect(ctl(TOUCH, 'release')).toBe('tap RELEASE');
    expect(ctl(THUMB, 'release')).toBe('tap the pad');
    expect(ctl(KEY, 'land')).toBe('hold Shift');
    expect(ctl(PAD, 'land')).toBe('hold B');
    expect(ctl(TOUCH, 'land')).toBe('hold LAND');
    expect(ctl(KEY, 'land', (k) => `<kbd>${k}</kbd>`)).toBe('hold <kbd>Shift</kbd>');
  });
});

describe('how to fly', () => {
  it('four phases on every device: drive & climb, let go, roll & land, brake', () => {
    for (const ctx of [KEY, PAD, TOUCH, THUMB, PRO, { ...KEY, tier: 'advanced' }]) {
      const rows = howtoRows(ctx);
      expect(rows).toHaveLength(4);
      expect(rows[0].phase).toMatch(/drive/i);
      expect(rows[1].phase).toMatch(/let go/i);
      expect(rows[3].phase).toMatch(/brake/i);
      for (const r of rows) { expect(r.ctl).toBeTruthy(); expect(r.what).toBeTruthy(); }
    }
  });
  it('each device its own controls', () => {
    expect(howtoRows(KEY).map((r) => r.ctl)).toEqual(['↑', 'Space', 'Shift', 'Shift']);
    expect(howtoRows(PAD).map((r) => r.ctl)).toEqual(['RT', 'A', 'B', 'B']);
    expect(howtoRows(TOUCH).map((r) => r.ctl)).toEqual(['GO', 'RELEASE', 'LAND', 'LAND']);
    expect(howtoRows(THUMB).map((r) => r.ctl).slice(0, 3)).toEqual(['the pad', 'the pad', 'the pad']);
    expect(howtoRows(PRO).map((r) => r.ctl)).toEqual(['↑', 'Space', '← →', 'Space']);
    expect(howtoRows({ ...KEY, course: 'lineup' })[1].phase).toMatch(/lift/i);
    expect([KEY, PAD, TOUCH, THUMB].map(deviceTitle)).toEqual(['Keyboard', 'Gamepad', 'Touch · two thumbs', 'Touch · one thumb']);
  });
});

describe('the pointer after a run', () => {
  it('words the fix with the device’s control', () => {
    expect(pointerText('late-land', KEY)).toBe('Land sooner: hold Shift right after you let go');
    expect(pointerText('late-land', TOUCH)).toBe('Land sooner: hold LAND right after you let go');
    expect(pointerText('late-land', THUMB)).toBe('Land sooner: hold the pad right after you let go');
    expect(pointerText('late-land', PAD)).toBe('Land sooner: hold B right after you let go');
    expect(pointerText('no-release', KEY)).toMatch(/press Space/);
    expect(pointerText('no-release', TOUCH)).toMatch(/tap RELEASE/);
    expect(pointerText('short', KEY)).toMatch(/hold F/);
    // Pro brakes by hand: LIFT, at the BRAKE line, the height from the coach's flight.
    expect(pointerText('late-brake', PRO, { needH: 11.2 })).toBe('Brake sooner: press Space at the BRAKE line, 12 m up');
    expect(pointerText('late-brake', { ...PRO, device: 'touch' })).toBe('Brake sooner: hold LIFT at the BRAKE line');
    expect(pointerText('late-brake', KEY)).toMatch(/Land sooner: hold Shift/);   // Assist: LAND paces the fall
  });
  it('every coach fix has words on every device', () => {
    const ids = ['fell-off', 'no-release', 'early-release', 'short', 'no-brake', 'late-land', 'late-brake', 'ran-out', 'late-roll', 'over-roll', 'no-roll', 'tilt', 'mark', 'gas', 'flipped', 'clean'];
    for (const ctx of [KEY, PAD, TOUCH, THUMB, PRO]) for (const id of ids) expect(pointerText(id, ctx), `${id} ${ctx.device}`).toBeTruthy();
  });
  it('picks the costliest fix', () => {
    expect(pickPointer([item('late-land'), item('tilt')], KEY)).toMatchObject({ id: 'late-land', better: '' });
  });
  it('never the same pointer a third time running: the next fix, or the drill for it', () => {
    const hist = ['late-land', 'late-land'];
    expect(pickPointer([item('late-land'), item('tilt')], KEY, { history: hist }).id).toBe('tilt');
    const only = pickPointer([item('late-land')], KEY, { history: hist });
    expect(only.id).toBe('drill:land');
    expect(only.text).toMatch(/Practice → 10 m up/);
    expect(pickPointer([item('late-land')], KEY, { history: ['tilt', 'late-land'] }).id).toBe('late-land');   // twice is fine
  });
  it('says so once it’s fixed', () => {
    const card = { facts: { sink: 3.1, clearance: 1.4 } };
    expect(pickPointer([item('mark')], KEY, { history: ['late-land'], card })).toMatchObject({ id: 'mark', better: 'Better: sink 3.1 m/s' });
    expect(pickPointer([item('late-land')], KEY, { history: ['late-land'], card }).better).toBe('');   // still there
    expect(pickPointer([item('mark')], KEY, { history: ['late-land'], card, crashed: true }).better).toBe('');   // a crash isn't better
    expect(betterText('short', card)).toBe('Better: 1.4 m over the roofs');
  });
});

describe('the live pointer', () => {
  it('names the moment and the control', () => {
    expect(livePointer('release', KEY)).toBe('Let go now: press Space');
    expect(livePointer('release', TOUCH)).toBe('Let go now: tap RELEASE');
    expect(livePointer('land', KEY, (k) => `<kbd>${k}</kbd>`)).toBe('Land now: hold <kbd>Shift</kbd>');
    expect(livePointer('brake', PRO)).toBe('Brake now: press Space');
    expect(livePointer('brake', { ...PRO, device: 'pad' })).toBe('Brake now: press A');
  });
});
