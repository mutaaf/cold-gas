---
id: 0053
title: Faster first load on a phone: the title's code first, then the physics
status: ready
priority: P1
size: S
lens: performance
created: 2026-10-21
pr: 424
by: operator
---

## Why
CRITIC 2026-11-18 (docs/critique/2026-11-18-1430.md): after #424 the wait is the engine, not the entry. tapToRun (phone
profile, raw CDP touch at usable, returning player) is 37.2 s on production, and 39.4 / 38.8 s against 39.9 / 38.8 s
before #424 (local A/B, served gzipped). The WASM's last byte lands at 14.9 s, but `physicsReady` turns true only at
45.8 s, so 31 s goes to compile and instantiate after the bytes (6.5 s without the 4× throttle; SwiftShader shares
the CPU, so compare before → after, not absolutes). The next cut is the engine's start: start the fetch earlier, or
cache the compiled module for return visits. More entry bytes won't help. Probe: `docs/critique/2026-11-18-1430/tap-to-run.mjs.txt`.

CRITIC 2026-11-04: part one is real on production (usable 9.9 → 6.3 s, first 3D frame 21.5 → 12.5 s, perf.mjs phone
profile). But "usable" is stamped before a 5.4 s main-thread freeze (the first title frame), and the run then waits for
Rapier, so a Jump tapped at "usable" starts a run only at ≈ 19 s. A first visit that bounces off the title (the funnel's
lone 2026-11-03 `visit-new`, no `run`) lives in that gap. Three criteria are added below; tapToRun is the number to move.

PART ONE SHIPPED 2026-11-03 (builder, #231): the WASM preload is gone. Measured (`node scripts/serve-gz.mjs dist/coldgas 4701`
then `node scripts/perf.mjs http://localhost:4701/coldgas/`: dist served gzipped like production, phone 4×CPU Slow 4G, medians of 3): usable 7,871 → 6,578 ms, first 3D frame 16,836 → 13,047 ms,
desktop unchanged, `physicsReady()` no later (2 runs each, main 44.4 / 44.2 s, PR 44.2 / 39.2 s: the WASM's last byte comes ≈ 0.7 s later, but at 4× CPU its compile dominates). The waterfall showed why: the
preloaded 1.17 MB WASM shared the link with the entry from 0.6 s, so the ≈ 220 kB (gzip) entry landed at 4.7 s, not 3.4 s.
What stays open for the next Builder: the main chunk (≈ 221 kB gzip) ≥ 20 KB smaller, and the light folding. Measured
per module in the entry: crash.js 9.1 kB gzip is the biggest title-irrelevant piece, but it adds meshes the stage
compiles in `stage.ready` and the wet slab mirrors (tagLook), so lazy-loading it needs a late compile + tag (flicker
gate); coach 4.6, instruments 3.5, share-card 2.9, practice 1.9 are the easy ones (≈ 13 kB, not 20). At 4×CPU the
entry's execution (≈ 3.2 s from landing to usable) now dominates; profile it before cutting bytes.

The Rapier WASM is 1.17 MB gzipped (~6.5 s on Slow 4G) and its fetch starts only after the main bundle
runs (sim/engine-web.js ~7, main.js ~48). First-load JS is ~280 KB gzipped and the main chunk carries
modules the title doesn't need (ai/settings, practice, panel, instruments). The Show/Wall carry ~10
dynamic lights on every tier.

GROOMED 2026-11-01: raised to P1 (stays proposed: the ready queue is over its cap of 10, so the Builder takes it once there is room); the operator's PLAYERS focus puts first load on a phone over cellular third (the build is 719 kB / 219 kB gzip main plus 66 kB gzip three.core, and the 1.17 MB WASM follows). Builder: say in the PR which of `visit-new` → `run` it should move.

GROOMED 2026-10-27 (reversed 2026-11-03: the preload was measured harmful and removed, see the top): the WASM `<link rel="preload">` already ships (vite.config.js inlineCss plugin). What is open: shrink the main chunk by lazy-loading title-irrelevant modules (≥ 20 KB gzip) and the light folding on `low`/`mid`.

## What
~~A WASM preload~~ (measured harmful and removed, see the top); lazy-load the
title-irrelevant modules; on `low`/`mid`, fold uplights and red points into emissive decals.

## Acceptance criteria
- [x] `scripts/perf.mjs` (Slow 4G profile): "usable" time improves; first 3D frame no worse
- [x] Main chunk gzip shrinks ≥ 20 KB
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse
- [ ] (critic 2026-11-04) `scripts/perf.mjs` also reports **tapToRun**: a raw touch on the Jump sent the moment it is "usable" (CDP `Input.dispatchTouchEvent`, no actionability wait), as a returning player (`coldgas_howto = 'seen'`) → `S.mode` leaves `title`. Production today: ≈ 19–20 s from navigation, ≈ 13 s after "usable" (docs/critique/2026-11-04-0100.md). It must improve, and the PR names the number.
- [ ] (critic 2026-11-04) On the phone profile, no main-thread task over 1 s after "usable". Today the first title frame is one 5.4 s task (`Fw` 2.43 s + GPU Commit 2.98 s, SwiftShader), and a tap waits behind it (pointerdown handled 6.1 s after its timestamp).
- [x] (critic 2026-11-04) While a tapped Jump waits for physics, the title shows a visible wait state that lasts until the run starts (today the "Loading physics" cue lasts 1.2 s, `src/main.js:125`, then the screen is silent for up to ≈ 6 s).

**Builder, 2026-11-17 (#424): the main chunk is 20.4 KB gzip lighter; tapToRun and the long task stay open.** The entry
chunk had grown to 239.89 kB gzip on main `5cc8b9e` (the 221 kB above was 2026-11-03). What a run needs only once it has
started or ended now rides in its own chunk, `src/later.js` : the coach, the drills, the HUD's instruments,
the judges' settings sheet, the share card's drawing, the board's client, the sheet's Post and the landing's beat. main.js
asks for it beside the physics WASM, and every start waits on both (`whenPhysics`, the challenge's `ready`), asking again
after a failure; `toast` (src/toast.js) and `aiLabel` (src/ai/config.js) stay in the entry for the title. Entry 239.89 →
219.49 kB gzip, later 18.44 kB (`npm run build`). `tests/unit/entry-lean.test.js` fails if any of those modules is imported statically
from the entry's graph again. The wait state shipped in 0154 (#411, "Starting…" until the run begins). Open for the next
Builder: tapToRun in perf.mjs, and the first title frame's long task (box 5, a render/GPU cost, not bytes).

**Builder, 2026-11-27 (#PR): perf.mjs reports tapToRun; the engine's "31 s after the bytes" was the probe, not the game.**
`node scripts/perf.mjs <url>` now prints `tapToRun`, `engineAt` and `wasmEnd` for the phone profile (raw CDP touch at
usable, returning player). On main `9d11f53`, local gzip-served build, phone 4× CPU Slow 4G, 6 cold loads: **tapToRun
7.8–11.0 s (median ≈ 8.3 s) after usable**, the engine up at 14.2–18.1 s, the WASM's last byte at 11.4 s. What the
critic's probe read as 31 s of compile:
- Its `setTimeout(poll, 20)` is starved on the title: `precomputeRefGhosts` flies the three reference ghosts in 5 ms
  slices and yields with `scheduler.yield()`, whose continuations outrank timers. A poll saw `physicsReady()` 28 s after
  the engine was in (performance marks in engine.js and `setMode`, since removed). perf.mjs reads the run's start with a
  MutationObserver on `body[data-mode]`, and the engine from its first WebAssembly instance.
- `S.mode !== 'title'` itself was right, but the probe could only see it once the starvation ended (the run live).
- The countdown advances by `min(dt, 0.1)` per frame, and a SwiftShader frame at 4× is ≈ 1.1–1.6 s, so a 3 s countdown
  took 32–48 s of wall clock there (a CPU profile of it: 46 of 48 s native/GPU, 2 s JS). Real phones aren't SwiftShader.
**Tried and measured worse, not shipped:** handing the fetch to `WebAssembly.compileStreaming` at boot (so the compile
overlaps the download instead of starting after the glue chunk and the first frame). Same 6-load A/B: tapToRun
12.0–13.2 s (median ≈ 12.5 s), the engine up ≈ 3 s later. On the throttled CPU the background compile competes with
the title's first frame. Don't retry it without a real-phone A/B.
Still open: the first title frame's long task (7.4 s at 4× on SwiftShader, `usable` → `stage.ready`), which every
tap waits behind, and a real-device tapToRun.

## Test plan
perf.mjs before/after in the PR; smoke e2e unchanged.

## Out of scope
A service worker.
