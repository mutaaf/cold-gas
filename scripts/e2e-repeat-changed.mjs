#!/usr/bin/env node
// Flake guard: run every e2e spec this branch adds or changes several times in a row, with no
// retries, so a test that only passes some of the time is caught before it merges (where it
// would start failing other people's PRs). CI runs it on pull requests after the main suite.
//
//   node scripts/e2e-repeat-changed.mjs            # specs changed vs origin/main, 5 times each
//   E2E_REPEAT=10 node scripts/e2e-repeat-changed.mjs tests/e2e/race.spec.js
//
// Frame-time tests (@perf) are left out: they run once, on their own, in the main suite.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function changedSpecs() {
  const base = process.env.GITHUB_BASE_REF || 'main';
  let range;
  try {
    git('rev-parse', '--verify', `origin/${base}`);
    range = [`origin/${base}...HEAD`];
  } catch {
    // CI checks out one commit: the PR merged into its base. Its first parent is that base, so
    // compare against it (not the base's current tip, which may have moved on since and would
    // drag other PRs' spec changes in).
    try {
      git('fetch', '--no-tags', '--deepen=1', 'origin');
      git('rev-parse', '--verify', 'HEAD^2');
      range = ['HEAD^1', 'HEAD'];
    } catch {
      try { git('fetch', '--no-tags', '--depth=1', 'origin', base); } catch { return null; }
      range = ['FETCH_HEAD', 'HEAD'];
    }
  }
  return git('diff', '--name-only', '--diff-filter=AMR', ...range, '--', 'tests/e2e')
    .split('\n')
    .filter((f) => /\.spec\.js$/.test(f) && existsSync(f));
}

const named = process.argv.slice(2);
const specs = named.length ? named : changedSpecs();
if (specs === null) {
  console.log('[flake guard] could not work out the base branch; skipping');
  process.exit(0);
}
if (!specs.length) {
  console.log('[flake guard] no e2e specs changed');
  process.exit(0);
}
// Keep the guard to a few minutes: fewer repeats when a branch touches many specs.
const repeat = Number(process.env.E2E_REPEAT) || (specs.length <= 4 ? 5 : specs.length <= 10 ? 3 : 2);
console.log(`[flake guard] ${specs.length} changed spec(s), ${repeat}× each, no retries:\n  ${specs.join('\n  ')}`);
const res = spawnSync('npx', ['playwright', 'test', ...specs, '--project=desktop', `--repeat-each=${repeat}`, '--retries=0'], { stdio: 'inherit' });
process.exit(res.status ?? 1);
