import { test, expect } from '@playwright/test';

// A streamed model answer plays through the judges' theatre: the words show on their own dark
// panel during COMPUTE, the panel leaves the stage when the verdict is spelled, and the words land
// in the judges' cards and the receipt. (Software GL in CI is slow: generous timeouts.)
test('judges theatre: a streamed answer is shown, then lands in the results', async ({ page }) => {
  test.setTimeout(150_000);
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  const words = { headline: 'Clean over the row', engineer: 'Sink rate 0.6 m/s. I would sign that off.', coordinator: 'That is the stunt.', designer: 'One unbroken line.', source: 'ai' };
  const body = ev('verify', { ticks: 2400, ms: 30, card: { total: 90 } })
    + ev('prompt', { provider: 'edge', providerLabel: 'Free', vendor: 'Workers AI', model: '@cf/test/model', where: 'Cloudflare edge', system: 's', user: 'u', inTokensEst: 600 })
    + ['ENGINEER: ', words.engineer, ' COORDINATOR: ', words.coordinator].map((t) => ev('token', { t })).join('')
    + ev('done', { words, inTokens: 600, outTokens: 4, ttftMs: 300, totalMs: 900, tokensPerSec: 40, neurons: 13, costUsd: null });
  await page.route('**/coldgas/api/judge/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body }));
  await page.goto('/coldgas/?play=reveal&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.fastForward());
  // The stream reaches the ticker during COMPUTE.
  await page.waitForFunction(() => /ENGINEER/.test(document.querySelector('.th-out')?.textContent || ''), null, { timeout: 90_000 });
  // At the verdict the ticker steps aside so the particle text has the stage to itself.
  await page.waitForFunction(() => document.querySelector('[data-theatre]')?.dataset.stage === 'app', null, { timeout: 60_000 });
  await expect(page.locator('.th-ticker')).toHaveCSS('opacity', '0');
  await expect(page.locator('[data-receipt]')).toContainText('Judged by', { timeout: 60_000 });
  await expect(page.locator('[data-judge="coordinator"] .quote')).toHaveText(words.coordinator, { timeout: 60_000 });
});
