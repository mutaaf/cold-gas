import { describe, it, expect } from 'vitest';
import { defaultHudMode, hudToggleHtml, HUD_MODES } from '../../src/hud-mode.js';

// Ticket 0061: phones and small tablets start with the compact HUD; desktops and big tablets with
// every instrument. (The layout, the toggle and its memory are tests/e2e/hud-collapse.spec.js.)
describe('hud mode', () => {
  it('starts compact on a touch screen up to a small tablet, full everywhere else', () => {
    expect(defaultHudMode({ coarse: true, w: 390, h: 844 })).toBe('compact');   // phone upright
    expect(defaultHudMode({ coarse: true, w: 844, h: 390 })).toBe('compact');   // phone sideways
    expect(defaultHudMode({ coarse: true, w: 820, h: 1180 })).toBe('compact');  // 11" tablet
    expect(defaultHudMode({ coarse: true, w: 1180, h: 820 })).toBe('compact');
    expect(defaultHudMode({ coarse: true, w: 1024, h: 1366 })).toBe('full');    // 13" tablet
    expect(defaultHudMode({ coarse: false, w: 390, h: 844 })).toBe('full');     // a narrow desktop window
    expect(defaultHudMode({ coarse: false, w: 1280, h: 720 })).toBe('full');
    expect(defaultHudMode()).toBe('full');
  });

  it('the handle is a real button that names what a tap does', () => {
    expect(HUD_MODES).toEqual(['compact', 'full']);
    const html = hudToggleHtml();
    expect(html).toMatch(/^<button type="button" class="h-handle" data-hud-toggle aria-expanded="(true|false)" aria-label="Show (all|fewer) instruments \(I\)"/);
    expect(html).toContain('More');
    expect(html).toContain('Less');
  });
});
