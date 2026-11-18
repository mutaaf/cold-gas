// Short-form vertical clips (TikTok, YouTube Shorts, Reels): the shared cutting room.
//
// A clip is cut from takes. A take is one scripted, deterministic run of the game recorded by Playwright's
// recordVideo at the clip's own size, with named marks (seconds into the recording) written beside it. A clip in
// store/clips/clips.json lists segments of takes (from a mark, for a length, at a speed), the captions over them
// and the end card. Re-cutting a variant only needs `--skip-capture`: the takes stay in dist-clips/raw/.
//
// Captions are drawn by Chromium (the game's own font, a black outline, accent words) to transparent PNGs and laid
// over the cut by ffmpeg. The Homebrew ffmpeg on this machine has no libass or drawtext, so an ASS file can't be
// burned; this needs nothing beyond Playwright and a stock ffmpeg. Every caption's box is measured as it is drawn
// and the cut fails if it reaches the bottom 20 % or the right edge, where the apps put their own buttons.
//
// Output: dist-clips/<id>.mp4 (H.264 High, yuv420p, 30 fps, +faststart, a silent AAC track so every app takes it),
// dist-clips/contact-sheet.png (each clip's first frame), dist-clips/qa/<id>.png (0 s, 1 s, middle and end, with the
// safe areas drawn on) for a person to look at before posting.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SAFE = { bottom: 0.8, right: 150, left: 48, top: 210 };   // px at 1080 wide; bottom as a share of height
const FPS = 30;

const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Reads the clip config and checks the text rules: no em or en dashes, at most two caption lines of 1-5 words. */
export function loadConfig(file, root) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  // Fonts named in the config by their path in the repo, as @font-face rules the caption pages can load.
  cfg.style.fontFace = (cfg.style.fonts || []).map((f) => `@font-face{font-family:'${f.family}';src:url('${pathToFileURL(resolve(root, f.file)).href}');font-weight:${f.weight || '100 900'};font-display:block}`).join('\n');
  const problems = [];
  const text = (where, s) => { if (/[–—]/.test(s)) problems.push(`${where}: a dash (en or em) in "${s}"`); };
  for (const c of cfg.clips) {
    for (const [i, cap] of (c.captions || []).entries()) {
      if (cap.lines.length > 2) problems.push(`${c.id} caption ${i}: ${cap.lines.length} lines (max 2)`);
      for (const l of cap.lines) {
        text(`${c.id} caption ${i}`, l);
        const words = l.replace(/\*/g, '').trim().split(/\s+/).length;
        if (words > 5) problems.push(`${c.id} caption ${i}: "${l}" has ${words} words (max 5)`);
      }
    }
    for (const k of ['post', 'title']) if (c[k]) text(`${c.id} ${k}`, c[k]);
  }
  for (const s of [cfg.endCard?.line, cfg.endCard?.url, cfg.endCard?.kicker]) if (s) text('end card', s);
  if (problems.length) throw new Error(`clips.json:\n  ${problems.join('\n  ')}`);
  return cfg;
}

/**
 * Records one take. `drive(page, mark)` plays the game; `mark(name)` stamps the seconds since recording began.
 * The video is only written when the context closes, so this closes it and moves the file to raw/<name>.webm.
 */
export async function capture(chromium, { name, size, out, launch = {}, context = {}, init, drive }) {
  const raw = join(out, 'raw');
  const tmp = join(raw, `.${name}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: size, ...context, recordVideo: { dir: tmp, size } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = {};
  // mark(name) stamps now; mark(name, ms) stamps a Date.now() taken elsewhere (a page's own clock is the same clock).
  const mark = (n, at = Date.now()) => { marks[n] = +((at - t0) / 1000).toFixed(3); console.log(`    ${name}: ${n} @ ${marks[n]}s`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try { await drive(page, mark); }
  finally {
    const video = page.video();
    await ctx.close();
    await browser.close();
    const file = await video.path();
    execFileSync('mv', [file, join(raw, `${name}.webm`)]);
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(join(raw, `${name}.json`), JSON.stringify({ marks, errors, at: new Date().toISOString() }, null, 2));
  if (errors.length) console.log(`    ${name}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  return marks;
}

/** A page of HTML in dist-clips/tmp, loaded from file:// so it can use the repo's own font files. */
async function still(browser, out, name, html, size, { transparent = false, measure } = {}) {
  const tmp = join(out, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const file = join(tmp, `${name}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const box = measure ? await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, measure) : null;
  if (errors.length) throw new Error(`${name}: page error ${errors[0]}`);
  const png = join(tmp, `${name}.png`);
  await page.screenshot({ path: png, omitBackground: transparent });
  await page.close();
  return { png, box };
}

function captionHtml(cap, style, size) {
  const top = { top: style.captionTop ?? 300, mid: Math.round(size.height * 0.36), low: Math.round(size.height * 0.56) }[cap.at || 'top'];
  const width = size.width - SAFE.left - SAFE.right - 40;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${style.fontFace || ''}
html,body{margin:0;background:transparent;width:${size.width}px;height:${size.height}px;overflow:hidden}
#c{position:absolute;left:${SAFE.left + 20}px;width:${width}px;top:${top}px;text-align:center;font-family:${style.font};font-weight:${style.weight || 900};
  color:#fff;line-height:1.08;letter-spacing:${style.tracking || '0'};text-transform:${style.upper === false ? 'none' : 'uppercase'};
  -webkit-text-stroke:${style.stroke || 16}px #000;paint-order:stroke fill;text-shadow:0 6px 18px rgba(0,0,0,.55)}
#c div{white-space:nowrap}
#c b{font-weight:inherit}
</style></head><body><div id="c"></div>
<script>
// Fit: the longest line fills at most the safe width, never past the largest size. A one-line caption that would
// have to drop under the smallest readable size is broken into two balanced lines instead.
const ACCENT = ${JSON.stringify(style.accent)}, MAX = ${style.size || 104}, MIN = ${style.minSize || 84}, W = ${width};
const html = (l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\\*([^*]+)\\*/g, '<b style="color:' + ACCENT + '">$1</b>');
const c = document.getElementById('c');
let lines = ${JSON.stringify(cap.lines)}, s = MAX;
const set = () => { c.innerHTML = lines.map((l) => '<div>' + html(l) + '</div>').join(''); };
const fit = () => { s = MAX; c.style.fontSize = s + 'px'; while (s > 40 && [...c.children].some((d) => d.scrollWidth > W)) { s -= 2; c.style.fontSize = s + 'px'; } };
set();
document.fonts.ready.then(() => {
  fit();
  if (s < MIN && lines.length === 1) {
    // Split where the two halves come closest in length, never inside an *accent*.
    const w = lines[0].split(' ');
    let best = null;
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i).join(' '), b = w.slice(i).join(' ');
      if ((a.split('*').length - 1) % 2) continue;
      const d = Math.abs(a.length - b.length);
      if (!best || d < best.d) best = { d, a, b };
    }
    if (best) { lines = [best.a, best.b]; set(); fit(); }
  }
});
</script></body></html>`;
}

function endCardHtml(card, style, size, bg) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${style.fontFace || ''}
html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden;background:#000}
.bg{position:absolute;inset:-60px;background:url("${bg}") center/cover;filter:blur(28px) brightness(.38) saturate(1.1)}
.wash{position:absolute;inset:0;background:${card.wash || 'radial-gradient(120% 70% at 45% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,.55) 100%)'}}
#card{position:absolute;left:${SAFE.left + 20}px;width:${size.width - SAFE.left - SAFE.right - 40}px;top:${Math.round(size.height * 0.27)}px;text-align:center;color:#fff;font-family:${style.font}}
.mark{${card.markCss || ''}}
.mark img{max-width:72%;max-height:300px}
.kicker{margin-top:56px;font-weight:${style.weight || 900};font-size:${card.kickerSize || 92}px;line-height:1;text-transform:uppercase;letter-spacing:${style.tracking || '0'};
  -webkit-text-stroke:12px #000;paint-order:stroke fill}
.url{display:inline-block;margin-top:34px;padding:22px 34px;border-radius:999px;background:${card.pill || style.accent};color:${card.pillText || '#000'};
  font-family:${card.urlFont || style.font};font-weight:${card.urlWeight || 800};font-size:${card.urlSize || 54}px;letter-spacing:0;white-space:nowrap}
.sub{margin-top:28px;font-family:${card.subFont || style.font};font-size:34px;opacity:.82;font-weight:600}
</style></head><body><div class="bg"></div><div class="wash"></div>
<div id="card"><div class="mark">${card.mark || ''}</div><div class="kicker">${esc(card.kicker || 'Play free')}</div>
<div class="url">${esc(card.url)}</div>${card.sub ? `<div class="sub">${esc(card.sub)}</div>` : ''}</div>
<script>
const u = document.querySelector('.url'), w = document.getElementById('card').clientWidth; let s = ${card.urlSize || 54};
document.fonts.ready.then(() => { while (s > 30 && u.offsetWidth > w) { s -= 2; u.style.fontSize = s + 'px'; } });
</script></body></html>`;
}

const inSafe = (box, size) => box.x >= SAFE.left - 1 && box.x + box.w <= size.width - SAFE.right + 1 && box.y >= SAFE.top && box.y + box.h <= size.height * SAFE.bottom;

/** Cuts one clip: segments at their speeds, captions over them, the end card, one H.264 file. */
export async function render(chromium, cfg, clip, { out }) {
  const size = cfg.size;
  const tmp = join(out, 'tmp', clip.id);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch();
  try {
    // 1. The cut, with its captions.
    const args = [], chains = [], placed = [];
    let t = 0;
    for (const [i, s] of clip.segments.entries()) {
      const take = join(out, 'raw', `${s.take}.webm`);
      if (!existsSync(take)) throw new Error(`${clip.id}: no take ${s.take} (run without --skip-capture)`);
      const marks = JSON.parse(readFileSync(join(out, 'raw', `${s.take}.json`), 'utf8')).marks;
      const at = (v) => (typeof v === 'number' ? v : (() => { const [m, off = '0'] = String(v).split(/(?=[+-])/); if (!(m in marks)) throw new Error(`${clip.id}: take ${s.take} has no mark ${m}`); return marks[m] + Number(off); })());
      const from = at(s.from);
      const dur = s.to !== undefined ? at(s.to) - from : s.dur;
      const speed = s.speed || 1;
      args.push('-ss', from.toFixed(3), '-t', dur.toFixed(3), '-i', take);
      chains.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},scale=${size.width}:${size.height}:flags=lanczos,setsar=1,format=yuv420p[s${i}]`);
      placed.push({ start: t, from, speed, at, dur });
      t += dur / speed;
    }
    // A caption time is seconds into the clip, or "<segment>:<mark>[+-offset]": that moment of the take, wherever
    // the segment put it (so re-timing a segment carries its captions along).
    const when = (v) => {
      if (typeof v === 'number') return v;
      const m = /^(\d+):(.+)$/.exec(v);
      if (!m || !placed[+m[1]]) throw new Error(`${clip.id}: caption time "${v}" is not a number or <segment>:<mark>`);
      const p = placed[+m[1]];
      return +(p.start + (p.at(m[2]) - p.from) / p.speed).toFixed(3);
    };
    const body = t;
    const n = clip.segments.length;
    let graph = chains.join(';') + `;${clip.segments.map((_, i) => `[s${i}]`).join('')}concat=n=${n}:v=1:a=0[cut]`;
    let last = 'cut', input = n;
    const boxes = [];
    for (const [i, cap] of (clip.captions || []).entries()) {
      const { png, box } = await still(browser, tmp, `cap${i}`, captionHtml(cap, cfg.style, size), size, { transparent: true, measure: '#c' });
      if (box.h < 40 || box.w < 100) throw new Error(`${clip.id} caption ${i}: drew nothing (${JSON.stringify(box)})`);
      if (!inSafe(box, size)) throw new Error(`${clip.id} caption ${i} "${cap.lines.join(' / ')}" leaves the safe area: ${JSON.stringify(box)}`);
      boxes.push(box);
      const start = Math.max(0, when(cap.start ?? 0)), end = Math.min(when(cap.end ?? body), body);
      if (end - start < 0.8) throw new Error(`${clip.id} caption ${i}: on screen ${(end - start).toFixed(2)} s, too short to read`);
      args.push('-loop', '1', '-t', body.toFixed(3), '-i', png);
      graph += `;[${last}][${input}:v]overlay=0:0:enable='between(t,${start.toFixed(3)},${(end - 0.001).toFixed(3)})'[o${i}]`;
      last = `o${i}`; input++;
    }
    const cut = join(tmp, 'cut.mp4');
    run([...args, '-filter_complex', graph, '-map', `[${last}]`, '-t', body.toFixed(3), '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-pix_fmt', 'yuv420p', cut]);

    // 2. The end card, over the last frame of gameplay (from the take, so no caption shows through), blurred.
    const lastFrame = join(tmp, 'last.png');
    const tail = placed[placed.length - 1], lastSeg = clip.segments[clip.segments.length - 1];
    run(['-ss', Math.max(0, tail.from + tail.dur - 0.08).toFixed(3), '-i', join(out, 'raw', `${lastSeg.take}.webm`), '-frames:v', '1', '-update', '1', lastFrame]);
    const card = { ...cfg.endCard, ...(clip.endCard || {}) };
    const { png: cardPng, box: cardBox } = await still(browser, tmp, 'card', endCardHtml(card, cfg.style, size, pathToFileURL(lastFrame).href), size, { measure: '#card' });
    if (!inSafe({ ...cardBox, h: cardBox.h }, size)) throw new Error(`${clip.id}: end card leaves the safe area ${JSON.stringify(cardBox)}`);
    const cardLen = card.seconds || 1.8, fade = 0.25;

    // 3. One file: the cut, a short dissolve into the card, silent stereo audio, tagged BT.709, moov up front.
    const file = join(out, `${clip.id}.mp4`);
    run(['-i', cut, '-loop', '1', '-t', (cardLen + fade).toFixed(3), '-framerate', String(FPS), '-i', cardPng,
      '-f', 'lavfi', '-t', (body + cardLen).toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-filter_complex', `[1:v]scale=${size.width}:${size.height},setsar=1,format=yuv420p,fps=${FPS}[card];[0:v]fps=${FPS},format=yuv420p[cut];[cut][card]xfade=transition=fade:duration=${fade}:offset=${(body - fade).toFixed(3)},format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-preset', 'slow', '-crf', '18', '-maxrate', '14M', '-bufsize', '20M',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', file]);
    const length = probe(file);
    return { id: clip.id, file, length: +length.toFixed(2), body: +body.toFixed(2), captions: boxes.length };
  } finally { await browser.close(); }
}

/** Frames at 0 s, 1 s, the middle and the end of a clip, side by side, with the safe areas drawn on. */
export async function qa(chromium, cfg, result, { out }) {
  const dir = join(out, 'qa');
  mkdirSync(dir, { recursive: true });
  const times = [0, 1, result.length / 2, result.length - 0.15];
  const frames = times.map((s, i) => {
    const f = join(dir, `${result.id}-${i}.png`);
    run(['-ss', s.toFixed(2), '-i', result.file, '-frames:v', '1', '-update', '1', f]);
    return f;
  });
  const { width: W, height: H } = cfg.size;
  const w = 360, h = Math.round(H * w / W), k = w / W;
  const html = `<!doctype html><html><body style="margin:0;background:#111;font:600 16px -apple-system,sans-serif;color:#ddd">
<div style="padding:10px 14px">${esc(result.id)} · ${result.length}s</div><div style="display:flex;gap:12px;padding:0 14px 14px">
${frames.map((f, i) => `<div><div style="position:relative;width:${w}px;height:${h}px;background:url('${pathToFileURL(f).href}') 0 0/100% 100%">
<div style="position:absolute;left:0;right:0;top:${h * SAFE.bottom}px;bottom:0;border-top:2px dashed #f55"></div>
<div style="position:absolute;top:0;bottom:0;right:0;width:${SAFE.right * k}px;border-left:2px dashed #f55"></div>
<div style="position:absolute;left:0;right:0;top:0;height:${SAFE.top * k}px;border-bottom:2px dashed #fa0"></div>
</div><div style="padding-top:6px">${['0 s', '1 s', 'middle', 'end'][i]} (${times[i].toFixed(1)} s)</div></div>`).join('')}</div></body></html>`;
  const browser = await chromium.launch();
  try {
    const { png } = await still(browser, out, `qa-${result.id}`, html, { width: 4 * w + 5 * 12 + 4, height: h + 70 });
    execFileSync('mv', [png, join(dir, `${result.id}.png`)]);
  } finally { await browser.close(); }
  return join(dir, `${result.id}.png`);
}

/** One PNG: every clip's first frame in a grid, labelled. */
export async function contactSheet(chromium, cfg, results, { out, title }) {
  const firsts = results.map((r) => {
    const f = join(out, 'tmp', `first-${r.id}.png`);
    run(['-i', r.file, '-frames:v', '1', '-update', '1', f]);
    return { ...r, f };
  });
  const cols = Math.min(firsts.length, 3), w = 320, h = Math.round(cfg.size.height * w / cfg.size.width);
  const rows = Math.ceil(firsts.length / cols);
  const html = `<!doctype html><html><head><style>${cfg.style.fontFace || ''}</style></head><body style="margin:0;background:#0b0b0d;color:#eee;font:600 17px -apple-system,sans-serif">
<div style="padding:22px 24px 6px;font:800 26px ${cfg.style.font}">${esc(title)}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:18px;padding:16px 24px 24px">
${firsts.map((r) => `<div><img src="${pathToFileURL(r.f).href}" style="width:${w}px;height:${h}px;display:block;border-radius:10px"><div style="padding-top:8px">${esc(r.id)}</div><div style="opacity:.6;font-weight:500">${r.length}s</div></div>`).join('')}
</div></body></html>`;
  const browser = await chromium.launch();
  try {
    const { png } = await still(browser, out, 'contact-sheet', html, { width: cols * w + (cols - 1) * 18 + 48, height: rows * (h + 62) + (rows - 1) * 18 + 100 });
    execFileSync('mv', [png, join(out, 'contact-sheet.png')]);
  } finally { await browser.close(); }
  return join(out, 'contact-sheet.png');
}

/** The command line every repo's scripts/clips.mjs shares: capture the takes, cut the clips, QA, contact sheet. */
export async function main({ chromium, root, takes, title, before, after }) {
  const argv = process.argv.slice(2);
  const opt = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const skipCapture = argv.includes('--skip-capture');
  const only = opt('only')?.split(',');
  const onlyTakes = opt('takes')?.split(',');
  const out = resolve(root, 'dist-clips');
  const cfg = loadConfig(join(root, 'store/clips/clips.json'), root);
  mkdirSync(join(out, 'raw'), { recursive: true });
  const clips = cfg.clips.filter((c) => !only || only.includes(c.id));
  const ctx = before ? await before() : {};
  try {
    if (!skipCapture) {
      const need = new Set(clips.flatMap((c) => c.segments.map((s) => s.take)));
      for (const t of takes) {
        if (!need.has(t.name) || (onlyTakes && !onlyTakes.includes(t.name))) continue;
        console.log(`take ${t.name}`);
        await capture(chromium, { size: cfg.size, out, ...t, ...(typeof t.with === 'function' ? t.with(ctx) : {}) });
      }
    }
  } finally { if (after) await after(ctx); }
  const results = [];
  for (const c of clips) {
    console.log(`clip ${c.id}`);
    const r = await render(chromium, cfg, c, { out });
    r.qa = await qa(chromium, cfg, r, { out });
    console.log(`  ${r.file} (${r.length}s)`);
    results.push(r);
  }
  if (!only) {
    const sheet = await contactSheet(chromium, cfg, results, { out, title });
    console.log(`contact sheet: ${sheet}`);
    rmSync(join(out, 'tmp'), { recursive: true, force: true });
  }
  writeFileSync(join(out, only ? 'last-run.partial.json' : 'clips.json'), JSON.stringify(results, null, 2));
  return results;
}
