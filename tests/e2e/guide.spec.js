import { test, expect } from '@playwright/test';

// The player's guide as a phone opens it: 200, its heading, nothing from another host, no sideways scroll at 390 px.
test('the guide serves, loads only from its own origin and fits a phone', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const own = new URL(baseURL).host;
  const foreign = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && (u.host !== own || u.pathname.startsWith('/cdn-cgi/'))) foreign.push(r.url()); });
  const res = await page.goto('/coldgas/guide/', { waitUntil: 'load' });
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'COLD GAS Player Guide' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play COLD GAS' }).first()).toHaveAttribute('href', '../');
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await ctx.close();
});
