import { test, expect } from '@playwright/test';

// COLD GAS installs like an app (0081): a manifest Chromium accepts with no installability errors,
// icons that are what they say (size, type, an opaque Apple icon, the maskable mark inside the safe
// circle), link-preview tags with an absolute image URL, and a Share that hands the share sheet a
// PNG card.
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), png: buf.subarray(1, 4).toString() === 'PNG' });

test('the manifest parses, Chromium finds it installable, and every icon is what it says', async ({ page, request }) => {
  // The install surface is the HTML and static files: no need to wait for the 3D stage.
  await page.goto('/coldgas/?gfx=low', { waitUntil: 'domcontentloaded' });

  const res = await request.get('/coldgas/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m.name).toBe('COLD GAS');

  const cdp = await page.context().newCDPSession(page);
  const app = await cdp.send('Page.getAppManifest');
  expect(app.url).toMatch(/\/coldgas\/manifest\.webmanifest$/);
  expect(app.errors).toEqual([]);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  // Every image the manifest and the head name, fetched under the base path.
  const base = new URL('/coldgas/', page.url());
  const images = [...m.icons, ...m.screenshots].map((i) => ({ src: new URL(i.src, base).pathname, sizes: i.sizes, type: i.type }));
  images.push({ src: '/coldgas/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    { src: '/coldgas/favicon-32.png', sizes: '32x32', type: 'image/png' }, { src: '/coldgas/favicon-16.png', sizes: '16x16', type: 'image/png' },
    { src: '/coldgas/og.png', sizes: '1200x630', type: 'image/png' });
  for (const i of images) {
    const r = await request.get(i.src);
    expect(r.status(), i.src).toBe(200);
    expect(r.headers()['content-type'], i.src).toContain(i.type);
    if (i.type === 'image/png') {
      const s = pngSize(await r.body());
      expect(s.png && `${s.w}x${s.h}`, i.src).toBe(i.sizes);
    }
  }

  // Pixels: the Apple icon has no transparency (iOS would fill it black); the maskable mark sits
  // inside the 40 % safe circle; the "any" icon has transparent corners (it carries its own shape).
  const px = await page.evaluate(async () => {
    const read = async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    };
    const apple = await read('apple-touch-icon.png');
    let opaque = true;
    for (let i = 3; i < apple.d.length; i += 4) if (apple.d[i] < 255) { opaque = false; break; }
    const mk = await read('icons/maskable-512.png');
    let reach = 0;
    for (let i = 0; i < mk.d.length; i += 4) {
      if (mk.d[i] + mk.d[i + 1] + mk.d[i + 2] <= 300) continue;
      const p = i / 4, x = (p % mk.w) + 0.5, y = Math.floor(p / mk.w) + 0.5;
      reach = Math.max(reach, Math.hypot(x - mk.w / 2, y - mk.h / 2) / mk.w);
    }
    const any = await read('icons/icon-512.png');
    return { opaque, reach, corner: any.d[3] };
  });
  expect(px.opaque).toBe(true);
  expect(px.reach).toBeGreaterThan(0.25);   // the mark is there, and large
  expect(px.reach).toBeLessThanOrEqual(0.4);
  expect(px.corner).toBe(0);
});

test('the head carries the install and link-preview tags', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low', { waitUntil: 'domcontentloaded' });
  const meta = (sel) => page.locator(sel).first().getAttribute('content');
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('./manifest.webmanifest');
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('./apple-touch-icon.png');
  expect(await meta('meta[name="apple-mobile-web-app-capable"]')).toBe('yes');
  expect(await meta('meta[name="mobile-web-app-capable"]')).toBe('yes');
  expect(await meta('meta[name="apple-mobile-web-app-title"]')).toBe('COLD GAS');
  expect(await meta('meta[name="apple-mobile-web-app-status-bar-style"]')).toBe('black-translucent');
  expect(await meta('meta[name="theme-color"]')).toBe('#05070c');
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
  expect(await meta('meta[property="og:image"]')).toBe('https://mutaafaziz.com/coldgas/og.png');
  expect(await meta('meta[property="og:url"]')).toBe('https://mutaafaziz.com/coldgas/');
  expect(await meta('meta[property="og:type"]')).toBe('website');
  expect(await meta('meta[property="og:image:width"]')).toBe('1200');
  expect(await meta('meta[property="og:image:height"]')).toBe('630');
  expect(await meta('meta[property="og:image:alt"]')).toBeTruthy();
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(await meta('meta[name="twitter:image"]')).toBe('https://mutaafaziz.com/coldgas/og.png');
  // The first paint is the game's black, before any stylesheet.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(5, 7, 12)');
});

test('Share hands the share sheet a 1080 × 1350 PNG card of the run', async ({ page }) => {
  test.slow();   // boots the stage and flies the reference run on software GL
  await page.addInitScript(() => {
    navigator.canShare = (d) => !!d;
    navigator.share = async (d) => {
      const f = d.files?.[0];
      window.__shared = { text: d.text, url: d.url, name: f?.name, type: f?.type, bytes: f ? Array.from(new Uint8Array(await f.arrayBuffer())) : null };
    };
  });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeVisible();
  await page.locator('[data-reveal]').click();
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 20_000 });
  await page.locator('[data-screen="results"] [data-share]').click();
  await page.waitForFunction(() => window.__shared, null, { timeout: 10_000 });
  const s = await page.evaluate(() => window.__shared);
  expect(s.type).toBe('image/png');
  expect(s.name).toMatch(/^coldgas-\d+\.\d\.png$/);
  expect(pngSize(Buffer.from(s.bytes))).toEqual({ w: 1080, h: 1350, png: true });
  expect(s.text).toMatch(/^COLD GAS \d+\.\d: .+ on The Show\./);
  expect(s.url).toMatch(/\/coldgas\/$/);
});

test('without a share sheet, Share copies the link and says so', async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeVisible();
  await page.locator('[data-reveal]').click();
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 20_000 });
  await page.locator('[data-screen="results"] [data-share]').click();
  await expect(page.locator('[data-toast]')).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^COLD GAS .+ http:\/\/localhost:\d+\/coldgas\/$/);
});
