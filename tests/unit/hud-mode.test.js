import { describe, it, expect, vi, afterEach } from 'vitest';
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

  // 0075: a folding phone opened or closed is only a resize. The default follows the new shape, a
  // choice never flips.
  describe('refit on a new screen shape', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
    const device = (w, h) => {
      vi.resetModules();   // a fresh module: no mode decided yet
      const store = new Map();
      vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('coarse') }));
      vi.stubGlobal('innerWidth', w);
      vi.stubGlobal('innerHeight', h);
      vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) });
    };
    it('follows the shape while nothing is chosen', async () => {
      device(382, 580);
      const m = await import('../../src/hud-mode.js');
      expect(m.hudMode()).toBe('compact');
      vi.stubGlobal('innerWidth', 1366); vi.stubGlobal('innerHeight', 1024);   // the big screen
      m.refitHudMode();
      expect(m.hudMode()).toBe('full');
      vi.stubGlobal('innerWidth', 669); vi.stubGlobal('innerHeight', 825);     // opened: still a phone's short side
      m.refitHudMode();
      expect(m.hudMode()).toBe('compact');
      expect(localStorage.getItem('coldgas_hud')).toBe(null);   // following the shape is not a choice
    });
    it('keeps the player\'s choice through any fold', async () => {
      device(382, 580);
      const m = await import('../../src/hud-mode.js');
      m.setHudMode('full');   // one tap on the handle
      for (const [w, h] of [[466, 498], [669, 825], [951, 543], [678, 340]]) {
        vi.stubGlobal('innerWidth', w); vi.stubGlobal('innerHeight', h);
        m.refitHudMode();
        expect(m.hudMode()).toBe('full');
      }
    });
  });
});
