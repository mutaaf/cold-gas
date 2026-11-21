# Proposal: give the e2e jobs headroom (ci.yml, operator only)

Filed 2026-11-19 by the builder. `.github/workflows/` is frozen, so this is a proposal, not a change.

## What happened

Main went red three times on 2026-11-19 with every e2e test that ran green, only because shards hit
`timeout-minutes: 35`:

| commit | change | e2e 1/4 | 2/4 | 3/4 | 4/4 |
|---|---|---|---|---|---|
| 2ca517c, f47e74d | app | — | — | > 35 (102–103/108) | f47e74d > 35 |
| 8ca7131 (green) | iOS train | 29.0 | 23.2 | 19.9 | 21.5 |
| d77eeaa | **backlog only** (#455) | > 34.6 | > 34.0 | 27.9 | > 34.6 (88/105) |

d77eeaa changed two ticket files and nothing the suite runs, yet three shards ran ≈ 1.4–1.6× their
time on 8ca7131. #454 already re-cut the shards by per-file medians; its own comment in
`playwright.config.js` says the suite is ≈ 115 median minutes in four 35-minute jobs and "a 2×
runner still fails, the fix for that is ci.yml's". At ≈ 29 min a shard, a runner 1.2× the median
fails, and today's runners were slower than that.

No weight in `playwright.config.js` can fix it, and agents cannot touch ci.yml. Every slow-runner
day costs a red main, a `fix/` run that can only re-run jobs, and blocks every builder PR meanwhile.

## Options (pick one)

1. **Five e2e shards** (recommended): `matrix.shard: [1, 2, 3, 4, 5]`, `--shard=${{ matrix.shard }}/5`,
   the job name `e2e N/5`, and the `check` job's needs unchanged in shape. ≈ 23 median minutes a
   shard: a 1.5× runner fits. `playwright.config.js` only applies its weights to `/4`, so `/5`
   cuts evenly by test count until an agent re-weights it (a builder can do that in a follow-up
   `fix/` PR from the next run's per-file times; it is not frozen).
2. **`timeout-minutes: 45`** on the e2e job: one line, no re-cut, but a slow day still takes
   45 minutes of wall time per PR.

Either way the flake guard (also 4 × 35 min) is unaffected for normal PRs.

## What an agent does meanwhile

When a main e2e shard is cancelled at 35 min with every finished test green and the commit does
not touch the suite, re-run the failed jobs (`rerun_failed_jobs`) and record it; do not re-cut
weights against one slow run.
