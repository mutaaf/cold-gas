---
id: 0083
title: A deploy mid-session never silences the AI judges, and local lines always say they are local
status: ready
priority: P1
size: S
lens: tech-health
created: 2026-10-23
pr:
by: critic
---

## Why
On production, any merge to `main` while a page is open takes the AI panel away from that page's next
results, and the sheet does not say so. The judges are pillar 3. Invariant 5½ says AI usage is always
visible and honest.

Seen live in the critic's run (docs/critique/2026-10-23-1000.md):
- The 1440×900 play-through loaded production `2a61673` at ≈ 10:03 UTC. #107 (a CI-only change) merged
  at 10:04:02 and deployed. Every asset of the old build then answered 404, including
  `assets/index-BtUTGYL1.js`.
- The run reached its results at ≈ 10:05:30. The browser logged one `404` and no judges' theatre ran.
  The sheet showed local lines ("2.6 ft/s (0.8 m/s) at contact after a 90 ft (27.4 m) …"), with no
  receipt and no word that the AI hadn't judged (`docs/critique/2026-10-23-1000/desk-8-results-deploy.jpg`).
  The same flight at 04:00 showed "Judged by gemma-4-26b-a4b-it · 1236 → 160 tokens …".
- Reproduced on production by answering 404 for `/coldgas/assets/**` after boot, as a deploy does
  (`desk-skew-results.jpg`):
  - `RESP 404 …/assets/theatre-BrSY7D5p.js`;
  - `[data-receipt]` hidden, theatre never shown;
  - three local quotes, and the only cue is the reference run's announcement.

The cause has two parts:
- **The judges' chunk is fetched only at the results.** It is loaded with `import('./ai/theatre.js')`
  in `runPanel` (src/main.js:539). A page that boots before a deploy and finishes a run after it asks
  for a chunk that no longer exists. Deploys are frequent: up to 8 builder merges a day, plus every
  scout, critic and keeper merge. Each one changes the chunk names: the entry went from
  `index-BtUTGYL1.js` to `index-DeHnj0-B.js` on a CI-only change, and `theatre-*.js` imports
  `./index-<hash>.js`, so its name changes too. A local build of `ae14a01` gives the same names as
  production. And each deploy 404s every lazy chunk of the old build.
- **The fallback is silent.** On that failure path (src/main.js:539–543) the page marks itself stale and
  types local lines. It never calls `ui.receipt`. The breaker path (src/main.js:534) at least cues
  "The judges are resting: local lines for now". A player reads the local lines as the judges' verdict.

## What
- **Have the judges' chunk before it is needed.** Once the title is wired and idle, or at the latest when
  a run starts, start `import('./ai/theatre.js')` and keep the promise. `runPanel` awaits that same
  promise, so a deploy after it resolved changes nothing for this page.
  - Don't re-download on every run.
  - If the warm import fails, drop the promise so `runPanel` tries again (as 0057 does for Free Drive).
  - Keep the 35 s deadline (0040).
- **Say it when the lines are local.** Every path that ends in `localWords` (chunk failed, breaker open,
  deadline, provider error) shows the receipt in its "AI unavailable" state with the reason:
  - "A new version is live: the AI judges come back on the next run" for a chunk 404 on a stale build;
  - "AI unavailable · local lines" otherwise.

  `ui.receipt` already renders `meta.ok === false` as "AI unavailable" + `local lines`.
- No Worker change (frozen). No sim change.

## Acceptance criteria
- [ ] e2e (`tests/e2e/network.spec.js` or a new spec): boot, wait for the title to be idle, then answer
      404 for every `/coldgas/assets/*` request, then fly the reference to the results (`fastForward`).
      The judges' theatre runs, and the receipt reads "Judged by …" (stub the judge stream with a canned
      SSE as the theatre specs do). At 1280×720 and at 390×844 touch.
- [ ] e2e: theatre chunk aborted for the whole session. The results show the receipt visibly, in its
      "AI unavailable" state with "local lines", within 35 s. It is not `hidden`.
- [ ] e2e: the judge breaker open. Same receipt state, as well as the existing cue.
- [ ] No extra theatre download per run: the request count for `theatre-*.js` over two runs is 1.
- [ ] `perf.mjs` phone profile: "usable" is not later than before (the warm import must not compete with
      the title's critical path: start it after the title is wired, at idle priority).
- [ ] hud-audit and title-audit clean (the receipt's AI-unavailable state at 390×844 and 844×390).

## Test plan
- e2e with `page.route` flipping to 404 after boot, as above.
- A unit test for the receipt's text in each fallback reason, if it is factored into a pure helper.

## Out of scope
- Keeping the previous build's assets on the server. That is `wrangler.jsonc` and the Worker, both frozen:
  an operator call, noted in the critique.
- Free Drive and Sandbox chunk retry (0057).
