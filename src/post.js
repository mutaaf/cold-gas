// Post to the board from the results (audit 2026-10-30): beside Retry, reachable without scrolling on a
// phone. "Post · ABC" once initials are remembered on this device, the three letters right there the first
// time; the rank inline once it's on ("Posted · #3 today"). And the one question before an unposted board
// jump is thrown away: Home on the results (the top bar, the sheet, the theatre's bar, H) asks once,
// inline, "Leave without posting?" Leave / Post. No browser dialogs.
//
// Before posting (0141): one `dry: true` request per decided run asks the board what rank this run would get, and the
// button names it ("Post · ABC · would be #1 today"). It never blocks the sheet; no answer leaves "Post · ABC".
// A dry call isn't a post: the funnel's `post` counts only the real one.
//
// `ctx()` → { run, card, eligible } for the sheet on screen (src/main.js). The post sends the run's input
// log and its telemetry (the same `t` the judges get); the Worker scores it (src/worker/index.js).
import { postScore, postMessage, dryRank, rankLabel } from './panel.js';
import { obs } from './obs/index.js';

const KEY = 'coldgas_initials';
const clean = (v) => String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
function stored() { try { return clean(localStorage.getItem(KEY)); } catch { return ''; } }
function store(v) { try { localStorage.setItem(KEY, v); } catch { /* storage blocked: asked again next time */ } }

export function createPost({ ctx, onLeaveOpen = () => {}, onLeavePost = () => {} }) {
  const form = document.querySelector('[data-r-post]');
  const input = form.querySelector('#initials');
  const field = form.querySelector('[data-r-post-field]');
  const btn = form.querySelector('[data-r-post-btn]');
  const iniEl = form.querySelector('[data-r-post-ini]');
  const rankEl = form.querySelector('[data-r-post-rank]');
  const dayEl = Object.assign(document.createElement('span'), { className: 'r-post-day', textContent: ' today' });
  const edit = form.querySelector('[data-r-post-edit]');
  const msg = form.querySelector('[data-r-submit-msg]');
  const leave = document.querySelector('[data-leave]');
  const leaveGo = leave.querySelector('[data-leave-go]'), leavePost = leave.querySelector('[data-leave-post]');
  let postingRun = null, postedRun = null, askedRun = null, editing = false, leaveThen = null;
  let dryRun = null, dryAbort = null, dryFor = null, dryLabel = '';
  input.value = stored();

  const unposted = () => { const c = ctx(); return !!(c.eligible && c.run && postedRun !== c.run); };
  // Draw the control for the sheet on screen.
  function sync() {
    const c = ctx(), ini = stored();
    form.hidden = !c.eligible;
    form.dataset.state = !c.eligible ? '' : postedRun === c.run ? 'posted' : postingRun === c.run ? 'posting' : ini && !editing ? 'known' : 'new';
    const known = form.dataset.state === 'known' || form.dataset.state === 'posting';
    field.hidden = known || form.dataset.state === 'posted';
    btn.hidden = form.dataset.state === 'posted';
    btn.disabled = form.dataset.state === 'posting';
    iniEl.textContent = known ? ` · ${ini}` : '';
    const rank = dryFor === c.run ? dryLabel : '';
    // "today" is dropped on a 320–360 px column (CSS), where the whole label would overflow the button.
    rankEl.replaceChildren(...(rank ? [` · ${rank.replace(/ today$/, '')}`, dayEl] : []));
    btn.setAttribute('aria-label', `${known ? `Post to today’s board as ${ini.split('').join(' ')}` : 'Post to today’s board'}${rank ? `: ${rank}` : ''}`);
    edit.hidden = form.dataset.state !== 'known';
    leavePost.textContent = ini ? `Post · ${ini}` : 'Post';
  }
  // A new sheet: fresh message, the field closed, the question not yet asked.
  function reset() { msg.textContent = ''; editing = false; hideLeave(); sync(); askRank(); }

  // The rank it would get: asked once per run (a sheet redrawn, a replay and back, never asks again).
  async function askRank() {
    const c = ctx(), run = c.run;
    if (!c.eligible || !run || dryRun === run || postedRun === run) return;
    dryAbort?.abort();
    dryRun = run;
    const ctl = dryAbort = new AbortController();
    const rank = await dryRank({ log: run.inputLog, t: run.t, course: run.course }, { signal: ctl.signal });
    if (dryAbort === ctl) dryAbort = null;
    if (ctl.signal.aborted || ctx().run !== run) return;   // a new run's sheet: this answer belongs to the last one
    dryFor = run; dryLabel = rankLabel(rank);
    sync();
  }

  async function post() {
    const c = ctx();
    const run = c.run;
    if (!c.eligible || !run) return;
    if (postedRun === run) { msg.textContent = 'Already posted.'; return; }
    if (postingRun === run) return;   // one request in flight: a double click (or Enter twice) posts once
    const initials = field.hidden ? stored() : clean(input.value);
    if (initials.length !== 3) { msg.textContent = 'Three letters.'; editing = true; sync(); input.focus({ preventScroll: true }); return; }
    store(initials); input.value = initials; editing = false;
    postingRun = run;
    msg.textContent = 'Posting…';
    sync();
    let res;
    try { res = await postScore({ log: run.inputLog, t: run.t, initials, course: run.course }); } finally { postingRun = null; }
    obs.play(res.ok ? 'post' : 'post-fail');
    if (res.ok) postedRun = run;
    if (ctx().run !== run) return;   // a new run's sheet: this answer belongs to the last one
    msg.textContent = postMessage(res);
    sync();
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); post(); });
  input.addEventListener('input', () => { const v = clean(input.value); if (v !== input.value) input.value = v; });
  edit.addEventListener('click', () => { editing = true; sync(); input.focus(); input.select(); });

  // --- Leave without posting? ---
  function hideLeave() { leave.hidden = true; leaveThen = null; }
  // Home asked for: true when the question is up instead (the caller waits for Leave), false to go now.
  function confirmLeave(go) {
    const c = ctx();
    if (!unposted() || askedRun === c.run) return false;
    askedRun = c.run;
    leaveThen = go;
    leave.hidden = false;
    onLeaveOpen();
    sync();
    leavePost.focus({ preventScroll: true });
    return true;
  }
  leaveGo.addEventListener('click', () => { const go = leaveThen; hideLeave(); go?.(); });
  leavePost.addEventListener('click', () => {
    hideLeave();
    onLeavePost();
    if (stored()) post();
    else { editing = true; sync(); input.focus({ preventScroll: true }); }
  });
  return { sync, reset, post, confirmLeave, hideLeave, leaveOpen: () => !leave.hidden, unposted };
}
