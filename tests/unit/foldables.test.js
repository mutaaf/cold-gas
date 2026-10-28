import { describe, it, expect } from 'vitest';
import { deviceKind, pickDeviceTier } from '../../src/gfx-tier.js';
import { defaultHudMode, fullFits } from '../../src/hud-mode.js';
import { FOLD, FLIP, FOLD_INSETS, insetsFor, dprFor, viewportsFor, touchFor, planShards, planLoad } from '../../scripts/audit-plan.mjs';

// Ticket 0103: the book-style folding phone as Safari reports it (measured on the simulated device in
// Device Hub, docs/backlog/0102): an iPhone UA in every pose, `screen` stuck at the outer screen's 466×678.
const DUO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
const POSES = { closed: [382, 580], closedSide: [594, 368], closedSide2: [678, 384], open: [669, 871], openSide: [951, 589],
  appOpen: [669, 930], appOpenSide: [951, 648], appClosed: [466, 657], appClosedSide: [678, 445] };

describe('the book-style fold, as Safari reports it', () => {
  it('is a phone in every pose, and boots the same tier open or closed', () => {
    for (const [w, h] of Object.values(POSES)) {
      const d = { ua: DUO_UA, maxTouchPoints: 5, coarse: true, screenW: 466, screenH: 678, viewW: w, viewH: h };
      expect(deviceKind(d)).toBe('phone');
      expect(pickDeviceTier(d).tier).toBe(pickDeviceTier({ ...d, viewW: 382, viewH: 580 }).tier);
    }
  });
  it('an unknown touch UA is told by the page it has, not by a stale screen', () => {
    expect(deviceKind({ ua: 'x', coarse: true, screenW: 466, screenH: 678, viewW: 669, viewH: 871 })).toBe('tablet');
    expect(deviceKind({ ua: 'x', coarse: true, screenW: 466, screenH: 678, viewW: 382, viewH: 580 })).toBe('phone');
    expect(deviceKind({ ua: 'x', coarse: true, screenW: 820, screenH: 1180 })).toBe('tablet');   // no viewport: the screen
  });
  it('shows the compact HUD in every pose (by the viewport)', () => {
    for (const [w, h] of Object.values(POSES)) expect(defaultHudMode({ coarse: true, w, h })).toBe('compact');
  });
});

describe('the audit flies the measured poses', () => {
  it('every measured pose, in a tab and installed, at 3× and touch, in `all`', () => {
    const all = viewportsFor('all');
    for (const [w, h] of Object.values(POSES).concat([[466, 498]])) {
      expect(FOLD).toContainEqual([w, h]);
      expect(all).toContainEqual([w, h]);
      expect(dprFor(w, h)).toBe(3);
      expect(touchFor(w, h)).toBe(true);
    }
    expect(FOLD).not.toContainEqual([678, 340]);   // 0075's secondhand size: refuted by the measurement
  });
  it('each pose with its measured insets; the notch pass unchanged; others none', () => {
    expect(insetsFor(594, 368)).toEqual({ t: 0, l: 84, r: 0, b: 0 });
    expect(insetsFor(669, 930)).toEqual({ t: 61, l: 0, r: 0, b: 34 });
    expect(insetsFor(678, 445)).toEqual({ t: 0, l: 84, r: 0, b: 34 });
    expect(insetsFor(382, 580)).toBeNull();
    expect(insetsFor(844, 390, 1)).toEqual({ t: 0, l: 47, r: 47, b: 21 });
    expect(insetsFor(390, 844)).toBeNull();
    for (const k of Object.keys(FOLD_INSETS)) expect(FOLD.map(([w, h]) => `${w}x${h}`)).toContain(k);
  });
  it('six CI shards stay balanced (dearest within 1.25× of the mean)', () => {
    const loads = planShards(viewportsFor('all'), 6).map(planLoad);
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    expect(Math.max(...loads) / mean).toBeLessThan(1.25);
  });
});

describe('room for the full set', () => {
  it('sideways under 720 px on a touch screen: no room; upright, a desktop, or wider: room', () => {
    expect(fullFits({ coarse: true, w: 594, h: 368 })).toBe(false);
    expect(fullFits({ coarse: true, w: 678, h: 445 })).toBe(false);
    expect(fullFits({ coarse: true, w: 814, h: 380 })).toBe(true);
    expect(fullFits({ coarse: true, w: 382, h: 580 })).toBe(true);
    expect(fullFits({ coarse: false, w: 600, h: 400 })).toBe(true);
  });
});

// Ticket 0104: a flip phone's screens (estimates, docs/backlog/0102) are in the gate at 3×, and the full set
// has room on the tall screen upright only.
describe('flip phones', () => {
  it('flies the inner screen both ways and both cover screens, touch at 3×, in `all`', () => {
    const all = viewportsFor('all');
    for (const [w, h] of [[360, 748], [800, 300], [360, 380], [424, 360]]) {
      expect(FLIP).toContainEqual([w, h]);
      expect(all).toContainEqual([w, h]);
      expect(touchFor(w, h)).toBe(true);
      expect(dprFor(w, h)).toBe(3);
    }
  });
  it('the full set fits the tall screen upright, not sideways with the bars, not the cover screen', () => {
    expect(fullFits({ coarse: true, w: 360, h: 748 })).toBe(true);
    expect(fullFits({ coarse: true, w: 800, h: 300 })).toBe(false);
    expect(fullFits({ coarse: true, w: 360, h: 380 })).toBe(false);
    expect(fullFits({ coarse: true, w: 424, h: 360 })).toBe(false);
    expect(fullFits({ coarse: true, w: 844, h: 390 })).toBe(true);   // a phone sideways keeps it
  });
});
