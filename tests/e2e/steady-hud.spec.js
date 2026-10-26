import { test, expect } from '@playwright/test';

// A steady HUD (0047): nothing on it shifts as its numbers change. The telemetry strip is centred, so
// any cell that grows (pitch gaining its "+", fan reaching five figures, SINK taking FAN's place in
// the air) used to slide every cell sideways. And no field zooms iOS on focus: every input computes
// ≥ 16 px on a coarse pointer.

test('the telemetry strip holds still through a whole Show run (1280×720)', async ({ page }) => {
  test.slow();   // the full reveal on CI's software GL
  await page.addInitScript(() => localStorage.setItem('coldgas_hud', 'full'));
  await page.goto('/coldgas/?gfx=low&course=show');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__coldgas.physicsReady());
  // Every frame, where SPD and the strip's edges are, and whether the HUD is in its air layout.
  await page.evaluate(() => {
    const spd = document.querySelector('[data-ch="spd"]'), strip = document.querySelector('.h-strip'), hud = document.querySelector('[data-screen="hud"]');
    const out = window.__steady = { xs: [], ws: [], air: new Set(), pitch: new Set(), fan: new Set(), signed: false };
    const tick = () => {
      if (window.__coldgas.S.mode === 'live' && !hud.hidden) {
        out.xs.push(spd.getBoundingClientRect().left); out.ws.push(strip.getBoundingClientRect().width);
        out.air.add(hud.hasAttribute('data-air'));
        const pt = document.querySelector('[data-pitch]').textContent;
        out.pitch.add(pt.length); if (pt.startsWith('+')) out.signed = true;
        out.fan.add(document.querySelector('[data-fan]').textContent.length);
      }
      if (window.__coldgas.S.mode !== 'results') requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // The reference flight on the Show: the same HUD a player sees, flown the same way every time.
    window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown();
  });
  await page.waitForFunction(() => window.__coldgas.S.run?.phase === 'done' || window.__coldgas.S.mode === 'results', null, { timeout: 150_000 });
  const m = await page.evaluate(() => ({ ...window.__steady, air: [...window.__steady.air], pitch: [...window.__steady.pitch], fan: [...window.__steady.fan] }));
  expect(m.xs.length, 'frames sampled').toBeGreaterThan(30);
  // The run covers the cases that used to move it: both layouts, and readouts of different lengths.
  expect(m.air.sort()).toEqual([false, true]);
  expect(m.signed, 'pitch read with its + sign').toBe(true);
  expect(m.pitch.length, 'pitch lengths seen').toBeGreaterThan(1);
  expect(m.fan.length, 'fan lengths seen').toBeGreaterThan(1);
  expect(Math.max(...m.xs) - Math.min(...m.xs), 'SPD x range, px').toBeLessThan(0.5);
  expect(Math.max(...m.ws) - Math.min(...m.ws), 'strip width range, px').toBeLessThan(0.5);
});

test('every field computes ≥ 16 px on a coarse pointer (no zoom on focus)', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  // The lazy UIs' fields too: the judges' brain sheet is in the document; the build UI's are made on use.
  const small = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'range' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'hidden')
    .map((el) => ({ el: el.outerHTML.slice(0, 80), px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((f) => f.px < 16));
  expect(small).toEqual([]);
  await page.close();
});
