// The countdown numeral's slot (0070, src/count-slot.js): the free band it stands in, clear of the HUD.
import { describe, it, expect } from 'vitest';
import { countSlot } from '../../src/count-slot.js';

const box = (x, y, r, b) => ({ x, y, r, b });
const clear = (s, vh, vw, w, h, boxes) => {
  // The numeral, centred in its band at its scale, crosses none of the boxes.
  const H = h * s.scale, W = w * s.scale, cy = s.top + (vh - s.top - s.bottom) / 2;
  const n = { x: (vw - W) / 2, r: (vw + W) / 2, y: cy - H / 2, b: cy + H / 2 };
  return boxes.every((o) => o.r <= n.x || o.x >= n.r || o.b <= n.y || o.y >= n.b);
};

describe('the countdown slot', () => {
  it('is the whole screen when nothing crosses the numeral', () => {
    expect(countSlot(844, [box(16, 60, 130, 270)], 50, 110, 390)).toEqual({ top: 0, bottom: 0, scale: 1 });
  });

  it('stands below the telemetry panel on a 390x844 phone, full HUD (the scout\'s collision)', () => {
    // The measured boxes of main at 390x844 full: the top bar, the timeline, the strip (y 268-411).
    const boxes = [box(156, 20, 374, 56), box(160, 58, 320, 90), box(90, 268, 374, 411)];
    const s = countSlot(844, boxes, 52, 113, 390);
    expect(s.top).toBeGreaterThanOrEqual(411);
    expect(s.scale).toBe(1);
    expect(clear(s, 844, 390, 52, 113, boxes)).toBe(true);
  });

  it('keeps clear of a thumb pad and a cue too', () => {
    const boxes = [box(156, 20, 374, 56), box(90, 268, 374, 411), box(16, 444, 374, 480), box(130, 640, 260, 800)];
    const s = countSlot(844, boxes, 52, 113, 390);
    expect(s.scale).toBe(1);
    expect(clear(s, 844, 390, 52, 113, boxes)).toBe(true);
  });

  it('shrinks the numeral to the tallest band when none holds it (320x568, full HUD)', () => {
    const boxes = [box(0, 0, 320, 120), box(90, 238, 304, 304), box(16, 318, 304, 372), box(0, 480, 320, 568)];
    const s = countSlot(568, boxes, 32, 160, 320);
    expect(s.scale).toBeLessThan(1);
    expect(clear(s, 568, 320, 32, 160, boxes)).toBe(true);
  });

  it('prefers the band nearest the middle among those that fit', () => {
    const s = countSlot(1000, [box(0, 300, 1000, 340)], 100, 100, 1000);
    expect(s).toEqual({ top: 348, bottom: 0, scale: 1 });
  });

  it('ignores boxes beside the numeral\'s column', () => {
    expect(countSlot(720, [box(0, 300, 500, 400), box(780, 300, 1280, 400)], 116, 188, 1280)).toEqual({ top: 0, bottom: 0, scale: 1 });
  });
});
