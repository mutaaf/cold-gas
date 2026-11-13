// The stunt's name (0260): what was flown, in a few words, from scoreRun's card only (src/sim/judge.js). Pure: no DOM,
// no storage, nothing the card doesn't say. The share card's headline, the dare ("Beat my 82.4 on The Show · 360"), the
// challenge card (0251) and, through the vectors, the iPhone's share (0252) all read it.
//
//   landed:  <event> · <the trick> · <how it finished>   "The Show · 360 · on the mark", "The Wall · hang 2.1 s · stuck it",
//                                                         "The Lineup · 720 · over five"
//   wrecked: <event> · <what went wrong>                  "The Show · into the row", "The Wall · off the wall"
// Our own words only (AGENTS.md §3.7): no racing game's trick names, no brand, no real model.

export const EVENT_NAME = { show: 'The Show', wall: 'The Wall', lineup: 'The Lineup' };

// What went wrong, by the card's verdict (judge.js's own verdicts, in the game's words).
const CAUSE = {
  'Fell off the wall': 'off the wall', Wrecked: 'wrecked', Contact: 'into the row', 'Stalled on the wall': 'stalled on the wall',
  'No climb': 'no climb', 'Came down on the deck': 'down on the deck', 'Rolled over': 'rolled over', Crash: 'crashed',
  'Short of the row': 'short of the row', 'No jump': 'no jump',
};
const FINISH = { 'Perfect 10': 'stuck it', 'Stuck it': 'stuck it' };
const ON_MARK = 2;   // m: the inner ring of every pad (src/sim/courses.js pad.rings[0])

// The event a card is from: the Show's and the Wall's cards say so; the Lineup's is the one with a height over the roofs.
export const courseOf = (card) => card?.course || card?.facts?.course || (Number.isFinite(card?.facts?.apexOverRoof) ? 'lineup' : '');

/** A landed run: jumped, upright, nothing hit (the same reading as the landing's beat, src/beat.js). */
export function landedCard(card) {
  const f = card?.facts || {};
  return !!f.jumped && !f.crashed && !(card.verdict in CAUSE);
}

// The trick: whole turns (the larger of roll and pitch, as judge.js counts them) where there are any; the Wall's hang
// inverted; the Show's carry over the row.
function trick(card) {
  const f = card.facts || {}, course = courseOf(card);
  const turned = Math.max(f.rollDeg || 0, f.pitchDeg || 0);
  const turns = turned >= 300 ? Math.round(turned / 360) : 0;
  const spin = turns ? `${turns * 360}` : '';
  if (course === 'lineup') return [spin, 'over five'].filter(Boolean);
  if (course === 'wall') return [f.invertedS > 0 ? `hang ${Number(f.invertedS).toFixed(1)} s` : spin].filter(Boolean);
  return [spin || 'over the row'];
}

// A wreck's cause: the verdict's, and for a plain "Wrecked" where it happened (before the jump, or coming down).
function cause(card) {
  if (card.verdict !== 'Wrecked' && CAUSE[card.verdict]) return CAUSE[card.verdict];
  const f = card.facts || {};
  if (f.jumped) return 'wrecked on landing';
  return courseOf(card) === 'lineup' ? 'wrecked on the run-up' : 'wrecked on the wall';
}

/**
 * The stunt's name. `short`: the event and the trick only (the dare: "Beat my 82.4 on The Show · 360").
 * @param {{ course?: string, verdict: string, facts?: object }} card   scoreRun's card
 */
export function stuntName(card, { short = false } = {}) {
  if (!card) return '';
  const event = EVENT_NAME[courseOf(card)] || 'The range';
  if (!landedCard(card)) return `${event} · ${cause(card)}`;
  const parts = [event, ...trick(card)];
  if (!short) {
    const f = card.facts || {};
    const finish = Number.isFinite(f.padMiss) && f.padMiss <= ON_MARK ? 'on the mark' : FINISH[card.verdict] || '';
    if (finish) parts.push(finish);
  }
  return parts.join(' · ');
}

/** The words a share carries with its link: a dare for a landing, a question for a wreck. */
export function dareText(card) {
  const score = card.total.toFixed(1);
  return landedCard(card) ? `Beat my ${score} on ${stuntName(card, { short: true })}` : `${stuntName(card)}, ${score}. Can you land it?`;
}
