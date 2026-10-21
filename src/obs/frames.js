// Frame-time bookkeeping: a ring of every recent frame (interval, sim, render, CPU work), a
// session histogram, and the hitch / low-fps / fell-behind counters. Pure and allocation-free per
// frame: everything is a preallocated typed array or a number.

// Histogram bucket upper edges (ms). The last bucket is everything above 250 ms.
export const EDGES = [6, 9, 12, 15, 17.5, 20, 25, 33.4, 50, 66.7, 100, 250];
export const NB = EDGES.length + 1;
export const HITCH_MS = 50;      // a visible stutter: three frames lost at 60 Hz
export const LONG_MS = 25;       // a frame that missed 60 Hz by a third
export const LOW_FPS_MS = 33.4;  // a window that averages under 30 fps is "sustained low fps"
export const WINDOW_MS = 2000;   // the governor's window

export function bucketOf(ms) {
  let i = 0;
  while (i < EDGES.length && ms > EDGES[i]) i++;
  return i;
}

// The q-quantile (0..1) of a histogram, linear within the bucket.
export function percentile(h, q) {
  let n = 0;
  for (let i = 0; i < h.length; i++) n += h[i];
  if (!n) return 0;
  const target = q * n;
  let acc = 0;
  for (let i = 0; i < h.length; i++) {
    if (acc + h[i] >= target && h[i] > 0) {
      const lo = i === 0 ? 0 : EDGES[i - 1], hi = i < EDGES.length ? EDGES[i] : 1000;
      return Math.round((lo + ((target - acc) / h[i]) * (hi - lo)) * 10) / 10;
    }
    acc += h[i];
  }
  return EDGES[EDGES.length - 1];
}

export function createFrameStats(ring = 600) {
  const s = {
    ring,
    dt: new Float32Array(ring), sim: new Float32Array(ring), ren: new Float32Array(ring), work: new Float32Array(ring),
    head: 0, count: 0,
    hist: new Uint32Array(NB),          // the session's frame intervals
    frames: 0, hitches: 0, longFrames: 0, lowFpsWindows: 0, droppedTicks: 0, simHeavy: 0,
    simSum: 0, renSum: 0, workSum: 0,
    // The current governor window.
    w: { t0: -1, frames: 0, dtSum: 0, slow: 0, workOver: 0, hitches: 0 },
    lastHitchAt: 0, worstMs: 0,
  };
  return s;
}

// One frame. dtMs: the interval since the last frame; simMs / renMs / workMs: CPU time in the sim,
// in stage.render and in the whole frame; dropped: sim ticks the clock gave up this frame.
// Returns a closed window ({ frames, meanDt, slowShare, workOverShare, hitches }) every WINDOW_MS,
// reusing one object, else null.
const closed = { frames: 0, meanDt: 0, slowShare: 0, workOverShare: 0, hitches: 0 };
export function recordFrame(s, now, dtMs, simMs, renMs, workMs, dropped) {
  const i = s.head;
  s.dt[i] = dtMs; s.sim[i] = simMs; s.ren[i] = renMs; s.work[i] = workMs;
  s.head = (i + 1) % s.ring;
  if (s.count < s.ring) s.count++;
  // A frame after a background tab or a breakpoint isn't a hitch, it's a gap.
  if (dtMs > 1000) return null;
  s.frames++;
  s.hist[bucketOf(dtMs)]++;
  s.simSum += simMs; s.renSum += renMs; s.workSum += workMs;
  if (dtMs > LONG_MS) s.longFrames++;
  if (dtMs > HITCH_MS) { s.hitches++; s.lastHitchAt = now; }
  if (dtMs > s.worstMs) s.worstMs = dtMs;
  if (simMs > 8) s.simHeavy++;
  if (dropped > 0) s.droppedTicks += dropped;
  const w = s.w;
  if (w.t0 < 0) w.t0 = now;
  w.frames++; w.dtSum += dtMs;
  if (dtMs > LONG_MS) w.slow++;
  if (workMs > 8) w.workOver++;
  if (dtMs > HITCH_MS) w.hitches++;
  if (now - w.t0 < WINDOW_MS) return null;
  closed.frames = w.frames; closed.meanDt = w.dtSum / w.frames; closed.slowShare = w.slow / w.frames;
  closed.workOverShare = w.workOver / w.frames; closed.hitches = w.hitches;
  if (closed.meanDt > LOW_FPS_MS) s.lowFpsWindows++;
  w.t0 = now; w.frames = 0; w.dtSum = 0; w.slow = 0; w.workOver = 0; w.hitches = 0;
  return closed;
}

// The last n frames' interval quantile, from the ring (sorts a copy: call it once a second, not per frame).
export function recentQuantile(s, q, n = s.count, field = 'dt') {
  n = Math.min(n, s.count);
  if (!n) return 0;
  const a = new Float32Array(n), src = s[field];
  for (let k = 0; k < n; k++) a[k] = src[(s.head - 1 - k + s.ring) % s.ring];
  a.sort();
  return a[Math.min(n - 1, Math.floor(q * n))];
}

export function summary(s) {
  const n = s.frames || 1;
  return {
    frames: s.frames, p50: percentile(s.hist, 0.5), p95: percentile(s.hist, 0.95), p99: percentile(s.hist, 0.99),
    hitches: s.hitches, longFrames: s.longFrames, lowFpsWindows: s.lowFpsWindows, droppedTicks: Math.round(s.droppedTicks), simHeavy: s.simHeavy,
    simMs: Math.round((s.simSum / n) * 100) / 100, renderMs: Math.round((s.renSum / n) * 100) / 100, workMs: Math.round((s.workSum / n) * 100) / 100,
    worstMs: Math.round(s.worstMs),
  };
}
