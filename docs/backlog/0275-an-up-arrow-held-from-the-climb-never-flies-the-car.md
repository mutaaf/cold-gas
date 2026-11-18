---
id: 0275
title: An ↑ held from the climb never noses the car down in the air or drives it off the mark
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-18
pr:
by: critic
---

## Why
The keyboard guide tells a newcomer "Hold ↑ to go", then "Keep holding ↑", then "Space to let go"
(src/guide.js:23). Nothing ever tells them to let go of ↑. In the air the same key means **nose down**
(src/input.js:345, `out.pitch = -ay` at :402), and after touchdown it is the throttle again. A player who does
exactly what the cue line said is flying the car into the row.

Measured in the sim with Assist (`docs/critique/2026-11-18-0400/keysnew-probe.mjs.txt`). There are 36 key
newcomers per row: ↑ floored up the climb, Space at 0.90/0.95/1.00 of the curl, F for 0/0.3/0.6 s, and Shift
at 0.5/1.5/2.5 s or never (auto-land):

| course | ↑ let go at the release | ↑ held in the air | ↑ held in the air and after touchdown |
|---|---|---|---|
| Show | **36/36** | 27/36 (9 short) | **20/36** (16 short) |
| Wall | **36/36** | 36/36 | **23/36** (9 off the mark, 4 tilt) |

That makes it the only plausible keyboard habit that costs landings: ↓ held, Shift tapped and RT held on a pad
all land at baseline in the same sweep. The gates (`naive-players` 32/32, `naive-show` 54/54, `human-show`
286/300) all model a player who lets go of ↑, so none of them sees this.

Meanwhile production's first real players (funnel 2026-11-18: 11 human sessions, **every decided run on keys
(7) or a pad (6)**, all Assist) landed **4 of 13** decided runs, and 7 of 20 runs were quit before the card.

The real car's pilot doesn't have one stick that means "accelerate" on the ground and "pitch down" in the
air. A carried-over press is a control the player never chose.

## What
- `src/input.js`: a key held across the ground→air change (the release, or the Show's lip) does not fly until
  it has been let go once. Do the same for the air→ground change (the touchdown): ↑/W held from the air is not
  throttle on the roll-out until it is released and pressed again. Copy the pad's `padHeld` pattern, which
  already does this for a reset (src/input.js:222, :240). ↓/S follows the same rule.
- The guide: once the car is off the curl on keys, the `roll` step's words also say to let go (for example
  "Let go · let it roll"). That is ≤ 5 words, src/guide.js `WORDS.key.roll`. The pad's RT is LIFT in the air,
  which my sweep found harmless, so leave it.
- No sim or scorer change. The input arms on a fresh press, so `SIM_VERSION` is unchanged and the reference
  hashes (`node scripts/ref-hash.mjs`) stay bit-identical.

## Acceptance criteria
- [x] A Node sweep of the "key newcomer" population above (Show and Wall, held ↑ through air and touchdown, fed
      through the same input mapping as the browser) lands **≥ 34/36 on each course**. Today it's 20/36 and 23/36.
- [x] A ↑ pressed fresh in the air still pitches the nose down, and ↑ pressed fresh after touchdown is still
      throttle (an e2e on keys at 1280×720: hold ↑ through the release, assert pitch input 0 until keyup + keydown).
- [x] `naive-players` 32/32, `naive-show` 54/54, `human-show 300 assist --cues=new` ≥ 95 %. `ref-hash` is unchanged.
- [x] Touch at 390×844 is unaffected (the thumb's hold is its own control).
- [x] The PR names the funnel number it should move: `run-landed / (run-landed + run-wrecked)` on keys, 4/13 on 2026-11-18.

## Test plan
- Unit: `tests/unit/input-*.test.js`. A key held across `air` false→true gives pitch 0 until released, and the
  same for air→ground throttle.
- Add the key-newcomer population to `scripts/human-show.mjs` (or a new `--keys-literal` mode) so the gate models
  the player the guide actually creates.
- e2e at 1280×720 keys, as above.

## Out of scope
The two-thumb touch scheme, Pro and Advanced (who chose their keys), and new cue copy beyond the roll step.

## Shipped
- `src/input.js`: on an Assist scored run, ↑/W and ↓/S held across the ground → air change (the release, the Show's lip)
  or the air → ground change (the touchdown) are *carried*: they do nothing on the new side until a keyup and a fresh
  keydown. A run's first sample sets the side without carrying (a drill that opens in the air). Pro, Advanced, the pad,
  touch and Free Drive (`ctx.free`) are untouched. The key handlers' effect is now `keyDown` / `keyUp`, exported so a
  Node sweep goes through the browser's own mapping.
- `src/guide.js`: the keys' roll step says "Release ↑, let it roll" (5 words).
- `scripts/keys-literal.mjs`: the critic's 36 key newcomers per course, but through `sample()` and the live step's wall
  assist instead of raw sim inputs. ↑ held to the end: **Show 8/36 → 36/36, Wall 15/36 → 36/36** (through the real
  hands the baseline is worse than the critic's raw-input 20/36 and 23/36). Let go at the release: 36/36 both, before
  and after. `tests/unit/input-carry.test.js` gates ≥ 34/36 on each course.
- e2e `tests/e2e/keys-carry.spec.js` at 1280×720 on keys: ↑ held through the release logs pitch 0 (100 without the
  change), a fresh ↑ in the air pitches.
- Gates unchanged: naive-players 32/32, naive-show 54/54, human-show 300 assist --cues=new 286/300, ref-hash identical
  (show 6b2cb98b, wall f1b9fab, lineup 4fc4af6b). No `SIM_VERSION` bump.
- Funnel number it should move: keys `run-landed / (run-landed + run-wrecked)`, 4/13 on 2026-11-18.
