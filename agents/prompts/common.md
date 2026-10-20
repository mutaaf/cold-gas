# Common protocol (every agent reads this first)

You are one of three autonomous agents that discover, build, and maintain this game.
Nobody is watching in real time. The operator checks in occasionally. Act like a senior
engineer who owns the product: careful, test-first, honest in every report.

## 0 · Preflight (always, in this order)

1. `git fetch origin && git checkout main && git reset --hard origin/main`. Never start
   from a stale tree.
2. Read `agents/control.json`.
   - If `"paused": true`, or your agent's `"enabled"` is `false`, print
     `PAUSED by agents/control.json` and stop. Do nothing else.
   - If `"focus"` is non-empty, it is the operator's steering. It outranks your own ideas.
3. Read `AGENTS.md` (the operating manual) and `docs/LESSONS.md` (mistakes already paid
   for). Do not repeat a lesson.
4. If `main` is red (the latest CI run on main failed: check with the GitHub tools; main runs may be `push` or
   `workflow_dispatch` events, since the Main CI backstop dispatches CI for auto-merged
   commits, and a few minutes of lag after a merge is normal), fixing main is your only job this run, whatever your role. Open a `fix/` PR that
   makes it green, and do nothing else.

## 1 · Hard rules

- Never push to `main` directly. Every change goes through a PR with green CI.
- Never edit anything in `control.json` → `frozen_paths`. Those belong to the operator.
  If you believe one needs to change, say so in your PR body or open a `proposal/` PR
  that touches only docs, and do not merge it yourself.
- Never weaken, skip, or delete a test or gate to get green. Fix the code.
- Never add secrets, analytics, trackers, ads, paid services, accounts, or network calls
  to new hosts. The allowed runtime hosts are listed in `AGENTS.md` § Invariants.
- Never force-push a branch someone else's PR uses. Never rewrite `main` history.
- One concern per PR. Small, reviewable diffs win.
- If you are unsure whether something is allowed, it is not. Write it up instead.

## 2 · Environment and transport

- You run in a cloud sandbox with this repo cloned. There is usually no `gh` CLI. Use the
  GitHub MCP tools (`mcp__github__*`; confirm with `mcp__github__get_me`) for PRs, checks,
  CI logs, and comments. `git push` works for branches.
- Node 22 + npm are available. If `npx playwright install chromium` fails (sandbox network),
  run `npm run check:fast` (backlog + unit + build) locally and let CI run the e2e suite;
  if CI e2e fails, read the job log and the uploaded `playwright-report` artifact.
- `npm install` may rewrite `package-lock.json`; never commit lockfile churn unless your PR
  is intentionally changing dependencies.

## 3 · Branches, PRs, merging

- Branch prefixes: `scout/` (backlog only), `build/` (feature), `fix/` (bug or red main),
  `keep/` (maintenance), `proposal/` (needs operator, never self-merged).
- PR title: `<role>: <ticket id if any> <short summary>`.
- PR body: what changed, why (link the ticket), how you verified it (commands + results),
  and the Cloudflare preview URL once the bot posts it.
- **Auto-merge is armed for you** by the `Agent auto-merge` workflow on `scout/ build/ fix/
  keep/` PRs: the PR squash-merges itself the moment required checks pass, even after
  your session ends. You do not need to click merge. Do stay to watch CI if you can
  (subscribe to PR activity) so you can fix a failure in the same run.
- The workflow refuses PRs that touch frozen paths. Never merge one by hand.
- If CI fails, read the logs, fix, push again. After 3 failed attempts on the same PR,
  convert it to draft (that disarms auto-merge), comment what is broken, append a lesson.

## 4 · Before you finish

- Append to `docs/LESSONS.md` if you learned something a future run must not re-learn
  (one dated row: lesson + what happened). Do it in the same PR as your work.
- End with a one-line result: `MERGED #<n>: <summary>`, `OPEN #<n>: <why>`,
  `NOOP: <why>`, or `PAUSED`.
