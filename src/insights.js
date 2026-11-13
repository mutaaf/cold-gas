// Box Office usage analytics (owner's decision, 2026-11-12; AGENTS.md §3.3). index.html loads the same-origin
// loader /boxoffice/v1/insights.js off localhost; it relays to the owner's PostHog through mutaafaziz.com (IPs
// truncated, GPC/DNT honoured, inputs masked in replays). This is the game's only way to name an event to it:
// queue-safe before the loader lands, a no-op when it never does, and never a throw into the game.
// Props are numbers and enums only: no initials, no free text, no ids.
export function track(name, props) {
  try {
    const w = globalThis.window;
    if (!w) return;
    (w.boxoffice ??= { q: [], track(...a) { this.q.push(a); } }).track(name, props);
  } catch { /* analytics never breaks the game */ }
}
