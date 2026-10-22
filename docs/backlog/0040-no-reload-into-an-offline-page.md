---
id: 0040
title: A flaky network never reloads the game into an offline page; a stale deploy recovers once
status: shipped
priority: P0
size: M
lens: tech-health
created: 2026-10-21
pr: 69
by: operator
---

## Why
main deploys up to 8×/day, so stale chunk hashes are a daily event, and the self-heal (PR #58) treats
every failed chunk the same: `vite:preloadError` fires before an optional chunk's own `.catch`
(rocket backdrop, film, SMAA) and reloads after 1.2 s (src/obs/heal.js ~91). On a flaky phone network
that reloads the page; offline it lands on the browser's "no internet" page and the game is gone.
Meanwhile the judges' chunk (`import('./ai/theatre.js')`, src/main.js ~315) has no timeout, so a stalled
fetch breaks invariant 5½, and its failure trips the persisted `judge` breaker. The WASM is re-fetched on
every `loadPhysics()` (sim/engine-web.js ~7). One failed import is reported twice. A throw while main.js
evaluates leaves a title with dead buttons and no heal (heal is installed last).

## What
Reload only when online and a `fetch(BASE_URL, {cache:'no-store'})` shows a different build; optional
chunks `preventDefault` the event and degrade. Race the theatre import against the 35 s deadline; on
failure mark the page stale so the next `toTitle` reloads. Memoise the WASM fetch. De-dupe reports.
Install a tiny boot watchdog early in index.html that offers a reload if the title isn't wired in 15 s.

## Acceptance criteria
- [x] Offline + aborted `rocket-*.js`: no reload, title playable, no unhandled rejection
- [x] A 404 on a lazy chunk after a "new build": exactly one reload, then it works
- [x] Theatre import stalled forever: local judge lines appear by 35 s
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e with `context.setOffline` and `page.route` aborts/stalls; unit test for the reload decision.

## Out of scope
A service worker / offline mode.
