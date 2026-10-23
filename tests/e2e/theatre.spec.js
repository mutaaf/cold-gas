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

// 0078: the TEXT stage spells the run's real figures one after another (label over value, each held
// to be read), bright against the field; once the call answers, its own numbers are spelled too.
// Skip (the words are in) still ends the show at once.
const canned = () => {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  const words = { headline: 'Clean over the row', engineer: 'Sink rate 0.6 m/s.', coordinator: 'That is the stunt.', designer: 'One unbroken line.', source: 'ai' };
  return { words, body: ev('verify', { ticks: 2400, ms: 30, card: { total: 90 } })
    + ev('prompt', { provider: 'edge', providerLabel: 'Free', vendor: 'Workers AI', model: '@cf/test/model', where: 'Cloudflare edge', system: 's', user: 'u', inTokensEst: 600 })
    + ['ENGINEER: ', words.engineer, ' COORDINATOR: ', words.coordinator].map((t) => ev('token', { t })).join('')
    + ev('done', { words, inTokens: 600, outTokens: 4, ttftMs: 300, totalMs: 900, tokensPerSec: 40, neurons: 13, costUsd: null }) };
};
async function toTheatre(page) {
  const { body } = canned();
  await page.route('**/coldgas/api/judge/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body }));
  await page.goto('/coldgas/?play=reveal&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'live' && window.__coldgas.physicsReady?.(), null, { timeout: 60_000 });
  // Every figure the theatre spells, with the stage it was spelled in.
  await page.evaluate(() => {
    window.__figs = [];
    const root = document.querySelector('[data-theatre]');
    new MutationObserver(() => {
      const f = root.dataset.fig, last = window.__figs[window.__figs.length - 1];
      if (f && (!last || last.fig !== f)) window.__figs.push({ fig: f, stage: root.dataset.stage, at: performance.now() });
    }).observe(root, { attributes: true, attributeFilter: ['data-fig'] });
  });
  await page.evaluate(() => window.__coldgas.fastForward());
}

test('judges theatre: the run spelled figure by figure, bright, then the call by its numbers', async ({ page }) => {
  test.slow();
  test.setTimeout(240_000);
  await toTheatre(page);
  await page.waitForFunction(() => document.querySelector('[data-theatre]')?.dataset.stage === 'text', null, { timeout: 90_000 });
  // Mid-figure, settled: the glyphs' brightest pixels against the box's typical (background) pixel.
  await page.waitForFunction(() => window.__figs.filter((f) => f.stage === 'text').length >= 2, null, { timeout: 30_000 });
  await page.waitForTimeout(900);
  const [x, y, w, h] = (await page.locator('[data-theatre]').getAttribute('data-fig-box')).split(',').map(Number);
  const png = await page.screenshot({ clip: { x, y, width: w, height: h } });
  const lum = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data, L = [];
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < d.length; i += 4) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    L.sort((a, b) => a - b);
    const at = (p) => L[Math.floor(L.length * p)];
    return { bg: at(0.5), p95: at(0.95), p98: at(0.98), p99: at(0.99) };
  }, png.toString('base64'));
  const cr = (l) => (l + 0.05) / (lum.bg + 0.05);
  console.log('figure contrast', JSON.stringify({ p95: cr(lum.p95).toFixed(2), p98: cr(lum.p98).toFixed(2), p99: cr(lum.p99).toFixed(2) }));
  expect(cr(lum.p98)).toBeGreaterThan(4.5);
  // The whole sequence: at least five distinct figures in the TEXT stage, each held to be read.
  await page.waitForFunction(() => document.querySelector('[data-theatre]')?.dataset.stage === 'compute', null, { timeout: 60_000 });
  const text = (await page.evaluate(() => window.__figs)).filter((f) => f.stage === 'text');
  expect(new Set(text.map((f) => f.fig)).size).toBeGreaterThanOrEqual(5);
  for (let i = 1; i < text.length; i++) expect(text[i].at - text[i - 1].at).toBeGreaterThan(1000);
  expect(text.map((f) => f.fig)).toEqual(expect.arrayContaining([expect.stringMatching(/^APEX \d/), expect.stringMatching(/^SCORE \d/)]));
  // The call answered: its numbers are spelled during COMPUTE, and the counters show them.
  await page.waitForFunction(() => window.__figs.some((f) => f.stage === 'compute' && /TOK/.test(f.fig)), null, { timeout: 60_000 });
  await expect(page.locator('[data-s="rate"]')).toHaveText('40 tok/s');
  // Then the verdict, and the words land (Skip mid-show: the next test).
  await expect(page.locator('[data-judge="coordinator"] .quote')).toHaveText(canned().words.coordinator, { timeout: 30_000 });
});

test('judges theatre: Skip during the figures ends the show at once', async ({ page }) => {
  test.slow();
  test.setTimeout(180_000);
  await toTheatre(page);
  // Tapped in the page the moment the second figure is up (no round trip to lag behind the show):
  // the show ends on the tap (its fade out starts) while the figures are still playing.
  const res = await page.evaluate(() => new Promise((resolve) => {
    const root = document.querySelector('[data-theatre]');
    const go = () => {
      if (window.__figs.filter((f) => f.stage === 'text').length < 2) return setTimeout(go, 16);
      const stage = root.dataset.stage, t0 = performance.now();
      root.querySelector('.th-skip').click();
      resolve({ stage, out: root.classList.contains('out'), ms: performance.now() - t0 });
    };
    go();
  }));
  expect(res).toMatchObject({ stage: 'text', out: true });
  await expect(page.locator('[data-theatre]')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('[data-judge="coordinator"] .quote')).toHaveText(canned().words.coordinator, { timeout: 30_000 });
});
