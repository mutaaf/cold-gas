import { test, expect } from '@playwright/test';

// Marquee (src/ads.js, AGENTS.md §3.3): ads only between runs, never in one. A stand-in loader where every
// slot can fill records each call with the game's mode at that moment: nothing may fire in the countdown or
// a live run, the first results are skipped, and the opt-in rewarded break re-asks the panel.
const fake = () => {
  const calls = [];
  const mode = () => window.__coldgas?.S?.mode || 'boot';
  const cfg = { enabled: true, slots: { title: { source: 'direct' }, postrun: { source: 'direct' }, reroll: { source: 'direct' } }, campaigns: [] };
  const brk = (kind) => (id, h = {}) => {
    calls.push({ kind, id, mode: mode() });
    h.beforeAd?.();
    const paused = !!window.__coldgas?.S?.adBreak;
    return new Promise((r) => setTimeout(() => { h.afterAd?.(); calls.at(-1).paused = paused; r(kind === 'rewarded' ? true : undefined); }, 50));
  };
  window.__adCalls = calls;
  window.marquee = { v: 1, ready: () => Promise.resolve(cfg), banner: () => {}, interstitial: brk('interstitial'), rewarded: brk('rewarded') };
};
async function toResults(page) {
  await page.evaluate(() => { window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
}

test('no ad call fires during a run; postrun skips the first results; rewarded is opt-in', async ({ page }) => {
  test.slow();
  await page.addInitScript(fake);
  await page.route('**/coldgas/api/judge/stream', (r) => r.abort());   // local lines, fast
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await expect(page.locator('[data-screen="title"] [data-marquee="title"]')).toHaveCount(1, { timeout: 15_000 });

  // Run 1 → Retry: the first session never gets an interstitial.
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown' || window.__coldgas.S.mode === 'live');
  await toResults(page);
  await expect(page.locator('[data-reroll]')).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__adCalls.length)).toBe(0);

  // Run 2: the rewarded break only on a press, then Retry shows the interstitial before the next run.
  await toResults(page);
  await expect(page.locator('[data-reroll]')).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-reroll]').click();
  // The break is over (afterAd ran) before the next press: a press during a break is the ad's, not the game's.
  await expect.poll(() => page.evaluate(() => window.__adCalls.filter((c) => c.kind === 'rewarded' && 'paused' in c).length)).toBe(1);
  await page.waitForFunction(() => !window.__coldgas.S.adBreak);
  await expect(page.locator('[data-reroll]')).toBeHidden();   // once per run
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });

  const calls = await page.evaluate(() => window.__adCalls);
  expect(calls.map((c) => `${c.kind}:${c.id}`)).toEqual(['rewarded:reroll', 'interstitial:postrun']);
  for (const c of calls) {
    expect(['results', 'replay']).toContain(c.mode);   // never countdown, live, or drive
    expect(c.paused).toBe(true);                         // beforeAd held the replay and the audio
  }
  expect(await page.evaluate(() => window.__coldgas.S.adBreak)).toBe(false);
  // And a live run fires nothing (the frequency cap aside, nothing in the run asks).
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__adCalls.length)).toBe(2);
});

test('no loader on a local preview: the game asks nobody, and missing window.marquee is a no-op', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (/\/ads\//.test(new URL(r.url()).pathname)) asked.push(r.url()); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await toResults(page);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  await expect(page.locator('[data-marquee]')).toHaveCount(0);
  await expect(page.locator('[data-reroll]')).toBeHidden();
  expect(asked).toEqual([]);
});
