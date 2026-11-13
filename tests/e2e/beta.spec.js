import { test, expect } from '@playwright/test';

// The beta page as a phone opens it: 200, its heading and the TestFlight invite, nothing loaded from another host,
// no sideways scroll at 390 or 320 px (the Duo's sticky sequence included); and the title's chip leads to it.
test('the beta page serves, loads only from its own origin and fits a phone', async ({ browser, baseURL }) => {
  for (const width of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const own = new URL(baseURL).host;
    const foreign = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && (u.host !== own || u.pathname.startsWith('/cdn-cgi/'))) foreign.push(r.url()); });
    const res = await page.goto('/coldgas/beta/', { waitUntil: 'load' });
    expect(res.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('COLD GAS');
    await expect(page.getByRole('link', { name: /Join the beta on TestFlight/ })).toHaveAttribute('href', 'https://testflight.apple.com/join/yMb3sJPg');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.duo-track').offsetTop + 400));
    await page.waitForTimeout(200);
    expect(foreign).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await ctx.close();
  }
});

test('the title shows the beta chip, and hides it once a run starts', async ({ page }) => {
  await page.goto('/coldgas/', { waitUntil: 'load' });
  const chip = page.locator('.top .beta-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('href', 'beta/');
  await page.evaluate(() => { document.body.dataset.mode = 'live'; });
  await expect(chip).toBeHidden();
});
