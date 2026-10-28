import { expect } from '@playwright/test';

// 0068's replay probe (shared with 0107's foldables): the reference flown to its results, the replay played,
// and every frame the car's centre against what the results leave of the screen (tests/e2e/replay-phone.spec.js).
// The reference to its results; the theatre (if it came up) skipped, the panel from local lines.
export async function toResults(page) {
  await page.route('**/coldgas/api/**', (r) => r.abort());
  await page.goto('/coldgas/?gfx=low');
  // Everything measured here is DOM boxes against the camera's projection: no pixels are needed, and on
  // software GL a drawn frame takes long enough that one replay would outlast the test.
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.evaluate(() => { const G = window.__coldgas; G.startRun('reveal'); G.skipCountdown(); G.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-r-judges] li').length > 0, null, { timeout: 60_000 });
  // The judges' theatre takes a phone's whole screen for the call: Skip, as a player would, until the
  // call is over and the theatre gone.
  await page.waitForFunction(() => {
    const th = document.querySelector('[data-theatre]');
    if (th && !th.hidden && th.classList.contains('on') && !th.classList.contains('out')) th.querySelector('.th-skip')?.click();
    return !!window.__coldgas.S.callMeta && (!th || th.hidden);
  }, null, { timeout: 90_000, polling: 250 });
  await settle(page);
}
// The results' own slides and fades (not a typing caret's endless blink) have finished.
export const moving = () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity && a.effect?.target?.closest?.('.results')).length;
export const settle = (page) => page.waitForFunction(`(${moving})() === 0`, null, { timeout: 10_000 });

// Every rAF from the tap until the replay loops: the uncovered rect and whether the car's centre is in it.
export function startProbe() {
  const G = window.__coldgas, v = G.carRoot.position.clone();
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const st = { frames: 0, inside: 0, minH: Infinity, minW: Infinity, out: [], stop: false, lastT: -1, looped: false };
  const tick = () => {
    if (st.stop) return;
    const w = innerWidth, h = innerHeight;
    // What the results put over the canvas: the sheet and the peek (clipped to the screen).
    let right = w, bottom = h;
    for (const el of document.querySelectorAll('.results .sheet, .results [data-peek]')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const l = Math.max(0, r.left), t = Math.max(0, r.top), rr = Math.min(w, r.right), b = Math.min(h, r.bottom);
      if (rr - l < 1 || b - t < 1) continue;
      if (rr - l >= w * 0.9) bottom = Math.min(bottom, t); else right = Math.min(right, l);
    }
    st.minH = Math.min(st.minH, bottom); st.minW = Math.min(st.minW, right);
    G.camera.updateMatrixWorld();
    v.copy(G.carRoot.position).project(G.camera);
    const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
    st.frames++;
    if (v.z < 1 && px >= 0 && px <= right && py >= 0 && py <= bottom) st.inside++;
    else if (st.out.length < 12) st.out.push(`${Math.round(px)},${Math.round(py)} shot ${G.director.state.shot} t ${G.S.replayT.toFixed(0)}`);
    if (G.S.replayT < st.lastT) { st.looped = true; st.stop = true; return; }
    st.lastT = G.S.replayT;
    requestAnimationFrame(tick);
  };
  window.__rp = st;
  requestAnimationFrame(tick);
}
export const probe = async (page) => {
  await page.evaluate(startProbe);
  await page.waitForFunction(() => window.__rp.looped || window.__coldgas.S.mode !== 'results', null, { timeout: 120_000, polling: 500 });
  return page.evaluate(() => { window.__rp.stop = true; const { frames, inside, minH, minW, out, looped } = window.__rp; return { frames, inside, minH, minW, out, looped }; });
};
// A finger on the button where it is (a locator's tap scrolls the sheet to the sticky row's place in the flow first).
export const tapOn = async (page, sel) => {
  const b = await page.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  const hit = await page.evaluate(([x, y, sel]) => { const e = document.elementFromPoint(x, y); return e?.closest(sel) ? 'ok' : e?.outerHTML.slice(0, 80); }, [x, y, sel]);
  expect(hit, `${sel} at ${x},${y}`).toBe('ok');
  await page.touchscreen.tap(x, y);
};
