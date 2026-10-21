// The health ledger: what past sessions on THIS device went through, kept in localStorage (never
// sent anywhere as-is). Each session records its frame percentiles, the graphics tier and
// resolution scale it ran, its errors per module and whether it ended cleanly. The breakers'
// states live here too, so a subsystem that broke stays off across a reload until it's due a retry.
//
// Boot reads it to pick the tier from experience instead of from the device's spec sheet
// (`chooseBoot`), and the in-session governor (`createGovernor`) steps the resolution down when a run
// hitches and back up when the headroom returns. Both have hysteresis: one bad session or 6 s of
// stutter is enough to step down; it takes several good ones to step back up, more for a tier that
// already failed here.
//
// Pure apart from the injected storage; every storage access is wrapped (private mode, quota, a
// blocked origin all just mean "no history").

export const TIER_IDS = ['low', 'mid', 'high'];
export const SCALES = [1, 0.85, 0.7, 0.55];   // resolution scale steps within a tier
export const LEDGER_KEY = 'coldgas_health';
const MAX_SESSIONS = 12;
export const P95_BAD = 33.4;     // a session whose p95 frame missed 30 fps: step down
export const P95_GOOD = 20;      // comfortably smooth: counts toward stepping up
export const UP_AFTER = 3;       // good sessions in a row at a tier before trying the next one up
export const UP_AFTER_FAILED = 5; // …if that next tier failed on this device in the last 10 sessions
const MIN_FRAMES = 600;          // ≈10 s of frames before a session's percentiles count

const tierIdx = (t) => Math.max(0, TIER_IDS.indexOf(t));
const fatal = (x) => !!x && ((x.ctxLost || 0) > 0 || (x.crashes?.physics || 0) > 0 || (x.crashes?.render || 0) + (x.crashes?.webgl || 0) + (x.crashes?.frame || 0) > 0);

export function emptyLedger() { return { v: 1, sessions: [], breakers: {}, recoveries: [] }; }

export function loadLedger(storage) {
  try {
    const raw = storage?.getItem(LEDGER_KEY);
    if (!raw) return emptyLedger();
    const l = JSON.parse(raw);
    if (!l || l.v !== 1 || !Array.isArray(l.sessions)) return emptyLedger();
    l.breakers = l.breakers && typeof l.breakers === 'object' ? l.breakers : {};
    l.recoveries = Array.isArray(l.recoveries) ? l.recoveries.slice(-8) : [];
    l.sessions = l.sessions.slice(-MAX_SESSIONS);
    return l;
  } catch { return emptyLedger(); }
}
export function saveLedger(storage, l) {
  try {
    l.sessions = l.sessions.slice(-MAX_SESSIONS);
    l.recoveries = l.recoveries.slice(-8);
    storage?.setItem(LEDGER_KEY, JSON.stringify(l));
    return true;
  } catch { return false; }
}

// Which tier and resolution scale to boot with → { tier, scale, reason, from }.
//   forced      ?gfx= (always wins)
//   deviceTier  the spec-sheet default (phone mid/low, desktop high): the ceiling for stepping up
export function chooseBoot({ sessions = [], deviceTier = 'high', forced = null } = {}) {
  if (TIER_IDS.includes(forced)) return { tier: forced, scale: 0, reason: `forced by ?gfx=${forced}`, from: 'url' };
  const cap = tierIdx(deviceTier);
  const past = sessions.filter((x) => x && TIER_IDS.includes(x.tier));
  const last = past[past.length - 1];
  if (!last) return { tier: deviceTier, scale: 0, reason: `first session on this device: ${deviceTier} for its class`, from: 'device' };
  const at = Math.min(tierIdx(last.tier), cap);
  const down = (why) => ({ tier: TIER_IDS[Math.max(0, at - 1)], scale: 0, reason: at > 0 ? `stepped down from ${TIER_IDS[at]}: ${why}` : `kept low: ${why}`, from: 'ledger' });
  // One bad session is enough to step down.
  if (fatal(last)) return down(last.ctxLost ? 'the last session lost the GPU' : `the last session crashed in ${Object.keys(last.crashes || {}).filter((k) => last.crashes[k] > 0).join(', ') || 'render'}`);
  const recent = past.slice(-3);
  if (recent.length >= 2 && recent.filter((x) => x.ended === false && (x.frames || 0) > MIN_FRAMES).length >= 2) return down('two of the last three sessions ended without closing (a killed tab)');
  if ((last.frames || 0) >= MIN_FRAMES && last.p95 > P95_BAD && (last.scale ?? 0) >= SCALES.length - 1) return down(`its p95 frame was ${last.p95} ms even at ${Math.round(SCALES[SCALES.length - 1] * 100)} % resolution`);
  if ((last.frames || 0) >= MIN_FRAMES && last.p95 > P95_BAD) return down(`its p95 frame was ${last.p95} ms`);
  // Keep the resolution the last session settled on (minus one step of optimism).
  const scale = Math.max(0, (last.scale ?? 0) - 1);
  // Step up only after a run of smooth sessions at this tier, and more of them if the tier above
  // failed here recently.
  if (at < cap) {
    const up = TIER_IDS[at + 1];
    const failedAbove = sessions.slice(-10).some((x) => x?.tier === up && (fatal(x) || ((x.frames || 0) >= MIN_FRAMES && x.p95 > P95_BAD)));
    const need = failedAbove ? UP_AFTER_FAILED : UP_AFTER;
    let run = 0;
    for (let k = past.length - 1; k >= 0; k--) {
      const x = past[k];
      if (x.tier !== TIER_IDS[at] || fatal(x) || (x.scale ?? 0) > 0 || !((x.frames || 0) >= MIN_FRAMES && x.p95 <= P95_GOOD)) break;
      run++;
    }
    if (run >= need) return { tier: up, scale: 0, reason: `stepped up to ${up}: ${run} smooth sessions at ${TIER_IDS[at]} (p95 ≤ ${P95_GOOD} ms)`, from: 'ledger' };
    return { tier: TIER_IDS[at], scale, reason: `kept ${TIER_IDS[at]}: ${run}/${need} smooth sessions toward ${up}`, from: 'ledger' };
  }
  return { tier: TIER_IDS[at], scale, reason: (last.frames || 0) >= MIN_FRAMES ? `kept ${TIER_IDS[at]}: last session p95 ${last.p95} ms` : `kept ${TIER_IDS[at]}: the last session was short`, from: 'ledger' };
}

// In-session resolution governor. feed(window) with a closed frame window (src/obs/frames.js);
// returns -1 (step down: lower the resolution), +1 (step up) or 0.
//   down: 3 windows in a row (6 s) with > 20 % of frames over 25 ms
//   up:   15 windows in a row (30 s) with < 2 % slow frames and < 10 % of frames over 8 ms of CPU,
//         at least 60 s after the last step down, and never back to a step that failed twice
//         this session.
export function createGovernor({ level = 0, max = SCALES.length - 1, now = () => performance.now() } = {}) {
  const g = { level, bad: 0, good: 0, lastDown: -Infinity, failedAt: new Uint8Array(max + 1), changes: 0 };
  g.feed = (w) => {
    if (!w || w.frames < 20) return 0;     // a background tab or a load stall: not evidence
    const bad = w.slowShare > 0.2, good = w.slowShare < 0.02 && w.workOverShare < 0.1;
    g.bad = bad ? g.bad + 1 : 0;
    g.good = good ? g.good + 1 : 0;
    if (g.bad >= 3 && g.level < max) {
      g.failedAt[g.level]++;
      g.level++; g.bad = 0; g.good = 0; g.lastDown = now(); g.changes++;
      return -1;
    }
    if (g.good >= 15 && g.level > 0 && now() - g.lastDown > 60_000 && g.failedAt[g.level - 1] < 2) {
      g.level--; g.good = 0; g.changes++;
      return 1;
    }
    return 0;
  };
  return g;
}
