---
id: 0362
title: A wreck the funnel files under "other" says what it was
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-23
pr:
by: scout
---

## Why
`/obs/digest → players` (human, 2026-11-07 → 11-23): 22 wrecks, and `wreck-other` is 7 of them (32 %), 3 of today's 4, the second-largest
bucket and the one that says nothing. `WRECK_OF` in `src/obs/signature.js` folds the coach's first finding into a cause and sends "the
mark, the gas, clean, no coach" to `other`. 0276 split `wreck-brake` into its three fixes and that is now actionable; `other` is
the next blind spot. The focus says to read the funnel and fix the biggest drop on the core loop; 22 of 43 decided runs ending in a
wreck is that drop, and a third of it is unexplained. Wreck Club makes the crash the punchline, so we need to know which crashes players meet.

## What
- `src/obs/signature.js`: `wreckCauses(items)` also counts a second name for an `other` wreck, from data the card already has and
  never from a clock: `wreck-none` (the coach had no finding), `wreck-clean` (the coach's first finding was `clean`: the run was
  judged clean yet crashed, i.e. a contact the coach doesn't model), `wreck-mark` / `wreck-gas` where the coach's finding id names the
  pad mark or the tanks (read the ids in `src/sim/coach.js` and map every one that still falls to `other`), else `wreck-<id>` for a known
  id, so no wreck is left unexplained. `wreck-other` itself stays counted for one release, as `wreck-brake` did (0276).
- Add the names to `WRECK_EVENTS`; the Worker accepts any name in `PLAY_EVENTS` (0276 relies on the same), so no `src/worker/` change.
  If it does need one, drop the counters, say so in the PR and file a `proposal/`.
- AGENTS.md §2 lists the new names.

## Acceptance criteria
- [ ] A wreck whose first finding is `clean` counts `wreck-other` and `wreck-clean`, once each, once per run.
- [ ] A wreck with no coach items counts `wreck-other` and `wreck-none`.
- [ ] Every coach finding id maps to a named cause or its own `wreck-<id>`; a unit test walks the ids in `src/sim/coach.js` so a new finding can't fall back to `other` silently.
- [ ] Existing names (`wreck-brake`, `wreck-short`, …) and `wreckCauses`' current outputs are unchanged.
- [ ] A beacon with every play name at its cap stays under 8 kB.
- [ ] No behaviour change for the player at 390×844 touch or 1280×720 keys.

## Test plan
`tests/unit/obs-run-end.test.js`: the clean and no-coach cases, the id walk, the once-per-run rule; `tests/e2e/obs.spec.js` unchanged and green.

## Out of scope
Changing what the coach says, the Wreck score (0237), or any Worker change.
