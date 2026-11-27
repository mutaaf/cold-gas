---
id: 0374
title: A careful thumb held from the tap can slide the Show's touchdown onto the 2 m bullseye, not 2.1 m past it
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-27
pr:
by: critic
---

## Why
Since 0360, the card pays full Precision only inside the pad's 2 m bullseye. One-thumb players reach the Show's
touchdown in two ways, both legal and both taught by the pad. Only one of them can reach that ring.

- **The pad teaches holding from the tap.** On production the pad reads "Tap · Let go", then "Hold · Land" 0.3 s after
  the tap, then "Hold · Aim" (`docs/critique/2026-11-27-0430/phone-first.log.txt`, run 1). A thumb that stays down from
  the tap does exactly what it is told.
- **The population.** `node scripts/human-phone.mjs 300 --scheme=thumb --skill=careful` was run on main `9d11f53`, which
  is what production serves. The thumb follows the sight's dot, reads it every few frames, and reacts a human's lag
  late. The output is `docs/critique/2026-11-27-0430/ring-probe.summary.txt`, and the probe's diff is
  `ring-probe.patch.txt`.

  | What the thumb did | n | median miss | outside 2.05 m | along the run (− = past the mark) | sideways |
  |---|---|---|---|---|---|
  | held from the tap, slid | 78 | **2.1 m** | **52** | **−1.64 to −2.19 m** | 0.08 m |
  | lifted, pressed again, slid | 222 | 1.2 m | **0** | −0.23 to −1.69 m | 0.37 m |

  The split is clean. Every careful run outside the ring is a thumb held from the tap, and every one of those lands
  long. Sideways, the held thumb is the more accurate of the two.
- **The along-the-run slide never engages on most held thumbs.** At the last sight read with the car ≥ 2.5 m up,
  the slide's along-run command (`thumb.aim.y`) is 0 on **57 of 78** held runs. Those 57 land 1.78–2.19 m long. It is
  non-zero on 204 of 222 pressed-again runs.
- **Probable cause, for the builder to confirm.** `src/onethumb.js:348` marks the brake as having "turned the fall"
  only once the sink has peaked above 4 m/s (`st.pk > 4`). `canA`, the gate on the along-run slide and on the sight's
  along-run dot (`:351`), waits for that. A thumb held from the tap is braking from the release, so its sink may never
  reach 4 m/s. Then `canA` stays shut, and the sight draws no along-run offset (`markOffset` sets `y = 0` when `!canA`,
  `:475`). The sight is telling the player "nothing to fix along the run" while the car lands 2 m long.
- **What it costs.** The card marks those 52 down to Precision 9.0–9.9. The coach (0371) now tells them "Land inside the
  2 m ring for full marks: this one was 2.2 m from the mark". But nothing the thumb can do with the sight it is shown
  reaches the ring. The words name a target the controls can't reach.

**The bar.** The reveal car hovered under 3 m for 1–1.5 s before it settled (`docs/REVEAL_RESEARCH.md` §2.1.4, REPORTED),
and that hover is when the touchdown is placed. The game's own bar is 0360's: skill shows in the score. A careful thumb
that follows the sight lands inside the ring whichever way the pad let it hold. Today the pressed-again style does
(0 of 222 outside) and the held style can't (52 of 78 outside).

**Number it moves:** the one-thumb Show's Precision and `landed-show` score. The focus's item (1) asks for skill that
shows in the score on a phone, and one thumb is the phone's default scheme.

## What
- `src/onethumb.js`: open the along-run slide (`canA`) on the Show for a thumb held from the tap. Its brake turns the
  fall without a 4 m/s sink peak, so `braked` needs a test that a held, early brake also passes. One example is the sink
  falling 0.5 m/s below its peak once the car is past the row's tallest roof. The builder picks the rule, the test and
  the numbers, and says why in the PR.
- The sight (`src/thumb-aim.js`, `markOffset`) follows the same `canA`, so the dot shows the along-run miss whenever the
  slide can act on it.
- Keep 0165's guard: no along-run slide over the roofs.
- Mirror it in Swift (`docs/NATIVE.md`) and regenerate the vectors if any card changes.

## Acceptance criteria
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=careful`, the "held from the tap" group: **≤ 8 of 78** land outside
      2.05 m (today 52), and the median miss is ≤ 1.5 m (today 2.1 m). Record the same split with the probe in
      `docs/critique/2026-11-27-0430/ring-probe.patch.txt`.
- [ ] The "lifted, pressed again" group doesn't regress: 0 of 222 outside 2.05 m, median ≤ 1.2 m, 300/300 clean.
- [ ] `--skill=sloppy` still lands 300/300, and its median clean score doesn't rise above today's 89.3, so care is
      still worth more than slop.
- [ ] `--skill=none` (never slides) is unchanged: 300/300 clean, median 87.3 ± 0.3.
- [ ] Phone 390×844: a held-from-tap thumb that follows the dot lands inside the ring. Screenshot the sight mid-descent
      showing an along-run offset, and the sheet showing Precision 10.
- [ ] Gates: `naive-players` 32/32, `naive-show` 54/54, `npm test` green. `ref-hash` stays bit-identical (show
      `6b2cb98b`, wall `f1b9fab`, lineup `4fc4af6b`), because the reference flights aren't one-thumb. The Wall and the
      Lineup thumb populations are unchanged.

## Test plan
- Extend `tests/unit/thumb-mastery.test.js`: fly the careful held-from-tap thumb (or a seeded subset of it) on the Show,
  and assert that `canA` opens before 2.5 m and that the touchdown lands inside `SHOW_MARK_RING`.
- Put the population numbers, before and after, in the PR body.

## Out of scope
- The scorer's curve and the ring size (0360, shipped).
- The coach's words (0371, shipped).
- The Wall's tapped thumb (0180).
