import { test, expect } from '@playwright/test';

// The Sandbox's build / power-up / quest layer: place a ramp and fly off it, finish a ring quest,
// an AI quest (the Worker mocked) through the theatre, and the phone build UI. Every frame is slow
// on a CI runner's software GL, so these step the sim directly (sandbox.frame) instead of waiting
// on the wall clock, and get test.slow(); nothing in them is optional.
const watch = (page) => {
  const errors = [], foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404|500/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) foreign.push(r.url()); });
  return { errors, foreign };
};
const open = async (page, q = '') => {
  await page.goto(`/coldgas/?drive=sandbox&gfx=low${q}`);
  await page.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 90_000 });
};
// Step the sim n × 0.1 s.
const run = (page, n) => page.evaluate((n) => { const s = window.__coldgas.sandbox; for (let i = 0; i < n; i++) s.frame(0.1, performance.now() / 1000); }, n);
const straight = (v) => `(c) => ({ throttle: Math.hypot(c.vel.x, c.vel.z) < ${v} ? 1 : 0, brake: 0, steer: -c.pos.x * 0.08 - c.vel.x * 0.05, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 })`;

test('Sandbox: place a kicker in build mode, drive up it, get air; the build survives a reload', async ({ page }) => {
  test.slow();
  const seen = watch(page);
  await open(page);
  await expect(page.locator('[data-bq-build]')).toBeVisible();
  // Build mode with the keyboard: B, 1 (kicker), Enter places it at the ghost, 22 m ahead.
  await page.keyboard.press('KeyB');
  await expect(page.locator('[data-bq-bar]')).toBeVisible();
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-bq-cost]')).toHaveText('1');
  // Undo and redo.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-bq-cost]')).toHaveText('0');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('[data-bq-cost]')).toHaveText('1');
  // A mouse click on the world places another (further on, after moving the ghost).
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.42);
  await expect(page.locator('[data-bq-cost]')).toHaveText('2');
  await page.keyboard.press('KeyB');
  await expect(page.locator('[data-bq-bar]')).toBeHidden();
  // Drive straight at the first kicker at ~80 km/h.
  await page.evaluate((fn) => {
    const s = window.__coldgas.sandbox, o = s.layer.store.all().find((x) => x.type === 'kicker');
    s.place(o.transform.x, o.transform.z - 70, (o.transform.yaw * 180) / Math.PI);
    s.pilot(new Function(`return ${fn}`)());
  }, straight(22));
  let maxY = 0;
  for (let i = 0; i < 60 && maxY < 3; i++) {
    await run(page, 2);
    maxY = Math.max(maxY, await page.evaluate(() => window.__coldgas.sandbox.car.pos.y));
  }
  expect(maxY).toBeGreaterThan(3);
  // Reload: the build is kept on this device.
  await page.reload();
  await page.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__coldgas.sandbox.layer.store.all().filter((o) => o.type === 'kicker').length)).toBe(2);
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('Sandbox: a ring quest completes, rewards unlock; a shared link carries a build', async ({ page }) => {
  test.slow();
  const seen = watch(page);
  await open(page);
  await page.evaluate(() => {
    const s = window.__coldgas.sandbox;
    s.layer.api.startQuest({ v: 1, id: 'qtest', title: 'Straight Rings', brief: 'Three in a row.', source: 'builtin',
      pieces: [{ t: 'ring', x: 0, z: 40, y: 0, yaw: 0, s: 1, m: 'concrete', hidden: false }, { t: 'ring', x: 0, z: 80, y: 0, yaw: 0, s: 1, m: 'concrete', hidden: false }, { t: 'ring', x: 0, z: 120, y: 0, yaw: 0, s: 1, m: 'concrete', hidden: false }],
      pickups: [], objectives: [{ type: 'rings', count: 3 }], timeLimit: 90, reward: 'piece:loop' });
  });
  await expect(page.locator('.bq-qtitle')).toHaveText('Straight Rings');
  await page.evaluate((fn) => window.__coldgas.sandbox.pilot(new Function(`return ${fn}`)()), straight(20));
  for (let i = 0; i < 40; i++) {
    await run(page, 2);
    if (await page.evaluate(() => window.__coldgas.sandbox.layer.api.quest?.done)) break;
  }
  await expect(page.locator('.bq-result.ok')).toBeVisible();
  await expect(page.locator('.bq-result')).toContainText('Unlocked: Loop');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coldgas_quests_v1')).pieces)).toContain('loop');
  await page.locator('[data-r-done]').click();
  await expect(page.locator('[data-bq-quest]')).toBeHidden();
  // Share: a build in the URL hash opens on another device.
  const url = await page.evaluate(() => { const L = window.__coldgas.sandbox.layer; L.place('wedge', 10, 0); L.place('loop', -20, 30); return L.api.shareUrl(); });
  expect(url).toMatch(/\?drive=sandbox#b=[\w-]+$/);
  const other = await page.context().browser().newPage();
  await other.goto(url.replace(/^https?:\/\/[^/]+/, 'http://localhost:' + new URL(page.url()).port).replace('?drive=sandbox', '?drive=sandbox&gfx=low'));
  await other.waitForFunction(() => window.__coldgas?.sandbox?.active, null, { timeout: 90_000 });
  expect(await other.evaluate(() => window.__coldgas.sandbox.layer.store.all().map((o) => o.type).sort())).toEqual(['loop', 'wedge']);
  await other.close();
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('AI quest: the designer streams through the theatre, the quest is validated and laid out; a bad answer falls back', async ({ page }) => {
  test.slow();
  const seen = watch(page);
  let answer = { title: 'Mock Canyon', brief: 'Two rings and the deck.', pieces: [{ t: 'ring', x: 0, z: 30 }, { t: 'ring', x: 0, z: 60 }, { t: 'barge', x: 0, z: 140 }], pickups: [{ t: 'nitrogen', x: 0, z: 20 }], objectives: [{ type: 'rings', count: 2 }, { type: 'land', target: 2 }], timeLimit: 90 };
  let calls = 0, lastHeaders = null;
  await page.route('**/coldgas/api/quest', async (route) => {
    calls++; lastHeaders = route.request().headers();
    const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
    const text = JSON.stringify(answer);
    let body = ev('prompt', { provider: 'edge', providerLabel: 'Cloudflare Edge', vendor: 'Workers AI', model: '@cf/google/gemma-4-26b-a4b-it', where: 'Cloudflare test', system: 's', user: 'u', inTokensEst: 900 });
    for (const t of text.match(/.{1,12}/gs)) body += ev('token', { t });
    // The real Worker only forwards a quest that passed the schema; this mock sends whatever it's
    // given, so the client's own check is what's tested on the second call.
    body += ev('done', { quest: answer, errors: null, provider: 'edge', model: '@cf/google/gemma-4-26b-a4b-it', ttftMs: 200, totalMs: 900, inTokens: 900, outTokens: 120, neurons: 12, costUsd: 0.0001 });
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });
  await open(page);
  await page.keyboard.press('KeyJ');
  await expect(page.locator('[data-bq-board]')).toBeVisible();
  await expect(page.locator('.bq-card')).toHaveCount(8);
  await page.fill('[data-wish]', 'two rings then a deck');
  await page.locator('[data-gen]').click();
  await expect(page.locator('[data-theatre]')).toBeVisible();
  await page.waitForFunction(() => window.__coldgas.sandbox.layer.api.quest, null, { timeout: 45_000 });
  await expect(page.locator('.bq-qtitle')).toHaveText('Mock Canyon');
  await expect(page.locator('.bq-eyebrow')).toContainText('AI quest');
  expect(calls).toBe(1);
  expect(lastHeaders['x-cg-key']).toBeUndefined();   // the free model: no key leaves the browser
  expect(await page.evaluate(() => window.__coldgas.sandbox.layer.store.all().filter((o) => o.tag === 'quest').length)).toBe(4);
  // A model that answers out of bounds: rejected in the browser too; the local generator lays one out.
  answer = { ...answer, title: 'Too Far', pieces: [...answer.pieces, { t: 'ring', x: 0, z: 9000 }] };
  await page.locator('[data-q-quit]').click();
  await page.keyboard.press('KeyJ');
  await page.locator('[data-gen]').click();
  await page.waitForFunction(() => window.__coldgas.sandbox.layer.api.quest, null, { timeout: 45_000 });
  const t = await page.locator('.bq-qtitle').textContent();
  expect(t).not.toBe('Too Far');
  await expect(page.locator('.bq-eyebrow')).toContainText('Side quest');
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('Phone: the build UI fits, the radial menu picks a piece, tap to aim, Place places it', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const seen = watch(page);
  await open(page);
  await page.locator('[data-bq-build]').tap();
  for (const sel of ['[data-bq-done]', '[data-bq-fab]', '[data-bq-place]', '[data-bq-del]', '[data-bq-undo]', '.bq-mats']) await expect(page.locator(sel)).toBeInViewport();
  await expect(page.locator('.bq-palette')).toBeHidden();
  await page.locator('[data-bq-fab]').tap();
  const wedge = page.locator('.bq-radial [data-bq-piece="wedge"]');
  await expect(wedge).toBeInViewport();
  await wedge.tap();
  await expect(page.locator('[data-bq-radial]')).toBeHidden();
  // Tap the world to aim, then Place.
  const box = await page.locator('#stage').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.4);
  await page.locator('[data-bq-place]').tap();
  await expect(page.locator('[data-bq-cost]')).toHaveText('1');
  expect(await page.evaluate(() => window.__coldgas.sandbox.layer.store.all()[0].type)).toBe('wedge');
  await page.locator('[data-bq-done]').tap();
  await expect(page.locator('[data-btn-go]')).toBeInViewport();
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
  await page.close();
});
