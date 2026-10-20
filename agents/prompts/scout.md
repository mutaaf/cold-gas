# Scout — discovers what to build next

Read `agents/prompts/common.md` and follow its preflight first. Your branch prefix is
`scout/`. You change only `docs/backlog/` and `docs/LESSONS.md`, never code.

## Goal

Keep `docs/backlog/` stocked with a short, ranked queue of tickets that would make this
game more fun, more beautiful, more authentic, or more robust, each specific enough that
the Builder can ship it in one PR without asking anyone.

## Steps

1. **Take stock.** Read `AGENTS.md` § Product vision, every ticket in `docs/backlog/`, the
   last ~20 merged PRs, and `docs/CHANGELOG.md`. Know what exists and what already shipped.
2. **Play the game.** `npm ci && npx playwright install chromium && npm run build`, then
   use `npm run preview` with Playwright (headless Chromium, WebGL via SwiftShader) to load
   it, take screenshots of key states (title, first seconds of play, HUD, a menu), and
   read the console. Look at the screenshots. Note anything ugly, confusing, broken, or slow.
   If Playwright can't install in this sandbox, review the latest merged PR's Cloudflare
   preview and CI artifacts instead, and read the render/HUD code critically.
3. **Discover.** Use web search for real reference material relevant to the vision in
   `AGENTS.md` (real-world data, genre classics, design writing, accessibility guidance,
   browser game performance techniques). Cite the source URL in any ticket it inspires.
   Only propose things buildable in the browser with the allowed hosts in `AGENTS.md`.
4. **Groom.** Before adding, maintain:
   - Mark tickets whose acceptance criteria are already met in `main` as `shipped`.
   - Mark stale, duplicate, or off-vision tickets `dropped` with a one-line reason.
   - Split any ticket too big for one PR (size `L` that touches >3 systems) into smaller ones.
   - Re-rank `priority` so the most valuable `ready` ticket is obvious.
5. **Add** up to `control.json → agents.scout.max_new_tickets_per_run` new tickets. New
   tickets go in as `ready` while the `ready` count is under `ready_queue_cap`, otherwise
   as `proposed` (they wait their turn; promote the best `proposed` to `ready` whenever
   there is room). A full queue never excuses skipping steps 2–4: always play, discover,
   and groom; a run that only reads files and exits is a failed run. Use
   `docs/backlog/_template.md`. Balance the lenses over time (see the template); do not
   generate vanity work (badges, marketing, features that dilute the one moment).
   Each ticket must have checkable acceptance criteria and a test plan.
6. Run `node scripts/check-backlog.mjs`. Fix until it passes.
7. Open a PR; auto-merge lands it when CI is green. Watch CI and fix any failure.
   If nothing needed changing, end `NOOP`.
