import { test } from '@playwright/test';
import { releaseFrameTests, thumbFrameTests } from './frame-probe.js';

// Ticket 0063: the drop off the ledge is the moment the Show builds to, and the carry camera used to
// draw it behind the top HUD (the car's centre above the mission block's bottom in a quarter of the
// air frames, its tail under the phone's rail). The probe flies the Show reference with the frame loop
// held and steps the run, the director and the probe together at a steady 30 frames a second, so the
// numbers don't depend on how fast CI's software GL draws: every air frame, the car's projected centre
// (carRoot through the camera) and its projected box (each visible mesh's bounding box) against the
// HUD's rects. Rendering never enters, so the canvas is drawn at a quarter of the pixels.
test.describe.configure({ mode: 'parallel' });

const VIEWS = [
  { name: 'desktop 1440×900', viewport: { width: 1440, height: 900 }, carW: 0.085 },
  { name: 'desktop 1280×720', viewport: { width: 1280, height: 720 }, carW: 0.075 },
  { name: 'phone 390×844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, phone: true },
  { name: 'phone 844×390', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, phone: true, carW: 0.06 },
  // The iPads (the critic's 2026-10-27 re-measure): 11" both ways (compact HUD), 13" both ways (the full set;
  // upright, its telemetry strip stands a fifth of the way down, under the mission block).
  { name: 'iPad 820×1180', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, phone: true },
  { name: 'iPad 1180×820', viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, phone: true, carW: 0.075 },
  { name: 'iPad 1024×1366', viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, phone: true },
  { name: 'iPad 1366×1024', viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, phone: true, grow: true },
];

// 0118's car-width bars (carW) are the ticket's: ≥ 1.45× the 0113 framing at 844×390 and 1440×900, still under the
// pre-0113 framing that hid the row. 1366×1024 (no bar in the ticket) holds the growth bar. 667×375 (bar 0.060) is
// checked by hand with the same probe (in the PR), not as a ninth flight: each flight here costs CI shard time.
releaseFrameTests(VIEWS);

// 0128: the same carry flown by a first visit's one thumb (the autopilot hides the touch controls, so the flights above
// never saw the pad): the held pad is opaque, and over the back of the row the car flew behind it (≥ 99 % of its box
// for half a second at 390×844). Small, mid and large upright phones, the pad on the left, an 11" iPad upright.
// The car's width over the carry is held at what it was before (0128's bar).
const TOUCH = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
thumbFrameTests([
  { name: 'phone 390×844', minCarW: 69, viewport: { width: 390, height: 844 }, ...TOUCH },
  { name: 'phone 360×780', minCarW: 57, viewport: { width: 360, height: 780 }, ...TOUCH },
  { name: 'phone 430×932', minCarW: 86, viewport: { width: 430, height: 932 }, ...TOUCH },
  { name: 'phone 390×844, left hand', hand: 'left', minCarW: 69, viewport: { width: 390, height: 844 }, ...TOUCH },
  { name: 'iPad 820×1180', viewport: { width: 820, height: 1180 }, ...TOUCH },
]);
