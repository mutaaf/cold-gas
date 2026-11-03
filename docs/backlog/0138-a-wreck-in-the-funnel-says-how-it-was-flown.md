---
id: 0138
title: A run's end in the players' funnel says how it was flown, so a real player's wrecks can be traced
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-03
pr:
by: critic
---

## Why
The only real phone player who has got past `run` wrecked the Show on 3 of their 4 finished runs. Our own
phone players never do, and the funnel can't say why.

- **The funnel** (`GET /coldgas/api/obs/digest`, `events["4f5af1b"]`, 2026-11-02): one `sessions:human` on a
  `phone-lo` device (coarse pointer, so touch) counted `run` 6, `run-landed` 1, **`run-wrecked` 3**,
  `run-quit` 1, `retry` 5, `daily-run` 4.
- **They were Show runs.** That day's Daily was `mark-show`, and `daily-run` is counted only for a finished
  run on the Daily's course (`src/comeback.js:200–203`). So all 4 decided runs (1 landed + 3 wrecked) were on
  the Show, and 3 of the 4 were wrecks.
- **Our models say that can't happen on the default phone controls:**
  - `human-phone.mjs 300 --scheme=thumb`: 300/300 land clean at every skill level (critique 2026-11-02 15:40).
  - 32 scripted one-thumb touch patterns on the Show, in Node with `src/onethumb.js`, all land clean. They
    cover a lift mid-climb, a 2–5 s lapse on the curl, early taps at curl progress 0.5–0.9, a tap with no
    hold, lifting in the air at 25–3 m with and without a re-press, mashing the pad every 30–120 ticks, and
    full slides each way. The worst was 65.3 (critique 2026-11-03 04:00).
  - The classic touch scheme on Assist: 144/150 clean (96 %).
- **So it's one of these, and the funnel can't tell which:**
  - Pro or Advanced. On touch that switches to the classic stick and buttons (`src/main.js:1036–1037`).
  - The classic scheme chosen in Controls.
  - Something in the page path that the Node model doesn't have.
- **What the next Scout or Critic run needs:** the funnel says "wrecked", but not how the run was flown or
  what wrecked it. The operator's focus says to read the funnel first and to say which number a PR moves.
  Today the most important number in it, the wreck rate of real phone players, can't be traced to a cause.

## What
- On a Jump run's decided card (`settleRun` in `src/main.js`), also count:
  - **How it was flown:** the controls (`thumb`, `classic`, `keys` or `pad`) and the flight tier (`assist`,
    `pro` or `advanced`).
  - **For a wreck, what wrecked it:** the coach's first finding id (`src/sim/coach.js`). Map it to a short
    fixed list, for example `short` (into the row), `late-brake`/`no-brake` (a hard touchdown), `flipped`,
    `fell-off`, `ran-out` and `other`.
- **Event names:** add them to `PLAY_EVENTS` (`src/obs/signature.js`) as plain names, for example
  `ctl-thumb` and `fly-pro`, plus a wreck event per cause.
  - The Worker already accepts any name on that list (`src/worker/obs.js:38`), so `src/worker/` (frozen) is
    not touched.
- **Limits:** counts only, with no ids, no free text and no per-run rows. Only the run's end is counted,
  once (0130's rule), so the beacon stays ≤ 8 kB.
- **Docs:** the AGENTS.md observability line that lists the events, and a CHANGELOG entry.

## Acceptance criteria
- [ ] A one-thumb Assist Jump run that wrecks counts `run-wrecked` plus `ctl-thumb`, `fly-assist` and exactly
      one wreck-cause event, once per run. A landed run counts its `ctl-*` and `fly-*` and no cause.
- [ ] A Pro run on touch counts `ctl-classic` and `fly-pro`. A keyboard run counts `ctl-keys`.
- [ ] Each wreck-cause event matches the coach's first finding for that run (unit test over a hard landing,
      a run into the row and a run that flips, each flown in Node).
- [ ] `cleanObs` accepts every new name and still drops near-misses (`tests/unit` obs-worker test). No new
      host, and the beacon stays ≤ 8 kB.
- [ ] Automated sessions still count only `sessions:auto`: `navigator.webdriver` stays out of every `play:`
      row.

## Test plan
- **Unit:** `tests/unit/obs*.test.js` covers the new names and the once-per-run rule. A coach-to-cause
  mapping test flies the three wrecks in Node.
- **e2e:** the existing `obs.spec.js` flight (no new boot, per LESSONS 2026-10-31) reads the pagehide beacon
  and asserts the `ctl-*` and `fly-*` pair.

## Out of scope
- Fixing whatever the real player hit. That is the next ticket, once the funnel names it.
- Per-device or per-session breakdowns, and any personal data.
- The Daily start and miss counts (0136).
