---
id: 0049
title: Easy on the battery: no full-screen blends while flying, an idle title that idles, no per-tick garbage
status: shipped
priority: P1
size: M
lens: performance
created: 2026-10-21
pr: 122
by: operator
---

## Why
- `.grain` covers the screen with `mix-blend-mode: overlay` during play (styles.css ~35), a full-screen
  blend at DPR 3 per frame; `backdrop-filter` blurs sit over a canvas that changes every frame (strip,
  cue, stick, buttons, the 24 px results sheet over the replay).
- The title renders the full stage at the display rate (120 Hz on ProMotion): heat for a still screen.
  The shadow map re-renders every frame even when nothing moves.
- Per sim tick (240 Hz): `Object.assign(out, newInput())`, `getGamepads()`, rest-arg helpers, a new
  `pedals` object, `KEYS.map().join()` in run.js: ~4–5k objects/s and regular GC pauses (invariant 6).

## What
Hide grain while live/replaying; solid semi-opaque fills instead of blur while live; render the idle
title at ~30 fps; shadow `autoUpdate` only when something moved; reset input objects in place, read pads
once per frame, compare packed inputs in place. Run `npm run determinism` (no outcome change, no bump).

## Acceptance criteria
- [x] `node --expose-gc` bench: zero allocations per tick in input/hands/run hot path (`npm run alloc:bench`; with a
      gamepad, one or two boxed numbers a tick remain: see Shipped)
- [x] `ref-hash.mjs` fingerprints unchanged
- [x] Title frames/s ≤ 31 when idle; live unaffected
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
An allocation bench script like `scripts/obs-bench.mjs`; ref-hash before/after; e2e counting rAF renders on the title.

## Out of scope
Changing sim behaviour.

## Shipped
- Per tick (240 Hz): inputs are reset in place (`clearInput`, src/sim/vehicle.js), not `Object.assign(out, newInput())`;
  `hands.pedals` answers in a reused object; the hands' and the driving level's per-tick doubles live on objects (a
  double written to a closure variable is a new heap number on every write); no rest-arg key helper; `Math.hypot`
  (boxes its answer) → `Math.sqrt`; `padValves` without per-call closures or iterators. The gamepads are read once a
  frame (`pollPads`) and copied into reused objects of the same shape, which every tick of the frame samples.
- The input log (src/sim/run.js `logInput`): quantised channel by channel into a reused Int16Array and compared in
  place with the last logged one; an entry is made only on a change, as before. Bit-identical to the old
  `KEYS.map(...).join(',')` (tests/unit/input-log.test.js); ref-hash identical (Show fedae05c, Wall bacb4720, Lineup
  8b2c2c9a). The Worker's replay path (`quantise`, unpack) is the same code, unchanged in outcome; no SIM_VERSION bump.
- `npm run alloc:bench` (V8's sampling heap profiler, collected objects included): main allocated 750–1430 B a tick
  through `sample()` (500 B a tick for `hands.keyboard`), plus the log's array and string. Now 0 B with keys and touch,
  one-thumb and the hands; with a gamepad V8 still boxes about one number a tick in the air (16 B), budgeted at two.
  Not chased further: it moves with the JIT's state. Advanced writes its ten valves by name (a computed-key store
  boxes). Pads at any index are copied (the copies grow with getGamepads()'s length).
- One deliberate difference in the live input: a tiny negative that rounds to −0 now reaches the sim as +0, as it
  always did in a replay (`unpack`), so a live run and its replay agree. ref-hash unchanged.
- Not in this pass: `vehicle.js` reads the ten valves by computed key in Advanced (the sim's step, not the input path).
- The title draws at ≈30 fps (src/pace.js: a deadline a whole period on, so 60/90/120/144/165/240 Hz all draw ≤ 30);
  a skipped frame only keeps the cue clock, and the drawn frame is timed from it (the display's interval), so
  the governor doesn't read the pacing as hitching; a costly title still can't read as headroom, since a step up
  needs the frames' work under 8 ms. (Keeping the title from the governor doubled CI's e2e time: on software GL
  the title is where it used to step the resolution down.) Live, countdown, results, replay and Free Drive are
  not paced.
- The shadow map (mid/high) is drawn on the title only when the hero moves, the mode, course or look changes, the
  context comes back, or 30 title frames pass, and on every frame for the first 60 title frames (the wing and the
  skirts ease home after a run); every other mode draws it every frame as before.
- CSS: the grain (an overlay blend over the whole screen) shows on the title only. During the countdown, a run, the
  results and the replay no element blurs the canvas behind it (`backdrop-filter: none`); the glass is a step
  denser instead (`--glass` 0.58 → 0.70; the strip and the one-thumb pad 0.62 → 0.72, the touch HUD handle
  tab 0.62 → 0.76, the compact descent and clock tabs 0.62 → 0.84 (unblurred at 0.62 the audit read the timeline's
  red crash label at 3.83–3.89:1 over the wreck at 814×380 and 844×390); the stick 0.36 → 0.46, idle touch buttons 0.46 → 0.56; pressed buttons keep
  their own fill). tests/e2e/battery.spec.js. Free Drive and the Sandbox keep their blur: their panels (0.5–0.62
  glass) weren't measured without it, a follow-up for 0052's pass.
