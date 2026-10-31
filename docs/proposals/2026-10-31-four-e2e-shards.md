# Proposal: a fourth e2e shard in ci.yml (operator only: frozen path)

Filed by the critic, 2026-10-31 16:20 UTC. Never self-merged.

## The problem: main is red on time, not on a test

| Run | Commit | e2e 1/3 | e2e 2/3 | e2e 3/3 | Failed tests |
|---|---|---|---|---|---|
| #569 | de19b26 (critic docs) | pass | pass | pass | 0 |
| #572 | 652a161 (scout docs only) | **cancelled at 35 min** | **cancelled at 35 min** | 24.6 min | 0 |
| #573 | d56c58e (#183, 0117) | 16.8 min | **cancelled at 35 min**, 85 tests green, none failed | 33.5 min | 0 |

On #573, e2e 2/3 had run 85 tests, all green, when it hit the job's 35-minute limit
(log: `✓ 85 … pause.spec.js:61:3 … (22.1s)`, then `The operation was canceled` at 16:11:59).
#572 was a docs-only commit, so the tree couldn't have caused it. LESSONS 2026-10-29 to 2026-10-31
(six rows) record the same result: the suite is ≈ 95 median worker-minutes, and three 35-minute jobs
leave almost no margin. No weights survive a slow runner (best cut 69:92:89 ≈ 31.7 / 31.6 / 31.9 median,
33.8 / 34.1 / 34.1 p75). Agents can't fix this: `.github/workflows/` is frozen, and re-weighting has
already cost #183 four CI rounds.

While main is red, every agent's preflight (common.md §0.4) spends its run on main instead of the
lockdown tickets.

## The change (in `.github/workflows/ci.yml`, operator only)

```yaml
  e2e:
    name: e2e ${{ matrix.shard }}/4
    ...
      matrix:
        shard: [1, 2, 3, 4]
    ...
      - run: npx playwright test --shard=${{ matrix.shard }}/4
```

- Playwright splits `/4` evenly (playwright.config.js applies `PWTEST_SHARD_WEIGHTS` only to `/3`),
  so each shard gets ≈ 24 median minutes, or ≈ 32 on a 1.33× runner, under 35.
- If branch protection lists `e2e 1/3` … `e2e 3/3` as required checks, swap them for `e2e 1/4` … `e2e 4/4`
  (or require only the aggregate `check` job).
- Alternative, or in addition: `timeout-minutes: 45` on the e2e job.

## After it lands

A builder `keep/` PR can delete the `/3` weights block and its comment from playwright.config.js.
