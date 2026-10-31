import { test } from '@playwright/test';
import { releaseFrameTests } from './frame-probe.js';

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
  { name: 'iPad 1366×1024', viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, phone: true },
];

// 0118's car-width bars (carW) are the ticket's: ≥ 1.45× the 0113 framing at 844×390 and 1440×900, still under the
// pre-0113 framing that hid the row. 667×375 (bar 0.060) is measured by the same probe in the PR, not as a ninth flight.
releaseFrameTests(VIEWS);
