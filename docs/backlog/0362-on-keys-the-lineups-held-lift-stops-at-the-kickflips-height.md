---
id: 0362
title: On keys and a pad, the Lineup's held LIFT stops at the kickflip's height, so "Space at the line" can't fly the car to 45 m
status: shipped
priority: P0
size: M
lens: player-feel
created: 2026-11-23
pr: 507
by: critic
---

## Why
The reveal's kickflip peaked at about **7–8 m**, with touchdown about **t0 + 3 s** after lift-off
(docs/REVEAL_RESEARCH.md §2.2 "Height" and "Timeline"; row 46: 7.5 m, range 7–9, REPORTED). On the Lineup a
keyboard player with Assist is told "Space at the line" (`src/guide.js:25`) or "Hold LIFT (Space) at the line"
(`src/main.js:1527`). Nothing tells them when to let go. While Space is held, the four down-jets push at full
regulated thrust. The car climbs at ≈ 22 m/s² net and keeps climbing for as long as the key is down.

The critic measured this in the sim (`docs/critique/2026-11-23-2136/lineup-lift-sweep.mjs.txt` → `lineup-lift-sweep.txt`).
The setup: Assist, a 7.5 m/s run-up (the reveal's), Space from z −4, ← for 0.8 s, then Shift to the ground.

| Space held | apex | N₂ left at touchdown (of 297 kg) | sink | verdict |
|---|---|---|---|---|
| 0.3 s | 5.3 m | 203 kg | — | Wrecked 32.3 (hits the row) |
| **0.4 s** | **8.3 m** | 140 kg | 0.8 | **Stuck it 89.0** |
| 0.5 s | 12.3 m | 125 kg | 0.8 | Stuck it 87.7 |
| 0.7 s | 23.3 m | 62 kg | 2.3 | Clean 75.3 |
| 0.8 s | 30.0 m | 41 kg | 8.1 | Survived 54.0 |
| **1.0 s** | **45.0 m** | 27 kg | **17.1** | **Wrecked 33.7** |
| 2.0 s | 112.4 m | 13 kg | 39.5 | Wrecked 33.3 |

- **The window is 0.4–0.7 s of a key the cue says to hold.**
  - One second of "hold" flies the car **6× the reveal's height** and spends 43 % of the tank going up.
  - LAND then has too little nitrogen left to stop the fall, so the car hits the ground at 17 m/s.
  - The real car's lift was a short burn to ≈ 7 m (§2.2), and the one-thumb Lineup already flies exactly that. It runs
    the reference's burn (`src/onethumb.js:248`, `lineupPilot` in `src/sim/autopilot.js:148`: lift until the projected
    apex reaches `REVEAL.lineup.apex`).
  - On keys and a pad, Assist gives the player none of that.
- **On production (`057f041`, the build players have), 11-23's funnel** (`/coldgas/api/obs/digest` → players, `human`):
  - **3 of 5 Lineup runs wrecked** (`wrecked-lineup` 3, `on-lineup` 5). The Show wrecked 1 of 3 and the Wall 0 of 3.
  - Every control that day was keys (`ctl-keys` 11, `fly-assist` 11).
  - The wrecks are `wreck-other` 3, so the coach couldn't even name the cause.
- **Confirmed on the production page** (`docs/critique/2026-11-23-2136/lineup-keys-prod.mjs.txt`). Setup: 1440×900,
  KeyboardEvents to the page's own listeners, the live step at 1/60 s, a 7.9 m/s run-up.
  - **Space held 1.0 s:** the apex is **39.9 m**, the car touches down at **15.9 m/s** 36.5 m past the mark with 10 %
    gas, and the verdict is **Wrecked 33.7** (`lineup-keys-hold1.0-results.png`).
  - **Space held 0.4 s:** the apex is 7.3 m, the sink 0.8 and the verdict **Clean 83.7** (`lineup-keys-hold0.4-results.png`).
- **The coach then teaches the wrong lesson.** The 1.0 s sheet's Next run says "Stay on the brake to the ground: keep
  holding Shift". The player held Shift from the end of the roll to the ground. What happened says "Boost less and brake
  once", but the player never touched BOOST. Nothing names the held Space, which is the one thing they did wrong.

Players: operator focus (1), the core loop (the first run on an event, the score right after landing). Number it should
move: `wrecked-lineup / on-lineup` (3/5 on 11-23) toward the Show's and the Wall's rate.

## What
In Assist (not Pro), on the Lineup, LIFT held from the ground is a **lift-off command**, not a throttle. The down-jets
burn until the projected apex (`pos.y + vy²/2g`) reaches the kickflip's height (the reference's
`REVEAL.lineup.apex`, `src/sim/autopilot.js:23`), then stop by themselves, whether or not the key is still down.
A LIFT pressed again after the burn, in the air, stays what it is today.
- `src/sim/vehicle.js` (the Assist layer beside `landCap`/`carryUp`), or `src/sim/run.js` for the Lineup's flat-ground
  lift-off. Same code for keys, a pad and the page's touch buttons. One thumb already flies the reference and is unchanged.
- The cue/guide may then say "Space at the line" and mean it. If the hold is now safe, the words needn't change.
- This is a sim change. Bump the run version (`run.js` header) so old Lineup replays replay as flown. Regenerate the
  native vectors (`npm run vectors`). Explain any ref-hash change. The Lineup reference itself should not change,
  since it already stops at that apex.

## Acceptance criteria
- [ ] Sim, Assist, Lineup, 7.5 m/s run-up, Space held from z −4 for 0.4, 0.6, 1.0, 1.5 and 3.0 s, then ← 0.8 s, then
      Shift: the apex is within **7–9 m** in every case (§2.2, row 46), and every run lands upright with sink ≤ 2 m/s and
      a verdict that isn't Wrecked. Today: 1.0 s → 45 m, sink 17.1, Wrecked.
- [ ] A new naive gate for the Lineup (like `scripts/naive-players.mjs` for the Wall). It covers a run-up of 6, 7.5 and
      9 m/s (§2.2: 7–9 m/s), a Space press at z −6…+1, holds of 0.3–3 s, a roll of 0, 0.8 or 1.4 s, then Shift. It lands
      **≥ 90 %** upright and unwrecked, and runs in `npm test` or `check:fast`. Today the 7.5 m/s grid ends 48 of 60
      upright (`naive-lineup.txt`), but 36 of those 48 are scored Wrecked (sink 10–45 m/s). Only 12 of 60 land unwrecked.
- [ ] In Pro, where a held LIFT still overshoots, a Lineup run that peaks > 12 m on a lift-off burn gets a coach finding
      that names the held lift ("let go of Space sooner…"). No sheet tells a player who held LAND to the ground to "keep
      holding Shift", and none tells a player who never boosted to "boost less" (a `coach.js` unit test).
- [ ] Pro is unchanged: a held LIFT in Pro still flies as today (a unit test pins one Pro hold of 1.0 s ≥ 30 m).
- [ ] The Lineup reference (`ref-lineup`) score is unchanged or explained. `naive-players` stays 32/32, and `naive-show`
      54/54.
- [ ] Works at 390×844 touch (the page's touch buttons, not one thumb) and 1440×900 keys.

## Test plan
Add a unit test that drives `createRun('lineup')` with `assist: 1` through the hold grid above and asserts the apex band
and the landing. Add `scripts/naive-lineup.mjs` (start from `docs/critique/2026-11-23-2136/naive-lineup.mjs.txt`) and its
gate. Run the vectors and ref-hash.

## Out of scope
- The run-up speed (0363).
- One thumb's Lineup (0181, already the reference's burn).
- Pro's manual lift.
- The thrust model's blowdown (§5).

## Builder note 2026-11-24 (#507)
Shipped: the lift-off burn (`src/sim/vehicle.js` `liftOffBurn`, LIFTOFF_VERSION 35; 34 went to 0360). A held second peaks at ≈ 8.6 m and
sticks it (was 45 m, Wrecked); a 0.3 s tap clears the row; Pro, the reference, the Show and the Wall are unchanged.
**Not met:** the naive grid lands 190/225 (84 %, was 70) against ≥ 90 %: the rest hold Space 1.5–3 s and roll at or
after the apex over the semi (0359's limit); holds of 0.5–0.6 s peak at 9.6–9.8 m (the roll that follows adds lift);
the coach findings (Pro > 12 m names the held lift; no "keep holding Shift" / "boost less" to a player who did neither)
are not built. The criteria are left unticked for the Critic to re-scope.
