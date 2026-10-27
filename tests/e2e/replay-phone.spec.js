import { test, expect } from '@playwright/test';

// Ticket 0068: on a portrait phone the results sheet covered the whole screen, so Replay showed nothing;
// at 844×390 and 1440×900 the strip beside the sheet showed sky and plumes but not the car. Replay on a
// phone now folds the sheet to a peek at the bottom (verdict, total, Retry · Home · Scores) with the replay
// full-frame above it, one tap or Esc each way; wherever the sheet stays beside the replay, the replay is
// framed in the strip it leaves. Every frame of one replay is sampled: the screen not covered by the results
// (DOM rects) and the hero's centre (carRoot through the camera) inside it.
test.describe.configure({ mode: 'parallel' });
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });
const desk = (width, height) => ({ viewport: { width, height } });

// The reference to its results; the theatre (if it came up) skipped, the panel from local lines.
async function toResults(page) {
  await page.route('**/coldgas/api/**', (r) => r.abort());
  await page.goto('/coldgas/?gfx=low');
  // Everything measured here is DOM boxes against the camera's projection: no pixels are needed, and on
  // software GL a drawn frame takes long enough that one replay would outlast the test.
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.evaluate(() => { const G = window.__coldgas; G.startRun('reveal'); G.skipCountdown(); G.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-r-judges] li').length > 0, null, { timeout: 60_000 });
  // The judges' theatre takes a phone's whole screen for the call: Skip, as a player would, until the
  // call is over and the theatre gone.
  await page.waitForFunction(() => {
    const th = document.querySelector('[data-theatre]');
    if (th && !th.hidden && th.classList.contains('on') && !th.classList.contains('out')) th.querySelector('.th-skip')?.click();
    return !!window.__coldgas.S.callMeta && (!th || th.hidden);
  }, null, { timeout: 90_000, polling: 250 });
  await settle(page);
}
// The results' own slides and fades (not a typing caret's endless blink) have finished.
const moving = () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity && a.effect?.target?.closest?.('.results')).length;
const settle = (page) => page.waitForFunction(`(${moving})() === 0`, null, { timeout: 10_000 });

// Every rAF from the tap until the replay loops: the uncovered rect and whether the car's centre is in it.
function startProbe() {
  const G = window.__coldgas, v = G.carRoot.position.clone();
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const st = { frames: 0, inside: 0, minH: Infinity, minW: Infinity, out: [], stop: false, lastT: -1, looped: false };
  const tick = () => {
    if (st.stop) return;
    const w = innerWidth, h = innerHeight;
    // What the results put over the canvas: the sheet and the peek (clipped to the screen).
    let right = w, bottom = h;
    for (const el of document.querySelectorAll('.results .sheet, .results [data-peek]')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const l = Math.max(0, r.left), t = Math.max(0, r.top), rr = Math.min(w, r.right), b = Math.min(h, r.bottom);
      if (rr - l < 1 || b - t < 1) continue;
      if (rr - l >= w * 0.9) bottom = Math.min(bottom, t); else right = Math.min(right, l);
    }
    st.minH = Math.min(st.minH, bottom); st.minW = Math.min(st.minW, right);
    G.camera.updateMatrixWorld();
    v.copy(G.carRoot.position).project(G.camera);
    const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
    st.frames++;
    if (v.z < 1 && px >= 0 && px <= right && py >= 0 && py <= bottom) st.inside++;
    else if (st.out.length < 12) st.out.push(`${Math.round(px)},${Math.round(py)} shot ${G.director.state.shot} t ${G.S.replayT.toFixed(0)}`);
    if (G.S.replayT < st.lastT) { st.looped = true; st.stop = true; return; }
    st.lastT = G.S.replayT;
    requestAnimationFrame(tick);
  };
  window.__rp = st;
  requestAnimationFrame(tick);
}
const probe = async (page) => {
  await page.evaluate(startProbe);
  await page.waitForFunction(() => window.__rp.looped || window.__coldgas.S.mode !== 'results', null, { timeout: 120_000, polling: 500 });
  return page.evaluate(() => { window.__rp.stop = true; const { frames, inside, minH, minW, out, looped } = window.__rp; return { frames, inside, minH, minW, out, looped }; });
};
// A finger on the button where it is (a locator's tap scrolls the sheet to the sticky row's place in the flow first).
const tapOn = async (page, sel) => {
  const b = await page.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  const hit = await page.evaluate(([x, y, sel]) => { const e = document.elementFromPoint(x, y); return e?.closest(sel) ? 'ok' : e?.outerHTML.slice(0, 80); }, [x, y, sel]);
  expect(hit, `${sel} at ${x},${y}`).toBe('ok');
  await page.touchscreen.tap(x, y);
};
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
