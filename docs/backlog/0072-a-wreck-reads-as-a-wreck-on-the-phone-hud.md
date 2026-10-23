---
id: 0072
title: On a phone a wreck reads as a wreck; the compact HUD never says TOUCHDOWN over a car on its roof
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr:
by: critic
---

## Why
0061 (#79) folded the vehicle panel away on phones, and the damage sensor went with it. A phone player
who crashes now gets no sign of it until the results sheet. Measured on production (da53d64,
2026-10-22 22:00, docs/critique/2026-10-22-2200.md). The Show reference was flown with every input
zeroed 0.125 s after the release, and the run ended `flipped`, 30.3 "Wrecked":

- **390×844 (compact, the phone default)** (`phone-C-7-touchdown.jpg`): the car lies on its roof in
  sparks. The rail reads `07 TOUCHDOWN · SPD 1 mph · ALT 1.1 ft · G 1.2 g · N₂ 504 lb` in white.
  Nothing on screen says the car is damaged.
- **1440×900 (full)** (`desk-C-7-touchdown.jpg`): the same moment shows DAMAGE **66 % WRECKED** in
  signal red, the car outline lit red, and ROLL 180°.

The compact rail is the only HUD a phone player sees, so a wreck on a phone reads as a clean
touchdown. AGENTS.md's craft rule is "colour means state". The one state that matters most after a
crash is the one the compact HUD drops. The timeline compounds it: it marks `07 TOUCHDOWN` as the
current step whether the wheels or the roof hit the ground. The BRAKE half of that timeline defect is
0065's.

## What
- `index.html`, `src/ui.js`, `src/styles.css`: in compact mode (`:root[data-hud=compact]`, both
  orientations), when damage leaves `ok` (`[data-dmg]`'s `data-state`), the rail carries one damage
  cell. It shows the percentage plus the state word (e.g. `DMG 66 % WRECKED`) in the same colours the
  full panel uses. It may replace a cell that means nothing on a wreck (N₂ after the run ends, say). The
  rail must not grow past 0061's 12 % screen budget.
- `src/ui.js` timeline: once the run ends in a crash (`flipped`, `contact`, any end the judge scores as
  wrecked), the current step reads as the crash, not as `07 TOUCHDOWN` (e.g. that step goes signal red
  with the end reason as its label). That applies in both HUD modes.
- No sim change.

## Acceptance criteria
- [x] e2e at 390×844 and 844×390 (touch, compact): fly the Show reference with every input zeroed from
      the release + 0.125 s. After the end, a visible element in the compact HUD has the text `WRECKED`
      (or the damage state the full panel shows) and the same damage % as `[data-dmg]`, in the full
      panel's red. (`tests/e2e/wreck-hud.spec.js`: `WRECKED 66 %` in G's place, rgb(255, 90, 98) like
      the panel's number and word; the line covers 8 % of the screen at the wreck.)
- [x] Same run, both HUD modes: no timeline step whose label contains `TOUCHDOWN` carries
      `data-state="now"` once the run ended in a crash. A clean reference landing still ends on
      `07 TOUCHDOWN`. (The step reads `07 FLIPPED` in signal red at 390×844, 844×390 and 1440×900; the
      reference ends on `07 TOUCHDOWN` at 390×844 and 1280×720; `crashStep` in src/ui.js, unit-tested.)
- [x] The compact HUD still covers ≤ 12 % of the screen and the car's centre is under it in 0 frames
      (`tests/e2e/hud-collapse.spec.js` stays green).
- [x] `node scripts/hud-audit.mjs`: 0 overlaps, 0 text < 11 px, 0 labels < 4.5:1 at every viewport,
      including a wrecked end state. (The audit now flies the wreck as `9-wreck`, compact and full.)
- [x] Screenshots of the wreck at 390×844 and 844×390 in the PR (checked by eye; described there:
      `gh` can't attach images).

## Test plan
Extend `tests/e2e/aftermath.spec.js` (0062's crash), or add a spec, using the zeroed-input crash at both
phone sizes. Wait for `physicsReady()` (it is a function, docs/LESSONS.md), then call `startRun` and
`skipCountdown()`. Read the DOM after `S.run.phase` leaves `air`.

## Out of scope
BRAKE showing during a fall with the valves shut (0065). The damage map's full view, the results
sheet.
