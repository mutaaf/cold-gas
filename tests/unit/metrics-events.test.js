// 0245: the Phase 2 funnel's one vocabulary (src/metrics/events.js) and this device's counters and queue
// (src/metrics/funnel.js). Every event is validated; anything outside the vocabulary is dropped, never thrown.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EVENTS, validate, vocabulary } from '../../src/metrics/events.js';
import { createFunnel } from '../../src/metrics/funnel.js';

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};
const DAY = 86_400_000;

describe('the vocabulary', () => {
  it('names snake_case verbs whose props are numbers and enums only', () => {
    for (const [name, spec] of Object.entries(EVENTS)) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      for (const rule of Object.values(spec)) {
        if (rule === 'num') continue;
        expect(Array.isArray(rule)).toBe(true);
        for (const v of rule) expect(['number', 'string'].includes(typeof v)).toBe(true);
      }
    }
    expect(Object.keys(EVENTS)).toEqual(expect.arrayContaining(['session_start', 'first_input', 'jump_start', 'jump_end', 'first_landing',
      'share_tap', 'share_done', 'challenge_open', 'challenge_play', 'license_pass']));
    expect(vocabulary()).toEqual(JSON.parse(JSON.stringify(EVENTS)));
  });

  it('keeps a good event and rounds its numbers', () => {
    expect(validate('jump_end', { n: 2, course: 'show', tier: 'pro', landed: 1, score: 82.41234 })).toEqual({ n: 2, course: 'show', tier: 'pro', landed: 1, score: 82.412 });
    expect(validate('share_done', { course: 'wall', via: 'file' })).toEqual({ course: 'wall', via: 'file' });
  });

  it('drops unknown names, non-enum values, missing or extra props and non-numbers, without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validate('game_won', {})).toBeNull();
    expect(validate('constructor', {})).toBeNull();
    expect(validate('jump_start', { n: 1, course: 'moon', tier: 'assist' })).toBeNull();
    expect(validate('jump_start', { n: 1, course: 'show' })).toBeNull();
    expect(validate('share_tap', { course: 'show', initials: 'ABC' })).toBeNull();
    expect(validate('first_input', { ms_since_load: 'soon' })).toBeNull();
    expect(validate('first_input', { ms_since_load: NaN })).toBeNull();
    expect(validate('first_input', null)).toBeNull();
    warn.mockRestore();
  });
});

describe('the funnel on this device', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a first visit, a jump, a landing, a retry: the events in order, sent only on flush', () => {
    const sent = [];
    const f = createFunnel({ store: memStore(), now: () => 100 * DAY, send: (n, p) => sent.push([n, p]) });
    f.session();
    f.input(812.4);
    f.input(2000);   // once a page
    const a = f.jumpStart('show', 'assist');
    expect(f.landedEver).toBe(false);
    expect(f.jumpEnd(a, { course: 'show', tier: 'assist', landed: true, score: 83.7 })).toBe(true);
    expect(f.landedEver).toBe(true);
    const b = f.jumpStart('show', 'assist');
    f.jumpEnd(b, { course: 'show', tier: 'assist', landed: true, score: 85 });
    expect(sent).toEqual([]);
    f.flush();
    expect(sent.map(([n]) => n)).toEqual(['session_start', 'first_input', 'jump_start', 'jump_end', 'first_landing', 'jump_start', 'jump_end']);
    expect(sent[0][1]).toEqual({ returning: 0, days_since_last: 0 });
    expect(sent[1][1]).toEqual({ ms_since_load: 812 });
    expect(sent[2][1]).toEqual({ n: 1, course: 'show', tier: 'assist' });
    expect(sent[4][1]).toEqual({ n: 1 });
    expect(sent[5][1].n).toBe(2);
    for (const [, p] of sent) for (const v of Object.values(p)) expect(['number', 'string'].includes(typeof v)).toBe(true);
    f.flush();
    expect(sent).toHaveLength(7);
  });

  it('a returning visitor says how many days since; n caps at 3; a wreck is no first landing', () => {
    const store = memStore({ coldgas_seen: String(95), coldgas_jumps: '7' });
    const sent = [];
    const f = createFunnel({ store, now: () => 100 * DAY + 5, send: (n, p) => sent.push([n, p]) });
    f.session();
    const a = f.jumpStart('wall', 'pro');
    expect(f.jumpEnd(a, { course: 'wall', tier: 'pro', landed: false, score: 12 })).toBe(false);
    const b = f.jumpStart('wall', 'pro');
    expect(f.jumpEnd(b, { course: 'wall', tier: 'pro', landed: true, score: 80 })).toBe(true);
    f.flush();
    expect(sent[0]).toEqual(['session_start', { returning: 1, days_since_last: 5 }]);
    expect(sent[1][1].n).toBe(3);
    expect(sent.find(([n]) => n === 'first_landing')[1]).toEqual({ n: 9 });
    expect(store.map.get('coldgas_seen')).toBe('100');
    expect(store.map.get('coldgas_jumps')).toBe('9');
    expect(store.map.get('coldgas_landings')).toBe('1');
  });

  it('a player from before the counters with a medal on record has landed', () => {
    const f = createFunnel({ store: memStore({ coldgas_medals: JSON.stringify({ 'show:assist': 84 }) }) });
    expect(f.landedEver).toBe(true);
    const g = createFunnel({ store: memStore({ coldgas_medals: JSON.stringify({ 'show:assist': 31 }) }) });
    expect(g.landedEver).toBe(false);
  });

  it('storage that throws keeps the game going', () => {
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const f = createFunnel({ store: bad, send: () => { throw new Error('no network'); } });
    f.session();
    const a = f.jumpStart('lineup', 'advanced');
    expect(() => f.jumpEnd(a, { course: 'lineup', tier: 'advanced', landed: true, score: 90 })).not.toThrow();
    expect(() => f.flush()).not.toThrow();
  });

  it('an invalid event never reaches the queue', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = createFunnel({ store: memStore() });
    expect(f.emit('share_done', { course: 'show', via: 'fax' })).toBe(false);
    expect(f.queued).toBe(0);
  });
});

describe('track()', () => {
  afterEach(() => { delete globalThis.window; vi.resetModules(); });
  it('on localhost sends only to a stub that is already there, and never queues for a loader', async () => {
    globalThis.window = { location: { hostname: 'localhost' } };
    const { track } = await import('../../src/insights.js');
    track('share_tap', { course: 'show' });
    expect(globalThis.window.boxoffice).toBeUndefined();
    const calls = [];
    globalThis.window.boxoffice = { track: (...a) => calls.push(a) };
    track('share_tap', { course: 'show' });
    expect(calls).toEqual([['share_tap', { course: 'show' }]]);
  });
  it('in production queues until the loader lands', async () => {
    globalThis.window = { location: { hostname: 'mutaafaziz.com' } };
    const { track } = await import('../../src/insights.js');
    track('session_start', { returning: 0, days_since_last: 0 });
    expect(globalThis.window.boxoffice.q).toEqual([['session_start', { returning: 0, days_since_last: 0 }]]);
  });
});
