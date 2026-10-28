import { describe, it, expect } from 'vitest';
import { foldState, readFold, drastic } from '../../src/fold.js';

// Ticket 0106: which change of size stops a run (src/fold.js drastic), measured sizes from docs/backlog/0102.
describe('drastic', () => {
  const s = (w, h) => ({ w, h });
  it('a fold or an unfold, and its mid-swing sizes, are drastic', () => {
    expect(drastic(s(382, 580), s(669, 871))).toBe(true);    // unfold
    expect(drastic(s(669, 871), s(466, 498))).toBe(true);    // folding, the first size Safari reports
    expect(drastic(s(594, 368), s(867, 589))).toBe(true);    // unfold sideways
    expect(drastic(s(951, 589), s(382, 580))).toBe(true);
  });
  it('turning the screen is drastic; a toolbar is not', () => {
    expect(drastic(s(390, 844), s(844, 390))).toBe(true);
    expect(drastic(s(669, 871), s(669, 906))).toBe(false);   // Safari's toolbar collapsing
    expect(drastic(s(382, 580), s(382, 618))).toBe(false);
    expect(drastic(s(951, 589), s(951, 648))).toBe(false);
    expect(drastic(s(466, 657), s(382, 657))).toBe(false);   // installed, closed: the side inset coming and going
  });
  it('a near-square turning (a flip cover screen) is not a turn; nothing known is nothing', () => {
    expect(drastic(s(360, 380), s(380, 360))).toBe(false);
    expect(drastic(null, s(390, 844))).toBe(false);
    expect(drastic(s(0, 0), s(390, 844))).toBe(false);
  });
});

// Ticket 0105: what a fold the browser reports means for the layout (src/fold.js).
describe('foldState', () => {
  it('one segment, or none reported (Safari, every pose measured): no split', () => {
    expect(foldState({})).toEqual({ split: 'none', fold: null, folded: false });
    expect(foldState({ segments: [{ x: 0, y: 0, width: 382, height: 580 }] }).split).toBe('none');
    expect(foldState({ segments: null, folded: true })).toEqual({ split: 'none', fold: null, folded: true });
  });
  it('two stacked segments (a flip phone half-folded): rows, the hinge between them', () => {
    const f = foldState({ segments: [{ x: 0, y: 0, width: 360, height: 366 }, { x: 0, y: 382, width: 360, height: 366 }], folded: true });
    expect(f).toEqual({ split: 'rows', fold: { x: 0, y: 366, w: 360, h: 16 }, folded: true });
  });
  it('two side by side (a book fold half-open): columns; a seamless hinge is 0 wide', () => {
    expect(foldState({ segments: [{ x: 0, y: 0, width: 467, height: 589 }, { x: 483, y: 0, width: 468, height: 589 }] }))
      .toEqual({ split: 'cols', fold: { x: 467, y: 0, w: 16, h: 589 }, folded: false });
    expect(foldState({ segments: [{ x: 372, y: 0, width: 372, height: 780 }, { x: 0, y: 0, width: 372, height: 780 }] }).fold)
      .toEqual({ x: 372, y: 0, w: 0, h: 780 });   // in either order
  });
  it('reads the browser: segments from window.viewport, the posture from its media query', () => {
    const win = { viewport: { segments: [{ x: 0, y: 0, width: 360, height: 366 }, { x: 0, y: 382, width: 360, height: 366 }] }, matchMedia: (q) => ({ matches: q === '(device-posture: folded)' }) };
    expect(readFold(win)).toMatchObject({ split: 'rows', folded: true });
    expect(readFold({})).toEqual({ split: 'none', fold: null, folded: false });
  });
});
