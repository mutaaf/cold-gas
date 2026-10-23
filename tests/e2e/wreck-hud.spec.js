import { test, expect } from '@playwright/test';

// Ticket 0072: on a phone a wreck reads as a wreck. The compact HUD (0061) folds the vehicle panel
// away, and the damage sensor went with it: a car on its roof read `07 TOUCHDOWN · SPD 1 mph …` in
// white. Now the compact line carries the damage (state word and %, the full panel's colours, in G's
// place) once the car is hurt, and in both HUD modes a crashed end reads as the crash on the timeline.
// The crash is the critic's: the Show reference with every input zeroed from the release + 0.125 s
// (it ends `flipped`, 66 % Wrecked under SIM_VERSION 26). The sim is stepped from the test (liveStep,
// 0.1 s at a time); only the DOM is read, so the canvas isn't drawn.
test.describe.configure({ mode: 'parallel' });
test.slow();   // a boot and a whole flight on software GL
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });

async function fly(page, { crash }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre
  await page.goto('/coldgas/?gfx=low');
  // (physicsReady is a function: wait on it, docs/LESSONS.md.)
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  const r = await page.evaluate((crash) => {
    const g = window.__coldgas, S = g.S;
    g.stage.render = () => {};
    g.startRun('reveal'); g.skipCountdown();
    if (crash) {
      const ap = S.autopilot;
      S.autopilot = (run) => {
        const i = ap(run);
        if (S.released && run.tick - S.releaseTick >= 0.125 * 240) for (const k of g.inputKeys) i[k] = 0;
        return i;
      };
    }
    for (let i = 0; i < 900 && S.run.phase !== 'done'; i++) g.liveStep(0.1);
    g.liveStep(0.1);   // a frame into the aftermath, as a player sees it
    const vis = (el) => {
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (e.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      const b = el.getBoundingClientRect();
      return b.width > 1 && b.height > 1;
    };
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const cell = document.querySelector('.h-strip > [data-ch="dmg"]'), strip = document.querySelector('.h-strip');
    const lis = [...document.querySelectorAll('[data-timeline] li')];
    // The HUD's share of the screen (0061's 12 % budget), on a 4 px grid like hud-collapse.spec.js.
    const C = 4, gw = Math.ceil(innerWidth / C), gh = Math.ceil(innerHeight / C), grid = new Uint8Array(gw * gh);
    for (const el of document.querySelectorAll('[data-hud-box], [data-hud-toggle]')) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      for (let y = Math.max(0, Math.floor(b.top / C)); y < Math.min(gh, Math.ceil(b.bottom / C)); y++) {
        for (let x = Math.max(0, Math.floor(b.left / C)); x < Math.min(gw, Math.ceil(b.right / C)); x++) grid[y * gw + x] = 1;
      }
    }
    return {
      hud: document.documentElement.dataset.hud, reason: S.run.t.endReason, crashed: !!S.card?.facts?.crashed, phase: S.run.phase,
      dmgState: document.querySelector('[data-dmg]').dataset.state, dmgPct: document.querySelector('[data-dmg-pct]').textContent,
      panelRed: getComputedStyle(document.querySelector('[data-dmg-pct]')).color, panelWordRed: getComputedStyle(document.querySelector('[data-dmg-word]')).color,
      cell: { vis: vis(cell), text: cell.innerText.replace(/\s+/g, ' ').trim(), pct: cell.querySelector('b').textContent,
        color: getComputedStyle(cell.querySelector('b')).color, wordColor: getComputedStyle(cell.querySelector('.h-lbl')).color, box: rect(cell), sw: cell.scrollWidth, cw: cell.clientWidth },
      strip: rect(strip), g: vis(document.querySelector('.h-strip > [data-ch="g"]')),
      steps: lis.map((li) => ({ text: li.textContent.trim(), state: li.dataset.state || '', crash: li.dataset.crash || '', vis: vis(li.querySelector('span')), color: getComputedStyle(li.querySelector('span')).color })),
      cover: grid.reduce((n, v) => n + v, 0) / grid.length,
    };
  }, crash);
  return { r, errors };
}

for (const [w, h] of [[390, 844], [844, 390]]) {
  test(`${w}×${h} compact: the zeroed-input wreck shows WRECKED and its % on the line, in the panel's red; the timeline says FLIPPED`, async ({ browser }) => {
    const page = await browser.newPage(touch(w, h));
    const { r, errors } = await fly(page, { crash: true });
    const txt = JSON.stringify(r);
    expect(r.hud, txt).toBe('compact');
    expect(r.reason, txt).toBe('flipped');
    expect(r.crashed, txt).toBe(true);
    expect(r.dmgState, txt).toBe('wreck');
    // The cell: on screen, the same word and % as the full panel, in its red, all of it inside the cell.
    expect(r.cell.vis, txt).toBe(true);
    expect(r.cell.text.toUpperCase(), txt).toContain('WRECKED');
    expect(r.cell.pct, txt).toBe(r.dmgPct);
    expect(r.cell.text, txt).toContain(`${r.dmgPct}`);
    expect(r.cell.color, txt).toBe(r.panelRed);
    expect(r.cell.wordColor, txt).toBe(r.panelWordRed);
    expect(r.cell.sw, txt).toBeLessThanOrEqual(r.cell.cw + 1);
    expect(r.cell.box.x, txt).toBeGreaterThanOrEqual(r.strip.x - 1);
    expect(r.cell.box.x + r.cell.box.w, txt).toBeLessThanOrEqual(r.strip.x + r.strip.w + 1);
    expect(r.g, 'the damage cell takes G\'s place: the line doesn\'t grow').toBe(false);
    expect(r.cover, txt).toBeLessThanOrEqual(0.12);
    // The timeline: no TOUCHDOWN as the step you're on; the step you're on is the crash, in red, and seen.
    for (const s of r.steps) if (/touchdown/i.test(s.text)) expect(s.state, txt).not.toBe('now');
    const now = r.steps.filter((s) => s.state === 'now');
    expect(now.length, txt).toBe(1);
    expect(now[0].text, txt).toBe('07 Flipped');
    expect(now[0].crash, txt).toBe('Flipped');
    expect(now[0].vis, txt).toBe(true);
    expect(now[0].color, txt).toBe(r.panelRed);
    expect(errors).toEqual([]);
  });
}

test('1440×900 full: the same wreck ends the timeline on FLIPPED, not TOUCHDOWN; the line keeps G', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const { r, errors } = await fly(page, { crash: true });
  const txt = JSON.stringify(r);
  expect(r.hud, txt).toBe('full');
  expect(r.reason, txt).toBe('flipped');
  for (const s of r.steps) if (/touchdown/i.test(s.text)) expect(s.state, txt).not.toBe('now');
  const now = r.steps.find((s) => s.state === 'now');
  expect(now.text, txt).toBe('07 Flipped');
  expect(now.color, txt).toBe(r.panelRed);
  expect(r.cell.vis, 'the full set has the vehicle panel: no damage cell on the line').toBe(false);
  expect(r.g, txt).toBe(true);
  expect(errors).toEqual([]);
});

for (const [w, h, opts] of [[390, 844, touch(390, 844)], [1280, 720, { viewport: { width: 1280, height: 720 } }]]) {
  test(`${w}×${h}: a clean reference landing still ends on 07 TOUCHDOWN`, async ({ browser }) => {
    const page = await browser.newPage(opts);
    const { r, errors } = await fly(page, { crash: false });
    const txt = JSON.stringify(r);
    expect(r.phase, txt).toBe('done');
    expect(r.crashed, txt).toBe(false);
    const now = r.steps.filter((s) => s.state === 'now');
    expect(now.length, txt).toBe(1);
    expect(now[0].text, txt).toBe('07 Touchdown');
    expect(now[0].crash, txt).toBe('');
    expect(now[0].vis, txt).toBe(true);
    expect(errors).toEqual([]);
  });
}

// A retry after the wreck starts clean: TOUCHDOWN is back in the timeline and the damage cell is gone.
test('390×844 compact: Retry after the wreck clears the crash step and the damage cell', async ({ browser }) => {
  const page = await browser.newPage(touch(390, 844));
  const { r } = await fly(page, { crash: true });
  expect(r.steps.at(-1).text).toBe('07 Flipped');
  const after = await page.evaluate(() => {
    const g = window.__coldgas;
    g.startRun('jump'); g.skipCountdown(); g.liveStep(0.1);
    const cell = document.querySelector('.h-strip > [data-ch="dmg"]');
    return { last: document.querySelector('[data-timeline] li:last-child').textContent.trim(), crash: document.querySelector('[data-timeline] [data-crash]') !== null,
      dmg: document.querySelector('[data-screen="hud"]').dataset.damage ?? null, cell: getComputedStyle(cell).display, g: getComputedStyle(document.querySelector('.h-strip > [data-ch="g"]')).display };
  });
  expect(after).toEqual({ last: '07 Touchdown', crash: false, dmg: null, cell: 'none', g: 'flex' });
});
