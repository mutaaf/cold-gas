// The last device used wins (src/input.js): a key or a pad hides the touch controls and takes the run
// off one-thumb, a finger brings them back, and only a change across touch / not-touch is heard.
import { describe, it, expect } from 'vitest';
import { createDevice, padIntent, isEditable, keyHolds, resetInput, freshRun, pollPads, sample } from '../../src/input.js';

const pad = ({ axes = [0, 0, 0, 0], pressed = [], values = {} } = {}) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe('last-device arbitration', () => {
  it('a phone starts on touch; a key takes it off, a finger puts it back', () => {
    const d = createDevice('touch'), heard = [];
    d.on((k) => heard.push(k));
    expect(d.touch).toBe(true);
    d.note('key');
    expect(d.touch).toBe(false);
    expect(d.last).toBe('key');
    d.note('touch');
    expect(d.touch).toBe(true);
    expect(heard).toEqual(['key', 'touch']);
  });

  it('switching between keys, pad and mouse is not a touch change', () => {
    const d = createDevice('none'), heard = [];
    d.on((k) => heard.push(k));
    d.note('key'); d.note('pad'); d.note('mouse'); d.note('mouse');
    expect(d.last).toBe('mouse');
    expect(heard).toEqual([]);
    d.note('touch');          // a touchscreen laptop's first tap
    d.note('touch');
    d.note('pad');            // then a controller
    expect(heard).toEqual(['touch', 'pad']);
  });

  it('a listener can be removed', () => {
    const d = createDevice('none'), heard = [];
    const off = d.on((k) => heard.push(k));
    off();
    d.note('touch');
    expect(heard).toEqual([]);
  });
});

describe('gamepad intent', () => {
  it('an idle pad (a little drift, triggers at rest) is not in use', () => {
    expect(padIntent(null)).toBe(false);
    expect(padIntent(pad({ axes: [0.08, -0.12, 0.2, 0] }))).toBe(false);
    expect(padIntent(pad({ values: { 6: 0.1 } }))).toBe(false);
  });
  it('a pressed button, a pulled trigger or a pushed stick is', () => {
    expect(padIntent(pad({ pressed: [0] }))).toBe(true);
    expect(padIntent(pad({ values: { 7: 0.6 } }))).toBe(true);
    expect(padIntent(pad({ axes: [0, -0.9, 0, 0] }))).toBe(true);
    // axes past the two sticks (some pads park a trigger at -1 there) never count
    expect(padIntent(pad({ axes: [0, 0, 0, 0, -1, -1] }))).toBe(false);
  });
});

describe('the editable-target guard', () => {
  const el = (match) => ({ closest: (sel) => (sel.split(',').some((s) => s.trim().startsWith(match)) ? {} : null) });
  it('fields of every kind are editable; the page is not', () => {
    for (const tag of ['input', 'select', 'textarea', '[contenteditable]']) expect(isEditable(el(tag))).toBe(true);
    expect(isEditable({ closest: () => null })).toBe(false);
    expect(isEditable(null)).toBe(false);
    expect(isEditable({})).toBe(false);
  });
});

// A restart lets go of everything, like pause (0099): what is still held then counts again only on a
// fresh press. A restart with Space held used to lift the new run off the line inside a second.
describe('a reset waits for a fresh press', () => {
  it("a key's auto-repeat doesn't bring back a key we let go of; a real press does", () => {
    const held = new Set();
    expect(keyHolds({ code: 'Space', repeat: false }, held)).toBe(true);
    held.add('Space');
    expect(keyHolds({ code: 'Space', repeat: true }, held)).toBe(true);    // still held: repeats are harmless
    held.clear();                                                          // resetInput
    expect(keyHolds({ code: 'Space', repeat: true }, held)).toBe(false);   // the old press, repeating
    expect(keyHolds({ code: 'Space', repeat: false }, held)).toBe(true);   // pressed again
  });

  it('a gamepad held through a reset drives nothing until it has been at rest once', () => {
    const p = pad({ pressed: [0, 7], values: { 7: 1 } });
    const nav = globalThis.navigator;
    const had = Object.getOwnPropertyDescriptor(nav, 'getGamepads');
    Object.defineProperty(nav, 'getGamepads', { configurable: true, value: () => [p, null, null, null] });
    try {
      const drive = () => { pollPads(); const o = sample('drive', 'assist'); return [o.lift, o.throttle > 0]; };
      expect(drive()).toEqual([1, true]);          // A (LIFT) and RT, held
      resetInput();
      expect(drive()).toEqual([0, false]);          // still held from before the reset: ignored
      expect(drive()).toEqual([0, false]);
      const btn = (i, on) => { p.buttons[i].pressed = on; p.buttons[i].value = on ? 1 : 0; };
      btn(0, false); btn(7, false);
      expect(drive()).toEqual([0, false]);          // let go: at rest
      btn(0, true);
      expect(drive()[0]).toBe(1);                   // a fresh press counts
      // A pad at rest (a little stick drift) is never held off by a reset.
      btn(0, false); p.axes[0] = 0.3;
      resetInput();
      pollPads();
      btn(0, true);
      expect(drive()[0]).toBe(1);
    } finally {
      if (had) Object.defineProperty(nav, 'getGamepads', had); else delete nav.getGamepads;
      freshRun();
    }
  });
});
