import { test, expect } from '@playwright/test';

// Ticket 0204: a wreck isn't offered to the board. The critic's sheet read 35.0 "Wrecked" with "Post · would be #1
// today" beside the initials. Now a run whose card says it crashed shows no Post, asks the board no rank (no dry
// request), and Home never asks "Leave without posting?". A landed run keeps Post and its rank (0141:
// network.spec.js 'double-click Post…', first-landing.spec.js). The crash is the Show reference as a jump of the
// player's own, every input zeroed from the release + 0.125 s (wreck-hud.spec.js's: it ends flipped, Wrecked); the
// sim is stepped from the test (liveStep), so the canvas isn't drawn.
test.describe.configure({ mode: 'parallel' });
test.slow();   // a boot and a whole flight on software GL

for (const [w, h, touch] of [[390, 844, true], [1280, 720, false]]) {
  test(`${w}×${h}: a wreck's sheet offers no Post, no rank, and Home doesn't ask to post it`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', () => { throw new Error('no browser dialogs'); });
    let drys = 0, posts = 0;
    await page.route(/\/api\/scores$/, (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (route.request().postDataJSON()?.dry === true) drys++; else posts++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rank: 1, dry: true, card: { total: 35 }, course: 'show', tier: 'assist' }) });
    });
    await page.route(/\/api\/judge\/stream$/, (route) => route.abort());
    await page.goto('/coldgas/?gfx=low&course=show');
    await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
    const card = await page.evaluate(() => {
      const g = window.__coldgas, S = g.S;
      g.stage.render = () => {};
      g.startRun('jump');
      const ap = g.createAutopilot(g.stage.course);
      S.autopilot = (run) => {
        const i = ap(run);
        if (S.released && run.tick - S.releaseTick >= 0.125 * 240) for (const k of g.inputKeys) i[k] = 0;
        return i;
      };
      g.skipCountdown();
      for (let i = 0; i < 4000 && S.run.phase !== 'done'; i++) g.liveStep(0.05);
      S.autopilot = null;   // the player's own run from here (an autopilot's run is never offered the board)
      g.fastForward();
      return { kind: S.runKind, total: S.card?.total, verdict: S.card?.verdict, crashed: !!S.card?.facts?.crashed, jumped: !!S.card?.facts?.jumped };
    });
    const txt = JSON.stringify(card);
    expect(card.kind, txt).toBe('jump');
    expect(card.crashed, txt).toBe(true);
    expect(card.jumped, txt).toBe(true);
    expect(card.total, txt).toBeGreaterThan(0);   // a score the old sheet would have offered the board
    await page.waitForFunction(() => ['results', 'replay'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
    // Give a dry request the time it would have taken to land on the button.
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-r-post]')).toBeHidden();
    await expect(page.locator('[data-r-post-btn]')).toBeHidden();
    expect(await page.evaluate(() => document.querySelector('.results')?.innerText || '')).not.toMatch(/would be #\d/);
    expect(drys).toBe(0);
    // Home goes straight to the title: nothing unposted to ask about.
    await page.keyboard.press('KeyH');
    await expect(page.locator('[data-leave]')).toBeHidden();
    expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('title');
    expect(posts).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
}
