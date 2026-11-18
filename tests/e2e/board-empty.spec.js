import { test, expect } from '@playwright/test';

// 0168: an empty board says what earns a row and offers the Jump that would fill it, for the tab's course. The button
// presses the title's own Jump (the how-to card for a new player), so ads, the how-to and the funnel are unchanged.
// A board with rows and the offline board render as before. One page boot per test (CI's software GL boots slowly).
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ROW = { initials: 'ABC', verdict: 'Clean', facts: { rollDeg: 360, sink: 1.2 }, total: 8.4, tier: 'Assist' };
const HOW = 'Land a jump, then Post with your initials from the results.';

// `board.rows` answers every /scores call ([] empty, null offline); `board.hold` (a course) holds that course's answer.
async function title(page, { howto = 'seen', board = { rows: [] } } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/scores**', async (r) => {
    if (board.hold && r.request().url().includes(`course=${board.hold}`)) await board.held;
    return board.rows === null ? r.abort() : r.fulfill({ json: { rows: board.rows } });
  });
  // A device that has landed a Jump (the title shows the Board) and, unless asked, has seen the how-to card.
  await page.addInitScript((howto) => {
    localStorage.setItem('coldgas_howto', howto);
    localStorage.setItem('coldgas_landings', '1');
  }, howto);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S?.mode === 'title', null, { timeout: 90_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });   // layout only: spare CI's software GL
  return errors;
}
const openBoard = async (page) => {
  await page.evaluate(() => document.querySelector('[data-screen="title"] [data-board-open]').click());
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
};
// Close and the Jump inside the sheet's visible box (a short screen must not scroll Close away), Jump ≥ 44 px.
async function fits(page) {
  const r = await page.evaluate(() => {
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    const sheet = box('[data-screen="board"] .sheet'), j = box('[data-board-jump]'), c = box('[data-board-close]'), rows = box('[data-board-rows]');
    return { sheet: { top: sheet.top, bottom: sheet.bottom, left: sheet.left, right: sheet.right }, j: { top: j.top, bottom: j.bottom, left: j.left, right: j.right, h: j.height }, c: { top: c.top, bottom: c.bottom, left: c.left, right: c.right }, rowsBottom: rows.bottom, vw: innerWidth, sw: document.documentElement.scrollWidth };
  });
  expect(r.j.h).toBeGreaterThanOrEqual(44);
  for (const b of [r.j, r.c]) {
    expect(b.bottom).toBeLessThanOrEqual(r.sheet.bottom + 0.5);
    expect(b.left).toBeGreaterThanOrEqual(r.sheet.left - 0.5); expect(b.right).toBeLessThanOrEqual(r.sheet.right + 0.5);
    expect(b.top).toBeGreaterThanOrEqual(r.rowsBottom - 0.5);
  }
  const apart = r.j.right <= r.c.left + 0.5 || r.c.top >= r.j.bottom - 0.5;   // side by side, or Close under the Jump
  expect(apart).toBe(true);
  expect(r.sw).toBeLessThanOrEqual(r.vw);
}

for (const screen of [{ name: '390×844 touch', ctx: PHONE }, { name: '1280×720', ctx: { viewport: { width: 1280, height: 720 } } }]) {
  test(`${screen.name}: an empty board names what earns a row and offers a Jump for each course tab, Today and All time`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage(screen.ctx);
    const errors = await title(page);
    await openBoard(page);
    const jump = page.locator('[data-board-jump]');
    for (const [course, name] of [['show', 'The Show'], ['wall', 'The Wall'], ['lineup', 'The Lineup']]) {
      await page.locator(`[data-board-course="${course}"]`).click();
      for (const kind of ['all', 'today']) {
        await page.locator(`[data-board="${kind}"]`).click();
        await expect(page.locator('[data-board-rows] .empty')).toContainText(kind === 'all' ? 'yet. Be the first' : 'yet today');
        await expect(jump).toBeVisible();
        await expect(jump).toHaveText(`Jump · ${name}`);
        await expect(page.locator('[data-board-how]')).toHaveText(HOW);
      }
    }
    await fits(page);
    // Reachable by keyboard: Tab gets there inside the sheet.
    let reached = false;
    for (let i = 0; i < 14 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.matches('[data-board-jump]')); }
    expect(reached).toBe(true);
    await page.screenshot({ path: `test-results/board-empty-${screen.ctx.viewport.width}.png` });
    expect(errors).toEqual([]);
    await page.close();
  });
}

test('short and narrow screens keep Close in view beside or under the Jump (568×320 landscape, 320×568)', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
  const errors = await title(page);
  await openBoard(page);
  await expect(page.locator('[data-board-jump]')).toHaveText('Jump · The Show');
  await fits(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-board-course="lineup"]').click();
  await expect(page.locator('[data-board-jump]')).toHaveText('Jump · The Lineup');
  await fits(page);
  expect(errors).toEqual([]);
  await page.close();
});

test('390×844 touch: the empty board\'s Jump closes the board and starts that course, like the title\'s Jump', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(PHONE);
  const errors = await title(page);
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  await openBoard(page);
  await page.locator('[data-board-course="wall"]').click();
  await expect(page.locator('[data-board-jump]')).toHaveText('Jump · The Wall');
  await page.locator('[data-board-jump]').tap();
  await expect(page.locator('[data-screen="board"]')).toBeHidden();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__coldgas.S.run?.course)).toBe('wall');
  expect(await page.evaluate(() => window.__coldgas.obs.plays['jump-tap'] ?? 0)).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

test('390×844 touch: a player who hasn\'t seen the how-to gets it from the board\'s Jump too', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(PHONE);
  const errors = await title(page, { howto: 'new' });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  await openBoard(page);
  const j = await page.locator('[data-board-jump]').boundingBox();
  await page.locator('[data-board-jump]').tap();
  await expect(page.locator('[data-screen="board"]')).toBeHidden();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  // A double-tap's second tap, where the Jump was, lands on nothing: the how-to card is still up, never skipped.
  await page.touchscreen.tap(j.x + j.width / 2, j.y + j.height / 2);
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('title');
  expect(errors).toEqual([]);
  await page.close();
});

test('a tab still loading never offers the tab before it; rows and offline render as before (no Jump, no line)', async ({ browser }) => {
  test.slow();
  const board = { rows: [], hold: 'wall' };
  board.held = new Promise((r) => { board.release = r; });
  const page = await browser.newPage(PHONE);
  const errors = await title(page, { board });
  await openBoard(page);
  await expect(page.locator('[data-board-jump]')).toHaveText('Jump · The Show');
  await page.locator('[data-board-course="wall"]').click();   // the Wall's answer is held
  await expect(page.locator('[data-board-jump]')).toBeHidden();
  await expect(page.locator('[data-board-how]')).toBeHidden();
  board.release();
  await expect(page.locator('[data-board-jump]')).toHaveText('Jump · The Wall');
  await expect(page.locator('[data-board-jump]')).toBeVisible();
  for (const rows of [[ROW], null]) {
    board.rows = rows;
    await page.locator('[data-board-close]').click();
    await openBoard(page);
    await expect(page.locator('[data-board-rows] li').first()).toContainText(rows ? 'ABC' : 'offline');
    await expect(page.locator('[data-board-jump]')).toBeHidden();
    await expect(page.locator('[data-board-how]')).toBeHidden();
    await expect(page.locator('[data-board-close]')).toBeVisible();
  }
  expect(errors).toEqual([]);
  await page.close();
});
