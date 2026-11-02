import { test, expect } from '@playwright/test';

// Observability and self-heal (src/obs/): errors are captured with stable signatures, a lost WebGL
// context is restored and the stage rebuilt, a physics trap stops the run instead of freezing the
// page, and For nerds → Health shows all of it.
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
const frameCount = (page) => page.evaluate(() => window.__coldgas.stage.renderer.info.render.frame);

test('an injected error is captured once per signature, counted, batched and shown in Health', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) setTimeout(() => { throw new Error(`obs-e2e injected boom ${i + 7}`); }, 10 * i);
    Promise.reject(new Error('obs-e2e rejected 42'));
  });
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().errors.find((e) => /injected boom/.test(e.msg))?.n ?? 0)).toBe(2);
  const snap = await page.evaluate(() => window.__coldgas.obs.snapshot());
  const boom = snap.errors.find((e) => /injected boom/.test(e.msg));
  expect(boom.sig).toMatch(/^[0-9a-f]{12}$/);
  expect(boom.msg).toBe('obs-e2e injected boom N');   // the numbers fold: one signature for both
  expect(snap.errors.find((e) => /rejected/.test(e.msg))?.kind).toBe('rejection');
  expect(pageErrors.filter((m) => /injected boom/.test(m))).toHaveLength(2);
  // The batch that would go to POST /coldgas/api/obs: deduped, no URL beyond a file name, no build path.
  // (Frames: every one lands in the ring; the histogram skips > 1 s gaps, which software GL on CI
  // can produce on the title, and a batch carries it only past 60 frames.)
  expect(await page.evaluate(() => window.__coldgas.obs.frames.count)).toBeGreaterThan(0);
  const payload = await page.evaluate(() => window.__coldgas.obs.flush('test', { force: true }));
  const sent = payload.errs.find((e) => e.sig === boom.sig);
  expect(sent).toMatchObject({ n: 2, kind: 'error', key: expect.stringMatching(/^[0-9a-f]{12}$/) });
  expect(JSON.stringify(payload)).not.toMatch(/localhost|http/);
  if (payload.fr) expect(payload.fr.h.reduce((a, c) => a + c, 0)).toBe(payload.fr.n);
  // For nerds → Health.
  await page.keyboard.press('Backquote');
  // The panel is a lazy chunk, loaded behind software GL's slow frames on CI (nerds.spec waits the same way).
  await expect(page.locator('[data-nerds]')).toHaveAttribute('aria-pressed', 'true', { timeout: 45_000 });
  await expect(page.locator('[data-k="h.errs"]')).toContainText(/\d+ · \d+ signature/, { timeout: 10_000 });
  await expect(page.locator('[data-k="h.list"]')).toContainText('injected boom');
  await expect(page.locator('[data-k="h.tier"]')).toContainText('low');
  await expect(page.locator('[data-k="h.why"]')).toContainText('forced by ?gfx=low');
});

test('a lost WebGL context is restored, the renderer rebuilt, and the game keeps drawing', async ({ page }) => {
  test.slow();   // software GL: the restore waits 2 s before nudging, then recompiles every shader
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await page.evaluate(() => window.__coldgas.stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.glLost)).toBe(true);
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(true);   // the run waits for the GPU
  // heal.js nudges the context back after 2 s (a real reset comes back by itself).
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().lastRecovery?.kind), { timeout: 20_000 }).toBe('webgl');
  const snap = await page.evaluate(() => window.__coldgas.obs.snapshot());
  expect(snap.lastRecovery.ok).toBe(true);
  expect(snap.glLost).toBe(false);
  expect(snap.errors.some((e) => e.kind === 'ctxlost' && e.mod === 'webgl')).toBe(true);
  // Drawing again: frames advance after resuming, and the page answers.
  await page.evaluate(() => document.querySelector('[data-resume]').click());
  const f0 = await frameCount(page);
  // (The first frames after a restore recompile every shader: seconds each on software GL under load.)
  await expect.poll(() => frameCount(page), { timeout: 90_000, message: await page.evaluate(() => JSON.stringify(window.__coldgas.obs.snapshot().errors)) }).toBeGreaterThan(f0 + 3);
  expect(await page.evaluate(() => window.__coldgas.stage.renderer.getContext().isContextLost())).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('a physics trap mid-run stops the run with a toast instead of freezing the page', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live');
  // What a Rust panic inside the engine's WASM looks like from JS.
  await page.evaluate(() => { window.__coldgas.S.run.car.world.rw.step = () => { throw new WebAssembly.RuntimeError('unreachable'); }; });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'title', null, { timeout: 15_000 });
  const snap = await page.evaluate(() => window.__coldgas.obs.snapshot());
  expect(snap.lastRecovery).toMatchObject({ kind: 'physics', ok: true });
  expect(snap.errors.find((e) => e.mod === 'physics')?.kind).toBe('trap');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  // Not frozen: frames keep coming, and a new run flies.
  const f0 = await frameCount(page);
  await expect.poll(() => frameCount(page), { timeout: 15_000 }).toBeGreaterThan(f0 + 3);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.run.tick > 10, null, { timeout: 30_000 });

  // 0130, folded in here (no new boot: the shards have no minutes to spare): where a run ends when it's neither
  // landed nor wrecked. Every beacon's play counts are kept as the page hands them to flush.
  await page.evaluate(() => {
    const obs = window.__coldgas.obs, f = obs.flush;
    window.__beacons = [];
    obs.flush('test', { force: true });   // what came before (the trapped run, this run's start) is sent
    obs.flush = (reason, o) => { const p = f(reason, o); window.__beacons.push({ reason, play: p?.play || {} }); return p; };
  });
  const leave = () => page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return window.__beacons.at(-1); });
  // Pause → Home during a live Jump: one run-quit, no card.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.locator('[data-screen="pause"] [data-home]').click();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'title');
  let b = await leave();
  expect(b.reason).toBe('pagehide');
  expect(b.play).toEqual({ 'run-quit': 1 });
  // The reference run left is never a player's quit; nor is a second Home from the title.
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); window.__coldgas.toTitle(); window.__coldgas.toTitle(); });
  expect((await leave()).play).toEqual({});
  // A newcomer skips the how-to card, and the page goes with the run live: howto-skip, then run-quit, once each.
  await page.evaluate(() => localStorage.setItem('coldgas_howto', 'new'));
  await page.locator('[data-start]').click();
  await page.locator('[data-howto-skip]').click();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  b = await leave();
  expect(b.play).toMatchObject({ howto: 1, 'howto-skip': 1, run: 1, 'run-quit': 1 });
  expect(b.play['run-landed'] ?? 0).toBe(0);
  expect((await leave()).play['run-quit'] ?? 0).toBe(0);   // once per run, however often the page hides
});
