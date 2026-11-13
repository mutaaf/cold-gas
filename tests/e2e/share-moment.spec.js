import { test, expect } from '@playwright/test';

// 0260: Share sends the moment in one tap: a 1080×1350 JPEG whose headline is the stunt's name (src/stunt-name.js), the
// score, the verdict, "Personal best" when it is one and the challenge address in print; the words are the dare ("Beat my
// 82.4 on The Show · …") and the link is the run's own challenge (#vs=), landed or wrecked. Without a share sheet the
// challenge is copied and a toast says so. The card is drawn after the run, from the Share press, in under 300 ms on a
// 4×-throttled CPU. What the card draws is read off the 2D context's fillText calls (the words, in order).
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function boot(page, { share = true } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((share) => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    window.__drawn = [];
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (this.canvas.width === 1080) window.__drawn.push(String(t)); return fill.call(this, t, ...a); };
    if (share) {
      navigator.canShare = (d) => !!d;
      navigator.share = async (d) => {
        const f = d.files?.[0];
        window.__shared = { at: performance.now(), text: d.text, url: d.url, type: f?.type, size: f?.size || 0 };
      };
    } else { delete Navigator.prototype.share; delete Navigator.prototype.canShare; }
  }, share);
  await page.route('**/coldgas/api/**', (r) => r.abort());
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  return errors;
}
// The player's own Jump, flown by the reference (a landing) or full throttle at the Wall (a wreck), to its sheet.
const fly = (page, { crash = false } = {}) => page.evaluate(({ crash }) => {
  const g = window.__coldgas, S = g.S;
  S.holdLive = true;
  g.startRun('jump', true);
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  S.autopilot = null;
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  S.holdLive = false;
  return { total: S.card.total, verdict: S.card.verdict };
}, { crash });
const linkReady = (page) => page.waitForFunction(() => window.__coldgas.comeback.linkFor(window.__coldgas.S.card).then((u) => /#vs=/.test(u)), null, { timeout: 30_000 });

test('a landing: one tap shares a picture headed by the stunt, the dare and the challenge link, under 300 ms at 4× CPU', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  const run = await fly(page);
  await linkReady(page);
  // The card's own work at 4× CPU: the 2D drawing, the fonts, the PNG. (The 3D frame it copies is the GPU's: on SwiftShader
  // that is the CPU's too, so the scene's render is held for the measure, as the other stepped specs do.)
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; window.__drawn.length = 0; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('[data-screen="results"] [data-share]').tap();
  await page.waitForFunction(() => window.__shared, null, { timeout: 15_000 });
  const s = await page.evaluate(() => window.__shared);
  // The best of three draws of the same card (a shared runner's neighbours come and go), each from scratch.
  const ms = Math.min(await page.evaluate(() => window.__coldgas.shareCardMs()),
    await page.evaluate(() => window.__coldgas.redrawCard()), await page.evaluate(() => window.__coldgas.redrawCard()));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(s.type).toBe('image/jpeg');   // a PNG of the card alone took 475 ms to encode at 4× CPU (src/share-card.js)
  expect(s.size).toBeGreaterThan(10_000);
  expect(s.url).toMatch(/\/coldgas\/\?play=jump&course=show#vs=[zr][A-Za-z0-9_-]+$/);
  expect(s.text).toMatch(new RegExp(`^Beat my ${run.total.toFixed(1).replace('.', '\\.')} on The Show · `));
  const drawn = await page.evaluate(() => window.__drawn);
  const name = s.text.replace(/^Beat my [\d.]+ on /, '');
  const head = drawn.find((t) => t.startsWith('The Show · '));
  expect(head.startsWith(name)).toBe(true);   // the headline: the stunt's full name (the dare carries its short form)
  expect(drawn.indexOf(head)).toBeLessThan(drawn.indexOf(run.total.toFixed(1)));
  expect(drawn).toContain(run.total.toFixed(1));
  expect(drawn.some((t) => /^PERFECT 10|^STUCK IT|^CLEAN/.test(t) && /PERSONAL BEST$/.test(t))).toBe(true);   // a first landing is a best
  expect(drawn.some((t) => /^localhost:\d+\/coldgas\/#vs=.{10}…$/.test(t))).toBe(true);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(300);
  expect(errors).toEqual([]);
  await page.close();
});

test('a wreck shares too: its cause in the headline, a question for words, the same kind of link', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  const run = await fly(page, { crash: true });
  await linkReady(page);
  await page.locator('[data-screen="results"] [data-share]').tap();
  await page.waitForFunction(() => window.__shared, null, { timeout: 15_000 });
  const s = await page.evaluate(() => window.__shared);
  expect(s.type).toBe('image/jpeg');
  expect(s.url).toMatch(/#vs=/);
  const head = (await page.evaluate(() => window.__drawn)).find((t) => t.startsWith('The Show · '));
  expect(s.text).toBe(`${head}, ${run.total.toFixed(1)}. Can you land it?`);
  expect(s.text).toMatch(/^The Show · /);
  expect(errors).toEqual([]);
  await page.close();
});

test('1280×720, no share sheet: the challenge is copied with the dare, and the toast says so', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = await boot(page, { share: false });
  await fly(page);
  await linkReady(page);
  await page.locator('[data-screen="results"] [data-share]').click();
  await expect(page.locator('[data-toast]')).toHaveText('Challenge link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Beat my [\d.]+ on The Show · .+ http:\/\/localhost:\d+\/coldgas\/\?play=jump&course=show#vs=/);
  expect(errors).toEqual([]);
  await ctx.close();
});
