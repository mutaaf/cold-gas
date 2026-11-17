import { test, expect } from '@playwright/test';

// 0168: an empty board says what earns a row and offers the Jump that would fill it, for the tab's course. The button
// starts the title's own Jump (the how-to card for a new player), so ads, the how-to and the funnel are unchanged.
// A board with rows and the offline board render as before.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ROW = { initials: 'ABC', verdict: 'Clean', facts: { rollDeg: 360, sink: 1.2 }, total: 8.4, tier: 'Assist' };

async function title(page, { rows = [], howto = 'seen' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/scores**', (r) => (rows === null ? r.abort() : r.fulfill({ json: { rows } })));
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

for (const screen of [{ name: '390×844 touch', ctx: PHONE }, { name: '1280×720', ctx: { viewport: { width: 1280, height: 720 } } }]) {
  test(`${screen.name}: an empty board names what earns a row and offers a Jump for each course tab`, async ({ browser }) => {
    const page = await browser.newPage(screen.ctx);
    const errors = await title(page);
    await openBoard(page);
    const jump = page.locator('[data-board-jump]');
    for (const [course, name] of [['show', 'The Show'], ['wall', 'The Wall'], ['lineup', 'The Lineup']]) {
      await page.locator(`[data-board-course="${course}"]`).click();
      await expect(jump).toHaveText(`Jump · ${name}`);
      await expect(page.locator('[data-board-rows] .empty')).toContainText('No jumps on');
      await expect(page.locator('[data-board-how]')).toHaveText('Land a jump, then Post · ABC from the results.');
      await page.locator('[data-board="all"]').click();
      await expect(jump).toHaveText(`Jump · ${name}`);
      await page.locator('[data-board="today"]').click();
      await expect(jump).toHaveText(`Jump · ${name}`);
    }
    await expect(jump).toBeVisible();
    // Fits: a 44 px target, inside the sheet, no overlap with Close or the rows.
    const box = (sel) => page.locator(sel).boundingBox();
    const b = await box('[data-board-jump]'), close = await box('[data-board-close]'), sheet = await box('[data-screen="board"] .sheet');
    const how = await box('[data-board-how]'), rows = await box('[data-board-rows]');
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x).toBeGreaterThanOrEqual(sheet.x); expect(b.x + b.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(sheet.y + sheet.height + 0.5);
    expect(b.y).toBeGreaterThanOrEqual(how.y + how.height - 0.5);
    expect(how.y).toBeGreaterThanOrEqual(rows.y + rows.height - 0.5);
    expect(close.y).toBeGreaterThanOrEqual(b.y + b.height - 0.5);
    // Reachable by keyboard: Tab gets there inside the sheet.
    let reached = false;
    for (let i = 0; i < 14 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.matches('[data-board-jump]')); }
    expect(reached).toBe(true);
    await page.screenshot({ path: `test-results/board-empty-${screen.ctx.viewport.width}.png` });
    expect(errors).toEqual([]);
    await page.close();
  });
}

test('390×844 touch: the empty board\'s Jump closes the board and starts that course, like the title\'s Jump', async ({ browser }) => {
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
  const page = await browser.newPage(PHONE);
  const errors = await title(page, { howto: 'new' });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  await openBoard(page);
  await page.locator('[data-board-jump]').tap();
  await expect(page.locator('[data-screen="board"]')).toBeHidden();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('title');
  expect(errors).toEqual([]);
  await page.close();
});

test('a board with rows and the offline board render as before: no Jump, no how-to line', async ({ browser }) => {
  for (const rows of [[ROW], null]) {
    const page = await browser.newPage(PHONE);
    await title(page, { rows });
    await openBoard(page);
    await expect(page.locator('[data-board-rows] li').first()).toContainText(rows ? 'ABC' : 'offline');
    await expect(page.locator('[data-board-jump]')).toBeHidden();
    await expect(page.locator('[data-board-how]')).toBeHidden();
    await page.close();
  }
});
