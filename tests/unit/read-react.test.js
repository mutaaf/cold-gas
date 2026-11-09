// 0173: a modelled thumb that re-reads the sight faster than it reacts still acts on every read, a reaction late,
// exactly once (scripts/lib/read-react.mjs, used by scripts/human-phone.mjs and scripts/lib/daily-reach.mjs).
import { describe, it, expect } from 'vitest';
import { createReadReact } from '../../scripts/lib/read-react.mjs';

// The scripts' loop: read every `every` ticks, move to whatever is due, every tick.
function drive(every, lag, reads, ticks) {
  const rr = createReadReact(lag), moves = [];
  let next = 0, k = 0;
  for (let t = 0; t < ticks; t++) {
    if (t >= next && k < reads.length) { rr.read(t, reads[k].x, reads[k].y); k++; next = t + every; }
    const w = rr.due(t);
    if (w) moves.push({ t, x: w.x, y: w.y });
  }
  return moves;
}

describe('read-react (0173)', () => {
  it('moves to the first read, lag after it, when the thumb re-reads faster than it reacts', () => {
    const every = 60, lag = 86;   // 0.25 s reads, 0.36 s reaction: the case that used to never move
    const reads = Array.from({ length: 20 }, (_, i) => ({ x: 10 + i, y: -5 - i }));
    const moves = drive(every, lag, reads, 2000);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]).toEqual({ t: lag, x: 10, y: -5 });
    // Every read is acted on, in order, each a reaction after it was read.
    const firstAt = (x) => moves.find((m) => m.x === x)?.t;
    for (let i = 0; i < reads.length; i++) expect(firstAt(reads[i].x)).toBe(i * every + lag);
  });

  it('is unchanged when the thumb reacts before it re-reads', () => {
    const moves = drive(120, 48, [{ x: 3, y: 4 }, { x: 7, y: 8 }], 400);
    expect(moves[0]).toEqual({ t: 48, x: 3, y: 4 });
    expect(moves.find((m) => m.x === 7).t).toBe(168);
    expect(moves.filter((m) => m.t < 48)).toEqual([]);
  });

  it('holds the last read it acted on between reads', () => {
    const moves = drive(60, 86, [{ x: 1, y: 1 }], 300);
    expect(moves.every((m) => m.x === 1 && m.y === 1)).toBe(true);
    expect(moves.length).toBe(300 - 86);
  });
});
