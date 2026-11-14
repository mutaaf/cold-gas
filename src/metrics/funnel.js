// The Phase 2 funnel on this device (0245): the few local counters its events need, and a queue that sends them.
//
// Counters (localStorage, each read and write guarded; 0254's progress store will adopt them):
//   coldgas_seen      the last UTC day this device opened the game (session_start's returning / days_since_last)
//   coldgas_jumps     Jumps of the player's own ever started here (jump_start / jump_end's n)
//   coldgas_landings  of those, how many landed (first_landing; "a first run" = none yet, 0247)
// No id of any kind: a count and a day number.
//
// Events are validated against the vocabulary (src/metrics/events.js) and queued; `flush()` hands them to Box Office
// (src/insights.js track) at a calm moment: the title, the results, the page going. Never from the frame loop: an
// event asked for mid-run waits in the queue (a few small objects, made once per event, never per frame).
import { validate, N_CAP } from './events.js';
import { medalFor } from '../medals.js';

const SEEN = 'coldgas_seen', JUMPS = 'coldgas_jumps', LANDINGS = 'coldgas_landings', MEDALS = 'coldgas_medals';
const DAY_MS = 86_400_000;
const QUEUE_MAX = 64;

const int = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e7) : null; };
const local = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Landed before this counter existed: a medal on record is a landing (bronze is a clean landing on every event and
// tier, src/medals.js), so a player from before 0245 isn't taken for a newcomer.
function landedBefore(store) {
  try {
    const m = JSON.parse(store?.getItem(MEDALS) || '{}');
    return Object.entries(m).some(([k, total]) => { const [course, tier] = k.split(':'); return !!medalFor(course, tier, Number(total)); });
  } catch { return false; }
}

/**
 * @param {object} [o]
 * @param {Storage|null} [o.store]
 * @param {() => number} [o.now]           wall clock, ms (the day number only)
 * @param {(name: string, props: object) => void} [o.send]   src/insights.js track
 */
export function createFunnel({ store = local(), now = () => Date.now(), send = () => {} } = {}) {
  const get = (k) => { try { return int(store?.getItem(k)); } catch { return null; } };
  const put = (k, v) => { try { store?.setItem(k, String(v)); } catch { /* memory only */ } };
  let jumps = get(JUMPS) ?? 0;
  let landings = get(LANDINGS);
  if (landings == null) { landings = landedBefore(store) ? 1 : 0; if (landings) put(LANDINGS, landings); }
  let inputSeen = false, sessionSent = false;
  const queue = [];

  function emit(name, props) {
    const p = validate(name, props);
    if (!p) return false;
    if (queue.length >= QUEUE_MAX) queue.shift();
    queue.push([name, p]);
    return true;
  }
  function flush() {
    while (queue.length) {
      const [name, props] = queue.shift();
      try { send(name, props); } catch { /* analytics never breaks the game */ }
    }
  }

  return {
    emit, flush,
    get queued() { return queue.length; },
    /** Once per page load: returning, and whole UTC days since the last visit. */
    session() {
      if (sessionSent) return;
      sessionSent = true;
      const today = Math.floor(now() / DAY_MS), last = get(SEEN);
      put(SEEN, today);
      emit('session_start', { returning: last == null ? 0 : 1, days_since_last: last == null ? 0 : Math.max(0, today - last) });
    },
    /** The page's first input that reaches the car or the title's primary action. */
    input(msSinceLoad) {
      if (inputSeen) return;
      inputSeen = true;
      emit('first_input', { ms_since_load: Math.max(0, Math.round(msSinceLoad)) });
    },
    /** A Jump of the player's own starts: counted, and its n (1, 2, 3 = three or more) returned for its end. */
    jumpStart(course, tier) {
      jumps = Math.min(jumps + 1, 1e7);
      put(JUMPS, jumps);
      const n = Math.min(jumps, N_CAP);
      emit('jump_start', { n, course, tier });
      return { n, jump: jumps };
    },
    /** Its card is decided. `start`: what jumpStart returned. The first landing on this device says which Jump it was. */
    jumpEnd(start, { course, tier, landed, score }) {
      emit('jump_end', { n: start?.n ?? 1, course, tier, landed: landed ? 1 : 0, score });
      if (!landed) return false;
      const first = landings === 0;
      landings = Math.min(landings + 1, 1e7);
      put(LANDINGS, landings);
      if (first) emit('first_landing', { n: start?.jump ?? jumps });
      return first;
    },
    /** A Jump has landed on this device (a first run is one before it has). */
    get landedEver() { return landings > 0; },
    get jumps() { return jumps; },
  };
}
