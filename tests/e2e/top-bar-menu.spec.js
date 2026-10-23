import { test, expect } from '@playwright/test';

// Ticket 0073: "no one knows what the icons on the top right corner mean on mobile". A touch screen
// can't hover for a title, so Ghost, Sound and For nerds fold into one labelled Menu whose rows name
// each control and say On or Off in words (a disclosure: aria-expanded, Escape and an outside tap
// close it, focus goes back to the toggle). A fine pointer keeps the icon row with its tooltips.
test.describe.configure({ mode: 'parallel' });
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });
const boot = async (page, q = '') => {
  await page.goto(`/coldgas/?gfx=low${q}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
};
const live = async (page) => {
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
};
const apart = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 0.5 && r.y + r.height <= h + 0.5;
// The row's On / Off word is CSS content (aria-hidden: the button's aria-pressed already says it).
const stateWord = (page, sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(`${sel} .m-state`), '::before').content.replace(/"/g, ''), sel);
const ROWS = [
  ['[data-ghost]', 'Ghost', 'your best run alongside'],
  ['[data-mute]', 'Sound', ''],
  ['[data-nerds]', 'For nerds', 'engineering readout'],
];

for (const [w, h] of [[390, 844], [844, 390]]) {
  test(`touch ${w}×${h}: one labelled Menu; its rows say what they do and whether they are on`, async ({ browser }) => {
    test.slow();   // boots on CI's software GL, then loads the nerds chunk behind its frames
    const page = await browser.newPage(touch(w, h));
    await boot(page);
    const toggle = page.locator('[data-more-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const [sel] of ROWS) await expect(page.locator(sel)).toBeHidden();   // no unlabelled glyphs on the bar
    // 36 px tall to sit level with Home and Retry; the tap lands on it 4 px above and below (44 px).
    const tb = await toggle.boundingBox();
    expect(tb.width).toBeGreaterThanOrEqual(44);
    const hit = await page.evaluate(({ x, y0, y1 }) => [y0, y1].map((y) => !!document.elementFromPoint(x, y)?.closest('[data-more-toggle]')),
      { x: tb.x + tb.width / 2, y0: tb.y + tb.height / 2 - 21.5, y1: tb.y + tb.height / 2 + 21.5 });
    expect(hit).toEqual([true, true]);

    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.locator('#more-sheet');
    await expect(sheet).toBeVisible();
    expect(inside(await sheet.boundingBox(), w, h)).toBe(true);
    for (const [sel, name, sub] of ROWS) {
      const row = page.locator(sel);
      await expect(row).toBeVisible();
      await expect(row.locator('.m-txt b')).toHaveText(name);
      if (sub) await expect(row.locator('.m-txt')).toContainText(sub);
      await expect(row).toHaveAccessibleName(new RegExp(`^${name}`));
      const r = await row.boundingBox();
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.width).toBeGreaterThanOrEqual(44);
      // Text on the sheet: 11 px or more.
      for (const px of await row.evaluate((el) => [...el.querySelectorAll('.m-txt, .m-txt b, .m-state')].map((e) => parseFloat(getComputedStyle(e).fontSize)))) expect(px).toBeGreaterThanOrEqual(11);
    }
    expect(await stateWord(page, '[data-ghost]')).toBe('On');
    expect(await stateWord(page, '[data-mute]')).toBe('On');
    expect(await stateWord(page, '[data-nerds]')).toBe('Off');

    // Ghost and Sound toggle in place: the word changes, the menu stays open.
    for (const sel of ['[data-ghost]', '[data-mute]']) {
      await page.locator(sel).tap();
      await expect(page.locator(sel)).toHaveAttribute('aria-pressed', 'false');
      expect(await stateWord(page, sel)).toBe('Off');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await page.locator(sel).tap();
      await expect(page.locator(sel)).toHaveAttribute('aria-pressed', 'true');
      expect(await stateWord(page, sel)).toBe('On');
    }
    expect(await page.evaluate(() => window.__coldgas.S.ghostOn)).toBe(true);

    // Escape closes it and focus returns to the toggle.
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-more-toggle'))).toBe(true);

    // A tap outside closes it (on the 3D view, clear of every control).
    await toggle.tap();
    await expect(sheet).toBeVisible();
    const out = await page.evaluate(() => {
      for (let y = innerHeight * 0.45; y < innerHeight * 0.9; y += 12) for (let x = 12; x < innerWidth - 12; x += 12) {
        if (document.elementFromPoint(x, y)?.id === 'stage') return { x, y };
      }
      return null;
    });
    expect(out).not.toBeNull();
    await page.touchscreen.tap(out.x, out.y);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // For nerds opens its panel and the menu steps aside.
    await toggle.tap();
    await page.locator('[data-nerds]').tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-nerds]')).toHaveAttribute('aria-pressed', 'true', { timeout: 45_000 });
    await expect(page.locator('[data-nerds-root]')).toBeVisible();
    await page.close();
  });

  test(`touch ${w}×${h}: in a run the Menu sits beside Home and Retry, clear of the HUD`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage(touch(w, h));
    await boot(page);
    await live(page);
    await expect(page.locator('.quick-home')).toBeVisible();
    const toggle = page.locator('[data-more-toggle]');
    await expect(toggle).toBeVisible();
    const [home, retry, tb] = await Promise.all([page.locator('.quick-home').boundingBox(), page.locator('.quick-retry').boundingBox(), toggle.boundingBox()]);
    expect(Math.abs(home.y - tb.y)).toBeLessThanOrEqual(1);   // one row
    expect(apart(retry, tb)).toBe(true);
    const actions = await page.locator('.top-actions').boundingBox();
    expect(inside(actions, w, h)).toBe(true);
    for (const el of await page.locator('[data-hud-box]').all()) {
      if (!(await el.isVisible())) continue;
      const r = await el.boundingBox();
      if (r && r.width > 1) expect(apart(actions, r), JSON.stringify({ actions, r })).toBe(true);
    }
    await toggle.tap();
    await expect(page.locator('[data-mute]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-mute]')).toBeHidden();
    expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('live');   // Escape closed the menu, nothing else
    await page.close();
  });
}

// The dual-screen phone, folded and unfolded (touch): the bar stays inside the screen and the sheet
// opens inside it.
for (const [w, h] of [[382, 580], [678, 340], [669, 825], [951, 543]]) {
  test(`touch ${w}×${h}: the bar and the open Menu fit`, async ({ browser }) => {
    const page = await browser.newPage(touch(w, h));
    await boot(page);
    const toggle = page.locator('[data-more-toggle]');
    await expect(toggle).toBeVisible();
    expect(inside(await page.locator('.top-actions').boundingBox(), w, h)).toBe(true);
    await toggle.tap();
    const sheet = page.locator('#more-sheet');
    await expect(sheet).toBeVisible();
    expect(inside(await sheet.boundingBox(), w, h)).toBe(true);
    for (const sel of ['[data-ghost]', '[data-mute]', '[data-nerds]']) expect((await page.locator(sel).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.close();
  });
}

test('desktop: the icon row stays, each with a tooltip, and the keys still toggle it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page);
  await expect(page.locator('[data-more-toggle]')).toBeHidden();
  const boxes = [];
  for (const sel of ['[data-ghost]', '[data-mute]', '[data-nerds]']) {
    const b = page.locator(sel);
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute('title', /\S/);
    await expect(b.locator('.m-txt')).toBeHidden();
    boxes.push(await b.boundingBox());
  }
  for (const b of boxes) expect(Math.abs(b.y - boxes[0].y)).toBeLessThanOrEqual(1);   // one row
  await page.keyboard.press('KeyG');
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyG');
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-mute]').click();
  await expect(page.locator('[data-mute]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.querySelector('[data-mute] [data-wave]') && getComputedStyle(document.querySelector('[data-mute] [data-wave]')).opacity)).toBe('0');
});
