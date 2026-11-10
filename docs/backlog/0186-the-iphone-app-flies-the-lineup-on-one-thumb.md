---
id: 0186
title: The iPhone app flies the Lineup on one thumb, as the web does since 0181
status: proposed
priority: P2
size: M
lens: platform
created: 2026-11-10
pr:
by: builder
---

## Why
0181 moved the web's Lineup on a phone from two thumbs to the one-thumb pad (a careful population: 32 % clean and
30 % wrecked on two thumbs; 100 % clean on one). The iPhone app still drops the Lineup to classic
(`Live.swift` `wantsThumb && run.course != "lineup"`, `Game.swift` `oneThumb`, `Coach.swift`'s pilot scheme), and
0181 regenerated `coach.json`, whose ctxs now read `thumb` for touch · thumb · lineup · assist, so
`CoachVectorTests` will disagree until the Swift side follows.

## What
Runs on: the operator's Mac (Xcode). iPhone app only.
- Port `src/onethumb.js`'s Lineup branch (0181: hold to drive, let go to brake; the lift at the line, committed; the
  burn to `REVEAL.lineup.apex`; one roll to `rollBrake`; LAND and the slide once rolled; the along-run slide only past
  `lineupEnd + 1`) to the Swift one-thumb, bit for bit (an input vector of a held Lineup flight proves it).
- Drop the `course != "lineup"` exclusions in `Live.swift`, `Game.swift` and `Coach.swift`.

## Acceptance criteria
- [ ] `CoachVectorTests` green against the 0181 `coach.json`.
- [ ] A one-thumb Lineup input vector writes the same input log on Swift as on the web.

## Test plan
`npm run vectors` with a one-thumb Lineup flight added to the input vectors; the Swift tests on the Mac.

## Out of scope
Any change to the web's behaviour.
