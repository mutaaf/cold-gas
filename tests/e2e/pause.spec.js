import { test, expect } from '@playwright/test';

// The pause sheet fits every screen and speaks the device's controls (0092): on a landscape phone
// Resume and Home are on the glass without scrolling, a touch player isn't handed a keyboard map
// (src/pointer.js's controls for the scheme in use instead), a keyboard keeps its key lists, and no
// label runs into its text.
const G = (page, fn, arg) => page.evaluate(fn, arg);
const touchCtx = (w, h) => ({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });

// A live run, paused the way a phone pauses one: the tab goes hidden (the phone rings), then comes
// back with the sheet up. A key would make the keyboard the device in use.
async function pausedRun(page, { key = false, before = null } = {}) {
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await G(page, () => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  if (before) await before(page);
  if (key) await page.keyboard.press('Escape');
  else {
    await G(page, () => {
      const set = (v) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
      set(true); set(false);
    });
  }
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect(await G(page, () => window.__coldgas.S.paused)).toBe(true);
  await page.waitForTimeout(700);   // the sheet's rise
}

// Each button's box against the sheet's visible box and the viewport, with the sheet at its top.
const fit = (page) => G(page, () => {
  const sheet = document.querySelector('[data-screen="pause"] .sheet');
  sheet.scrollTop = 0;
  const s = sheet.getBoundingClientRect();
  const out = {};
  for (const sel of ['data-resume', 'data-restart', 'data-controls-open', 'data-howto-open', 'data-home']) {
    const r = sheet.querySelector(`[${sel}]`).getBoundingClientRect();
    out[sel] = r.top >= Math.max(s.top, 0) - 0.5 && r.bottom <= Math.min(s.bottom, innerHeight) + 0.5 && r.left >= Math.max(s.left, 0) - 0.5 && r.right <= Math.min(s.right, innerWidth) + 0.5;
  }
  return out;
});

for (const [w, h] of [[844, 390], [568, 320], [320, 568]]) {
  test(`${w}×${h} touch: every pause button is in view, and a tap on Resume resumes`, async ({ browser }) => {
    const ctx = await browser.newContext(touchCtx(w, h));
    const page = await ctx.newPage();
    await pausedRun(page);
    expect(await fit(page)).toEqual({ 'data-resume': true, 'data-restart': true, 'data-controls-open': true, 'data-howto-open': true, 'data-home': true });
    await page.locator('[data-resume]').tap();
    await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
    await expect(page.locator('[data-screen="pause"]')).toBeHidden();
    await ctx.close();
  });
}

// No key a touch screen hasn't got (a lone letter is matched as a word: "Q E", "W S A D", "V B N M").
const KEYBOARD_ONLY = /\b(Shift|Space|Q E|W S A D|V B N M)\b/;
const sheetText = (page) => page.locator('[data-screen="pause"] .sheet').innerText();

for (const [w, h] of [[390, 844], [844, 390]]) {
  test(`${w}×${h} touch: the sheet shows the touch controls in use, no keyboard map`, async ({ browser }) => {
    const ctx = await browser.newContext(touchCtx(w, h));
    const page = await ctx.newPage();
    await pausedRun(page);
    const text = await sheetText(page);
    expect(text).not.toMatch(KEYBOARD_ONLY);
    // The scheme in use, in its own words (src/pointer.js): one-thumb holds the pad, two thumbs hold GO.
    const scheme = await G(page, () => document.querySelector('[data-touch]')?.dataset.scheme);
    expect(text).toMatch(scheme === 'thumb' ? /the pad/ : /GO/);
    await ctx.close();
  });
}

test('1280×720 keyboard: the four keys that matter, and All controls opens every key', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await pausedRun(page, { key: true });
  const text = await sheetText(page);
  expect(text).toMatch(/Shift/);
  expect(text).toMatch(/Space/);
  // Trimmed (audit 2026-10-30): four rows, not the full key map; the rest is one tap away.
  expect(await page.locator('[data-screen="pause"] .keys p').count()).toBe(4);
  expect(text).not.toMatch(/Q E Z C/);
  expect(Object.values(await fit(page)).every(Boolean)).toBe(true);
  await page.locator('[data-all-controls]').click();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await expect(page.locator('[data-ctl-keys]')).toBeVisible();
  await expect(page.locator('[data-ctl-keys]')).toContainText('Q E Z C');
  await page.locator('[data-controls-close]').click();
  await expect(page.locator('[data-screen="controls"]')).toBeHidden();
  // The top bar's Pause (0098) works with a mouse too and keeps no focus (Space and the arrows are the game's);
  // Escape and P still toggle.
  await page.locator('[data-resume]').click();
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
  await page.locator('.top [data-pause]').click();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
  expect(await G(page, () => !!document.activeElement?.matches('[data-pause]'))).toBe(false);   // not handed back on close
  await page.keyboard.press('p');
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(true);
});

// Each label's box ends ≥ 4 px before its text starts (it read "ADVANCEDQ E Z C").
const gaps = (page) => G(page, () => [...document.querySelectorAll('[data-screen="pause"] .keys p')].filter((p) => p.offsetParent).map((p) => {
  const b = p.querySelector('b'), t = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() && n.previousSibling === b);
  const range = document.createRange(); range.selectNodeContents(t);
  const first = range.getClientRects()[0];
  return { label: b.textContent, gap: Math.round((first.left - b.getBoundingClientRect().right) * 10) / 10 };
}));

for (const [w, h, touch] of [[320, 568, true], [390, 844, true], [1440, 900, false], [390, 844, false]]) {
  test(`${w}×${h} ${touch ? 'touch' : 'keyboard'}: no key label touches its text`, async ({ browser }) => {
    const ctx = await browser.newContext(touch ? touchCtx(w, h) : { viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await pausedRun(page, { key: !touch });
    const g = await gaps(page);
    expect(g.length).toBeGreaterThan(2);
    for (const row of g) expect(row.gap, row.label).toBeGreaterThanOrEqual(4);
    await ctx.close();
  });
}

// Paused, the flight readouts step back (0095): the sheet's scrim alone left the HUD at 55 %, legible under the
// glass and cut in half by its edges. Every visible HUD text, the cue, the count and the top bar render at an
// effective opacity ≤ 0.2 (opacity and filter: opacity() up the tree), and Resume brings them back.
const LIT = '[data-screen="hud"] *, .top .brand, .top button, [data-cue], [data-count] *';
const lit = (page, sel) => G(page, (sel) => {
  const eff = (el) => {
    let op = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return 0;
      op *= Number(cs.opacity);
      for (const m of cs.filter.matchAll(/opacity\(([\d.]+)(%?)\)/g)) op *= m[2] ? m[1] / 100 : Number(m[1]);
    }
    return op;
  };
  return [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && (el.tagName === 'BUTTON' || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  }).map((el) => ({ el: `${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''} "${el.textContent.trim().slice(0, 16)}"`, op: Math.round(eff(el) * 1000) / 1000 }))
    .filter((x) => x.op > 0.02);
}, sel);

for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [1440, 900, false]]) {
  test(`${w}×${h} ${touch ? 'touch' : 'keyboard'}: paused, the HUD and the top bar step back; Resume brings them back`, async ({ browser }) => {
    const ctx = await browser.newContext(touch ? touchCtx(w, h) : { viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await pausedRun(page, { key: !touch });
    // Polled: the step back is a 0.35 s fade, and a busy software-GL page can still be inside it.
    await expect.poll(async () => Math.max(...(await lit(page, LIT)).map((x) => x.op)), { timeout: 10_000 }).toBeLessThanOrEqual(0.2);
    const paused = await lit(page, LIT);
    expect(paused.filter((x) => x.el.startsWith('button')).length, 'the top bar has buttons').toBeGreaterThan(0);
    expect(paused.length, 'the HUD has text on screen').toBeGreaterThan(4);
    for (const x of paused) expect(x.op, x.el).toBeLessThanOrEqual(0.2);
    // Back within 0.4 s by the clock the page declares (a wall-clock wait flakes on software GL's busy main thread).
    const STEP = ['.hud', '.top', '[data-cue]', '[data-count]', '[data-drill-bar]'];
    const fades = await G(page, (sels) => sels.map((s) => {
      const cs = getComputedStyle(document.querySelector(s)), props = cs.transitionProperty.split(', ');
      const i = props.indexOf('filter'), durs = cs.transitionDuration.split(', '), dels = cs.transitionDelay.split(', ');
      return i < 0 ? null : parseFloat(durs[i % durs.length]) + parseFloat(dels[i % dels.length]);
    }), STEP);
    for (const d of fades) {
      expect(d).not.toBeNull();
      expect(d).toBeLessThanOrEqual(0.4);
    }
    await page.locator('[data-resume]').click();
    await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
    // Every layer that stepped back is back at full strength (a label's own dimming is its design).
    await expect.poll(() => G(page, (sels) => sels.map((s) => getComputedStyle(document.querySelector(s)).filter), STEP)).toEqual(STEP.map(() => 'none'));
    const back = await lit(page, '.h-timeline *, [data-hud-box] *, .top .brand, .top button');
    expect(back.length).toBeGreaterThan(4);
    expect(Math.max(...back.map((x) => x.op))).toBeGreaterThanOrEqual(0.95);
    await ctx.close();
  });
}

// On a phone the top bar's Menu (0073) stays open over the sheet unless the pause closes it (critic, 0095).
test('390×844 touch: pausing closes the Menu', async ({ browser }) => {
  const ctx = await browser.newContext(touchCtx(390, 844));
  const page = await ctx.newPage();
  await pausedRun(page, {
    before: async (p) => {
      await p.locator('[data-more-toggle]').tap();
      await expect(p.locator('[data-more-toggle]')).toHaveAttribute('aria-expanded', 'true');
      await expect(p.locator('#more-sheet')).toBeVisible();
    },
  });
  await expect(page.locator('[data-more-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#more-sheet')).toBeHidden();
  await ctx.close();
});

// A touch player can pause (0098): the top bar's Pause, a 44 px box inside the screen, one tap from the countdown and
// the live run (ground and air) at every touch size; hidden on the title, the results and the replay. One page and one
// boot for every size (the suite's shards have no minutes to spare, LESSONS 2026-10-29). Paused mid-air by the button,
// the Show's reference flight still scores 97.7 (94.0 before the v27 Show judging, 0121) with a 0.817 m/s touchdown: the pause holds the sim, it doesn't touch it.
test('touch: Pause is one tap from a run at every size, hidden off a run, and a mid-air pause leaves the score', async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext(touchCtx(390, 844));
  const page = await ctx.newPage();
  const btn = page.locator('.top [data-pause]');
  const hidden = () => G(page, () => document.querySelector('.top [data-pause]').getClientRects().length === 0);
  // Exactly one visible Pause, its box ≥ 44 × 44 and inside the viewport.
  const box = () => G(page, () => {
    const vis = [...document.querySelectorAll('[aria-label^="Pause"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const r = vis[0]?.getBoundingClientRect();
    return { n: vis.length, big: !!r && r.width >= 44 && r.height >= 44, inside: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  const ok = { n: 1, big: true, inside: true };
  const tapPauseAndResume = async () => {
    await btn.tap();
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    expect(await G(page, () => window.__coldgas.S.paused)).toBe(true);
    await page.locator('[data-resume]').tap();
    await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
    await expect(page.locator('[data-screen="pause"]')).toBeHidden();   // its "Paused" dialog out of the count
  };
  await page.route('**/coldgas/api/**', (r) => r.abort());   // the results' judges from local lines, no call to wait on
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await G(page, () => { window.__coldgas.stage.render = () => {}; });   // DOM boxes only: no software-GL frames to wait on
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  expect(await hidden()).toBe(true);   // the title

  for (const [w, h] of [[390, 844], [844, 390], [820, 1180], [1180, 820]]) {
    // Turned on the title: a drastic resize mid-run pauses it (0106), which is not what's under test here.
    await G(page, () => window.__coldgas.toTitle());
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);   // the new size settles (main.js foldPause: 500 ms)
    await G(page, () => window.__coldgas.startRun('jump'));
    expect(await G(page, () => window.__coldgas.S.mode)).toBe('countdown');
    expect(await box(), `${w}×${h} countdown`).toEqual(ok);
    await tapPauseAndResume();
    await G(page, () => window.__coldgas.skipCountdown());
    expect(await box(), `${w}×${h} live`).toEqual(ok);
    await tapPauseAndResume();
    expect(await G(page, () => window.__coldgas.S.mode)).toBe('live');
  }

  // The reference flight, paused by the button in the air, then flown to the end.
  await G(page, () => window.__coldgas.toTitle());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await G(page, () => { const cg = window.__coldgas; cg.startRun('reveal'); cg.skipCountdown(); });
  await G(page, () => { const cg = window.__coldgas; for (let i = 0; i < 4000 && cg.S.run.phase !== 'air'; i++) cg.liveStep(1 / 60); for (let i = 0; i < 20; i++) cg.liveStep(1 / 60); });
  expect(await box(), 'air').toEqual(ok);
  await btn.tap();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  // Read after the sheet is up: the live loop kept flying until the tap, so this is where the pause landed.
  const at = await G(page, () => ({ tick: window.__coldgas.S.run.tick, phase: window.__coldgas.S.run.phase, grounded: window.__coldgas.S.run.car.grounded }));
  expect(at.phase).toBe('air');
  expect(at.grounded, 'no wheel on the ground: in the air').toBe(0);
  await page.waitForTimeout(600);   // frames go by under the sheet; the sim holds
  expect(await G(page, () => window.__coldgas.S.run.tick)).toBe(at.tick);
  await page.locator('[data-resume]').tap();
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
  await G(page, () => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results' && window.__coldgas.S.card, null, { timeout: 30_000 });
  const card = await G(page, () => ({ total: window.__coldgas.S.card.total, sink: window.__coldgas.S.run?.t.sink ?? null }));
  expect(card.total).toBe(97.7);
  expect(card.sink).toBeCloseTo(0.817, 3);
  expect(await hidden()).toBe(true);   // the results
  // The replay plays under the results (S.mode stays 'results', the sheet folded to its peek on a phone).
  await G(page, () => document.querySelector('.results .sheet [data-replay]').click());
  await expect(page.locator('.results .peek[data-peek]')).toBeVisible();
  expect(await hidden()).toBe(true);   // the replay
  await ctx.close();
});
