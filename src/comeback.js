// Reasons to come back (src/challenge.js, src/daily.js): the title's card (a challenge someone sent you,
// else today's objective and your streak), the challenger's run as the ghost, the results' one-line
// verdicts ("You beat ABC by 2.1", "Daily ✓ complete · streak 4") and the link a Share carries.
// Owns two mounts and nothing else: [data-title-extra] (under the title's primary actions) and
// [data-daily-result] (on the results sheet, under the score). src/main.js wires it with a few calls.
import './comeback.css';
import { decodeChallenge, encodeChallenge, vsFromHash, challengeUrl, compare, createReplay, replayAsync, coarsen,
  COARSE_STEPS, VS_TARGET_CHARS, VS_MAX_CHARS } from './challenge.js';
import { objectiveFor, evaluate, loadStreak, saveStreak, streakNow, complete, courseName, dayNumber, DAY_MS } from './daily.js';
import { packFrames } from './ghost.js';
import { freeWorld } from './sim/world.js';
import { onUnits } from './units.js';

const OLD = 'This challenge is from an older version of the game. Here’s a normal jump.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utcLabel = (ms) => { const d = new Date(dayNumber(ms) * DAY_MS); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const TIER = { assist: 'Assist', pro: 'Pro', advanced: 'Advanced' };

/**
 * @param {object} o
 * @param {HTMLElement|null} o.mount        [data-title-extra]
 * @param {HTMLElement|null} o.resultMount  [data-daily-result]
 * @param {string} o.base                   the game's address (origin + base path)
 * @param {(id: string) => void} o.selectCourse
 * @param {() => string} o.getTier
 * @param {(t: string) => void} o.setTier
 * @param {() => void} o.jump               a Jump, as the title's own button does it
 * @param {() => Promise<unknown>} o.ready  physics (and the stage) up
 * @param {(blobOrText: object) => void} o.share   share-card's shareRun, bound to this run's card
 * @param {(msg: string, ms?: number) => void} o.toast
 * @param {() => number} [o.now]
 */
export function createComeback(o) {
  const now = o.now || (() => Date.now());
  // The challenge: { dec, state: 'checking' | 'ready' | 'bad', rp, ghost, total }. `armed` once taken:
  // the challenger rides as the ghost in every run on its course until "Not now".
  let ch = null, armed = false;
  let last = null;   // { run, card, link: Promise<string> } for the run on the results sheet
  let shownDay = dayNumber(now());

  // --- the title card ----------------------------------------------------------------------------
  function render() {
    const m = o.mount;
    if (!m) return;
    shownDay = dayNumber(now());
    if (ch && ch.state !== 'bad') {
      const d = ch.dec, who = d.initials || 'Someone';
      m.innerHTML = `<div class="xc xc-vs" role="group" aria-label="Challenge">
        <p class="xc-k"><span>Challenge</span>${d.tier !== 'assist' ? `<span class="xc-dot" aria-hidden="true">·</span><span>${TIER[d.tier]}</span>` : ''}</p>
        <p class="xc-goal"><b class="xc-who">${who}</b> scored <b class="xc-num">${d.score.toFixed(1)}</b> on ${courseName(d.course)}<span class="xc-sub"> — ${ch.mine == null ? 'beat it' : `${compare(ch.mine, ch.total, d.initials).text.replace(/^You/, 'you')} (your best)`}</span></p>
        <div class="xc-row"><button type="button" class="btn xc-go xc-take" data-vs-take>${ch.mine == null ? 'Take the challenge' : 'Race again'}</button><button type="button" class="btn link xc-x" data-vs-dismiss>${ch.mine == null ? 'Not now' : 'Done'}</button></div>
      </div>`;
      m.querySelector('[data-vs-take]').setAttribute('aria-description', `${d.initials || 'Their'} run rides beside you as the ghost`);
      m.querySelector('[data-vs-take]').addEventListener('click', take);
      m.querySelector('[data-vs-dismiss]').addEventListener('click', dismiss);
    } else {
      const obj = objectiveFor(now()), st = streakNow(loadStreak(), now());
      const pips = Array.from({ length: 7 }, (_, i) => `<i${i < Math.min(7, st.streak) ? ' class="on"' : ''}></i>`).join('');
      m.innerHTML = `<div class="xc xc-daily${st.doneToday ? ' done' : ''}" role="group" aria-label="Today’s daily jump">
        <div class="xc-text">
          <p class="xc-k"><span>Daily · ${utcLabel(now())}</span><span class="xc-dot" aria-hidden="true">·</span><span>${courseName(obj.course)}</span>${st.doneToday ? '<span class="xc-tick">✓ Done</span>' : ''}</p>
          <p class="xc-goal"><span class="xc-ck">${st.doneToday ? 'Daily ✓' : 'Daily'} · ${courseName(obj.course)}</span>${obj.goal()}</p>
          <p class="xc-streak xc-sub"><span class="xc-pips" aria-hidden="true">${pips}</span><span>${st.streak ? `${st.streak}-day streak` : 'Start a streak today'}</span></p>
        </div>
        <button type="button" class="btn xc-go" data-daily-play>${st.doneToday ? 'Play again' : 'Play today’s'}</button>
      </div>`;
      m.querySelector('[data-daily-play]').addEventListener('click', () => {
        o.selectCourse(obj.course);
        if (obj.tier && o.getTier() === 'assist') o.setTier(obj.tier);
        o.jump();
      });
    }
    fit();
  }

  // The title is anchored to the bottom and must never rise under the top bar (scripts/title-audit.mjs).
  // The card takes the room there is: whole; then compact (one line and its button) with the tagline
  // and the eyebrow stepping aside; then not at all. Measured from layout (offsetTop), not the rise-in
  // transforms, so the answer is the same during the title's entrance as after it.
  function fit() {
    const m = o.mount, title = m?.closest('.title');
    if (!title) return;
    for (let level = 0; level <= 3; level++) {
      if (level) title.dataset.extraFit = String(level); else delete title.dataset.extraFit;
      if (level === 3 || !overflows(title)) return;
    }
  }
  function overflows(title) {
    if (title.hidden || !title.getClientRects().length) return false;
    const tb = title.getBoundingClientRect();
    let top = Infinity;
    for (const k of title.children) if (k.offsetHeight > 1) top = Math.min(top, tb.top + k.offsetTop);
    let bar = 0;
    for (const e of document.querySelectorAll('.top .brand, .top-actions')) { const r = e.getBoundingClientRect(); if (r.height > 1) bar = Math.max(bar, r.bottom); }
    return top < bar + 4 || tb.bottom > innerHeight + 1 || o.mount.getBoundingClientRect().right > innerWidth + 1;
  }
  if (o.mount) {
    const title = o.mount.closest('.title');
    if (typeof ResizeObserver === 'function' && title) {
      let busy = false;
      new ResizeObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { busy = false; fit(); }); }).observe(title);
    }
    addEventListener('resize', fit);
    document.fonts?.ready?.then(fit);
    onUnits(() => render());
    // A new UTC day while the title is up: today's objective changes under it.
    setInterval(() => { if (dayNumber(now()) !== shownDay) render(); }, 30_000);
  }

  // --- a challenge link ------------------------------------------------------------------------------
  // Returns true when the boot hash is a challenge (the page holds on the title for its card; `?play=jump`
  // then doesn't skip the title). A payload that can't be read, or is from another SIM_VERSION, says so
  // gently and falls back to a normal jump (`fallback`).
  function boot(hash, fallback) {
    const payload = vsFromHash(hash);
    if (!payload) return false;
    const bad = () => { ch = null; armed = false; render(); o.toast(OLD, 4200); fallback(); };
    decodeChallenge(payload).then(async (dec) => {
      if (!dec || dec.stale) return bad();
      ch = { dec, state: 'checking', rp: null, ghost: null };
      o.selectCourse(dec.course);
      render();
      await o.ready();
      if (!ch || ch.dec !== dec || ch.state !== 'checking') return;
      ch.rp = createReplay(dec.log, dec.course);
      // Re-fly it a slice at a time (the title keeps its frames); a tap on Take finishes it at once.
      // ≤ 8 ms of engine ticks per slice, then the frame gets the thread back.
      for (;;) {
        if (ch?.dec !== dec || ch.state !== 'checking') break;
        const t0 = performance.now();
        let done = false;
        while (!(done = ch.rp.step(16)) && performance.now() - t0 < 8);
        if (done) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      if (ch?.dec === dec && ch.state === 'checking') { if (settle()) render(); else bad(); }
    }).catch(bad);
    return true;
  }
  // The replay is done: believe the payload only if the run scores what it says it scored here.
  function settle() {
    const { dec, rp } = ch;
    rp.step();
    const card = rp.card();
    freeWorld(rp.run.car.world);
    if (!card || Math.abs(card.total - dec.score) > 0.05 || card.tier !== dec.tier) {
      ch.state = 'bad'; armed = false;
      return false;
    }
    ch.ghost = packFrames(rp.run.frames, card.total, false, dec.course);
    ch.total = card.total;
    ch.state = 'ready';
    ch.rp = null;
    return true;
  }
  function take() {
    if (!ch) return;
    if (ch.state === 'checking') {
      if (!ch.rp) { ch.rp = createReplay(ch.dec.log, ch.dec.course); }
      if (!settle()) { render(); o.toast(OLD, 4200); o.jump(); return; }
    }
    armed = true;
    o.selectCourse(ch.dec.course);
    o.jump();
  }
  function dismiss() {
    ch = null; armed = false;
    render();
    o.mount?.querySelector('[data-daily-play]')?.focus();
  }

  // The challenger's frames for the ghost in a run on its course, once taken.
  const ghost = (course) => (armed && ch?.state === 'ready' && ch.dec.course === course ? ch.ghost : null);

  // --- the results ------------------------------------------------------------------------------------
  function results(run, card, { autopilot = false, drill = false } = {}) {
    const m = o.resultMount;
    last = null;
    if (m) m.replaceChildren();
    if (autopilot || drill || !run || !card) return;
    last = { run, card, link: prepare(run, card) };
    last.link.catch(() => {});
    const lines = [];
    let vs = null;
    if (ghost(run.course)) {
      vs = compare(card.total, ch.total, ch.dec.initials);
      ch.mine = Math.max(ch.mine ?? -Infinity, card.total);   // the title's card shows where you stand
      lines.push(`<div class="xr xr-vs" data-state="${vs.won ? 'won' : vs.tie ? 'tie' : 'behind'}"><p class="xr-line" data-vs-line>${vs.text}</p><button type="button" class="btn ghost xr-send" data-vs-send>Send it back</button></div>`);
    }
    const obj = objectiveFor(now());
    const r = evaluate(obj, card, run.course);
    if (r) {
      let text;
      if (r.ok) {
        const s = complete(loadStreak(), now());
        saveStreak(s);
        text = `Daily ✓ complete · streak ${s.streak}`;
      } else text = `Daily: ${r.miss} — try again`;
      lines.push(`<p class="xr xr-daily${r.ok ? ' ok' : ''}" data-daily-line>${text}</p>`);
    }
    render();   // the title's card under the sheet: where the challenge stands, the daily done, the streak
    if (!m || !lines.length) return;
    m.innerHTML = lines.join('');
    m.querySelector('[data-vs-send]')?.addEventListener('click', () => {
      const ini = ch?.dec.initials || 'you';
      const on = courseName(run.course), mine = card.total.toFixed(1), theirs = ch.total.toFixed(1);
      const text = vs.won ? `I beat ${ini}’s ${theirs} with ${mine} on ${on}. Your move:`
        : vs.tie ? `Dead level with ${ini} at ${mine} on ${on}. Break the tie:`
          : `${ini}, your ${theirs} still stands. I got ${mine} on ${on}. Race my run:`;
      o.share({ card, url: last?.card === card ? last.link : Promise.resolve(o.base), text });
    });
  }

  // The challenge link for a finished run (Share and Send it back carry it). Lossless when it fits the
  // target length; else the coarsest step that still flies the same verdict within a point (re-flown
  // here, and sent with the score it really scores); else the long lossless link (browsers take it);
  // else the plain address.
  async function prepare(run, card) {
    let initials = '';
    try { initials = localStorage.getItem('coldgas_initials') || ''; } catch { /* storage blocked */ }
    const src = { log: run.inputLog, course: run.course, score: card.total, tier: card.tier, initials };
    const url = (p) => challengeUrl(o.base, run.course, p);
    const exact = await encodeChallenge(src);
    if (exact.length <= VS_TARGET_CHARS) return url(exact);
    for (const step of COARSE_STEPS) {
      const log = coarsen(run.inputLog, step);
      if ((await encodeChallenge({ ...src, log })).length > VS_TARGET_CHARS) continue;
      const rp = await replayAsync(log, run.course);
      const c2 = rp.card();
      if (c2 && c2.verdict === card.verdict && Math.abs(c2.total - card.total) <= 1) return url(await encodeChallenge({ ...src, log, score: c2.total, tier: c2.tier }));
    }
    return exact.length <= VS_MAX_CHARS ? url(exact) : o.base;
  }
  // What a Share of `card` links to (a promise: it may still be packing).
  const linkFor = (card) => (last?.card === card ? last.link : Promise.resolve(o.base));

  render();
  return {
    boot, ghost, results, linkFor, render,
    get active() { return armed; },
    // e2e
    get state() { return ch ? { state: ch.state, armed, initials: ch.dec.initials, score: ch.dec.score, course: ch.dec.course } : null; },
  };
}
