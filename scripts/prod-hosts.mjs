// Which hosts does a production page reach, from which frame, in which mode? (0262)
//
//   node scripts/prod-hosts.mjs [url] [--phone] [--desktop] [--title=60] [--json=log.jsonl] [--let-ads]
//   node scripts/prod-hosts.mjs --log=log.jsonl            re-judge a saved log (no browser)
//
// Loads the URL (default https://mutaafaziz.com/coldgas/) as a first visit at 1440×900 and at 390×844 touch (both by
// default; one flag picks one), stays on the title for --title seconds (≥ 5; past the ad slot's dwell, src/ads.js),
// then taps Jump in the page and flies the course's reference to its sheet. Every request (and WebSocket) is printed:
// t, host, the request's frame, the page's S.mode when it started, and its verdict. Exit 1 on a host outside
// AGENTS.md §3.3's allowance or any third party during countdown/live (scripts/lib/prod-hosts.mjs has the rules),
// exit 2 when the page couldn't be flown or the recording missed the run. Not a CI gate: CI never loads the ad loader
// (it runs off localhost only). The Critic and the Keeper run it against production.
//
// The URL's own host counts as our origin (and its /ads/ as Marquee's), so a preview URL works too.
// Google's ad hosts are recorded, then aborted, so a probe never renders a real ad or counts as invalid traffic on
// the owner's ad account; --let-ads loads them (sparingly: it then also sees what Google's nested frames fetch).
// A probe browser keeps navigator.webdriver, so src/obs counts it as `auto` and PostHog drops its events (LESSONS
// 2026-11-13): it doesn't move the players' funnel. It posts nothing: no initials, no score.
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { verdict, line, modeAt, sawRun, pickInitiators, isGoogleAd, OWN_HOSTS, isLocal } from './lib/prod-hosts.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const url = args.find((a) => !a.startsWith('--')) || 'https://mutaafaziz.com/coldgas/';
const titleS = Number(opt('title', 60));
const jsonOut = opt('json', null);
const logIn = opt('log', null);
const letAds = args.includes('--let-ads');
const picked = ['desktop', 'phone'].filter((n) => args.includes(`--${n}`));
const screens = picked.length ? picked : ['desktop', 'phone'];
const own = [...new Set([...OWN_HOSTS, new URL(url).hostname])];
if (!Number.isFinite(titleS) || titleS < 5) { console.error(`prod-hosts: --title must be a number of seconds ≥ 5 (the slot's dwell is 4 s), not ${opt('title')}`); process.exit(2); }

const report = (name, entries, timeline) => {
  const v = verdict(entries, { own, timeline });
  const why = new Map(v.bad.map((b) => [b.e, b.why]));
  console.log(`\n== ${name}: ${entries.length} requests`);
  for (const e of entries) console.log(line(e, why.get(e)));
  console.log(v.ok ? `== ${name}: OK, only ${own.join(', ')} and Google's ad hosts from Marquee's /ads/` : `== ${name}: FAIL ${v.bad.length}: ${[...new Set(v.bad.map((b) => b.why))].join('; ')}`);
  return v.ok;
};

if (logIn) {
  const rows = readFileSync(logIn, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let ok = true, runs = true;
  for (const name of [...new Set(rows.filter((r) => r.screen).map((r) => r.screen))]) {
    const timeline = rows.find((r) => r.screen === name && r.timeline)?.timeline || [];
    ok = report(name, rows.filter((r) => r.screen === name && r.url), timeline) && ok;
    if (!sawRun(timeline)) { runs = false; console.error(`${name}: the log has no countdown → live → results`); }
  }
  process.exit(!ok ? 1 : runs ? 0 : 2);
}

// A stuck renderer can hang an evaluate forever: the whole probe gets 15 minutes a screen.
setTimeout(() => { console.error('prod-hosts: timed out'); process.exit(2); }, screens.length * 15 * 60_000).unref();

const SCREENS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
};

// This sandbox's Playwright can want a newer browser than the one installed (LESSONS 2026-11-11): fall back to it.
async function launch() {
  try { return await chromium.launch(); } catch (err) {
    if (!existsSync('/opt/pw-browsers/chromium')) throw err;
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what}: no answer in ${ms / 1000} s`); })]);

async function probe(browser, name) {
  const ctx = await browser.newContext(SCREENS[name]);
  // A first visit (the how-to's flag), set before the one goto: a reload behind analytics can hang (LESSONS 2026-11-13).
  // The mode timeline is on the page's clock: body[data-mode] until the game is up, then S.mode's own writes (below).
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    try { localStorage.setItem('coldgas_howto', 'new'); } catch { /* storage blocked: still a first visit */ }
    const tl = window.__probeModes = [];
    window.__probeNote = (m) => { if (m && m !== tl.at(-1)?.[1]) tl.push([Date.now(), m]); };
    const watch = () => {
      const b = document.body; if (!b) return void requestAnimationFrame(watch);
      const note = () => window.__probeNote(b.dataset.mode);
      note(); new MutationObserver(note).observe(b, { attributes: true, attributeFilter: ['data-mode'] });
    };
    watch();
  });
  if (!letAds) await ctx.route((u) => isGoogleAd(u.href), (route) => route.abort('blockedbyclient'));
  const page = await ctx.newPage();
  const t0 = Date.now();
  const entries = [], byReq = new Map(), seen = new Map();
  // Which scripts started each request, per requesting document (the /ads/ loader's breaks live in the page, §3.3).
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', (ev) => {
      const urls = new Set(); const i = ev.initiator || {};
      if (i.url) urls.add(i.url);
      for (let st = i.stack; st; st = st.parent) for (const f of st.callFrames || []) if (f.url) urls.add(f.url);
      const list = seen.get(ev.request.url) || []; list.push({ doc: ev.documentURL, urls: [...urls] }); seen.set(ev.request.url, list);
    });
  } catch { /* no CDP (not Chromium): frames alone decide */ }
  ctx.on('request', (req) => {
    const u = req.url(); if (isLocal(u)) return;
    const frames = [];
    try { for (let f = req.frame(); f; f = f.parentFrame()) frames.push(f.url()); } catch { /* a worker's request */ }
    const e = { screen: name, t: Date.now() - t0, url: u, frames, initiators: [] };
    entries.push(e); byReq.set(req, e);
  });
  const settle = (req) => { const e = byReq.get(req); if (!e) return; const st = req.timing().startTime; if (st > 0) e.t = Math.round(st - t0); };
  ctx.on('requestfinished', settle); ctx.on('requestfailed', settle);
  page.on('websocket', (ws) => entries.push({ screen: name, t: Date.now() - t0, url: ws.url(), frames: [page.url()], initiators: [] }));

  let flown = false, note = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => window.__coldgas?.stage && window.__coldgas.physicsReady?.(), null, { timeout: 120_000 });
    // From here, stamp the mode at the write itself: setMode sets S.mode before the rest of the Jump's work.
    await page.evaluate(() => {
      const S = window.__coldgas.S; let m = S.mode; window.__probeNote(m);
      Object.defineProperty(S, 'mode', { get: () => m, set: (v) => { window.__probeNote(v); m = v; }, configurable: true, enumerable: true });
    });
    console.log(`${name}: ready at ${((Date.now() - t0) / 1000).toFixed(1)} s; on the title for ${titleS} s`);
    await sleep(titleS * 1000);
    // The Jump as a player makes it (the title's button, clicked in the page: LESSONS 2026-11-14), then the reference
    // flies it on the live clock. A slow software-GL run gets 45 s, then the rest of the flight in one go.
    await within(page.evaluate(() => {
      const g = window.__coldgas;
      document.querySelector('[data-start]')?.click();
      if (g.S.mode === 'title') g.startRun('jump');
      g.S.autopilot = g.createAutopilot(g.stage.course);
    }), 30_000, 'Jump');
    await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 45_000 }).catch(async () => {
      note = ' (the run was finished in one step after 45 s live: later live requests are not covered)';
      await within(page.evaluate(() => window.__coldgas.fastForward()), 60_000, 'fastForward');
    });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
    await within(page.evaluate(() => { window.__coldgas.S.autopilot = null; }), 30_000, 'autopilot off');
    await sleep(5000);   // the sheet's own requests (the card, the board)
    flown = true;
  } catch (err) {
    console.error(`${name}: couldn't fly the page: ${err.message.split('\n')[0]}`);
  }
  const pageTl = await within(page.evaluate(() => window.__probeModes || []), 30_000, 'modes').catch(() => []);
  const timeline = pageTl.map(([at, m]) => [at - t0, m]);
  for (const e of entries) {
    if (!e.initiators.length) e.initiators = pickInitiators(seen.get(e.url), e.frames[0]);
    e.mode = modeAt(timeline, e.t);
  }
  entries.sort((a, b) => a.t - b.t);
  await ctx.close();
  return { entries, timeline, flown: flown && sawRun(timeline), note };
}

const browser = await launch();
let ok = true, flownAll = true; const rows = [];
for (const name of screens) {
  const { entries, timeline, flown, note } = await probe(browser, name);
  ok = report(name, entries, timeline) && ok; flownAll &&= flown;
  rows.push({ screen: name, timeline }, ...entries);
  console.log(`   ${name} modes: ${timeline.map(([t, m]) => `${(t / 1000).toFixed(2)} ${m}`).join(' → ')}${note}`);
  if (!flown) console.error(`   ${name}: no whole run recorded (countdown → live → results): exit 2`);
}
await browser.close();
if (!letAds) console.log('Google ad requests were recorded, then aborted (--let-ads loads them).');
if (jsonOut) { writeFileSync(jsonOut, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`log: ${jsonOut}`); }
process.exit(!ok ? 1 : flownAll ? 0 : 2);
