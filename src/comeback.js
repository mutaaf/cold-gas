// Reasons to come back (src/challenge.js, src/daily.js): the title's card (a challenge someone sent you,
// else today's objective and your streak), the challenger's run as the ghost, the results' one-line
// verdicts ("You beat ABC by 2.1", "Daily ✓ complete · streak 4") and the link a Share carries.
// Owns two mounts and nothing else: [data-title-extra] (under the title's primary actions) and
// [data-daily-result] (on the results sheet, under the score). src/main.js wires it with a few calls.
import './comeback.css';
import { decodeChallenge, encodeChallenge, vsFromHash, challengeUrl, compare, raceLine, createReplay, replayAsync, coarsen,
  COARSE_STEPS, VS_TARGET_CHARS, VS_MAX_CHARS } from './challenge.js';
import { stuntName, dareText, landedCard } from './stunt-name.js';
import { getMedals } from './medals.js';
import { obs } from './obs/index.js';
import { objectiveFor, evaluate, loadStreak, saveStreak, streakNow, complete, courseName, dayNumber, DAY_MS, missLine, titleHint } from './daily.js';
import { packFrames } from './ghost.js';
import { freeWorld } from './sim/world.js';
import { onUnits } from './units.js';
import { NO_ROOM_EVENT, ROOM_EVENT } from './ads.js';

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
 * @param {() => void} [o.play]             0251: a Jump at once (Take the challenge: no card in front of it)
 * @param {() => Promise<unknown>} o.ready  physics (and the stage) up
 * @param {(blobOrText: object) => void} o.share   share-card's shareRun, bound to this run's card
 * @param {(msg: string, ms?: number) => void} o.toast
 * @param {(course: string, tier?: string, flown?: boolean) => object} [o.how]   the device's words (src/pointer.js ctx) for a
 *                                          course; `flown`: as the run on the sheet was flown (its card's device and scheme)
 * @param {(text: string) => void} [o.tip]  the next countdown's tip (0139: today's hint on a Play today's)
 * @param {() => number} [o.now]
 * @param {(name: string, props: object) => void} [o.metric]   0245: the funnel's challenge_open / challenge_play
 * @param {() => string} [o.course]          the course on the stage (a link that can't be read names none)
 */
export function createComeback(o) {
  const now = o.now || (() => Date.now());
  // The challenge: { dec, state: 'checking' | 'ready' | 'bad', rp, ghost, total }. `armed` once taken:
  // the challenger rides as the ghost in every run on its course until "Not now".
  let ch = null, armed = false;
  let last = null;   // { run, card, link: Promise<string> } for the run on the results sheet
  let shownDay = dayNumber(now());
  let shownHint = '';   // the hint the daily card was last drawn with (0139)
  // 0139: today's hint for this device, flown at the tier Play today's would set ('' when there is none, or done).
  const todayHint = (whole = false) => {
    const obj = objectiveFor(now());
    if (streakNow(loadStreak(), now()).doneToday) return '';
    return titleHint(obj, o.how?.(obj.course, obj.tier && o.getTier() === 'assist' ? obj.tier : o.getTier()), whole);
  };

  // --- the title card ----------------------------------------------------------------------------
  function render() {
    const m = o.mount;
    if (!m) return;
    shownDay = dayNumber(now());
    if (ch && ch.state !== 'bad') {
      const d = ch.dec, who = d.initials || 'Someone';
      // 0251: the very stunt and tier to beat: "ABC · 82.4 · The Show · 360 · Pro" (the trick once the run is re-flown here).
      const stunt = ch.name || courseName(d.course);
      m.innerHTML = `<div class="xc xc-vs" role="group" aria-label="Challenge">
        <p class="xc-k"><span>Challenge</span></p>
        <p class="xc-goal" data-vs-goal><b class="xc-who">${who}</b> · <b class="xc-num">${d.score.toFixed(1)}</b> · ${stunt} · ${TIER[d.tier] || 'Assist'}<span class="xc-sub"> — ${ch.mine == null ? 'beat it' : `${compare(ch.mine, ch.total, d.initials).text.replace(/^You/, 'you')} (your best)`}</span></p>
        <div class="xc-row"><button type="button" class="btn xc-go xc-take" data-vs-take>${ch.mine == null ? 'Take the challenge' : 'Race again'}</button><button type="button" class="btn link xc-x" data-vs-dismiss>${ch.mine == null ? 'Not now' : 'Done'}</button></div>
      </div>`;
      m.querySelector('[data-vs-take]').setAttribute('aria-description', `${d.initials || 'Their'} run rides beside you as the ghost`);
      m.querySelector('[data-vs-take]').addEventListener('click', take);
      m.querySelector('[data-vs-dismiss]').addEventListener('click', dismiss);
    } else {
      const obj = objectiveFor(now()), st = streakNow(loadStreak(), now());
      // 0139: today's hint takes the streak words' place in their row (no new row: the title has no height to spare on a
      // phone); the words stay for a screen reader. It steps aside with the row when the card is tight.
      const hint = shownHint = todayHint();
      const streakWords = st.streak ? `${st.streak}-day streak` : 'Start a streak today';
      const pips = Array.from({ length: 7 }, (_, i) => `<i${i < Math.min(7, st.streak) ? ' class="on"' : ''}></i>`).join('');
      m.innerHTML = `<div class="xc xc-daily${st.doneToday ? ' done' : ''}" role="group" aria-label="Today’s daily jump">
        <div class="xc-text">
          <p class="xc-k"><span>Daily · ${utcLabel(now())}</span><span class="xc-dot" aria-hidden="true">·</span><span>${courseName(obj.course)}</span>${st.doneToday ? '<span class="xc-tick">✓ Done</span>' : ''}</p>
          <p class="xc-goal"><span class="xc-ck">${st.doneToday ? 'Daily ✓' : 'Daily'} · ${courseName(obj.course)}</span>${obj.goal()}</p>
          <p class="xc-streak xc-sub"><span class="xc-pips" aria-hidden="true">${pips}</span>${hint ? `<span class="vh">${streakWords}</span><span class="xc-hint" data-daily-hint>${hint}</span>` : `<span>${streakWords}</span>`}</p>
        </div>
        <button type="button" class="btn xc-go" data-daily-play>${st.doneToday ? 'Play again' : 'Play today’s'}</button>
      </div>`;
      m.querySelector('[data-daily-play]').addEventListener('click', () => {
        obs.play('daily-start');   // 0136: the funnel's first step, tapped → finished (done | miss)
        o.selectCourse(obj.course);
        if (obj.tier && o.getTier() === 'assist') o.setTier(obj.tier);
        const tip = todayHint(true);
        if (tip) o.tip?.(tip);   // and once more as the run counts down (the card may have stepped aside on a short screen)
        o.jump();
      });
    }
    fit();
  }

  // The title is anchored to the bottom and must never rise under the top bar (scripts/title-audit.mjs).
  // The card takes the room there is: whole; then compact (one line and its button) with the tagline
  // and the eyebrow stepping aside; then not at all. Measured from layout (offsetTop), not the rise-in
  // transforms, so the answer is the same during the title's entrance as after it.
  // 0142: the title's ad banner is the first thing to step aside. Before a banner is placed (and when it first draws), ads.js
  // asks for room (ROOM_EVENT): there is room only when the whole card fits as it is and the title can rise by the banner's
  // height under the top bar. And when a shown banner later leaves the card no room (a rotation, a resize), the title sends
  // it off (NO_ROOM_EVENT) before the Daily packs to one line and loses its goal and its streak.
  function fit() {
    const m = o.mount, title = m?.closest('.title');
    if (!title) return;
    for (let level = 0; level <= 3; level++) {
      if (level) title.dataset.extraFit = String(level); else delete title.dataset.extraFit;
      if (level === 3 || !overflows(title)) return;
      if (!level && shownAd(title)) {
        title.dispatchEvent(new CustomEvent(NO_ROOM_EVENT));
        if (!overflows(title)) return;
      }
    }
  }
  const shownAd = (title) => [...title.querySelectorAll('.ad-banner[data-filled]')].some((e) => e.offsetHeight > 1);
  // The title's highest child (layout, not the rise-in transforms; an undrawn ad frame is out of the flow) and the top bar's foot.
  function measure(title) {
    const tb = title.getBoundingClientRect();
    let top = Infinity;
    for (const k of title.children) if (k.offsetHeight > 1 && !(k.classList.contains('ad-banner') && !('filled' in k.dataset))) top = Math.min(top, tb.top + k.offsetTop);
    let bar = 0;
    for (const e of document.querySelectorAll('.top .brand, .top-actions')) { const r = e.getBoundingClientRect(); if (r.height > 1) bar = Math.max(bar, r.bottom); }
    return { tb, top, bar };
  }
  function overflows(title) {
    if (title.hidden || !title.getClientRects().length) return false;
    const { tb, top, bar } = measure(title);
    return top < bar + 4 || tb.bottom > innerHeight + 1 || o.mount.getBoundingClientRect().right > innerWidth + 1;
  }
  function roomFor(title, h) {
    if (title.dataset.extraFit || overflows(title)) return false;
    const { top, bar } = measure(title);
    return top - h >= bar + 4;
  }
  if (o.mount) {
    const title = o.mount.closest('.title');
    title?.addEventListener(ROOM_EVENT, (e) => { if (!roomFor(title, Number(e.detail?.h) || 0)) e.preventDefault(); });
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
    let opened = false;
    const bad = (dec = null) => {
      if (!opened) { opened = true; o.metric?.('challenge_open', { course: dec?.course || o.course?.() || 'show', stale: 1 }); }
      ch = null; armed = false; render(); o.toast(OLD, 4200); fallback();
    };
    decodeChallenge(payload).then(async (dec) => {
      if (!dec || dec.stale) return bad(dec);
      ch = { dec, state: 'checking', rp: null, ghost: null };
      obs.play('challenge-open');
      opened = true; o.metric?.('challenge_open', { course: dec.course, stale: 0 });
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
    }).catch(() => bad());
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
    ch.card = card;
    ch.name = stuntName(card, { short: true });
    ch.state = 'ready';
    ch.rp = null;
    return true;
  }
  let taking = false;
  async function take() {
    if (!ch || taking) return;
    if (ch.state === 'checking') {
      // Tapped before the engine is up (a slow phone's first seconds): wait for it, then finish the replay here.
      if (!ch.rp) {
        taking = true;
        try { await o.ready(); } finally { taking = false; }
        if (!ch || ch.state !== 'checking') return take();
        ch.rp ??= createReplay(ch.dec.log, ch.dec.course);
      }
      if (!settle()) { render(); o.toast(OLD, 4200); o.metric?.('challenge_play', { course: ch?.dec.course || o.course?.() || 'show', stale: 1 }); o.jump(); return; }
    }
    armed = true;
    o.metric?.('challenge_play', { course: ch.dec.course, stale: 0 });
    o.selectCourse(ch.dec.course);
    // 0251: the same stunt: the sender's tier for the race (every tier is open), the player's own back on Not now / Done.
    if (o.getTier() !== ch.dec.tier) { ch.prevTier ??= o.getTier(); o.setTier(ch.dec.tier, { auto: true, persist: false }); }
    (o.play || o.jump)();
  }
  function dismiss() {
    if (ch?.prevTier && o.getTier() === ch.dec.tier) o.setTier(ch.prevTier, { auto: true });
    ch = null; armed = false;
    render();
    o.mount?.querySelector('[data-daily-play]')?.focus();
  }

  // 0139: the device, the touch scheme or the tier changed. Redraw the daily card only if its hint did: a redraw replaces
  // the card's buttons, and a device switch is noted on the very pointerdown or keydown that is pressing one.
  function refresh() {
    if (!o.mount || (ch && ch.state !== 'bad')) return;
    if (todayHint() !== shownHint) render();
  }

  // The challenger's frames for the ghost in a run on its course, once taken.
  const ghost = (course) => (armed && ch?.state === 'ready' && ch.dec.course === course ? ch.ghost : null);

  // --- the results ------------------------------------------------------------------------------------
  function results(run, card, { autopilot = false, drill = false } = {}) {
    const m = o.resultMount;
    last = null;
    if (m) m.replaceChildren();
    if (autopilot || drill || !run || !card) return null;
    last = { run, card, link: prepare(run, card) };
    last.link.catch(() => {});
    const lines = [];
    let vs = null;
    if (ghost(run.course)) {
      obs.play('challenge-run');
      // 0251: like for like (the same event and tier) or no verdict; the recipient's own best on that event and tier beside it.
      vs = raceLine({ course: run.course, tier: card.tier, total: card.total }, { course: ch.dec.course, tier: ch.dec.tier, total: ch.total, initials: ch.dec.initials });
      if (vs.comparable) ch.mine = Math.max(ch.mine ?? -Infinity, card.total);   // the title's card shows where you stand
      const prior = getMedals(run.course, card.tier).best, best = Math.max(prior ?? -Infinity, card.total);
      const state = !vs.comparable ? 'other' : vs.won ? 'won' : vs.tie ? 'tie' : 'behind';
      lines.push(`<div class="xr xr-vs" data-state="${state}"><p class="xr-line"><span data-vs-line>${vs.text}</span><span class="xr-best" data-vs-best>Your best ${best.toFixed(1)}</span></p><button type="button" class="btn ${vs.won ? 'primary' : 'ghost'} xr-send" data-vs-send>Send it back</button></div>`);
    }
    const obj = objectiveFor(now());
    const r = evaluate(obj, card, run.course);
    if (r) {
      // 0136: a finished Daily on its course is met (daily-done) or missed (daily-miss). daily-run meant a miss
      // before daily-miss existed; it is still counted on a miss for one release so the digest's history reads on.
      if (r.ok) obs.play('daily-done');
      else { obs.play('daily-miss'); obs.play('daily-run'); }
      let text;
      if (r.ok) {
        const s = complete(loadStreak(), now());
        saveStreak(s);
        text = `Daily ✓ complete · streak ${s.streak}`;
      } else text = missLine(obj, r, o.how?.(run.course, card.tier, true));   // 0139: what to change, in the words of how it was flown
      lines.push(`<p class="xr xr-daily${r.ok ? ' ok' : ''}" data-daily-line>${text}</p>`);
    }
    render();   // the title's card under the sheet: where the challenge stands, the daily done, the streak
    if (!m || !lines.length) return vs;
    m.innerHTML = lines.join('');
    m.querySelector('[data-vs-send]')?.addEventListener('click', () => {
      // 0251: the recipient's run as the new challenge, with the dare: "Beat 84.5 on The Show · 360".
      const text = landedCard(card) ? `Beat ${card.total.toFixed(1)} on ${stuntName(card, { short: true })}` : dareText(card);
      o.share({ card, url: last?.card === card ? last.link : Promise.resolve(o.base), text });
    });
    return vs;
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
    boot, ghost, results, linkFor, render, refresh,
    get active() { return armed; },
    // e2e
    get state() { return ch ? { state: ch.state, armed, initials: ch.dec.initials, score: ch.dec.score, course: ch.dec.course, tier: ch.dec.tier, name: ch.name || '' } : null; },
    decode: (url) => decodeChallenge(vsFromHash(String(url).replace(/^[^#]*/, ''))),
  };
}
