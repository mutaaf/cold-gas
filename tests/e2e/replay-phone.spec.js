import { test, expect } from '@playwright/test';
import { toResults, settle, probe, tapOn } from './replay-probe.js';

// Ticket 0068: on a portrait phone the results sheet covered the whole screen, so Replay showed nothing;
// at 844×390 and 1440×900 the strip beside the sheet showed sky and plumes but not the car. Replay on a
// phone now folds the sheet to a peek at the bottom (verdict, total, Retry · Home · Scores) with the replay
// full-frame above it, one tap or Esc each way; wherever the sheet stays beside the replay, the replay is
// framed in the strip it leaves. Every frame of one replay is sampled: the screen not covered by the results
// (DOM rects) and the hero's centre (carRoot through the camera) inside it.
test.describe.configure({ mode: 'parallel' });
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });
const desk = (width, height) => ({ viewport: { width, height } });

const note = (r) => test.info().annotations.push({ type: 'replay', description: JSON.stringify({ ...r, out: undefined }) });
const sheetBox = (page) => page.evaluate(() => { const r = document.querySelector('.results .sheet').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });

for (const [w, h] of [[390, 844], [430, 932], [320, 568]]) {
  test(`${w}×${h} portrait: Replay folds the sheet to a peek, the car plays above it, one tap brings the sheet back`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage(touch(w, h));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await toResults(page);
    // Somewhere down the sheet, as a player reading the judges would be.
    const scroll = await page.evaluate(() => { const s = document.querySelector('.results .sheet'); s.scrollTop = Math.min(240, s.scrollHeight - s.clientHeight); return s.scrollTop; });
    const quotes = await page.evaluate(() => [...document.querySelectorAll('[data-r-judges] .quote')].map((q) => q.textContent));
    await tapOn(page, '.results .sheet [data-replay]');
    await settle(page);
    await expect(page.locator('.results [data-peek]')).toBeVisible();
    const r = await probe(page);
    note(r);
    expect(r.looped, JSON.stringify(r)).toBe(true);
    expect(r.frames).toBeGreaterThan(30);
    expect(r.minH / h, JSON.stringify(r)).toBeGreaterThanOrEqual(0.75);
    expect(r.inside / r.frames, JSON.stringify(r)).toBeGreaterThanOrEqual(0.9);
    // The end of the replay brought the sheet back; Replay again, then one tap on the peek does it too.
    await expect(page.locator('.results [data-peek]')).toBeHidden();
    await settle(page);
    await tapOn(page, '.results .sheet [data-replay]');
    await settle(page);
    await tapOn(page, '.results [data-peek-back]');
    await settle(page);
    await expect(page.locator('.results [data-peek]')).toBeHidden();
    expect(await sheetBox(page)).toEqual({ l: 0, t: 0, w, h });
    expect(await page.evaluate(() => document.querySelector('.results .sheet').scrollTop)).toBe(scroll);
    // The judges' words were not restarted: each carries on from where it was (a finished quote sets its
    // units without the brackets it was typed with).
    const after = await page.evaluate(() => [...document.querySelectorAll('[data-r-judges] .quote')].map((q) => q.textContent));
    const bare = (t) => t.replace(/[()]/g, '');
    after.forEach((q, i) => expect(bare(q).startsWith(bare(quotes[i])), JSON.stringify([quotes[i], q])).toBe(true));
    expect(errors).toEqual([]);
    await page.close();
  });
}

test('390×844: Esc each way from the keyboard, focus kept; reduced motion is a cut', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(touch(390, 844));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toResults(page);
  await page.locator('.results .sheet [data-replay]').focus();
  await page.keyboard.press('Enter');
  // A cut: on the next frame the peek is up and nothing is moving.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const cut = await page.evaluate(() => {
    const sheet = document.querySelector('.results .sheet'), pk = document.querySelector('.results [data-peek]');
    return { moving: [...sheet.getAnimations(), ...pk.getAnimations()].filter((a) => a.playState === 'running').length, sheetTop: sheet.getBoundingClientRect().top, inert: sheet.inert, peekBottom: pk.getBoundingClientRect().bottom };
  });
  expect(cut).toEqual({ moving: 0, sheetTop: 844, inert: true, peekBottom: 844 });
  await expect(page.locator('.results [data-peek]')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('[data-peek]') != null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.results [data-peek]')).toBeHidden();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('results');   // Esc closed the peek, not the results
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 50))).toContain('data-replay');
  await page.close();
});

// Where the sheet sits beside the replay it stays put, and the replay is framed in the strip it leaves.
for (const [w, h, opts] of [[844, 390, touch(844, 390)], [820, 1180, touch(820, 1180)], [1440, 900, desk(1440, 900)]]) {
  test(`${w}×${h}: the sheet stays where it is; the car plays left of it`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage(opts);
    await toResults(page);
    const before = await sheetBox(page);
    expect(before.l).toBeGreaterThan(0);
    await page.locator('.results .sheet [data-replay]').click();
    await settle(page);
    expect(await sheetBox(page)).toEqual(before);
    await expect(page.locator('.results [data-peek]')).toBeHidden();
    const r = await probe(page);
    note(r);
    expect(r.looped, JSON.stringify(r)).toBe(true);
    expect(r.minW, JSON.stringify(r)).toBe(before.l);
    expect(r.inside / r.frames, JSON.stringify(r)).toBeGreaterThanOrEqual(0.9);
    await page.close();
  });
}
