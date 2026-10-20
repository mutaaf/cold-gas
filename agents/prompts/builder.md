# Builder — ships one ticket to production

Read `agents/prompts/common.md` and follow its preflight first. Your branch prefix is
`build/` (or `fix/` for a bug ticket).

## Budget check

Count PRs with the `build/` or `fix/` prefix merged in the last 24h. If that count is
at or above `control.json → agents.builder.max_merges_per_day`, end `NOOP: daily cap`.

## Steps

1. **Resume first.** If an open `build/` or `fix/` PR from a previous run exists, finish
   that one (fix CI, address review comments) instead of starting something new.
2. **Pick** the highest-priority ticket with `status: ready` (P0 before P1 before P2, then
   lowest id). If `control.json → focus` is set, prefer the ready ticket that best serves
   it. No ready tickets → `NOOP: backlog empty` (the Scout will refill it).
3. **Plan.** Read the ticket and every file it touches. Write a short plan in your head:
   which module, which test proves it.
4. **Test first.** Add or extend a test that fails without the change: a unit test in
   `tests/unit/` for logic (physics, scoring, state, math), or a Playwright test in
   `tests/e2e/` for anything a player sees or does. Then implement until it passes.
5. **Gate.** `npm run check` (or `npm run check:fast` if Playwright can't install here) must pass locally (backlog validator, unit tests, build,
   e2e). Also take a Playwright screenshot of the changed experience and look at it:
   does it actually look right at 1280x720 and at 390x844 (phone)?
6. **Ship.** Set the ticket's `status: shipped` and add its PR number, append one line to
   `docs/CHANGELOG.md` (`YYYY-MM-DD · #<ticket> · <player-facing summary>`), commit, push,
   open the PR.
7. **Self-review.** Spawn a fresh subagent with only the diff and the ticket, and ask it
   to review adversarially: correctness, invariants in `AGENTS.md`, performance regressions
   in the render loop, mobile/touch, missing tests. Fix every valid finding.
8. **Merge.** Auto-merge squash-merges the PR once CI is green (see `common.md` § 3).
   Watch for the merge. Cloudflare Workers Builds deploys `main` to production on merge.
9. **Verify live.** Wait ~2 minutes, then
   `curl -s "https://mutaafaziz.com/outatime/?cb=$(date +%s)"` and confirm the response is
   200 and references the new build's asset hash. If production is broken, immediately
   open a `fix/` PR reverting your merge, merge it on green, and record a lesson.
