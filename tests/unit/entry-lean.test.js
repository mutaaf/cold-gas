// 0053: the first load on a phone. The entry chunk (src/main.js and everything it imports statically) is what a
// phone downloads, parses and runs before the title's Jump is wired. The modules a run needs only once it has
// started or ended (the coach, the drills, the HUD's instruments, the AI settings sheet, the share card's drawing,
// the board's client, the sheet's Post and the landing's beat)
// ride in their own chunk, src/later.js, which main.js asks for beside the physics engine; a run waits on both.
// A static import of one of them from the entry's graph puts its bytes back on the title's critical path.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const LATE = ['src/sim/coach.js', 'src/practice.js', 'src/instruments.js', 'src/ai/settings.js', 'src/share-card.js',
  'src/panel.js', 'src/post.js', 'src/beat.js'];

// Every module reachable from `entry` by static imports (dynamic import() is a separate chunk, not followed).
function staticGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(resolve(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+\.js)['"]/gm)) {
      const spec = m[1] || m[2];
      if (!spec.endsWith('.js')) continue;
      const next = resolve(ROOT, dirname(file), spec).slice(ROOT.length + 1);
      if (existsSync(resolve(ROOT, next))) walk(next);
    }
  };
  walk(entry);
  return seen;
}

describe('the entry chunk carries only what the title needs (0053)', () => {
  const graph = staticGraph('src/main.js');

  it('walks the real graph', () => {
    expect(graph.has('src/ui.js')).toBe(true);
    expect(graph.has('src/sim/run.js')).toBe(true);
  });

  for (const late of LATE) {
    it(`${late} is not in the entry's static graph`, () => {
      expect(graph.has(late)).toBe(false);
    });
  }

  it('src/later.js carries them, and main.js asks for it with the physics', () => {
    const later = staticGraph('src/later.js');
    for (const late of LATE) expect(later.has(late)).toBe(true);
    const main = readFileSync(resolve(ROOT, 'src/main.js'), 'utf8');
    expect(main).toMatch(/import\(\s*['"]\.\/later\.js['"]\s*\)/);
  });
});
