---
id: 0220
title: Roam, on the iPhone, drives round the Show's, the Wall's and the Lineup's sets and on into Free Drive's world
status: in-progress
priority: P1
size: M
lens: engagement
created: 2026-11-12
by: operator
---

## Why
The owner, 2026-11-12: "we need to ensure free drive works within the game play so i can go drive around the stunt
modes". Free Drive (0215) stood only on the Show's set and started facing away from it. You couldn't go and look at the
Lineup's row, or step off a card and drive the course you'd just flown.

## What
Runs on: the operator's Mac (Xcode).
- Three roam courses: `drive` (the Show's set, which has the Wall's curl too), `drive-wall` and `drive-lineup`. Each puts
  that course's set at the world's centre: its parked row as the same mass-correct bodies, its pad, its fixtures (the
  Lineup's poles) and its launch complex. Free Drive's streamed world goes on round it in every direction (`stageOf`,
  `driveCourse(on:)`, `isDrive`). None of them is in `COURSES`, so nothing that looks a course up by id can score one.
- The car starts on the course's own mark, facing down its run. The jets fly as they do in Free Drive (LIFT/LAND), and the
  tanks refill on the ground, since nothing is scored. The Wall's suction is the run's own fan (the fan switch), and the curl is
  solid.
- Ways in: **Roam** beside Fly on the title, for the chosen course (Free Drive moves to a globe button), and **Roam** on
  the results sheet. `-roam <course>` opens one directly (shots).
- The way out: **Fly <course>** on the roam's HUD goes straight into a scored run from the mark, and Back goes to the
  title.

## Acceptance criteria
- [ ] `make test` green, with the 52 run vectors bit-exact. New FreeDriveTests: each roam stands on its set and is never
      a course; the Lineup's set is solid and comes back after a rebase; a roamer's car shoves the parked row; the
      Wall's roam has the curl.
- [ ] Simulator shots of roaming the Show, the Wall and the Lineup, in docs/shots/0220/.

## Test plan
`cd ios && make test && make rules`, then `-roam show|wall|lineup` on the simulator.

## Out of scope
A kicker. No course in the port has one (the Lineup's reveal used none).
