// The board on a portal: this device's jumps (a portal build has no server; src/portal/offline.js). The same calls and
// answers as the online board (src/panel.js postScore / dryRank / fetchBoard), kept in localStorage (and so in the
// CrazyGames data module, src/portal/storage.js). The score is the run's own card (scoreRun), never a typed number.
export const BOARD_KEY = 'coldgas_portal_board';
export const MAX_ROWS = 200, SHOW_ROWS = 20;
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function readRows(ls) {
  try {
    const rows = JSON.parse(ls.getItem(BOARD_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && Number.isFinite(r.total)) : [];
  } catch { return []; }
}

export function rowFor(card, { initials, course, now }) {
  return {
    initials, total: Math.round(card.total * 10) / 10, verdict: String(card.verdict || ''),
    facts: { rollDeg: card.facts?.rollDeg ?? 0, sink: card.facts?.sink ?? 0 }, tier: card.tier || 'assist', course, day: dayOf(now),
  };
}

/** The board's rows: today's (or every day's) best for a course, best first. */
export function boardRows(rows, { kind = 'today', course = null, now = Date.now() } = {}) {
  const day = dayOf(now);
  return rows.filter((r) => (kind === 'all' || r.day === day) && (!course || r.course === course))
    .sort((a, b) => b.total - a.total).slice(0, SHOW_ROWS);
}

/** Where a card would land on today's board for its course (1 = top). */
export function rankOf(rows, card, { course, now = Date.now() }) {
  const day = dayOf(now);
  return 1 + rows.filter((r) => r.day === day && r.course === course && r.total > card.total).length;
}

export function postLocal(ls, { card, initials, course, now = Date.now() }) {
  if (!card || !card.facts?.jumped || !(card.total > 0)) return { ok: false, status: 400, error: 'no jump' };
  const rows = readRows(ls);
  const rank = rankOf(rows, card, { course, now });
  rows.push(rowFor(card, { initials, course, now }));
  rows.sort((a, b) => b.total - a.total);
  try { ls.setItem(BOARD_KEY, JSON.stringify(rows.slice(0, MAX_ROWS))); } catch { return { ok: false, status: 0 }; }
  return { ok: true, status: 200, rank, local: true };
}
