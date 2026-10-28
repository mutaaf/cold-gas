// The HUD audit: flies the Show (by keyboard, so any build can be audited) at every viewport we
// ship to, freezes each phase, screenshots it, and measures what a designer would check by eye:
//   - overlaps between HUD instruments, touch controls, cues and bars (px² of intersection)
//   - the smallest rendered text (CSS px, SVG text scaled by its viewBox)
//   - WCAG contrast of every visible HUD label, measured on the real screenshot: the text's
//     luminance against the worst (closest) 10 % of the pixels behind it, with the text hidden.
//
//   node scripts/hud-audit.mjs <url> <outdir> [set=all|phones|tablets|fold|safe|quick|WxH[s],…] [label] [states=both|compact|full] [--shard=N/M]
//
// Viewports: phones (incl. a 320 px Slide Over column and Safari's portrait with its bars), iPads in
// both orientations, a folding phone (0075, measured in 0103: scripts/audit-plan.mjs FOLD, in a tab and
// installed, each pose with its measured insets, and the 466×498 it passes through mid-swing; touch at
// 3× like the device), desktops. A trailing `s` (e.g. 844x390s) is the safe-area pass: the page's
// --safe-* insets are forced to a notched phone's (47 px on the notch side in landscape, 34 px home
// indicator in portrait, 21 px in landscape), as iOS reports them with viewport-fit=cover.
// Touch viewports also fly a Lineup hop (attitude dial vs the LIFT slot).
// Every viewport is flown with the HUD compact and full (0061, src/hud-mode.js: the choice is set
// in localStorage before the page loads); a frame's name carries `-compact` or `-full`.
//
// Once per viewport the judges' theatre is measured too (0082): its judge stream is held open so the
// show stays up, its content is set to a fixed worst case (the stream's text, the model card, the
// counters; a phone also with its Rookie row), its motion is stopped (the particle field is hidden: any
// frame of it is a sample, and its legibility is scripts/theatre-shots.mjs's job), and its boxes are
// checked for overlaps and for leaving the theatre, its text for size and contrast, and every control
// for a 44 × 44 px target (its centre's 44 px square, sampled with elementFromPoint, must hit it).
// Then, where Replay folds the results to a peek (0068: the sheet covers the screen), the peek is measured
// the same way over the replay (11-peek).
// And once per viewport the pause sheet (0092), paused mid-run as a phone pauses: the same checks, with
// every button (Resume and Home above all) inside the sheet's visible box and the viewport at its top.
//
// A gate (0082): the exit code is 1 when any count is non-zero (overlaps, offscreen, text < 11 px,
// labels < 4.5:1, targets < 44 px, anything that changed between the two shots, frames missed), and
// the offenders are listed at the end.
// --shard=N/M flies the N-th of M shares of the viewports, balanced by estimated cost (scripts/audit-plan.mjs;
// CI splits `all` across parallel jobs).
// CI (software GL, about 2× slower): AUDIT_SLOW (default 2 when CI is set) scales every wait.
//
// Writes <outdir>/<label>-<viewport>-<phase>.png and <outdir>/<label>-report.json.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { DRIVE, viewportsFor, planShards, touchFor, dprFor, insetCss } from './audit-plan.mjs';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const [url = 'http://localhost:4391/coldgas/', out = 'shots', set = 'all', label = 'audit', states = 'both'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SLOW = Number(process.env.AUDIT_SLOW || (process.env.CI ? 2 : 1));
const ms = (t) => Math.round(t * SLOW);
const [shardN, shardM] = (flags.shard || '1/1').split('/').map(Number);
if (!(shardM >= 1 && shardN >= 1 && shardN <= shardM)) { console.error(`bad --shard=${flags.shard} (want N/M, 1 ≤ N ≤ M)`); process.exit(2); }
const STATES = states === 'both' ? ['compact', 'full'] : [states];
mkdirSync(out, { recursive: true });
const ALL_VIEWPORTS = viewportsFor(set);
// A shard is a cost-balanced share of the viewports (scripts/audit-plan.mjs; the title audit is one
// of its items, run by scripts/serve-and-audit.mjs with the shard that holds it).
const VIEWPORTS = shardM > 1 ? planShards(ALL_VIEWPORTS, shardM, { title: set === 'all' })[shardN - 1].filter((v) => v !== 'title') : ALL_VIEWPORTS;
// The ratio and the forced insets per viewport (scripts/audit-plan.mjs: a notched phone's on the `s` pass, the
// folding phone's measured ones on its poses, 0103).

// Everything that sits over the stage during a run (both the old markup and the new; missing ones
// are skipped). Pairs where one contains the other are not overlaps.
const BOXES = [
  '.top .brand', '.top-actions', '[data-drill-bar]', '[data-cue]',
  // old HUD
  '.hud-left', '.hud .speed', '.descent', '.hud .phase', '.adi-wrap', '.readouts',
  // new HUD
  '[data-hud-box]',
  // touch (the stick's label stands outside the stick's box: a box of its own, 0087)
  '[data-stick]', '[data-stick-hint]', '.buttons', '.tbtn', '[data-onethumb]', '[data-nozzle-pad] svg',
  // Free Drive
  '.fd-road', '.fd-ctl', '.fd-timer', '.fd-speed', '.fd-stats', '.fd-map', '.fd-fine', '.bq-dock', '.fd-ai',
  // the HUD's handle (compact ⇄ full), wherever it stands
  '[data-hud-toggle]',
];
const TEXT_ROOTS = '[data-screen="hud"], [data-touch], [data-cue], .top, [data-drill-bar], [data-drive-hud], [data-onethumb], .bq-dock';

// The judges' theatre (0082): its panels and controls, measured inside the theatre's own box.
const THEATRE = {
  boxes: ['.th-rail', '.th-caption', '.th-card', '.th-stats', '.th-ticker', '.th-skip', '.th-quick button'].map((s) => `[data-theatre] ${s}`),
  textRoots: '[data-theatre]', targets: '[data-theatre] button', within: '[data-theatre]',
};

// The pause sheet (0092): its heading and actions against the sheet's visible box and the viewport (with
// the sheet at its top: Resume and Home must be on the glass without scrolling), its text for size and
// contrast, its buttons for 44 px targets. The sheet itself is a box, so a sheet taller than the
// viewport is offscreen too. --plant=pause-spacer pushes the actions 600 px down (the gate must fail).
const PAUSE = {
  boxes: ['.sheet', '.sheet h2', '[data-resume]', '[data-restart]', '[data-controls-open]', '[data-howto-open]', '[data-home]'].map((s) => `[data-screen="pause"] ${s}`),
  textRoots: '[data-screen="pause"]', targets: '[data-screen="pause"] .actions .btn', within: '[data-screen="pause"] .sheet',
};

// Replay on a phone (0068): the results folded to their peek at the bottom, the replay above it.
const PEEK = {
  boxes: ['.top .brand', '.top-actions', '.results [data-peek] .peek-line', '.results [data-peek] .btn'],
  textRoots: '.results [data-peek], .top', targets: '.results [data-peek] button',
};

// A GPU where there is one (macOS: Metal); software GL elsewhere (CI), as the e2e config does.
const GL = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });
const report = [];
const missed = [];

// What is on the glass, as the contrast pass depends on it: every measured box and every label (its rect,
// its effective opacity). Taken with the frame shot and again with the text-hidden shot; anything that
// differs moved or faded between the two, and its contrast would be measured against the wrong pixels
// (0077: a wall-clock cue faded out between them and measured 1.99:1). Reported, and counted.
function snapGlass({ BOXES, TEXT_ROOTS }) {
  const shown = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || e.hidden) return false; } const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const sig = (el) => { const r = el.getBoundingClientRect(); let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}@${op.toFixed(2)}`; };
  const out = {};
  for (const sel of BOXES) document.querySelectorAll(sel).forEach((el, i) => { if (shown(el)) out[`${el.dataset.hudBox || sel}#${i}`] = sig(el); });
  for (const root of document.querySelectorAll(TEXT_ROOTS)) [root, ...root.querySelectorAll('*')].forEach((el, i) => {
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && shown(el)) out[`${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''}#${i} "${el.textContent.trim().slice(0, 16)}"`] = sig(el);
  });
  return out;
}

async function measure(page, vpName, phase, { boxes = BOXES, textRoots = TEXT_ROOTS, targets = null, within = null } = {}) {
  const file = `${out}/${label}-${vpName}-${phase}.png`;
  // The sim is frozen, so the cue line's timer runs out and it fades; in play it is refreshed every
  // frame while it applies. Hold it on (no fade) so it is measured as a player sees it: only if it is
  // showing at the freeze (a line that had already faded stays faded), pinned until the thaw so the
  // page's own clock can't fade it halfway through the measurement.
  await page.evaluate(() => {
    const c = document.querySelector('[data-cue]');
    if (!document.getElementById('audit-hold-css')) { const st = document.createElement('style'); st.id = 'audit-hold-css'; st.textContent = '[data-cue].audit-hold { opacity: 1 !important; transition: none !important; }'; document.head.append(st); }
    if (c?.textContent.trim() && c.classList.contains('on')) c.classList.add('audit-hold');
  });
  await page.waitForTimeout(ms(450));   // let transitions settle
  // Hold the page still while it is measured: every frame loop waits (requestAnimationFrame callbacks are
  // queued, then released after the bare shot), so the 3D frame (the sim is frozen, but render-time
  // sparks, dust and the camera's drift would go on), Free Drive's live readouts and the cue's clock
  // (src/ui.js tickCue) are the same for the text shot and the bare shot. CSS motion is settled too:
  // every animation at its resting state (a blinking BRAKE or a pulsing pad is measured lit, not at a
  // random phase; the damage flash, which ends hidden, keeps its own) and transitions done. The loops'
  // frames already in flight land in the queue first (two timer ticks).
  await page.addStyleTag({ content: '*:not(.dmg-fx), *::before, *::after { animation: none !important; transition: none !important; }' }).then((h) => page.evaluate((el) => { el.id = 'audit-still'; }, h));
  await page.evaluate(() => new Promise((res) => {
    if (!window.__auditRaf) { const q = []; window.__auditRaf = { q, raf: window.requestAnimationFrame }; window.requestAnimationFrame = (cb) => { q.push(cb); return 0; }; }
    setTimeout(() => setTimeout(res, 50), 50);
  }));
  const shot = await page.screenshot({ path: file });
  const before = await page.evaluate(snapGlass, { BOXES: boxes, TEXT_ROOTS: textRoots });
  const m = await page.evaluate(({ BOXES, TEXT_ROOTS, targets, within }) => {
    const vis = (el) => {
      if (!el || !el.isConnected) return false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
        if (e.hidden) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const boxes = [];
    for (const sel of BOXES) for (const el of document.querySelectorAll(sel)) if (vis(el)) {
      const r = el.getBoundingClientRect();
      boxes.push({ sel: el.dataset.hudBox ? `[data-hud-box=${el.dataset.hudBox}]` : sel, el, r: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.x + a.r.w, b.r.x + b.r.w) - Math.max(a.r.x, b.r.x);
      const h = Math.min(a.r.y + a.r.h, b.r.y + b.r.h) - Math.max(a.r.y, b.r.y);
      if (w > 1 && h > 1) overlaps.push({ a: a.sel, b: b.sel, px: Math.round(w * h) });
    }
    // Off the glass: outside the viewport, or outside the panel the boxes live in (the theatre and the
    // pause sheet clip), whichever is tighter.
    const P = within ? document.querySelector(within).getBoundingClientRect() : { x: 0, y: 0, right: innerWidth, bottom: innerHeight };
    const W = { x: Math.max(0, P.x), y: Math.max(0, P.y), right: Math.min(innerWidth, P.right), bottom: Math.min(innerHeight, P.bottom) };
    const offscreen = boxes.filter((b) => b.r.x < W.x - 1 || b.r.y < W.y - 1 || b.r.x + b.r.w > W.right + 1 || b.r.y + b.r.h > W.bottom + 1).map((b) => b.sel);
    // Touch targets: the 44 × 44 px square on each control's centre is all the control's (a hit area
    // may extend past the visual box, as the top bar's Menu does), and on the glass.
    const smallTargets = [];
    if (targets) for (const el of document.querySelectorAll(targets)) if (vis(el)) {
      const r = el.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const pts = [];
      for (const dx of [-21, 0, 21]) for (const dy of [-21, 0, 21]) pts.push([cx + dx, cy + dy]);
      const miss = pts.filter(([x, y]) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true; const at = document.elementFromPoint(x, y); return !at || !el.contains(at); });
      if (miss.length) smallTargets.push(`${el.textContent.trim().slice(0, 16) || el.className} ${Math.round(r.width)}×${Math.round(r.height)} (${miss.length}/9 points miss)`);
    }
    // Text: every visible element with its own text.
    const texts = [];
    for (const root of document.querySelectorAll(TEXT_ROOTS)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own || !vis(el)) continue;
        const cs = getComputedStyle(el);
        let px = parseFloat(cs.fontSize);
        if (el instanceof SVGElement) { const ctm = el.getScreenCTM(); if (ctm) px *= Math.hypot(ctm.a, ctm.b); }
        const r = el.getBoundingClientRect();
        // effective opacity up the tree
        let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        const color = el instanceof SVGElement ? cs.fill : cs.color;
        // Scrolled out of a clipping panel (the pause sheet's lower key lines): its size counts, but it
        // isn't on the glass, so there is no background to measure it against.
        const clipped = !!within && (r.y < W.y - 1 || r.y + r.height > W.bottom + 1 || r.x < W.x - 1 || r.x + r.width > W.right + 1);
        texts.push({ t: el.textContent.trim().slice(0, 24), px: Math.round(px * 10) / 10, color, op, clipped, r: { x: r.x, y: r.y, w: r.width, h: r.height } });
      }
    }
    return { overlaps, offscreen, texts, smallTargets };
  }, { BOXES: boxes, TEXT_ROOTS: textRoots, targets, within });
  // Contrast: hide the HUD's text, screenshot the same frame (the sim is frozen), compare.
  await page.addStyleTag({ content: `${textRoots.split(', ').map((s) => `${s}, ${s} *`).join(', ')} { color: transparent !important; fill: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; }` }).then((h) => page.evaluate((el) => { el.id = 'audit-hide'; }, h));
  await page.waitForTimeout(ms(80));
  const bare = await page.screenshot();
  const after = await page.evaluate(snapGlass, { BOXES: boxes, TEXT_ROOTS: textRoots });
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).map((k) => `${k} ${before[k] || 'absent'} → ${after[k] || 'gone'}`);
  await page.evaluate(() => { document.getElementById('audit-hide')?.remove(); document.getElementById('audit-still')?.remove(); const h = window.__auditRaf; if (h) { delete window.__auditRaf; window.requestAnimationFrame = h.raf; for (const cb of h.q) h.raf.call(window, cb); } });
  const contrast = await page.evaluate(async ({ shotB64, bareB64, texts, dpr }) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
    const [img, bimg] = await Promise.all([load(shotB64), load(bareB64)]);
    const cv = new OffscreenCanvas(bimg.width, bimg.height), cx = cv.getContext('2d');
    cx.drawImage(bimg, 0, 0);
    const bg = cx.getImageData(0, 0, cv.width, cv.height).data;
    void img;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) || [255, 255, 255, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    return texts.map((t) => {
      if (t.clipped) return { t: t.t, px: t.px, ratio: null };
      const c = parse(t.color), a = c.a * t.op;
      // Inset 2 px: a box's own border is not the background behind its glyphs.
      const ins = Math.min(2, t.r.w / 4, t.r.h / 4);
      const x0 = Math.max(0, Math.floor((t.r.x + ins) * dpr)), y0 = Math.max(0, Math.floor((t.r.y + ins) * dpr));
      const x1 = Math.min(cv.width, Math.ceil((t.r.x + t.r.w - ins) * dpr)), y1 = Math.min(cv.height, Math.ceil((t.r.y + t.r.h - ins) * dpr));
      const ls = [];
      let worst = null;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * cv.width + x) * 4;
        // the text's own colour composited over this background pixel
        const tr = c.r * a + bg[i] * (1 - a), tg = c.g * a + bg[i + 1] * (1 - a), tb = c.b * a + bg[i + 2] * (1 - a);
        const lt = L(tr, tg, tb), lb = L(bg[i], bg[i + 1], bg[i + 2]);
        ls.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05));
      }
      if (!ls.length) return { ...t, ratio: null };
      ls.sort((p, q) => p - q);
      worst = ls[Math.floor(ls.length * 0.1)];   // the worst 10 % of the background behind it
      return { t: t.t, px: t.px, ratio: Math.round(worst * 100) / 100 };
    });
  }, { shotB64: shot.toString('base64'), bareB64: bare.toString('base64'), texts: m.texts, dpr: await page.evaluate(() => devicePixelRatio) });
  const small = m.texts.filter((t) => t.px < 11).map((t) => `${t.t} ${t.px}px`);
  const low = contrast.filter((c) => c.ratio !== null && c.ratio < 4.5).map((c) => `${c.t} ${c.ratio}`);
  const minPx = Math.min(...m.texts.map((t) => t.px));
  const minRatio = Math.min(...contrast.filter((c) => c.ratio !== null).map((c) => c.ratio));
  const minLabel = contrast.find((c) => c.ratio === minRatio)?.t ?? null;   // which label it is (the margin to watch)
  const row = { vp: vpName, phase, file, overlaps: m.overlaps, offscreen: m.offscreen, minPx, small, minRatio, minLabel, lowContrast: low, smallTargets: m.smallTargets, changed };
  report.push(row);
  console.log(`${vpName} ${phase}: overlaps ${m.overlaps.length}${m.overlaps.length ? ` (${m.overlaps.map((o) => `${o.a}×${o.b} ${o.px}`).join('; ')})` : ''} · offscreen ${m.offscreen.length}${m.offscreen.length ? ` (${m.offscreen.join(', ')})` : ''} · min text ${minPx}px (${small.length} < 11) · min contrast ${minRatio}${minLabel ? ` "${minLabel}"` : ''} (${low.length} < 4.5)${targets ? ` · targets < 44 px ${m.smallTargets.length}` : ''}${changed.length ? ` · changed during measure ${changed.length} (${changed.join('; ')})` : ''}`);
}

// The judges' theatre, held up and made still (0082): a fixed, worst-case call (the longest lines it
// shows), at COMPUTE (every panel up, the stream on its glass), no motion. On a phone it is measured
// again with the Rookie row (0076) in its bar.
async function measureTheatre(page, vpName) {
  const up = await page.waitForFunction(() => { const t = document.querySelector('[data-theatre]'); return t && !t.hidden && t.classList.contains('on') && t.querySelector('.th-rail'); }, null, { timeout: ms(60000) }).then(() => true).catch(() => false);
  if (!up) { missed.push(`${vpName} 10-theatre`); console.log('  missed the theatre'); return; }
  await page.waitForTimeout(ms(900));   // its fade-in
  await page.addStyleTag({ content: '[data-theatre], [data-theatre] *, [data-theatre]::before, [data-theatre] *::before, [data-theatre] *::after { animation: none !important; transition: none !important; } [data-theatre] .th-canvas { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const root = document.querySelector('[data-theatre]'), q = (s) => root.querySelector(s);
    const set = (s, t) => { const n = q(s); if (n) n.textContent = t; };
    root.dataset.stage = 'compute';
    [...root.querySelectorAll('.th-rail li')].forEach((li, i) => { li.className = i < 2 ? 'done' : i === 2 ? 'on' : ''; });
    set('.th-caption', 'gemma-4-26b-a4b-it is writing the judges\' remarks…');
    set('[data-k="model"]', 'gemma-4-26b-a4b-it'); set('[data-k="vendor"]', 'Free · Workers AI');
    set('[data-k="where"]', 'Cloudflare edge'); set('[data-k="billed"]', 'COLD GAS · free allowance');
    for (const [k, v] of Object.entries({ in: '~612', out: '48', ttft: '412 ms', rate: '38 tok/s', neurons: '13', cost: '—' })) set(`[data-s="${k}"]`, v);
    set('[data-k="reason"]', 'Sink 0.6 m/s at the pad, inside the limit; the roll finished level.');
    set('[data-k="out"]', 'ENGINEER: Sink rate 0.6 m/s at the pad. I would sign that off. COORDINATOR: That is the stunt. DESIGNER: One unbroken line.');
  });
  await measure(page, vpName, '10-theatre', THEATRE);
  if (await page.evaluate(() => innerWidth <= 720)) {
    await page.evaluate(() => document.querySelector('[data-theatre]').classList.add('th-rookie'));
    await measure(page, vpName, '10-theatre-rookie', THEATRE);
  }
}

// The pause sheet (0092), once per viewport: a fresh run, paused the way a phone pauses one (the tab goes
// hidden and comes back: a key would make the keyboard the device and show its key lists on a touch
// screen), the sheet at its top, measured, then Home.
async function measurePause(page, vpName) {
  await page.evaluate(() => { const g = window.__coldgas; g.S.paused = false; g.startRun('jump'); g.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: ms(30000) }).catch(() => {});
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const up = await page.waitForFunction(() => { const p = document.querySelector('[data-screen="pause"]'); return p && !p.hidden && window.__coldgas.S.paused; }, null, { timeout: ms(10000) }).then(() => true).catch(() => false);
  if (!up) { missed.push(`${vpName} 12-pause`); console.log('  missed the pause sheet'); return; }
  if (flags.plant === 'pause-spacer') await page.evaluate(() => { const d = document.createElement('div'); d.style.height = '600px'; document.querySelector('[data-screen="pause"] .actions').before(d); });
  await page.waitForTimeout(ms(700));   // the sheet's rise
  await page.evaluate(() => { document.querySelector('[data-screen="pause"] .sheet').scrollTop = 0; });
  await measure(page, vpName, '12-pause', PAUSE);
  await page.evaluate(() => document.querySelector('[data-screen="pause"] [data-home]').click());
}

// The peek opens only where the sheet covers the screen (a phone upright, a folding phone open); elsewhere
// Replay leaves the sheet where it is and there is nothing new to measure. The call is held open, so the
// theatre is put away as the call's end would (Skip waits for the words).
async function measurePeek(page, vpName) {
  const open = await page.evaluate(() => {
    const th = document.querySelector('[data-theatre]');
    if (th) { th.hidden = true; th.classList.remove('on', 'out'); }
    document.querySelector('.results .sheet [data-replay]')?.click();
    return window.__coldgas.S.peek;
  });
  if (!open) return;
  await measure(page, vpName, '11-peek', PEEK);
  await page.evaluate(() => document.querySelector('.results [data-peek-back]')?.click());
}

// Seconds each viewport took (both states), for the shard plan's cost model (scripts/audit-plan.mjs).
const seconds = {};
for (const [w, h, safe] of VIEWPORTS) for (const hudState of STATES) {
  const t0 = Date.now();
  const touch = safe || touchFor(w, h);
  const vpBase = `${w}x${h}${safe ? 's' : ''}`, vpName = `${vpBase}-${hudState}`;
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: dprFor(w, h), isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The judges' stream is held open (never answered), so the theatre stays up to be measured.
  await page.route('**/coldgas/api/judge/stream', () => { /* held open */ });
  await page.addInitScript((m) => { try { localStorage.setItem('coldgas_hud', m); } catch { /* storage blocked */ } }, hudState);
  const forced = insetCss(w, h, safe);
  if (forced) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }), forced);
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: ms(30000) });
  await page.waitForTimeout(ms(1500));
  const S = (fn, arg) => page.evaluate(fn, arg);
  const freeze = () => S(() => { window.__coldgas.S.paused = true; });
  const thaw = () => S(() => { window.__coldgas.S.paused = false; document.querySelector('[data-cue]')?.classList.remove('audit-hold'); });
  // A frame that is never reached is a failure of the gate, not a skip. The waits are on a condition and
  // generous (a frame is taken as soon as it holds): on software GL a 1080×1920 frame takes ≈ 0.5 s and
  // the clock caps the sim at 0.1 s a frame, so the run-up and the climb run at a fifth of real time.
  const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout: ms(timeout), polling: 'raf' }).then(() => true).catch(() => { missed.push(`${vpName} ${fn.toString().slice(0, 90)}`); console.log('  missed', fn.toString().slice(0, 90)); return false; });
  await S(() => { window.__auditStop = false; window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  // A page-side driver (synthetic key events, read by src/input.js like real ones): crawl in at
  // ≈5 m/s, up the curl, brake on the ledge (as scripts/human-show.mjs's players do).
  await S(() => {
    const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const st = { up: false, dn: false };
    const set = (k, on) => { if (st[k] !== on) { st[k] = on; key(k === 'up' ? 'ArrowUp' : 'ArrowDown', on); } };
    // One-thumb (the touch default on the Show): hold the pad; its governor stops on the ledge.
    const touchEl = document.querySelector('[data-touch]');
    const thumbOn = () => touchEl && !touchEl.hidden && touchEl.dataset.scheme === 'thumb';
    const drive = () => {
      const G = window.__coldgas.S, r = G.run;
      if (thumbOn()) {
        if (!r || G.mode !== 'live' || window.__auditStop) { window.__coldgas.thumb.up(); return; }
        if (!window.__coldgas.thumb.held) window.__coldgas.thumb.down();
        requestAnimationFrame(drive);
        return;
      }
      if (!r || G.mode !== 'live' || window.__auditStop) { set('up', false); set('dn', false); return; }
      if (!G.paused) {
        const v = Math.hypot(r.car.vel.x, r.car.vel.y, r.car.vel.z);
        // ease off near the top, stop on the ledge
        const ledge = r.phase === 'ramp' && (r.t.progress >= 0.95 || (r.t.progress > 0.85 && v > 2.5));
        set('up', !ledge && v < (r.phase === 'ramp' ? (r.t.progress > 0.85 ? 2 : 5) : 5.5));
        set('dn', ledge);
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });
  await until(() => window.__coldgas.S.run.car.pos.z > -5);
  await freeze(); await measure(page, vpName, '1-runup'); await thaw();
  await until(() => window.__coldgas.S.run.phase === 'ramp' && window.__coldgas.S.run.car.pos.y > 10);
  await freeze(); await measure(page, vpName, '2-climb'); await thaw();
  await until(() => { const r = window.__coldgas.S.run; return r.phase === 'ramp' && r.t.progress >= 0.95 && Math.hypot(r.car.vel.x, r.car.vel.y, r.car.vel.z) < 0.2; });
  await S(() => { window.__auditStop = true; });
  await page.waitForTimeout(ms(300));
  await freeze(); await measure(page, vpName, '3-hang'); await thaw();
  const thumbMode = await S(() => { const t = document.querySelector('[data-touch]'); return !!t && !t.hidden && t.dataset.scheme === 'thumb'; });
  if (thumbMode) await S(() => window.__coldgas.thumb.down());   // tap to let go, and keep holding: land
  else { await page.keyboard.down('Space'); await page.waitForTimeout(ms(150)); await page.keyboard.up('Space'); }
  if (!thumbMode) { await page.keyboard.down('KeyF'); await page.keyboard.down('ShiftLeft'); }
  await until(() => window.__coldgas.S.run.phase === 'air' && window.__coldgas.S.run.car.pos.z < -9);
  await freeze(); await measure(page, vpName, '4-carry'); await thaw();
  await until(() => window.__coldgas.S.run.phase === 'air' && window.__coldgas.S.run.car.pos.y < 9);
  await freeze(); await measure(page, vpName, '5-brake'); await thaw();
  await until(() => window.__coldgas.S.run.t.touchTick >= 0);
  await page.waitForTimeout(ms(200));
  await freeze(); await measure(page, vpName, '6-touchdown'); await thaw();
  if (thumbMode) await S(() => window.__coldgas.thumb.up()); else { await page.keyboard.up('KeyF'); await page.keyboard.up('ShiftLeft'); }
  // The aftermath and the results' beat, stepped in the page (the e2e hook): on the wall clock they ran
  // at a fifth of real time at 1080×1920 on software GL (the clock caps the sim at 0.1 s a frame) and
  // missed a 60 s wait (0087). The results are the same either way; only the theatre is measured there.
  await S(() => window.__coldgas.fastForward());
  if (await until(() => window.__coldgas.S.mode === 'results', 30000) && hudState === STATES[0]) { await measureTheatre(page, vpBase); await measurePeek(page, vpBase); }
  // A wreck (0072): the reference with every input zeroed from the release + 0.125 s ends flipped,
  // 66 % Wrecked. Stepped to its end in the page, then a beat of its aftermath (0.6 s, stepped too: on
  // the wall clock the car and the debris were somewhere else at every frame rate, and the labels over
  // them measured 4.5 to 5.8:1 from run to run, 0087): the damage on the compact line and the crash on
  // the timeline, as a player sees them; frozen there, then two of the page's own frames to draw it.
  const wrecked = await S(() => {
    const g = window.__coldgas, G = g.S;
    g.startRun('reveal'); g.skipCountdown();
    const ap = G.autopilot;
    G.autopilot = (run) => { const i = ap(run); if (G.released && run.tick - G.releaseTick >= 30) for (const k of g.inputKeys) i[k] = 0; return i; };
    for (let i = 0; i < 900 && G.run.phase !== 'done'; i++) g.liveStep(0.1);
    for (let i = 0; i < 36 && G.mode === 'live'; i++) g.liveStep(1 / 60);
    G.paused = true;   // frozen here, before the page's own clock can step it on
    // The reference autopilot announces itself on the cue line ("The reference run…"), which a player's
    // own wreck never shows: cleared, so the frame doesn't depend on whether its 2.4 s ran out.
    const c = document.querySelector('[data-cue]'); if (c) c.textContent = '';
    return G.run.phase === 'done';
  });
  if (wrecked) { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await measure(page, vpName, '9-wreck'); await thaw(); }
  else { missed.push(`${vpName} 9-wreck`); console.log('  missed the wreck'); }
  if (hudState === STATES[0]) await measurePause(page, vpBase);
  // The Lineup in the air (touch): its air layout adds LIFT in slot B beside the attitude dial.
  if (touch) {
    await S(() => window.__coldgas.toTitle());
    await page.goto(`${url}?gfx=low&course=lineup`);
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: ms(30000) });
    await page.waitForTimeout(ms(800));
    await S(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(ms(1200)); await page.keyboard.down('Space');
    if (await until(() => window.__coldgas.S.run.phase === 'air' && window.__coldgas.S.run.car.pos.y > 1.5)) {
      await freeze(); await measure(page, vpName, '8-lineup-air'); await thaw();
    }
    await page.keyboard.up('Space'); await page.keyboard.up('ArrowUp');
  }
  // Free Drive on phones, iPads and the two desktop sizes.
  if (DRIVE.includes(vpBase)) {
    await S(() => window.__coldgas.toTitle());
    await page.goto(`${url}?gfx=low&drive=stelvio`);
    const ok = await until(() => window.__coldgas?.drive?.active, 90000);
    if (ok) {
      // Off the start to a fixed speed, then coast (not 2.5 s of wall clock: on software GL the clock caps
      // the sim at 0.1 s a frame, so a timed press left the car, the camera and what lies behind the
      // labels somewhere else on every runner).
      await page.keyboard.down('ArrowUp');
      await until(() => window.__coldgas.drive.stats().speed > 6, 60000);
      await page.keyboard.up('ArrowUp');
      await S(() => window.__coldgas.drive.pause?.(false));
      await measure(page, vpName, '7-drive');
    }
  }
  if (errors.length) console.log('  errors:', errors.slice(0, 3).join(' | '));
  await page.close();
  seconds[vpBase] = Math.round((seconds[vpBase] || 0) + (Date.now() - t0) / 1000);
  if (hudState === STATES[STATES.length - 1]) console.log(`  ${vpBase}: ${seconds[vpBase]} s`);
}
writeFileSync(`${out}/${label}-report.json`, JSON.stringify({ shard: `${shardN}/${shardM}`, viewports: VIEWPORTS.map(([w, h, s]) => `${w}x${h}${s ? 's' : ''}`), seconds, missed, frames: report }, null, 1));
const tot = report.reduce((a, r) => ({ ov: a.ov + r.overlaps.length, sm: a.sm + r.small.length, lc: a.lc + r.lowContrast.length, off: a.off + r.offscreen.length, tg: a.tg + (r.smallTargets?.length || 0), ch: a.ch + (r.changed?.length || 0) }), { ov: 0, sm: 0, lc: 0, off: 0, tg: 0, ch: 0 });
console.log(`TOTAL ${label}${shardM > 1 ? ` (shard ${shardN}/${shardM})` : ''}: ${report.length} frames · overlaps ${tot.ov} · offscreen ${tot.off} · text < 11 px ${tot.sm} · labels < 4.5:1 ${tot.lc} · targets < 44 px ${tot.tg} · changed during measure ${tot.ch} · missed ${missed.length}`);
// The gate: every offender, then a non-zero exit code.
const bad = report.filter((r) => r.overlaps.length || r.offscreen.length || r.small.length || r.lowContrast.length || r.smallTargets?.length || r.changed?.length);
if (bad.length || missed.length) {
  console.log('FAIL — offenders:');
  for (const r of bad) {
    const why = [...r.overlaps.map((o) => `overlap ${o.a}×${o.b} ${o.px}px²`), ...r.offscreen.map((o) => `offscreen ${o}`), ...r.small.map((t) => `small "${t}"`), ...r.lowContrast.map((t) => `contrast "${t}"`), ...(r.smallTargets || []).map((t) => `target ${t}`), ...(r.changed || []).map((t) => `changed during measure ${t}`)];
    console.log(`  ${r.vp} ${r.phase}: ${why.join('; ')}`);
  }
  for (const m of missed) console.log(`  missed: ${m}`);
  process.exitCode = 1;
}
await browser.close();
