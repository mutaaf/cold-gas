import { test, expect } from '@playwright/test';

// Ticket 0064: the judges' theatre never draws with a deleted WebGL program or buffer, and it never piles
// up WebGL contexts. aurora-field draws a still frame on set()/setShape() whenever its loop isn't running,
// and after destroy() that frame used the deleted programs and buffers (a show's step that resumed after a
// Skip, a restart or the fade). Every show also made a fresh canvas whose context stayed alive until GC,
// so a long session crept toward the browser's context limit, where the oldest (the game's) is lost.
// The judges' stream is stubbed with a canned answer (no network). Software GL is slow: generous timeouts.

const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
const words = { headline: 'Clean over the row', engineer: 'Sink rate 0.6 m/s.', coordinator: 'That is the stunt.', designer: 'One unbroken line.', source: 'ai' };
const judgeBody = ev('verify', { ticks: 2400, ms: 30, card: { total: 90 } })
  + ev('prompt', { provider: 'edge', providerLabel: 'Free', vendor: 'Workers AI', model: '@cf/test/model', where: 'Cloudflare edge', system: 's', user: 'u', inTokensEst: 600 })
  + ['ENGINEER: ', words.engineer, ' COORDINATOR: ', words.coordinator].map((t) => ev('token', { t })).join('')
  + ev('done', { words, inTokens: 600, outTokens: 4, ttftMs: 300, totalMs: 900, tokensPerSec: 40, neurons: 13, costUsd: null });

// Every WebGL context the page makes, kept so the test can ask which are still live at the end.
function trackContexts() {
  const gls = (window.__gls = []);
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !gls.some((g) => g.ctx === c)) gls.push({ ctx: c, canvas: this });
    return c;
  };
}
const glState = (page) => page.evaluate(() => {
  const game = window.__coldgas.stage.renderer.domElement;
  const live = window.__gls.filter((g) => !g.ctx.isContextLost());
  return { made: window.__gls.length, live: live.length, theatre: window.__gls.some((g) => g.canvas.classList.contains('th-canvas')), gameLost: window.__gls.filter((g) => g.canvas === game).some((g) => g.ctx.isContextLost()) };
});

function watch(page) {
  const seen = { gl: [], lost: [], errors: [] };
  page.on('console', (m) => {
    const t = m.text();
    if (/WebGL: INVALID_/.test(t)) seen.gl.push(t);
    if (/context lost|Oldest context will be lost/i.test(t)) seen.lost.push(t);
  });
  page.on('pageerror', (e) => seen.errors.push(e.message));
  return seen;
}

// A reference run straight to its results, the theatre up with its field.
async function toTheatre(page) {
  await page.evaluate(() => { const g = window.__coldgas; g.startRun('reveal'); g.skipCountdown(); g.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  // A phone runs the call docked on the sheet (the score first): "Watch the call" puts the theatre up.
  const watch = page.locator('[data-call-watch]');
  if (page.viewportSize().width < 720) await watch.waitFor({ state: 'visible', timeout: 15_000 }).then(() => watch.click(), () => {});
  await page.waitForFunction(() => { const t = document.querySelector('[data-theatre]'); return t && !t.hidden && t.querySelector('.th-canvas') && t.dataset.stage; }, null, { timeout: 60_000 });
}
const stageIs = (page, s) => page.waitForFunction((s) => document.querySelector('[data-theatre]')?.dataset.stage === s, s, { timeout: 90_000 });
const theatreGone = (page) => expect(page.locator('[data-theatre]')).toBeHidden({ timeout: 90_000 });

const VIEWPORTS = [
  { name: '390×844 touch', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { name: '1440×900', viewport: { width: 1440, height: 900 } },
];
for (const vp of VIEWPORTS) {
  test(`judges theatre at ${vp.name}: judged runs (Skip and Retry mid-stream, Retry in the fade, the whole show) draw nothing with a deleted object @heavy`, async ({ browser }) => {
    test.slow();
    test.setTimeout(420_000);
    const { name, ...opts } = vp;
    const page = await browser.newPage(opts);
    await page.addInitScript(trackContexts);
    const seen = watch(page);
    await page.route('**/coldgas/api/judge/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: judgeBody }));
    await page.goto('/coldgas/?gfx=low');
    await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });

    // 1 · Skip mid-stream, during the figures: the answer is already in (so Skip ends the show at once),
    // and COMPUTE is still queued behind the figure on screen.
    await toTheatre(page);
    await stageIs(page, 'text');
    await page.locator('.th-skip').click();
    await theatreGone(page);
    await page.waitForTimeout(2500);   // past the figure's own beat, when the queued stage step comes due

    // 2 · Retry mid-stream (the figures playing, COMPUTE queued): the show is torn down at once.
    await toTheatre(page);
    await stageIs(page, 'text');
    await page.evaluate(() => document.querySelector('[data-theatre] [data-again]').click());
    await expect(page.locator('[data-theatre]')).toBeHidden();
    await page.waitForTimeout(2500);

    // 3 · Retry while the theatre is still fading out (tapped in the page the moment the fade starts).
    await toTheatre(page);
    await page.evaluate(() => new Promise((resolve) => {
      const root = document.querySelector('[data-theatre]');
      const go = () => { if (!root.classList.contains('out')) return setTimeout(go, 8); root.querySelector('[data-again]').click(); resolve(); };
      go();
    }));
    await expect(page.locator('[data-theatre]')).toBeHidden();
    await page.waitForTimeout(1500);   // past the fade's own teardown

    // 4 · The whole show, to the verdict and out.
    await toTheatre(page);
    await theatreGone(page);
    await page.waitForTimeout(1500);

    expect(seen.gl).toEqual([]);
    expect(seen.errors).toEqual([]);
    expect(seen.lost).toEqual([]);
    const gl = await glState(page);
    expect(gl.gameLost).toBe(false);
    expect(gl.live).toBeLessThanOrEqual(2);
    await page.close();
  });
}

// Twenty shows in one session (each cut short by the next run, as a restart does): the page still holds
// only the game's context and at most one theatre's, and the game's is never the one the browser drops.
test('judges theatre: twenty shows leave at most two live WebGL contexts, the game\'s intact @heavy', async ({ page }) => {
  test.slow();
  test.setTimeout(420_000);
  await page.addInitScript(trackContexts);
  const seen = watch(page);
  await page.route('**/coldgas/api/judge/stream', () => { /* held open: each show runs until the next run aborts it */ });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });   // the game's frames aren't under test
  for (let i = 0; i < 20; i++) await toTheatre(page);
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.waitForTimeout(1000);
  const gl = await glState(page);
  expect(gl.theatre).toBe(true);   // the shows really drew their fields on WebGL
  expect(gl.live).toBeLessThanOrEqual(2);
  expect(gl.gameLost).toBe(false);
  expect(seen.gl).toEqual([]);
  expect(seen.lost).toEqual([]);
  expect(seen.errors).toEqual([]);
});

// The quest designer's theatre (the Sandbox), opened twice, the second straight after the first resolves
// (its field still fading on the shared canvas): nothing drawn with a deleted object, one theatre context.
test('quest theatre: two designs in a row draw nothing with a deleted object @heavy', async ({ page }) => {
  test.slow();
  test.setTimeout(300_000);
  await page.addInitScript(trackContexts);
  const seen = watch(page);
  const quest = { title: 'Mock Canyon', brief: 'Two rings and the deck.', pieces: [{ t: 'ring', x: 0, z: 30 }, { t: 'ring', x: 0, z: 60 }, { t: 'barge', x: 0, z: 140 }], pickups: [{ t: 'nitrogen', x: 0, z: 20 }], objectives: [{ type: 'rings', count: 2 }, { type: 'land', target: 2 }], timeLimit: 90 };
  let body = ev('prompt', { provider: 'edge', providerLabel: 'Cloudflare Edge', vendor: 'Workers AI', model: '@cf/test/model', where: 'Cloudflare test', system: 's', user: 'u', inTokensEst: 900 });
  for (const t of JSON.stringify(quest).match(/.{1,12}/gs)) body += ev('token', { t });
  body += ev('done', { quest, errors: null, provider: 'edge', model: '@cf/test/model', ttftMs: 200, totalMs: 900, inTokens: 900, outTokens: 120, neurons: 12, costUsd: 0.0001 });
  await page.route('**/coldgas/api/quest', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body }));
  await page.goto('/coldgas/?drive=sandbox&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 90_000 });
  const titles = await page.evaluate(async () => {
    const api = window.__coldgas.sandbox.layer.api, out = [];
    const root = document.querySelector('[data-theatre]');
    out.push((await api.generate('two rings then a deck'))?.title);
    // The second show starts while the first one's field is still fading: the first's teardown must
    // not hide it.
    const second = api.generate('two rings then a deck');
    await new Promise((r) => setTimeout(r, 1200));
    out.push(root.hidden ? 'hidden' : 'shown');
    out.push((await second)?.title);
    return out;
  });
  expect(titles).toEqual(['Mock Canyon', 'shown', 'Mock Canyon']);
  await expect(page.locator('[data-theatre]')).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect(seen.gl).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(seen.lost).toEqual([]);
  const gl = await glState(page);
  expect(gl.theatre).toBe(true);
  expect(gl.live).toBeLessThanOrEqual(2);
  expect(gl.gameLost).toBe(false);
});
