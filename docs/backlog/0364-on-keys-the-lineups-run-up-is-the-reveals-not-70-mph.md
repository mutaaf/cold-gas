---
id: 0364
title: On keys the Lineup's run-up comes in at the reveal's 16–20 mph, not 70 mph, and the LIFT cue arrives in time
status: ready
priority: P1
size: S
lens: authenticity
created: 2026-11-23
pr:
by: critic
---

## Why
The reveal's kickflip "drove at normal speed toward a lineup": about **7–9 m/s (16–20 mph)** at lift-off, off flat ground
(`docs/REVEAL_RESEARCH.md` §2.2, ESTIMATE from frame scaling). On keys with Assist, the Lineup says only "Hold ↑ to drive"
(`src/main.js:1491`, shown while v < 2 m/s), so a keyboard player holds ↑. There's no word about speed, unlike the Show's
"crawl in, about 20 km/h" (`main.js:1494`).

**On production** (`057f041`, 1440×900, `docs/critique/2026-11-23-1630/lineup-keys-floor.json.txt`):
- The car is at **30 m/s (67 mph)** when "Hold Space at the line" appears, at z −13.1. The HUD reads **70 mph** at the press,
  0.26 s later (`desk-lineup-keys-floor-70mph-at-the-line.png`).
- From the cue to the row (z 7) is **0.67 s** at that speed. A person's reaction uses 0.26 s of it.
- Result: **No jump, 4.0, crashed**.

**The same player at the reveal's 16 mph** (8.2 m/s; `lineup-keys-16mph-350ms.json.txt`) scores **Stuck it, 84.3**. At that
speed the cue gives them 2.5 s.

**The population model** (`flyKeysLineup`, 200 players, `lineup-coach.out.txt`): those who hold ↑ to the line land **0 of
26**. Every capped speed from 6 to 8.5 m/s lands 48–80 %.
- The model's floored player lets go at the line (17.5 m/s), so the page's 32 m/s is worse than the model.
- The model draws "floored" for only 1 in 7 keys players. On a screen that never mentions speed, a keyboard player holds the
  key, so the real share is likely higher.

The funnel agrees (`/obs/digest`, human, 2026-11-23): 5 sessions, all `ctl-keys`, 5 runs `on-lineup`, **3 `wrecked-lineup`**.
A 0.67 s 0–60 car will always outrun a cue placed for 8 m/s. Either the cue says the speed, or Assist holds it, as Assist
already holds the Show's crawl on the curl.

Players: focus (1), the core loop and skill that shows in the score. **Number it moves:** `landed-lineup` / `on-lineup` for
`ctl-keys`.

## What
Pick the smallest change that meets the criteria; the builder decides. Two options:
- **Assist holds the run-up.** On the Lineup with Assist, ↑ drives the car up to the reveal's run-up speed (≈ 8 m/s) and
  holds it there, the way Assist holds a crawl on suction on the Show's curl (`src/sim/vehicle.js` / the Lineup's
  `sample()` path in `src/main.js`). Pro and Advanced keep full throttle: their run-up is theirs.
- **The cue says the speed.** On the Lineup's run-up (keys and classic touch, not one thumb), the cue reads "Run in at about
  `<units>` · `<Space>` at the line" (units from the HUD's mph/km/h). Then "Hold Space at the line" appears when the line is at
  least 1.0 s ahead at the car's current speed, not at a fixed z −14.

Either way, the "Hold LIFT at the line" cue must never come with less than one reaction time plus 0.4 s to the line.
Sim/vector impact: if Assist's input sample changes, run `npm run vectors` and the ref-hash in the same PR. The Lineup
reference's own run-up must stay as it is.

## Acceptance criteria
- [ ] On production at 1440×900, holding ↑ from Go with Assist on the Lineup (`docs/critique/2026-11-23-1630/lineup-keys.mjs.txt
      <out> floor floor 500`) launches at **≤ 9.5 m/s** and lands. Or, if the cue path is taken, the cue shows the speed to
      run in at, and a player who follows it (the `16 500` / `16 350` runs) lands.
- [ ] The cue "Hold LIFT at the line" appears ≥ 1.0 s before the car reaches the line, at any run-up speed the car can reach.
- [ ] `flyKeysLineup` lands **≥ 85 %** of 200 players (seed 777); today it's 113/200 = 56.5 %. Hold the line in
      `tests/unit/daily-reach.test.js` or a new test. The 0218 keys Daily stays meetable.
- [ ] The one-thumb Lineup stays at 200/200 (`flyThumbLineup`). The Lineup Pro reference is unchanged (`npm run ref-hash`,
      lineup 3444 · 91.7 · `4fc4af6b`) unless the vectors are regenerated in the same PR with a reason.
- [ ] 32/32 naive Wall, 54/54 naive Show unchanged. `npm test` green.

## Test plan
- Unit: Assist's Lineup run-up with ↑ held from Go stays ≤ 9.5 m/s at the line. Or, for the cue path, the cue's lead time
  at 6, 8, 15 and 32 m/s is ≥ 1.0 s.
- Unit: the population floor on `flyKeysLineup`.
- e2e (keys, 1280×720): ↑ held to the line, Space on the cue, lands.

## Out of scope
- The coach's words on a Lineup wreck (0363).
- How long LIFT must be held. 0.35 s vs 0.40 s is the edge between Contact 34 and Stuck it 88 at 6–8 m/s in
  `lineup-keys-sim-grid.out.txt`. That's worth a look after this lands, when the run-up is no longer the bigger cliff.
- One-thumb and Pro.
