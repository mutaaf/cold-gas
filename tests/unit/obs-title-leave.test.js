import { describe, it, expect } from 'vitest';
import { createTitleLeave } from '../../src/obs/title-leave.js';
import { PLAY_EVENTS, LEAVE_EVENTS } from '../../src/obs/signature.js';
import { cleanObs } from '../../src/worker/obs.js';

// 0143: a visit that ends on the title. Counts only, once per page load.
const counter = () => {
  const n = {};
  return { n, play: (k) => { n[k] = (n[k] || 0) + 1; } };
};

describe('title-leave (0143)', () => {
  it('a load that never taps Jump and goes counts one title-left and one reason', () => {
    const c = counter(), t = createTitleLeave(c.play);
    expect(t.leave({ mode: 'title' })).toBe('left-title');
    expect(t.leave({ mode: 'title' })).toBeNull();   // the page hides again (pagehide, bfcache): at most once a load
    expect(c.n).toEqual({ 'title-left': 1, 'left-title': 1 });
  });

  it('names the one reason: the how-to card, a start waiting, the title not drawn, or nothing', () => {
    const why = (s) => createTitleLeave(() => {}).leave({ mode: 'title', ...s });
    expect(why({ howto: true, starting: true, drawn: false })).toBe('left-howto');
    expect(why({ starting: true, drawn: false })).toBe('left-starting');
    expect(why({ drawn: false })).toBe('left-booting');
    expect(why({ drawn: true })).toBe('left-title');
    for (const r of ['left-howto', 'left-starting', 'left-booting', 'left-title']) expect(LEAVE_EVENTS).toContain(r);
  });

  it('a load that reaches a run counts no title-left, however it leaves', () => {
    const c = counter(), t = createTitleLeave(c.play);
    t.jumpTap(); t.ran();
    expect(t.leave({ mode: 'title' })).toBeNull();
    expect(c.n).toEqual({ 'jump-tap': 1 });
  });

  it('jump-tap counts once a load, and never after a run', () => {
    const c = counter(), t = createTitleLeave(c.play);
    t.jumpTap(); t.jumpTap(); t.jumpTap();
    expect(c.n['jump-tap']).toBe(1);
    const d = counter(), u = createTitleLeave(d.play);
    u.ran(); u.jumpTap();
    expect(d.n).toEqual({});
  });

  it('a page left off the title (Free Drive, the Sandbox, a drill, the reference) is no title-left', () => {
    const c = counter(), t = createTitleLeave(c.play);
    for (const mode of ['drive', 'countdown', 'live', 'results', 'replay']) expect(t.leave({ mode })).toBeNull();
    expect(c.n).toEqual({});
  });

  it('a load that got past the title once (Free Drive, a drill, the reference) and is back on it is no title-left', () => {
    const c = counter(), t = createTitleLeave(c.play);
    t.mode('title'); t.mode('drive'); t.mode('title');
    expect(t.leave({ mode: 'title' })).toBeNull();
    expect(c.n).toEqual({});
  });

  it('a page hidden on the title that comes back and plays takes its leave back once (title-back)', () => {
    const c = counter(), t = createTitleLeave(c.play);
    expect(t.leave({ mode: 'title' })).toBe('left-title');   // hidden (an app switch, the back-forward cache)
    t.mode('title');
    expect(c.n['title-back'] ?? 0).toBe(0);
    t.jumpTap(); t.mode('countdown'); t.ran(); t.mode('live'); t.mode('title'); t.mode('countdown');
    expect(t.leave({ mode: 'title' })).toBeNull();
    expect(c.n).toEqual({ 'title-left': 1, 'left-title': 1, 'jump-tap': 1, 'title-back': 1 });
  });

  it('the Worker keeps the new names and drops look-alikes', () => {
    for (const k of ['jump-tap', 'title-left', 'title-back', ...LEAVE_EVENTS]) expect(PLAY_EVENTS).toContain(k);
    const b = { v: 1, build: 'abc1234', dc: 'phone-mid', tier: 'high', scale: 0, errs: [], fr: null, rec: [], br: [], auto: false,
      play: { 'jump-tap': 1, 'title-left': 1, 'left-booting': 1, 'left-later': 1, 'title-left2': 3 } };
    expect(cleanObs(b).play).toEqual({ 'jump-tap': 1, 'title-left': 1, 'left-booting': 1 });
  });
});
