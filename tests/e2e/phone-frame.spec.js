import { test, expect } from '@playwright/test';
import { releaseFrameTests } from './frame-probe.js';
import { toResults, settle, probe, tapOn } from './replay-probe.js';

// Ticket 0107: 0063's bar (the drop off the ledge in frame, below the top HUD, no more than a tenth of the car
// under any HUD box on a touch screen, a roof in frame over the row) on the foldables' shapes: the book-style
// fold open (669×871, 951×589: near-square) and closed and turned (594×368), and a flip phone's tall screen
// (360×748: about 22:9) and its shortest screens. Their measured or estimated sizes are docs/backlog/0102's. Its own file (not
// release-frame.spec.js) so it runs in the lighter CI shard.
test.describe.configure({ mode: 'parallel' });

const T = { hasTouch: true, isMobile: true, phone: true };
releaseFrameTests([
  { name: 'fold open 669×871', viewport: { width: 669, height: 871 }, ...T },
  { name: 'fold open 951×589', viewport: { width: 951, height: 589 }, ...T },
  { name: 'fold closed 594×368', viewport: { width: 594, height: 368 }, ...T },
  { name: 'flip 360×748', viewport: { width: 360, height: 748 }, ...T },
  // The two shortest: a flip's cover screen upright and its tall screen sideways with Chrome's bars. Before
  // 0107 the car's centre rose to within 24 px of the top HUD there (95 px under a 105 px rail head; 75 px
  // under a 56 px top bar).
  { name: 'flip cover 360×380', viewport: { width: 360, height: 380 }, minTop: 50, ...T },   // the rail's head rides in the top bar here
  { name: 'flip sideways 800×300', viewport: { width: 800, height: 300 }, ...T },
  // 0116: the upright phones the critic measured beside 390×844 (release-frame.spec.js), where the carry showed three of
  // the row's five bodies; every upright view above and there holds the row-across bars too.
  { name: 'phone 360×800', viewport: { width: 360, height: 800 }, ...T },
  { name: 'phone 412×915', viewport: { width: 412, height: 915 }, ...T },
]);

// 0068's replay on the book-style fold: open (669×871, 951×589) the results take the whole screen in two
// columns, and closed and turned (594×368) in one, so Replay folds them to the peek and the replay plays above
// it; the car's centre stays in the part of the screen the results leave in nine frames in ten or more.
for (const [w, h] of [[669, 871], [951, 589], [594, 368]]) {
  test(`${w}×${h}: Replay folds the results to the peek and the car plays above it`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await toResults(page);
    await tapOn(page, '.results .sheet [data-replay]');
    await settle(page);
    await expect(page.locator('.results [data-peek]')).toBeVisible();
    const r = await probe(page);
    expect(r.looped, JSON.stringify(r)).toBe(true);
    expect(r.frames).toBeGreaterThan(30);
    expect(r.inside / r.frames, JSON.stringify(r)).toBeGreaterThanOrEqual(0.9);
    expect(errors).toEqual([]);
    await page.close();
  });
}
