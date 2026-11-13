// The Phase 2 funnel's one vocabulary (0245, docs/proposals/phase-2-growth.md §6): every usage event the web sends to
// Box Office (src/insights.js), and the one the iPhone app will send (0246) under the same names. Pure: no DOM, no
// storage, no network. Names are Box Office's snake_case verbs. Props are numbers and enums only (AGENTS.md §3.3):
// never initials, free text or an id.
//
// A prop is either 'num' (a finite number, rounded to 3 decimals) or an array of the values it may take. Every prop is
// required. `validate` drops what doesn't fit (with a warning in a dev build), never throws: analytics never breaks
// the game.

const COURSE = ['show', 'wall', 'lineup'];
const TIER = ['assist', 'pro', 'advanced'];
const BIT = [0, 1];

// n: this device's lifetime Jump count for the run, capped at 3 (3 means "3 or more"): the first-jump and the
// second-jump steps of the funnel, without a long tail of ids.
export const N_CAP = 3;

export const EVENTS = Object.freeze({
  // A page load. returning: this device has opened the game before (a local last-seen UTC day, no id);
  // days_since_last: whole UTC days since then (0 the same day, and on a first visit).
  session_start: { returning: BIT, days_since_last: 'num' },
  // The first touch, key or pad press of the page that reaches the car (a live run) or the title's primary action.
  first_input: { ms_since_load: 'num' },
  // A Jump of the player's own (not the reference, not a drill) starts, and its card is decided.
  jump_start: { n: [1, 2, 3], course: COURSE, tier: TIER },
  jump_end: { n: [1, 2, 3], course: COURSE, tier: TIER, landed: BIT, score: 'num' },
  // The first landed Jump on this device: the Jump number it took.
  first_landing: { n: 'num' },
  // Share pressed, and how it left the device (the share sheet with the picture, with the link only, or the clipboard).
  share_tap: { course: COURSE },
  share_done: { course: COURSE, via: ['file', 'link', 'copy'] },
  // A challenge link opened (stale: from another SIM_VERSION or unreadable), and taken.
  challenge_open: { course: COURSE, stale: BIT },
  challenge_play: { course: COURSE, stale: BIT },
  // A license passed (wired by 0255).
  license_pass: { license: ['rookie', 'bronze', 'silver', 'gold', 'ace', 'legend'] },
});

const warn = (msg) => {
  try { if (import.meta.env?.DEV) console.warn(`[metrics] ${msg}`); } catch { /* no console */ }
};

// The props as they will be sent, or null when the event isn't in the vocabulary or a prop doesn't fit.
export function validate(name, props = {}) {
  const spec = Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
  if (!spec) { warn(`unknown event ${name}`); return null; }
  const out = {};
  for (const key of Object.keys(spec)) {
    const rule = spec[key], v = props?.[key];
    if (rule === 'num') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { warn(`${name}.${key} is not a number`); return null; }
      out[key] = Math.round(v * 1000) / 1000;
    } else {
      if (!rule.includes(v)) { warn(`${name}.${key} = ${JSON.stringify(v)} is not one of ${rule.join('|')}`); return null; }
      out[key] = v;
    }
  }
  for (const key of Object.keys(props || {})) if (!Object.hasOwn(spec, key)) { warn(`${name}.${key} is not in the vocabulary`); return null; }
  return out;
}

// The vocabulary as plain data (for the iPhone's vectors, 0246): { name: { prop: 'num' | [values] } }.
export const vocabulary = () => JSON.parse(JSON.stringify(EVENTS));
