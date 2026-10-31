import { test, expect } from '@playwright/test';

// The cue line and the HUD across a run's edges (0034, 0035): the cue is written only when its
// message changes, every message holds ≥ 400 ms, "Go" shows after the countdown, and a retry's
// countdown shows this run's start instead of the last run's end.

// Every write to the cue line (its text) and every show/hide, with wall-clock timestamps.
const watchCue = () => {
  const el = document.querySelector('[data-cue]');
  const log = (window.__cueLog = []);
  new MutationObserver((recs) => {
    const t = performance.now();
    for (const r of recs) {
      if (r.type === 'childList' && r.target === el) log.push({ t, kind: 'text', text: el.textContent.trim() });
      if (r.type === 'attributes') log.push({ t, kind: el.classList.contains('on') ? 'on' : 'off' });
    }
  }).observe(el, { childList: true, attributes: true, attributeFilter: ['class'] });
};
// How long each message stayed up: from its write to the next write or the line going off.
const spans = (log) => {
  const out = [];
  let cur = null, on = false;
  for (const e of log) {
    if (e.kind === 'text') { if (cur && on) cur.ms = e.t - cur.t; cur = { text: e.text, t: e.t, ms: null }; out.push(cur); on = true; }
    else if (e.kind === 'off') { if (cur && cur.ms == null) cur.ms = e.t - cur.t; on = false; }
    else if (e.kind === 'on') on = true;
  }
  return out;
};
const game = (page, fn, arg) => page.evaluate(fn, arg);

test('a player\'s Show run writes the cue only on change, holds each message, and shows "Go"', async ({ page }) => {
  test.slow();   // a whole Show flown in real time
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  // The cue line is DOM: nothing here needs the 3D. On CI's software GL a live frame takes 0.2–2 s,
  // which made this cue-following bot (one read per frame) too coarse to fly the run and timed it
  // out; with the draw stubbed the page runs at the display rate.
  await game(page, () => { window.__coldgas.stage.render = () => {}; });
  await game(page, () => { window.__coldgas.setTier('assist'); });
  await game(page, watchCue);
  await game(page, () => window.__coldgas.startRun('jump'));
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  // Assist, by the cues (as scripts/play-human.mjs does): crawl in at about 17 mph, let go when the
  // cue says so, then hold BOOST + LAND to the ground.
  const read = () => game(page, () => ({ mode: window.__coldgas.S.mode, speed: Number(document.querySelector('[data-speed]').textContent), cue: document.querySelector('[data-cue]').classList.contains('on') ? document.querySelector('[data-cue]').textContent : '' }));
  let up = false, released = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const st = await read();
    if (st.mode !== 'live') break;
    if (!released && /let go/i.test(st.cue)) {
      if (up) await page.keyboard.up('ArrowUp');
      await page.keyboard.press('Space', { delay: 180 });
      await page.keyboard.down('KeyF'); await page.keyboard.down('ShiftLeft');
      released = true;
    } else if (!released && (st.speed < 17) !== up) {
      up = !up;
      if (up) await page.keyboard.down('ArrowUp'); else await page.keyboard.up('ArrowUp');
    }
    await page.waitForTimeout(40);
  }
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 90_000, polling: 100 });
  await page.keyboard.up('KeyF'); await page.keyboard.up('ShiftLeft');
  expect(released, 'the cue never said to let go').toBe(true);

  const log = await game(page, () => window.__cueLog);
  const writes = log.filter((e) => e.kind === 'text');
  const shown = spans(log);
  console.log(`cue writes: ${writes.length}, class toggles: ${log.length - writes.length}\n${shown.map((s) => `  ${s.ms == null ? '(to the end)' : `${Math.round(s.ms)} ms`}  ${s.text}`).join('\n')}`);
  expect(writes.length).toBeLessThan(10);
  // "Go" follows the countdown and stays up ≥ 400 ms.
  const go = shown.find((s) => s.text === 'Go');
  expect(go, 'Go was never written').toBeTruthy();
  expect(go.ms).toBeGreaterThanOrEqual(400);
  // No message under 400 ms, except one the run's end cleared. (The hold is timed on the frame's
  // clock; these timestamps come from a MutationObserver callback a fraction of a millisecond away:
  // 399.9 ms has been measured for a full hold. 2 ms of slack, far under a frame.)
  for (const s of shown.slice(0, -1)) expect(s.ms, s.text).toBeGreaterThanOrEqual(398);
});

test('phone: "Go" holds after the countdown and the cue line does not flap', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await game(page, watchCue);
  await page.locator('[data-start]').tap();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  // A couple of seconds sitting on the line: the one-thumb pad's cue asks every frame.
  await page.waitForTimeout(2500);
  const log = await game(page, () => window.__cueLog);
  const shown = spans(log);
  const go = shown.find((s) => s.text === 'Go');
  expect(go, 'Go was never written').toBeTruthy();
  expect(go.ms ?? 1e9).toBeGreaterThanOrEqual(400);
  expect(log.filter((e) => e.kind === 'text').length).toBeLessThanOrEqual(3);
  await ctx.close();
});

// The HUD cells a countdown shows (the clock aside), read in one go.
const cells = () => {
  const q = (s) => document.querySelector(s);
  const now = document.querySelector('[data-timeline] [data-state="now"] em');
  return {
    speed: q('[data-speed]').textContent, n2: q('[data-air]').textContent, n2State: q('[data-n2-state]').textContent,
    n2Warn: q('[data-tank]').dataset.state || '', bar: q('[data-tank-bar]').textContent, roll: q('[data-roll]').textContent,
    rollArc: q('[data-roll-arc]').style.strokeDasharray, alt: q('[data-alt]').textContent, sink: q('[data-sink]').textContent,
    g: q('[data-g]').textContent, pitch: q('[data-pitch]').textContent, phase: now ? now.textContent : '',
  };
};

for (const phone of [false, true]) {
  test(`${phone ? 'phone' : 'desktop'}: a retry's countdown shows a fresh HUD, held until the first live frame`, async ({ browser }) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre open
    await page.goto('/coldgas/?gfx=low');
    await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
    // A finished run that leaves the HUD far from a start: the reference, flown to the end.
    await game(page, () => { const G = window.__coldgas; G.startRun('reveal'); G.skipCountdown(); G.fastForward(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
    // Record the cells every frame from the retry to the first live frame.
    await game(page, (cellsSrc) => {
      const read = new Function(`return (${cellsSrc})()`);
      const snaps = (window.__snaps = []);
      const loop = () => {
        const G = window.__coldgas;
        snaps.push({ mode: G.S.mode, tick: G.S.run?.tick ?? -1, cells: read() });
        if (!(G.S.mode === 'live' && G.S.run.tick > 0 && snaps.filter((s) => s.mode === 'live' && s.tick > 0).length >= 2)) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, cells.toString());
    // A phone's sheet carries the call docked (the score first): its pinned Retry is the thumb's.
    if (phone) await page.locator('.results .retry-btn[data-again]').tap();
    else await page.keyboard.press('KeyR');
    const first = await game(page, cells);
    expect(await game(page, () => window.__coldgas.S.mode)).toBe('countdown');
    expect(first.n2).toBe('655');            // a full fill, in lb (US units lead by default)
    expect(first.n2State).toBe('Reg');
    expect(first.n2Warn).toBe('');
    expect(first.speed).toBe('0');
    expect(first.roll).toBe('0');
    expect(first.phase).toBe('01');
    await page.waitForFunction(() => (window.__snaps || []).filter((s) => s.mode === 'live' && s.tick > 0).length >= 2, null, { timeout: 30_000 });
    const snaps = await game(page, () => window.__snaps);
    const count = snaps.filter((s) => s.mode === 'countdown');
    const live = snaps.find((s) => s.mode === 'live' && s.tick > 0);
    expect(count.length).toBeGreaterThan(0);
    // Through the countdown and into the first live frame, nothing but the clock moves. (Not the
    // fan readout: the suction fan really does spool up from the first live tick on the Show.)
    for (const s of [...count, live]) expect(s.cells).toEqual(count[0].cells);
    await ctx.close();
  });
}
