// The landing's beat (0199): between a landed run's card and the results sheet, about 2.4 s over the live
// scene. The verdict, the score counting up, then the three judges' numbers going up one by one. The numbers
// are the card closeCard decided (src/sim/judge.js); nothing here computes a score.
//
// The clock is the live step's (src/main.js liveStep → step(dt)), so a pause holds it and fastForward steps
// through it like the rest of the run. The DOM is written on change only: the score's text when its tenth
// changes, a class when a judge lands.
import { isCrash } from './rookie.js';

export const BEAT = {
  len: 2.4,        // s from the card to the sheet
  countAt: 0.15,   // the score starts counting
  countLen: 1.05,  // and lands on the card's total
  judgeAt: [1.3, 1.55, 1.8],   // each judge's card goes up
  guard: 0.45,     // taps before this don't skip (a thumb still on the pad as the car comes down)
  quietLen: 1.2,   // reduced motion: the final numbers at once, held this long
};

// A beat for a landed run of the player's own: not the reference, not a drill, not a wreck or a crash, not a
// run that never left the ground.
export function beatEligible({ card, autopilot, drill, runKind }) {
  return !!card && !autopilot && !drill && runKind === 'jump' && !!card.facts?.jumped && !isCrash(card) && card.total > 0;
}

const ease = (k) => 1 - (1 - k) ** 3;
// The beat at time t (pure): the score shown, in tenths (the card's own at the end), how many judges are up,
// whether the score has landed, and whether the beat is over. `out`: an object to write into (the overlay reuses
// one, so a frame of the beat allocates nothing).
export function beatAt(t, total, reduced = false, out = {}) {
  const tenths = Math.round(total * 10);
  if (reduced) { out.tenths = tenths; out.judges = 3; out.landed = true; out.done = t >= BEAT.quietLen; return out; }
  const k = Math.min(1, Math.max(0, (t - BEAT.countAt) / BEAT.countLen));
  let judges = 0;
  for (let i = 0; i < BEAT.judgeAt.length; i++) if (t >= BEAT.judgeAt[i]) judges++;
  out.tenths = k >= 1 ? tenths : Math.floor(tenths * ease(k)); out.judges = judges; out.landed = k >= 1; out.done = t >= BEAT.len;
  return out;
}
const SETTLE_BUZZ = [18, 70, 12];

// The overlay. `cues`: { chime(i), settle(), buzz(kind, ms) } (src/audio.js, src/touch-settings.js).
export function createBeat(root, cues) {
  const verdictEl = root.querySelector('[data-beat-verdict]');
  const totalEl = root.querySelector('[data-beat-total]');
  const eyebrow = root.querySelector('[data-beat-eyebrow]');
  const judgeEls = [...root.querySelectorAll('[data-beat-judge]')];
  const say = root.querySelector('[data-beat-say]');   // read out once, whole (the counting digits are aria-hidden)
  const st = { on: false, t: 0, total: 0, reduced: false, tenths: -1, judges: 0, landed: false, done: false };
  const now = { tenths: 0, judges: 0, landed: false, done: false };
  let sayT = 0;

  function show(card, { reduced = false, course = '' } = {}) {
    st.on = true; st.t = 0; st.total = card.total; st.reduced = reduced; st.tenths = -1; st.judges = 0; st.landed = false; st.done = false;
    verdictEl.textContent = card.verdict;
    eyebrow.textContent = course;
    // Set a moment after the region is shown: a live region that appears with its text already in is often not read.
    if (say) {
      say.textContent = '';
      clearTimeout(sayT);
      const line = `${card.verdict}. ${card.total.toFixed(1)} out of 100.`;
      sayT = setTimeout(() => { if (st.on) say.textContent = line; }, 120);
    }
    card.judges.forEach((j, i) => {
      const el = judgeEls[i];
      if (!el) return;
      el.querySelector('.bj-who').textContent = j.name.replace(/^The /, '');
      el.querySelector('.bj-score').textContent = j.score.toFixed(1);
      el.classList.remove('in');
    });
    root.classList.remove('landed');
    root.toggleAttribute('data-quiet', reduced);
    root.hidden = false;
    paint();
  }
  // One step of the live clock. Returns true once the beat has run its length.
  function step(dt) {
    if (!st.on || st.done) return true;   // held on its last frame until the car is at rest: nothing more to paint
    st.t += dt;
    return (st.done = paint());
  }
  function paint() {
    beatAt(st.t, st.total, st.reduced, now);
    if (now.tenths !== st.tenths) { st.tenths = now.tenths; totalEl.textContent = (now.tenths / 10).toFixed(1); }
    if (now.landed && !st.landed) {
      st.landed = true;
      root.classList.add('landed');
      cues.settle?.();
      cues.buzz?.(null, SETTLE_BUZZ);
    }
    while (st.judges < now.judges) {
      const i = st.judges++;
      judgeEls[i]?.classList.add('in');
      if (!st.reduced) { cues.chime?.(i); cues.buzz?.('tap'); }
    }
    return now.done;
  }
  function hide() {
    st.on = false;
    clearTimeout(sayT);
    root.hidden = true;
  }
  return { show, step, hide, get active() { return st.on; }, get t() { return st.t; }, canSkip: () => st.on && st.t >= BEAT.guard };
}
