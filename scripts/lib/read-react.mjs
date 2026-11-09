// A modelled thumb's read-react loop (0173): it reads the sight, and acts on that read a reaction later. Reads are
// queued, never overwritten: a thumb that re-reads every 0.25 s with a 0.36 s reaction still moves to each read, in
// order, `lag` ticks after it read it (before 0173 each read pushed the pending move out again, and those thumbs never
// moved). Pure; used by scripts/human-phone.mjs (daily-reach.mjs's flyThumb is 0176), tested in tests/unit/read-react.test.js.
export function createReadReact(lag) {
  const q = [];
  let cur = null;
  return {
    // What the thumb read at tick t (the dot's offset, +y up the glass).
    read(t, x, y) { q.push({ x, y, at: t + lag }); },
    // Where the thumb is at tick t: the latest read whose reaction has arrived, or null before the first one.
    due(t) {
      while (q.length && q[0].at <= t) cur = q.shift();
      return cur;
    },
  };
}
