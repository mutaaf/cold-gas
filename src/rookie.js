// Rookie mode (0074): after three crashed runs in a row (two on a device that has never landed, 0184), the results sheet offers one button that puts the
// car on Easy driving (src/driving.js) and Assist flight (auto-land, LAND rolls out and brakes) and goes
// again. Pure, no DOM: src/main.js keeps the streak and draws the button; the unit tests drive this.
//
// A crash is what the timeline calls one (0072's crashStep: the card's `facts.crashed`) or the judge's
// Wrecked verdict. Any other finished run is clean and ends the streak; a run quit before its card
// (Retry mid-run, Home) doesn't count either way, and the reference jump is never the player's.
export const ROOKIE_AFTER = 3;
// 0184: a device that has never landed a Jump (a first-ever session: most first-time phone visitors who wreck twice
// have left before a third) gets the offer one crash sooner. Everyone else keeps three.
export const ROOKIE_AFTER_NEW = 2;
export const isCrash = (card) => !!(card && (card.facts?.crashed || card.verdict === 'Wrecked'));
export const nextStreak = (n, crashed) => (crashed ? (n | 0) + 1 : 0);
export const isRookie = (level, tier) => level === 'easy' && tier === 'assist';
// The offer: from the third crash in a row on (the fourth, the fifth…), or the second when this device has never
// landed (`neverLanded`), unless the car is already there.
export const offerRookie = (n, level, tier, neverLanded = false) =>
  n >= (neverLanded ? ROOKIE_AFTER_NEW : ROOKIE_AFTER) && !isRookie(level, tier);
// The offer's one line says the streak it answers (0184: the second crash says two, not three).
const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export const rookieWhy = (n) =>
  `${COUNT[n | 0] || (n | 0)} ${(n | 0) === 1 ? 'crash' : 'crashes in a row'}. Easy driving and Assist flying land it for you; switch back in Controls.`;

// The streak lives for this tab's session (a reload keeps it, a new visit starts clean).
const KEY = 'coldgas_crash_streak';
const session = () => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
export function loadStreak(store = session()) {
  try { const n = parseInt(store?.getItem(KEY) || '0', 10); return n > 0 && n < 1000 ? n : 0; } catch { return 0; }
}
export function saveStreak(n, store = session()) {
  try { store?.setItem(KEY, String(n | 0)); } catch { /* storage blocked: memory only */ }
}
