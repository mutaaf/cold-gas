#!/usr/bin/env node
// npm run clips: short-form vertical clips (TikTok, Shorts, Reels) of COLD GAS, cut from the reference runs.
//
//   npm run clips                      build, capture every take, cut every clip in store/clips/clips.json
//   npm run clips -- --skip-capture    re-cut from the takes already in dist-clips/raw/ (caption or edit changes)
//   npm run clips -- --only=cg-show-roll   one clip (no contact sheet)
//   npm run clips -- --takes=show      capture only these takes
//
// Each take is the game's own reference run (startRun('reveal'): the autopilot flies the same input log every time,
// so a take is the same flight on every capture) on one course, recorded at 1080x1920 with real GPU rendering. The
// marks are the run's own phase changes (on the ramp, inverted, airborne, over the row, landed), stamped in the page
// the frame they happen, so the cuts in clips.json follow the flight, not a stopwatch.
// Output in dist-clips/ (gitignored); scripts/clips-lib.mjs does the cutting; store/clips/POSTING.md says what to post.
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { main } from './clips-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CLIPS_PORT) || 4795;
const URL = `http://127.0.0.1:${PORT}/coldgas/`;
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };

// Watches the run in the page and stamps each phase the first frame it is true (Date.now(), the same clock as the
// recording's start in clips-lib.mjs).
function watch() {
  const S = window.__coldgas.S, seen = (window.__marks = {});
  const tests = {
    live: () => S.mode === 'live',
    // the car has rolled half a metre from its mark
    move: () => { if (S.mode !== 'live') return false; const p = S.run.car.pos; window.__start ??= { x: p.x, z: p.z }; return Math.hypot(p.x - window.__start.x, p.z - window.__start.z) > 0.5; },
    ramp: () => S.run?.phase === 'ramp',
    climb: () => S.run?.phase === 'ramp' && S.run.car.pos.y > 8,
    inverted: () => S.run?.t?.invertedTime > 0.2,
    air: () => S.run?.phase === 'air',
    overrow: () => S.run?.phase === 'air' && S.run.car.pos.z < -16,
    landed: () => S.run?.phase === 'landed',
    results: () => S.mode === 'results',
  };
  const tick = () => { for (const [k, f] of Object.entries(tests)) { try { if (!(k in seen) && f()) seen[k] = Date.now(); } catch { /* not yet */ } } requestAnimationFrame(tick); };
  tick();
}

// One take: the reference run on a course, from its title (lights up) to a few seconds of its results.
function take(name, course, { tail = 7000 } = {}) {
  return {
    name,
    launch: GPU,
    drive: async (page, mark) => {
      await page.goto(URL + (course === 'show' ? '' : `?course=${course}`));
      await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 90000 });
      await page.evaluate(() => window.__coldgas.stage.ready);
      await page.evaluate(() => window.__coldgas.stage.backdrop);
      await page.waitForTimeout(2500);   // the backdrop's lights come up
      mark('title');
      await page.evaluate(watch);
      await page.evaluate(() => window.__coldgas.startRun('reveal'));
      await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 90000 });
      await page.waitForTimeout(tail);
      mark('end');
      for (const [k, at] of Object.entries(await page.evaluate(() => window.__marks))) mark(k, at);
    },
  };
}

const TAKES = [take('show', 'show'), take('wall', 'wall'), take('lineup', 'lineup')];

let server;
await main({
  chromium,
  root: ROOT,
  title: 'COLD GAS: short-form clips',
  takes: TAKES,
  before: async () => {
    if (!process.argv.includes('--skip-capture')) {
      console.log('building dist/');
      execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
      server = spawn(process.execPath, [join(ROOT, 'scripts/serve-gz.mjs'), 'dist/coldgas', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 600));
    }
    return {};
  },
  after: async () => { server?.kill(); },
});
