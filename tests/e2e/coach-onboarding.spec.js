import { test, expect } from '@playwright/test';

// Ticket 0079: a new player knows the controls and gets coached. The first Jump shows how to fly on
// this device (skippable, remembered); the AI assist control is labelled in words on every screen; Adapt
// to me steps the tier down after crashes (with Undo) and offers a harder step after clean landings,
// between runs only; the coach's pointer is one line in the device's words, again as the next run counts
// down; a new player's cue line gives the timely pointer. Runs are stepped from the test (liveStep), the
// crash is full throttle with no release (aftermath.spec.js), the clean run is the reference autopilot,
// handed back to the "player" as the run ends so the coach reads it as theirs. Only the DOM is read.
test.describe.configure({ mode: 'parallel' });
test.slow();

const SIZES = [[382, 580], [390, 844], [844, 390], [678, 340], [951, 543], [1280, 720]];
const touchPage = (browser, w = 390, h = 844) => browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });

async function boot(page, { firstVisit = false, stub = true } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A browser under automation counts as a returning player; this one is new (once: a reload keeps what it set).
  if (firstVisit) await page.addInitScript(() => { if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new'); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  if (stub) await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}

// One run to its sheet. crash: full throttle at the Wall, no release; else the reference flight. The
// autopilot hands over as the run ends, so the coach (and the pointer) treat it as the player's.
const fly = (page, crash, { tier } = {}) => page.evaluate(({ crash, tier }) => {
  const g = window.__coldgas, S = g.S;
  if (tier) g.setTier(tier);
  g.startRun('jump', true);
  const assist = S.flyTier === 'assist' ? 1 : 0;   // the inputs a player on this tier sends (the card's tier is what was flown)
  S.autopilot = crash ? () => ({ throttle: 1, assist }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  const flew = S.flyTier;
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  S.autopilot = null;
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  const vis = (sel) => { const el = document.querySelector(sel); return !!el && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0; };
  return { mode: S.mode, crashed: !!S.card?.facts?.crashed, cardTier: S.card?.tier, flew, tier: S.tier, sink: S.card?.facts?.sink, verdict: S.card?.verdict,
    down: vis('[data-adapt-down]'), up: vis('[data-adapt-up]'), rookie: vis('[data-rookie] [data-rookie-go]') };
}, { crash, tier });

// The floor for anything we add: ≥ 44 × 44 targets, text ≥ 11 px, inside the viewport.
const floor = (loc) => loc.evaluate((el) => {
  const b = el.getBoundingClientRect();
  const sizes = [el, ...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize));
  return { w: b.width, h: b.height, minFont: Math.min(99, ...sizes), inView: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 };
});

// The card fits whole: every row, the note and both buttons on screen, nothing overlapping, no scroll.
const cardFits = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-screen="howto"] .sheet');
  const parts = [...sheet.querySelectorAll('.eyebrow, h2, .howto-rows li, .howto-assist, .actions .btn')].filter((e) => !e.closest('[hidden]'));
  const r = parts.map((e) => e.getBoundingClientRect());
  const issues = [];
  r.forEach((a, i) => {
    if (a.top < 0 || a.left < 0 || a.bottom > innerHeight + 1 || a.right > innerWidth + 1) issues.push(`${parts[i].className || parts[i].tagName} off screen`);
    r.forEach((b, j) => { if (j > i && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) issues.push(`${parts[i].className || parts[i].tagName} × ${parts[j].className || parts[j].tagName}`); });
  });
  if (sheet.scrollHeight > sheet.clientHeight + 1) issues.push('scrolls');
  for (const e of sheet.querySelectorAll('*')) {
    if (e.closest('[hidden]') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(e).fontSize) < 11) issues.push(`"${e.textContent.trim().slice(0, 16)}" < 11 px`);
  }
  for (const b of sheet.querySelectorAll('.actions .btn')) if (!b.closest('[hidden]') && b.getBoundingClientRect().height < 44) issues.push('button < 44 px');
  return issues;
});

test('keyboard: the first Jump shows how to fly (keys), Skip goes straight into the run, and a reload never shows it again', async ({ page }) => {
  const errors = await boot(page, { firstVisit: true });
  await page.locator('[data-start]').click();
  const card = page.locator('[data-screen="howto"]');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-howto-device]')).toHaveText('Keyboard');
  await expect(page.locator('[data-howto-rows] li')).toHaveCount(4);
  await expect(page.locator('[data-howto-rows] kbd')).toHaveText(['↑', 'Space', 'Shift', 'Shift']);
  await expect(page.locator('[data-howto-assist]')).toContainText(/AI assist is on/i);
  await expect(page.locator('[data-howto-go]')).toBeFocused();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('title');   // nothing started under it
  await page.locator('[data-howto-skip]').click();
  await expect(card).toBeHidden();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem('coldgas_howto'))).toBe('seen');
  await page.reload();
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  await expect(card).toBeHidden();
  // Still there any time: the title's How to fly (Escape closes it, focus back where it was).
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.locator('.cta [data-howto-open]').focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-howto-skip]')).toBeHidden();
  await expect(page.locator('[data-howto-go]')).toHaveText('Got it');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('.cta [data-howto-open]')).toBeFocused();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('title');
  expect(errors).toEqual([]);
});

test('touch: the first Jump shows the one-thumb controls; Got it starts the run; not again after a reload', async ({ browser }) => {
  const page = await touchPage(browser);
  const errors = await boot(page, { firstVisit: true });
  await page.locator('[data-start]').tap();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  await expect(page.locator('[data-howto-device]')).toHaveText('Touch · one thumb');
  await expect(page.locator('[data-howto-rows] li').first()).toContainText(/hold\s*the pad/i);
  await expect(page.locator('[data-howto-rows] li').nth(1)).toContainText(/tap\s*the pad/i);
  // The two-thumb scheme, when it's the one in use: its own buttons.
  await page.evaluate(() => window.__coldgas.touch.set('scheme', 'classic'));
  await page.locator('[data-howto-skip]').tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.locator('.cta [data-howto-open]').tap();
  await expect(page.locator('[data-howto-device]')).toHaveText('Touch · two thumbs');
  await expect(page.locator('[data-howto-rows] kbd')).toHaveText(['GO', 'RELEASE', 'LAND', 'LAND']);
  await page.locator('[data-howto-go]').tap();
  await page.evaluate(() => window.__coldgas.touch.set('scheme', 'thumb'));
  await page.reload();
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.locator('[data-start]').tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  await expect(page.locator('[data-screen="howto"]')).toBeHidden();
  expect(errors).toEqual([]);
  await page.close();
});

test('the how-to card fits whole, with no overlaps, at every size (folding phone, phones both ways, desktop)', async ({ browser }) => {
  const touch = await touchPage(browser, 382, 580);
  const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  for (const p of [touch, desk]) await boot(p);
  for (const [w, h] of SIZES) {
    const page = w === 1280 ? desk : touch;
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { window.__coldgas.toTitle(); document.querySelector('.cta [data-howto-open]').click(); });
    await page.waitForTimeout(700);   // the sheet's rise
    expect(await cardFits(page), `${w}×${h}`).toEqual([]);
    await page.keyboard.press('Escape');
  }
  await touch.close(); await desk.close();
});

for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [1280, 720, false]]) {
  test(`${w}×${h}: the AI assist control says what it does, opens the tiers in words, and the sheet carries it too`, async ({ browser }) => {
    const page = touch ? await touchPage(browser, w, h) : await browser.newPage({ viewport: { width: w, height: h } });
    const errors = await boot(page);
    const ctlT = page.locator('.cta [data-assist-open]');
    await expect(ctlT).toBeVisible();
    await expect(ctlT).toContainText(/AI assist/i);
    await expect(ctlT.locator('[data-assist-state]')).toHaveText('On');
    await expect(ctlT.locator('[data-assist-sub]')).toHaveText(/rolls you out, levels and brakes/);
    const m = await floor(ctlT);
    expect(m, JSON.stringify(m)).toMatchObject({ inView: true });
    expect(m.h).toBeGreaterThanOrEqual(44);
    expect(m.w).toBeGreaterThanOrEqual(44);
    expect(m.minFont).toBeGreaterThanOrEqual(11);
    // Open it (tap, or the keyboard), pick Pro: the words and the factor, announced as radios.
    if (touch) await ctlT.tap(); else { await ctlT.focus(); await page.keyboard.press('Enter'); }
    const sheet = page.locator('[data-screen="assist"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-tier-opt="assist"]')).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.locator('[data-tier-opt="pro"]')).toContainText('×1.08');
    await expect(sheet.locator('[data-tier-opt="pro"]')).toContainText(/BRAKE line yourself/);
    await expect(sheet.locator('[data-tier-opt="advanced"]')).toContainText('×1.15');
    await expect(sheet.locator('[data-adapt]')).toHaveAttribute('aria-checked', 'true');
    if (touch) await sheet.locator('[data-tier-opt="pro"]').tap();
    else { await expect(sheet.locator('[data-tier-opt="assist"]')).toBeFocused(); await page.keyboard.press('ArrowDown'); }
    await expect(sheet.locator('[data-tier-opt="pro"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('button[data-tier]')).toContainText('×1.08');
    expect(await page.evaluate(() => ({ tier: window.__coldgas.S.tier, saved: localStorage.getItem('coldgas_tier') }))).toEqual({ tier: 'pro', saved: 'pro' });
    if (touch) await sheet.locator('[data-assist-close]').tap(); else await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(ctlT.locator('[data-assist-state]')).toHaveText('Off · Pro');
    await expect(ctlT.locator('[data-assist-sub]')).toContainText('×1.08');
    if (!touch) await expect(ctlT).toBeFocused();
    // A run keeps the tier it started with: a change mid-run is for the next one.
    const mid = await page.evaluate(() => {
      const g = window.__coldgas, S = g.S;
      g.startRun('jump', true); S.autopilot = () => ({ throttle: 1, assist: 0 }); g.skipCountdown();
      for (let i = 0; i < 20; i++) g.liveStep(0.1);
      g.setTier('assist');
      const during = S.flyTier;
      for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
      return { during, cardTier: S.card.tier, next: S.tier };
    });
    expect(mid).toEqual({ during: 'pro', cardTier: 'pro', next: 'assist' });
    // The results carry the control (and the run's own tier line).
    await expect(page.locator('[data-r-tier]')).toContainText('Pro');
    const ctlR = page.locator('.results [data-assist-open]');
    await expect(ctlR).toBeVisible();
    await expect(ctlR.locator('[data-assist-state]')).toHaveText('On');
    const r = await ctlR.evaluate((el) => { const b = el.getBoundingClientRect(); return { h: b.height, w: b.width }; });
    expect(r.h).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
    await page.close();
  });
}

test('Adapt to me: three crashes in a row on Pro turn AI assist on for the next run, with Undo; off, it stays off and Rookie mode is offered', async ({ page }) => {
  const errors = await boot(page);
  for (let k = 1; k <= 2; k++) expect(await fly(page, true, k === 1 ? { tier: 'pro' } : {})).toMatchObject({ crashed: true, cardTier: 'pro', tier: 'pro', down: false });
  const r3 = await fly(page, true);
  // The third run was flown and scored on Pro; the step is for the next one, said on the sheet.
  expect(r3, JSON.stringify(r3)).toMatchObject({ crashed: true, flew: 'pro', cardTier: 'pro', tier: 'assist', down: true, rookie: false });
  await expect(page.locator('[data-adapt-why]')).toHaveText('AI Assist turned on: 3 crashes in a row on Pro.');
  await expect(page.locator('.results [data-assist-open] [data-assist-state]')).toHaveText('On');
  const undo = page.locator('[data-adapt-undo]');
  const m = await floor(undo);
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.minFont).toBeGreaterThanOrEqual(11);
  await undo.click();
  await expect(page.locator('[data-adapt-down]')).toBeHidden();
  expect(await page.evaluate(() => window.__coldgas.S.tier)).toBe('pro');
  // The next run flies Pro (Undo was the player's choice: the count starts over).
  const r4 = await fly(page, true);
  expect(r4).toMatchObject({ flew: 'pro', tier: 'pro', down: false });
  // Off in the Controls sheet: three more crashes keep Pro, and the sheet offers Rookie mode instead.
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.evaluate(() => document.querySelector('[data-controls-open]').click());
  const sw = page.locator('[data-screen="controls"] [data-adapt]');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('coldgas_adapt'))).toBe('0');
  await page.locator('[data-controls-close]').click();
  for (let k = 0; k < 2; k++) await fly(page, true);
  const r7 = await fly(page, true);
  expect(r7, JSON.stringify(r7)).toMatchObject({ tier: 'pro', down: false, rookie: true });
  expect(errors).toEqual([]);
});

test('three clean landings on AI Assist offer Pro ×1.08 (one tap, never forced); on Easy driving, Standard first', async ({ page }) => {
  const errors = await boot(page);
  const runs = [];
  for (let k = 0; k < 3; k++) runs.push(await fly(page, false, k === 0 ? { tier: 'assist' } : {}));
  for (const r of runs) expect(r, JSON.stringify(r)).toMatchObject({ crashed: false, tier: 'assist', down: false });
  expect(runs.map((r) => r.up)).toEqual([false, false, true]);
  const go = page.locator('[data-adapt-go]');
  await expect(go).toContainText('Ready for Pro? ×1.08');
  await expect(page.locator('[data-adapt-up-why]')).toContainText(/3 clean landings in a row/);
  const m = await floor(go);
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.minFont).toBeGreaterThanOrEqual(11);
  expect(await page.evaluate(() => window.__coldgas.S.tier)).toBe('assist');   // offered, not taken
  await page.evaluate(() => { window.__coldgas.S.prevRun = window.__coldgas.S.run; });
  await go.click();
  expect(await page.evaluate(() => { const S = window.__coldgas.S; return { tier: S.tier, newRun: S.run !== S.prevRun, flew: S.flyTier }; })).toEqual({ tier: 'pro', newRun: true, flew: 'pro' });
  // Easy driving: Standard is offered first.
  await page.evaluate(() => { const g = window.__coldgas; g.toTitle(); g.setTier('assist'); g.driving.set({ level: 'easy' }); });
  const easy = [];
  for (let k = 0; k < 3; k++) easy.push(await fly(page, false));
  expect(easy.map((r) => r.up)).toEqual([false, false, true]);
  await expect(go).toContainText(/Standard driving/);
  await page.evaluate(() => window.__coldgas.driving.set({ level: 'standard' }));
  expect(errors).toEqual([]);
});

test('desktop: the coach\'s pointer is one line with the key in it, and the next run\'s countdown says it again', async ({ page }) => {
  const errors = await boot(page);
  await fly(page, true, { tier: 'assist' });
  const ptr = page.locator('[data-pointer]');
  await expect(ptr).toBeVisible({ timeout: 10_000 });
  const text = (await page.locator('[data-pointer-text]').textContent()).trim();
  expect(text).toMatch(/press Space|hold ↑|hold Shift|hold F/);
  expect(parseFloat(await page.locator('[data-pointer-text]').evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  // On top of the sheet: before the actions.
  const order = await page.evaluate(() => {
    const p = document.querySelector('[data-pointer]').getBoundingClientRect(), a = document.querySelector('.results .top-actions-row').getBoundingClientRect();
    return p.bottom <= a.top + 1;
  });
  expect(order).toBe(true);
  const tip = await page.evaluate(() => {
    const g = window.__coldgas;
    g.startRun('jump', true);
    const cue = document.querySelector('[data-cue]');
    return { on: cue.classList.contains('on'), text: cue.textContent.trim(), mode: g.S.mode };
  });
  expect(tip, JSON.stringify(tip)).toMatchObject({ on: true, mode: 'countdown' });
  expect(tip.text).toBe(`Tip: ${text}`);
  // Never the same pointer a third time running.
  await page.evaluate(() => window.__coldgas.toTitle());
  const seen = [];
  for (let k = 0; k < 3; k++) {
    await fly(page, true);
    await expect(ptr).toBeVisible({ timeout: 10_000 });
    seen.push(await ptr.getAttribute('data-fix'));
  }
  expect(seen[2] === seen[1] && seen[1] === seen[0], JSON.stringify(seen)).toBe(false);
  expect(errors).toEqual([]);
});

test('phone: the pointer names the touch control, on the sheet and in the next countdown', async ({ browser }) => {
  const page = await touchPage(browser);
  const errors = await boot(page);
  await page.evaluate(() => window.__coldgas.touch.set('scheme', 'classic'));
  await fly(page, true, { tier: 'assist' });
  const ptr = page.locator('[data-pointer]');
  await expect(ptr).toBeVisible({ timeout: 10_000 });
  const text = (await page.locator('[data-pointer-text]').textContent()).trim();
  expect(text).toMatch(/tap RELEASE|hold GO|hold LAND|hold BOOST/);
  expect(text).not.toMatch(/Space|Shift/);
  const tip = await page.evaluate(() => { window.__coldgas.startRun('jump', true); return document.querySelector('[data-cue]').textContent.trim(); });
  expect(tip).toBe(`Tip: ${text}`);
  expect(errors).toEqual([]);
  await page.close();
});

test('a new player\'s cue line says "Let go now" with the key, on the ledge', async ({ page }) => {
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.setTier('assist');
    g.startRun('jump', true);
    S.autopilot = g.createAutopilot(g.stage.course);
    g.skipCountdown();
    for (let i = 0; i < 4000 && !(S.run.phase === 'ramp' && !S.released && S.run.t.progress >= 0.92); i++) g.liveStep(0.02);
    S.autopilot = null;
    g.liveStep(0.01);
    const cue = document.querySelector('[data-cue]');
    return { live: S.coachLive, ptr: S.ptr.release, text: cue.textContent.trim(), keys: [...cue.querySelectorAll('kbd')].map((k) => k.textContent) };
  });
  expect(r, JSON.stringify(r)).toMatchObject({ live: true, ptr: 1, keys: ['Space'] });
  expect(r.text).toMatch(/^Let go now: press Space$/);
  expect(errors).toEqual([]);
});
