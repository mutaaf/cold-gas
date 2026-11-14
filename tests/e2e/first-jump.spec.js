import { test, expect } from '@playwright/test';

// 0248: the first jump is taught by playing it. On a newcomer's Jump the cue line says the one thing due now (one
// thumb: "Hold to go" with the pad breathing and a Skip chip, "Keep holding", "Tap to let go", "Let it roll", "Hold to
// land"), each gone once done; the first landing gets its own beat ("First landing"), then the calm sheet with Next
// jump and Retry and no Post form; a wreck says one line and offers Retry alone, and the next attempt's guide picks up
// at the step it missed. A thumb is scripted through the one-thumb control (window.__coldgas.thumb) on the live clock,
// stepped from the test; the guide's state is read each step, the DOM where a person would look.
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new'); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}

// A newcomer's Jump to its first hint: on the mark, hands off for half a second.
const toFirstHint = (page) => page.evaluate(() => {
  const g = window.__coldgas, S = g.S;
  S.holdLive = true;
  g.startRun('jump');
  g.skipCountdown();
  for (let i = 0; i < 10; i++) g.liveStep(0.05);
  const cue = document.querySelector('[data-cue]');
  return { shown: S.guide?.shown, cue: cue.textContent, skip: cue.classList.contains('on') && !!cue.querySelector('[data-guide-skip]'), breathing: document.querySelector('[data-onethumb]').hasAttribute('data-guide') };
});
// Then the thumb: held up the curl, a tap on the ledge (or never, `tap: false`), hands off in the air; the hints seen.
const flyThumb = (page, { tap = true } = {}) => page.evaluate(({ tap }) => {
  const g = window.__coldgas, S = g.S, th = g.thumb;
  const seen = [];
  const note = () => { const s = S.guide?.shown || ''; if (s && seen.at(-1) !== s) seen.push(s); };
  const step = (n = 1) => { for (let i = 0; i < n && S.mode === 'live'; i++) { g.liveStep(0.05); note(); } };
  th.down(); step();
  for (let i = 0; i < 2000 && S.mode === 'live' && !(S.run.phase === 'ramp' && S.run.t.progress >= 0.92); i++) step();
  step(8);
  if (tap) { th.up(); step(); th.down(); step(); th.up(); }
  for (let i = 0; i < 4000 && S.mode === 'live' && !S.card; i++) step();
  if (!tap) th.up();
  const beatEl = document.querySelector('[data-beat]');
  step(6);   // the aftermath's first frames: the beat is up
  const beat = { shown: !beatEl.hidden, first: beatEl.hasAttribute('data-first'), verdict: beatEl.querySelector('[data-beat-verdict]').textContent, eyebrow: beatEl.querySelector('[data-beat-eyebrow]').textContent };
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  S.holdLive = false;
  return { seen, beat, landed: !!S.card.facts.jumped && !S.card.facts.crashed, verdict: S.card.verdict, guideDone: S.guide?.done ?? null };
}, { tap });
const shown = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'), sel);

test('phone, one thumb: each hint at its beat and gone once done, then the first landing’s beat and the calm sheet', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  const first = await toFirstHint(page);
  expect(first).toEqual({ shown: 'go', cue: 'Hold to goSkip', skip: true, breathing: true });
  const run = await flyThumb(page);
  expect(run.seen.slice(0, 3)).toEqual(['keep', 'tap', 'roll']);
  expect(run.seen.every((s) => ['keep', 'tap', 'roll', 'land'].includes(s))).toBe(true);
  expect(new Set(run.seen).size).toBe(run.seen.length);   // each once, in order
  expect(run.landed).toBe(true);
  expect(run.beat).toMatchObject({ shown: true, first: true, verdict: 'First landing' });
  expect(run.beat.eyebrow).toContain(run.verdict);
  // The calm sheet: Next jump, then Retry (Beat <score>), then Share; no Post form, no ad, nothing over it.
  const sheet = page.locator('[data-screen="results"]');
  await expect(sheet).toHaveAttribute('data-calm', '');
  await expect(page.locator('.results [data-next]')).toBeVisible();
  await expect(page.locator('.results .top-actions-row [data-again]')).toBeVisible();
  expect(await shown(page, '[data-r-post]')).toBe(false);
  expect(await shown(page, '[data-ai-modal]')).toBe(false);
  // A landed newcomer is a newcomer no more: the next Jump has no guide, the title is today's.
  await page.evaluate(() => { const g = window.__coldgas; g.toTitle(); g.startRun('jump'); });
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => window.__coldgas.S.guide)).toBeNull();
  await page.evaluate(() => window.__coldgas.toTitle());
  await expect(page.locator('[data-screen="title"]')).not.toHaveAttribute('data-first', '');
  expect(errors).toEqual([]);
  await page.close();
});

test('phone: a first jump that never lets go: one line, Retry alone, and the next attempt’s guide starts at the ledge', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  await toFirstHint(page);
  const run = await flyThumb(page, { tap: false });
  expect(run.landed).toBe(false);
  expect(run.beat.shown).toBe(false);
  await expect(page.locator('[data-screen="results"]')).toHaveAttribute('data-first-wreck', '');
  await expect(page.locator('[data-pointer-text]')).toHaveText('Tap on the ledge');
  const visible = await page.evaluate(() => [...document.querySelectorAll('.results .top-actions-row > .btn')].filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none').map((b) => b.innerText.trim()));
  expect(visible).toEqual(['Retry']);
  await page.locator('.results .top-actions-row [data-again]').tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  const again = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    S.holdLive = true; g.skipCountdown();
    for (let i = 0; i < 10; i++) g.liveStep(0.05);
    return { shown: S.guide?.shown ?? null, done: S.guide?.done, skip: !!document.querySelector('[data-cue].on [data-guide-skip]') };
  });
  expect(again.done & 0b11).toBe(0b11);   // go and keep were done last time: not taught again
  expect(again.shown).toBe('');
  expect(again.skip).toBe(false);
  // A drill from Practice is never the lesson, and its sheet isn't the first wreck's.
  const drill = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.toTitle();
    document.querySelector('[data-practice-open]').click();
    document.querySelector('[data-drill]').click();
    return { kind: S.runKind, guide: S.guide };
  });
  expect(drill).toEqual({ kind: 'drill', guide: null });
  expect(errors).toEqual([]);
  await page.close();
});

test('Skip ends the guide for good; keys get it in their own words', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  const hint = await toFirstHint(page);
  expect(hint.skip).toBe(true);
  // (The live clock is the test's: the cue line would let the line go after its 0.6 s without the next frame's ask.)
  await page.evaluate(() => document.querySelector('[data-cue] [data-guide-skip]').click());
  expect(await page.evaluate(() => ({ guide: window.__coldgas.S.guide, saved: localStorage.getItem('coldgas_guide') }))).toEqual({ guide: null, saved: 'skip' });
  await page.evaluate(() => { const g = window.__coldgas; g.toTitle(); g.startRun('jump'); });
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => window.__coldgas.S.guide)).toBeNull();
  await page.close();
  // A keyboard, a first visit: the same moments in its keys.
  const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const e2 = await boot(desk);
  await desk.keyboard.press('KeyG'); await desk.keyboard.press('KeyG');   // the device is the keyboard
  const k = await toFirstHint(desk);
  expect(k.shown).toBe('go');
  expect(k.cue).toContain('Hold ↑ to go');
  expect(errors).toEqual([]);
  expect(e2).toEqual([]);
  await desk.close();
});
