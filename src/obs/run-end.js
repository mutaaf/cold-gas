// The end of a Jump run in the players' funnel (0130, 0138). Pure: no DOM; src/main.js hands it the run on stage,
// its decided card and how it was flown, and `coachOf(run, card)` (the coach's findings, re-flown from the log).
//
// A run counts `run` as it starts (in main.js) and exactly one of run-landed, run-wrecked (its decided card) or
// run-quit (left before its card). A decided card also counts how it was flown: ctl-* and fly-*. A wreck counts
// what wrecked it (wreck-*: the coach's first finding) once: from the results' own coach a beat after the sheet
// (no extra re-fly on the frame the sheet slides in), or re-flown here if the run is left before that coach ran:
// at once when the page goes (its last beacon), else deferred off the Retry/Home tap (`defer`).
import { wreckCause, ctlOf, flyOf } from './signature.js';

export function createRunEnd(play, coachOf, defer = (fn) => setTimeout(fn, 0)) {
  let open = null, owed = null;
  const pay = (items) => {
    if (!owed) return;
    const o = owed;
    owed = null;
    if (items === undefined) { try { items = coachOf(o.run, o.card); } catch { items = null; } }
    play(wreckCause(items));
  };
  return {
    start(run) { open = run; },
    // current: the run on stage; card: its decided card (or null); left: it is being left (Retry, Home, the page
    // going: `now`); how: { device, scheme, tier } as the run was flown (taken when its card was decided).
    settle(current, card, left, how = {}, now = false) {
      if (open && open === current) {
        if (card) {
          const wrecked = !!card.facts?.crashed;
          play(wrecked ? 'run-wrecked' : 'run-landed');
          play(ctlOf(how.device, how.scheme));
          play(flyOf(card.tier || how.tier));
          if (wrecked) owed = { run: current, card };
        } else if (left) play('run-quit');
      }
      open = null;
      if (left && owed) { if (now) pay(); else defer(() => pay()); }
    },
    // The results' coach ran for `run`: its findings name the cause (no second re-fly).
    coached(run, items) { if (owed && owed.run === run) pay(items); },
    // The open run is dropped uncounted: a trap or an escalation is the game's fault, never the player's quit (0130).
    drop() { open = null; },
    get owed() { return !!owed; },
  };
}
