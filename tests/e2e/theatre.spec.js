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

// Ticket 0082: every theatre control is a 44 px target (the pills keep their size; the hit area runs past
// them, as the top bar's Menu does), and on a short landscape screen the theatre takes the screen and reads
// across: nothing overlaps or leaves it (the rail was clipped on the left at 844×390, Skip sat on it). The
// judges' stream is held open so the show stays up; its panels get a fixed, long call (as
// scripts/hud-audit.mjs measures it), so the stream's glass is up too.
// The folding phone as measured (0103: 594×368 closed sideways, 951×589 open) and a flip phone (0104: 800×300
// sideways with Chrome's bars, 424×360 its cover screen), where the raw stream steps out (the receipt has it).
const THEATRE_VIEWPORTS = [[844, 390], [932, 430], [594, 368], [951, 589], [390, 844], [800, 300], [424, 360]];
const streamShown = (w, h) => !(h <= 330 || (w <= 520 && h <= 440));
for (const [w, h] of THEATRE_VIEWPORTS) {
  test(`judges theatre at ${w}×${h}: controls are 44 px targets, nothing overlaps or clips`, async ({ browser }) => {
    test.setTimeout(150_000);
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    await page.route('**/coldgas/api/judge/stream', () => { /* held open: the theatre stays up */ });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/coldgas/?gfx=low');
    await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
    await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
    // A crashed run of the player's (full throttle at the Wall, never released), to its results.
    const mode = await page.evaluate(() => {
      const g = window.__coldgas, S = g.S;
      g.startRun('jump', true);
      S.autopilot = () => ({ throttle: 1, assist: 1 });
      g.skipCountdown();
      for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
      return S.mode;
    });
    expect(mode).toBe('results');
    // These screens run the call docked on the sheet (audit 2026-10-30): the score shows, and "Watch the call"
    // puts the theatre up.
    await expect(page.locator('[data-theatre]')).toBeHidden();
    await page.locator('[data-call-watch]').tap({ timeout: 60_000 });
    await page.waitForFunction(() => { const t = document.querySelector('[data-theatre]'); return t && !t.hidden && t.classList.contains('on') && t.querySelector('.th-skip'); }, null, { timeout: 60_000 });
    await page.addStyleTag({ content: '[data-theatre], [data-theatre] * { animation: none !important; transition: none !important; }' });
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-theatre]');
      root.dataset.stage = 'compute';
      root.querySelector('[data-k="model"]').textContent = 'gemma-4-26b-a4b-it';
      root.querySelector('.th-caption').textContent = 'gemma-4-26b-a4b-it is writing the judges\' remarks…';
      root.querySelector('[data-k="out"]').textContent = 'ENGINEER: Sink rate 0.6 m/s at the pad. I would sign that off. COORDINATOR: That is the stunt. DESIGNER: One unbroken line.';
      const T = root.getBoundingClientRect();
      const shown = (el) => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && b.width > 1 && b.height > 1; };
      const boxes = ['.th-rail', '.th-caption', '.th-card', '.th-stats', '.th-ticker', '.th-skip', '.th-quick [data-again]', '.th-quick [data-home]']
        .map((s) => [s, root.querySelector(s)]).filter(([, el]) => el && shown(el)).map(([s, el]) => [s, el.getBoundingClientRect()]);
      const overlaps = [], clipped = [];
      for (let i = 0; i < boxes.length; i++) {
        const [s, a] = boxes[i];
        if (a.left < T.left - 1 || a.top < T.top - 1 || a.right > T.right + 1 || a.bottom > T.bottom + 1) clipped.push(s);
        for (let j = i + 1; j < boxes.length; j++) {
          const [t, b] = boxes[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${s}×${t}`);
        }
      }
      // Each control's 44 × 44 px square, centred on it, is all the control's.
      const small = [];
      for (const el of root.querySelectorAll('button')) if (shown(el)) {
        const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        let miss = false;
        for (const dx of [-21, 0, 21]) for (const dy of [-21, 0, 21]) { const at = document.elementFromPoint(cx + dx, cy + dy); if (!at || !el.contains(at)) miss = true; }
        if (miss) small.push(el.textContent.trim());
      }
      const controls = [...root.querySelectorAll('button')].filter(shown).map((el) => el.textContent.trim());
      return { overlaps, clipped, small, controls, ticker: shown(root.querySelector('.th-ticker')) };
    });
    expect(m, JSON.stringify(m)).toMatchObject({ overlaps: [], clipped: [], small: [], ticker: streamShown(w, h) });
    // Retry, Home and Skip are all there (on a short screen the theatre covers the sheet's own).
    expect(m.controls).toEqual(expect.arrayContaining(['Retry', 'Home', 'Skip']));
    expect(errors).toEqual([]);
    await page.close();
  });
}
