# NATIVE.md: COLD GAS as a native iPhone app

The plan for a native Swift + Metal build of the game, made first for the **iPhone Duo** (the book-style foldable,
September 2026) and the **Pro Max**, at 120 Hz with Core Haptics. Written 2026-11-04 by the operator. This is a
**parallel track** beside the web focus in `agents/control.json`: the web game keeps shipping, and nothing here
may slow it down or change its behaviour.

It's built on what the owner's other native projects already paid for. Each rule below that came from somewhere
else names where:
- **moon-club** is a native SwiftUI app with Metal shaders, XcodeGen, App Store Connect tooling and the Duo simulator.
- **18-0-duo-graphics** has the Duo fold APIs and measured postures.
- **kin** has the TestFlight pipeline and a bit-exact TypeScript→C# port.
- **fantasy-edge** and **saturday** cover generated projects and contracts.

## 1 · What it is

It's the same game, native:
- **The three courses:** the Show, the Wall and the Lineup.
- **The three tiers:** Assist, Pro and Advanced (ten valves by hand).
- **Mastery and scoring:** drills, the landing HUD and the coach; `scoreRun` and the judges, with the AI panel
  streaming through the theatre and the receipt.
- **Reasons to come back:** the board, medals, the daily jump, challenge links, replays and the share card.

It talks to the same frozen Worker. A run flown on the phone and the same input log flown on the web score
**identically**.

**Not in v1.** Free Drive (the roads and the endless world), the Sandbox and builds, side quests and the rocket.
They're about 7k more lines of streaming-world code. They come in v2, once the core is proven.

**The bar.** It holds 120 fps on a Pro Max and a Duo through a whole run. It's playable on an iPhone 15 Pro. The
landing is felt in the hand (§6). It looks at least as good as `?gfx=high` on a desktop.

## 2 · Invariants (the web's, carried over, plus the native ones)

1. **One sim, two implementations, the same bits.**
   - The Swift sim is a line-for-line port of `src/sim` that matches it bit for bit, proven by vectors (§3).
   - A sim change lands on both sides in the same PR, or the vectors go red. "Change both sides together" (moon-club).
   - `SIM_VERSION` is shared: the Swift core reads it from the vectors file and refuses to run if they differ.
2. **Scores are decided by `scoreRun`** on the Worker from the telemetry, as on the web (AGENTS.md 3.5). The app
   never sends a score.
3. **Own origin only.**
   - The only network host is `mutaafaziz.com/coldgas/api/*`.
   - No third-party SDKs or remote Swift packages: lint-checked, as in moon-club's `check-rules.sh`.
   - **No ads in the app.** Marquee is a web loader, and kin skips ads on native too.
   - No accounts, no tracking. The privacy label is "Data Not Collected", except anonymous diagnostics if the
     health beacon ships.
4. **The renderer, the HUD, the audio and the haptics read the sim. They never write it.**
5. **Zero allocations in the 240 Hz tick and the frame.** In V8 the cost was boxed doubles (LESSONS 0049, 0109).
   In Swift it's ARC retain/release, closures, existentials and `Array` copy-on-write. So the tick runs on
   structs, preallocated buffers and `unsafe` storage. An allocation bench (§8) holds it at 0 B a tick.
6. **IP caution** (AGENTS.md 3.7), store listing included: no real brand, product or person, and nothing that
   names the real reveal. 18-0's rule: "the statistics are facts; the name is a trademark."
7. **Accessibility.**
   - Reduce Motion stops every shake and big transition.
   - The HUD holds 4.5:1 contrast and text of at least 11 pt.
   - Touch targets are at least 44 pt.
   - Every control has a game-controller and hardware-keyboard path.
   - Haptics can be turned off (§6).
8. **Never branch on the device model; gate on capabilities** (`hasHinge`, `supportsHaptics`, the display's
   maximum frame rate). From moon-club.

## 3 · The sim: a Swift port proven by vectors

kin ported its pure TypeScript core line for line to C# for its Unity client. It stays **bit-exact**, checked by
`ParityTests` against golden fixtures that the TypeScript writes. We do the same thing.

- **`ios/Packages/ColdGasCore`:**
  - Foundation only: no UIKit, no Metal, no SwiftUI.
  - Swift 6 tools in Swift 5 language mode (moon-club, fantasy-edge).
  - It ports `dmath`, `m3`, `spec`, `courses` (Show, Wall, Lineup), `world`, `vehicle`, `run`, `impacts`,
    `judge`, `predict`, `damage`, `coach`, `autopilot`, plus `hands`, `driving`, `onethumb` and `challenge`.
- **Rapier.** The native Rust crate at the same version as `@dimforge/rapier3d-deterministic` (0.21.0), with
  `enhanced-determinism`.
  - Built from source by `ios/scripts/rapier.sh` into an XCFramework (arm64 iOS, arm64 simulator, macOS, Linux
    for the sandboxes), behind a small C API.
  - Building it from source is what keeps the "no remote packages" rule.
  - Rapier claims cross-platform determinism. **The spike (0147) proves it against the WASM build.**
- **`npm run vectors` (web side, Node, 0146)** flies a fixed set of input logs through `src/sim` and writes
  `ios/Packages/ColdGasCore/Tests/Vectors/*.json`:
  - The logs: the reference flights for each course, the 32 naive players, crashes, Pro spin fuzz and Advanced
    valve logs.
  - What it records: per-tick fingerprints (pose, velocities, gas, phase), the telemetry, `scoreRun`'s card and
    `SIM_VERSION`.
  - Generated files are never edited by hand (18-0, fantasy-edge: hand-edited fixtures once dropped 74 % of
    their rows).
  - `npm run check` fails if the vectors are stale.
- **The Swift tests replay every vector and must match bit for bit:** compared with `Double.bitPattern`, never
  with a tolerance.
  - The core uses only Foundation, so `swift test` also runs **on Linux**. The cloud agents, which have no Xcode,
    can therefore keep both sides in step.

### Verdict of the spike (0147, 2026-11-04): proceed with the Swift port

Measured, not assumed:
- **Native Rapier is bit-exact with the WASM build.** The scripts/engine-spike.js scene matches the WASM
  hashes exactly through the C API: `ce2812cc` at 240 steps and `0ddfc5d3` at 2,400 steps, with the same car
  position. It matches from a Rust port of the spike and from the Swift one on macOS arm64 and the iPhone Duo
  simulator.
  - The engine is rapier3d 0.36.0, the crate inside @dimforge/rapier3d-deterministic 0.21.0, built with the
    same features as the WASM build: `enhanced-determinism`, `fem`, `serde-serialize`, `debug-render` and
    `profiler`.
  - Cargo.lock pins glam 0.33.10 and smallvec 1.16.2, the versions compiled into the WASM.
- **`DMath.swift` is bit-exact with `src/sim/dmath.js`.** It matches on all 11 sets of 5,000 vectors (special
  values included) on four platforms: macOS arm64, the iPhone Duo simulator, Linux arm64 and Linux x86_64.
- **The compiler doesn't contract our arithmetic.** The release build's dmath kernels are 118 `fmul`, 102 `fadd`
  and no `fmadd`. The only fused instructions (4 `fmsub`) are LLVM's lowering of
  `truncatingRemainder(dividingBy: 4)`: `x − trunc(x/4)·4`, with a power-of-two divisor, so the product is exact
  and the result is the same.
- **Still open:**
  - The physical-iPhone leg. Package tests can't run on a device without a host app, so 0148's app runs the
    same vectors with `-selftest`.
  - The 240-tick `vehicle.step` slice. It needs `vehicle.js` and `world.js` (≈2,100 lines) plus the engine's
    contact and event API, so it's the first item of phase 1 (0150).
- **Why it matched.** Every value crosses into the engine as the bindings take it: a JS number is rounded to
  f32, and the bindings' own defaults are used, not Rust's. For example, a rigid body always gets
  `additional_mass_properties` unless `mass_only`, and the TS collision groups `0xffffffff` unpack to
  `0xffff/0xffff`. ios/Vendor/Rapier/src/lib.rs mirrors the TS layer call for call. Keep it that way as the API
  grows.

### Porting rules (each one is a bug waiting to happen)

| JS | Swift |
|---|---|
| `Math.round(x)` rounds half **up** (toward +∞): `Math.round(-2.5) = -2` | `(x + 0.5).rounded(.down)`, **never** `.rounded()` (which rounds a half away from zero) |
| `a % b` on doubles truncates | `a.truncatingRemainder(dividingBy: b)`, never `remainder` |
| `Math.max/min` propagate NaN; `Math.max(-0, 0) = +0` | `jsMax` / `jsMin` helpers with the same semantics; Swift's `max`/`min` differ on NaN |
| `Math.imul`, `\|0`, `>>>`, `<<` | `Int32` with `&*`, `&+`, `&<<`; `UInt32` for `>>>` |
| `Math.floor` / `ceil` / `sqrt` / `abs` | `.rounded(.down)` / `.rounded(.up)` / `.squareRoot()` / `abs()`; all are exact |
| `Math.LN10`, `Math.PI` | The same literal, written out |
| `DataView` big-endian bit tricks (`dexp`, `dlog`) | `Double(bitPattern:)` / `.bitPattern` |
| A `number` | `Double`. Never `Float`, and never `Int` where JS does double arithmetic |
| An expression's evaluation order | Kept exactly, with the same parentheses: `a*b + c` must not become a fused multiply-add |

- **Compiler settings.** No `-Ounchecked`, no fast-math, no `-ffp-contract=fast`. Swift doesn't contract
  floating point by default. The spike checks the shipping `-O` build's disassembly for `fmadd`/`fmsub` in the hot
  kernels anyway.
- **`dmath` only:** never `Foundation.sin/atan2/hypot/pow` (LESSONS: "Engines disagree on transcendental
  functions"). The same lint as the web runs over the Swift sources.

## 4 · Rendering: Metal 4 at 120 Hz

- **Frame pacing.**
  - `CADisableMinimumFrameDurationOnPhone = YES` (moon-club, 18-0); without it the phone is capped at 60.
  - A `CAMetalDisplayLink` with `preferredFrameRateRange` up to 120.
  - Two sim ticks per frame at 120 Hz, with the car interpolated between ticks, as `src/render/interp.js` does now.
  - Triple-buffered uniforms in a ring, so nothing is allocated per frame.
- **The look,** ported pass for pass from `src/render`:
  - Lighting: physically based materials with clear-coat paint, cascaded shadows, the floor reflection.
  - The film-look pass (bloom, tone mapping, grain) and the mist.
  - On the GPU as compute: the plumes (shock diamonds and condensation), and the crash (sparks, chips, dust,
    debris).
- **Anti-aliasing.** 4× MSAA in memoryless tile memory. It's cheap on Apple GPUs, and it fixes what SMAA couldn't:
  - The sub-pixel lamp strips that flicker through the bloom (LESSONS 0037, "Sub-pixel emissive geometry").
  - Keep the `sliver()` minimum-width idea for strips under a pixel.
- **MetalFX** upscaling at the resolution floor.
- **Meshes from the JS, never redrawn by hand.**
  - `npm run meshes` runs the procedural generators (`cars.js`, `parked/`, `wall.js`, `courses.surface()`) in
    Node and writes one binary mesh file per object.
  - The JS stays the only source of the car and the row. A mesh changes when its generator changes.
- **Shaders.**
  - Every pipeline is built **at launch, off the main thread, for the real pixel formats** (LESSONS 0046: compile
    where the frame draws), and cached in an `MTLBinaryArchive`.
  - kin's Unity client hitched 2.4–3.4 s on first play compiling shaders. The first frame of a run must never
    compile anything.
  - One `.metal` namespace with no duplicate function names (moon-club).
  - Clamp everything that goes into `pow`, `sqrt` and `normalize` (LESSONS: "One NaN pixel is a flicker storm").
  - Generated meshes are wound outward (LESSONS: "Loft winding").
- **Camera.** The director's rigs are ported. The lens keeps the **horizontal** field of view under an aspect
  (LESSONS 0108, `lens()` in director.js). That's how the near-square inner screen and the portrait outer screen
  frame the car the same.
- **Thermal and power.**
  - `ProcessInfo.thermalState` and Low Power Mode feed the resolution governor, which works as `src/obs/ledger.js`
    does:
    - Judge each frame against the display's cadence: the slowest of the window's cadence, the session's best and
      33.4 ms (LESSONS 0044).
    - Pixels go first, effects last.
    - The frame rate is never cut without a reason the player can see in Settings.
  - A resize is applied at the start of the next frame, never between a draw and its presentation (LESSONS 0044:
    a black frame).
- **Privacy manifest.** Declare 35F9.1 (system boot time) for `CACurrentMediaTime` frame timing, plus the
  UserDefaults and file-timestamp reasons (moon-club).

## 5 · iPhone Duo and Pro Max

Use the facts 18-0-duo-graphics measured on the Xcode 27.1/27.2 simulator. They're locked in as layout tests here
too.

| Pose | Window (pt) | Insets | Fold band |
|---|---|---|---|
| Book (open, upright) | 951 × 669 | right 84 (the vertical status bar), bottom 34 | vertical, x 455.5, 40 wide |
| Tabletop (half open) | 669 × 951 | top 82, bottom 34 | horizontal, y 455.5, 40 high |
| Closed (outer screen) | 466 × 678 | right 84 | none |

- **APIs (iOS 27.1 SDK; UIScene is required on the 27 SDK, or the app crashes at launch):**
  - `reservedRegions(kind: .division, options: .includeInactive)` is read on **every** `layoutSubviews` pass. There
    is no fold notification, trait or `UIDevice` property, and UIKit re-lays-out on a fold only for a view that
    read the regions last pass.
  - `UIHingeInteraction` gives the hinge angle.
- **Rules:**
  - **Lay out from the fold region; never use the hinge angle for layout.** The angle only drives effects: the
    stage lights warm as the phone opens, and a haptic tick at the detents (§6).
  - **Flat and folded lay out the same.** A flat Duo reports the fold as an inactive region at the same frame.
  - **The fold isn't in the middle of the safe area.** Halving the safe width puts the gutter 42 pt off the crease.
  - Pick the fold region by its shape; the array order isn't documented.
- **Layouts:**
  - **Book:** the scene fills the leading panel. The HUD instruments, landing tape and valve pad go on the
    trailing panel. Nothing draws across the hinge.
  - **Tabletop:** the scene above the fold, the controls below, like a handheld console. It's the same split
    `src/fold.js` already makes for a horizontal fold.
  - **Closed:** the phone layout, with the one-thumb pad.
- **A fold mid-run doesn't pause the run.** The sim doesn't know about views. A fold is a resize that passes through
  sizes no pose has (LESSONS 0075):
  - Re-fit the camera on every layout pass.
  - Reallocate the drawable only once the size settles.
- **Pro Max:** Dynamic Island insets, controls in thumb reach on a 6.9" screen, and the full look by default.
- **Testing:**
  - The simulators are `iPhone Duo` and `iPhone 18 Pro Max`.
  - The Duo simulator boots closed, and `simctl` can't move the hinge (moon-club). So debug launch arguments set
    it: `-pose closed|book|tabletop|flat`, `-hinge <deg>` and `-window WxH`.
  - Nobody has watched any of this on Duo hardware yet. A real-device pass is a gate before TestFlight.

## 6 · Haptics (first-class: the landing is felt in the hand)

**Why it matters.** On the web, `buzz()` (src/touch-settings.js) uses `navigator.vibrate`. **iOS Safari doesn't
have it**, so today an iPhone player feels nothing. The web buzzes at six moments: a pad tap, the release, the
landing HUD going amber/red, the touchdown (length scaled by sink rate), a crash and the first contact. Native
Core Haptics turns those buzzes into **a continuous track driven by the sim**, synced with the audio.

**Architecture.**
- **`HapticScore` (in ColdGasCore, pure, tested)** reads the sim's state each tick and emits haptic events into a
  fixed ring.
  - It never writes the sim, and replays produce the same track.
  - Vectors pin which events a reference flight produces, and on which ticks.
- **`HapticPlayer` (in the app)** maps events to `CHHapticEngine` players:
  - One engine, started at launch with `playsHapticsOnly` off, sharing the audio session. That way the hiss and
    the buzz line up.
  - Continuous players are created once and modulated with `CHHapticDynamicParameter`. Nothing is allocated per
    event (invariant 5).
- **The same track on a controller:** `GCController.haptics` (e.g. a DualSense) gets it through its own engine.

**The track.**

| Moment | Haptic | Driven by |
|---|---|---|
| Rolling on the concrete | A low continuous rumble; intensity ∝ speed, sharpness from surface (concrete, deck steel) | Wheel contact and speed |
| The kicker / the Wall's curl | Rumble sharpness rises with the normal load (the g you feel in the climb) | Suspension load |
| The release (thrusters armed / let go) | A crisp transient + a 120 ms swell | `noteRelease` (as `buzz('release')` today) |
| The ten jets firing | A continuous "hiss": intensity ∝ total valve flow, sharpness ∝ tank pressure (it softens as the nitrogen blows down) | Valves, `gas` |
| Apex | The rumble drops to nothing: the weightless moment is felt as silence | Vertical speed crossing 0 |
| Landing HUD amber → red | Two soft ticks → three sharp ticks, once per change (as `buzz('warn')`) | `hud-landing` status |
| Retro-burn | A rising hiss + a shudder at peak flow | Valves in the LAND phase |
| **Touchdown** | **One transient per wheel, at the tick that wheel touched, scaled by its sink rate.** A synced landing is one clean thump; a sloppy one is felt as four | Per-wheel contact ticks |
| Scrape / hit / crush | A transient scaled by impact speed and part, from `run.impacts`; a crash = a heavy hit + a decaying grind | `impacts.js` events |
| Stuck it | A settle: two soft decaying taps as the suspension comes to rest | Phase → landed, low sink |
| The judges' scores | A light tick as each judge's number lands; a medal is a rising triple | Results sheet |
| UI | System selection / impact feedback (`UISelectionFeedbackGenerator`) on taps, toggles, the one-thumb pad | UIKit |
| Duo hinge | A light tick at the open, tabletop and closed detents (effect only, never layout) | `UIHingeInteraction` |

**Rules.**
- **Settings: Off / Subtle / Full,** default Full. Subtle halves intensity and drops the continuous rumble. The
  system's own haptics switch is always respected.
- **Reduce Motion doesn't turn haptics off** (they're a separate preference). But a crash shake that's off stays
  off; the haptic replaces it.
- **Haptics never carry information that isn't also on the screen or in the sound.** The landing HUD's colour and
  tone still say amber and red.
- **The engine stops on background, resumes on return, and restarts itself** after
  `stoppedHandler`/`resetHandler` (the audio session can take it away).
- **Replay plays the same track** from the replay's own events. Scrubbing silences it.
- **Budget:** one engine. At most three continuous players (rumble, hiss, grind) plus transients. The track is
  rate-limited to what the actuator can render (no more than a transient per 10 ms per channel).
- **Tested:**
  - Unit: `HapticScore` against the vectors (the reference Show fires the release, warn and touchdown events on
    the right ticks).
  - Manual: a hardware pass on a Pro Max and a Duo, recorded as a ticket's acceptance item.
  - The simulator can't play haptics, so `-haptics log` prints the track for the shots harness.

## 7 · The app around the sim

- **UI.**
  - SwiftUI for the title, how-to, results sheet, board, settings and theatre. The HUD in the run is drawn in Metal
    (or Core Animation layers updated on change, like the web's "DOM on change").
  - Michroma and Geist are bundled (OFL).
  - No `alert`/`confirm`-style blocking dialogs.
  - **Never force-unwrap state or content lookups in views:** moon-club 0.8.0 crashed on TestFlight from exactly
    that, so it's a lint rule.
- **Input.**
  - Touch: one-thumb and classic, read at the display rate with coalesced touches, with the 15 % stick dead zone
    (LESSONS: "A resting thumb flies the car").
  - Tilt steering through CoreMotion.
  - Gamepads and hardware keyboards through GameController.
  - `freshRun`: every run starts with nothing held.
- **Audio.** The procedural WebAudio sounds port to `AVAudioEngine` with `AVAudioSourceNode` synths, and the jets
  get spatial audio.
- **Network.** The production API, unchanged. The Worker doesn't check Origin, and rate limits are per IP (kin
  works the same way).
  - Deadlines and retries as `src/net.js`.
  - The judges' theatre and receipt are the same, and the panel's fallback lines are local.
  - A BYOK key lives in the **Keychain** and is sent per call as `x-cg-key`.
  - The health beacon (`/obs`) sends only fields `cleanObs` accepts today; the Worker is frozen.
- **Saves.** Medals, the daily streak, initials and settings live in UserDefaults. Every new field is optional or
  has a merge rule, or old saves fail to decode and progress resets (moon-club).
- **Challenge links.**
  - v1: the app makes and reads `#vs=` payloads (the same bytes as `src/challenge.js`, pinned by vectors), and a
    shared link opens the web game.
  - Opening links in the app needs an `apple-app-site-association` file on mutaafaziz.com (another repo; none of
    the owner's apps has one yet). That's a v1.1 decision.

## 8 · Repo, tooling and agents

```
ios/
  project.yml                XcodeGen; ColdGas.xcodeproj is gitignored ("edit project.yml, never the project")
  Makefile                   up · test · sim · shots · bench · device · testflight · vectors
  Packages/ColdGasCore/      the sim, the scorer, HapticScore; Foundation only; swift test on macOS and Linux
    Tests/Vectors/           GENERATED by `npm run vectors`; never hand-edited
  ColdGas/                   the app: Render/ (Metal), HUD/, UI/ (SwiftUI), Input/, Audio/, Haptics/, Net/
  Vendor/Rapier/             built by scripts/rapier.sh from the pinned crate; the C header is checked in
  scripts/                   rapier.sh · shots.sh · device.sh · testflight.sh · asc.mjs · check-rules.sh
  release-notes/<version>.md required per release, linted
```

- **Copy the tooling instead of rewriting it:**
  - From moon-club: `asc.mjs`, the zero-dependency App Store Connect client. It handles signing, because cloud
    signing failed with the API key and it mints its own distribution certificate and profiles. It also does the
    upload and submit.
  - From moon-club: `shots.sh` (launch arguments, a readiness token file instead of sleeps, a timeout on every
    `simctl` call, the status bar at 9:41).
  - From fantasy-edge: `device.sh`, which turns the three common device failures into plain English.
  - From kin: the TestFlight flow, with UTC-timestamp build numbers.
- **Launch arguments for every screen:**
  - `-demo -course show|wall|lineup -tier assist|pro|advanced -play`.
  - `-autopilot` flies the reference run; `-results` jumps to the results sheet.
  - `-pose` and `-window` as in §5, plus `-bench` and `-haptics log`.
- **`make bench`** flies the reference Show and prints `BENCH frames avg p95 hitches alloc/tick`. Read it with
  `simctl launch --console`; `--console-pty` printed nothing (moon-club).
- **Definition of done for native work:**
  - `make test`, plus `swift test` on Linux for the core.
  - Vectors green.
  - Screenshots on the iPhone 18 Pro Max and the Duo in every pose. You looked at a real render, not just the
    tests (kin).
  - For haptics changes, `-haptics log` matches what the ticket asks for.
- **Who builds what:**
  - The cloud agents run in Linux sandboxes with no Xcode, and none of the owner's repos has macOS CI.
  - So the **web-side and core** tickets (vectors, meshes, the Swift core on Linux) can go to the Builder.
  - App, renderer and device tickets are built in the operator's local sessions on this Mac and say so in their
    frontmatter (`size`, and "Runs on: the operator's Mac" under What).
  - Adding a macOS runner needs `.github/workflows/`, which is frozen: an owner decision.
- **Machine gotchas:**
  - Each Xcode update needs its Metal toolchain (`xcodebuild -downloadComponent MetalToolchain`).
  - `xcode-select -p` must point at Xcode.app.
  - The first `xcodebuild` after `xcodegen generate` sometimes fails; run it again.
  - Simulator names repeat across runtimes, so use UDIDs.
  - Open the simulator with `open -b com.apple.iphonesimulator`.
- **Git:** one agent per checkout, and stage by path, never `git add -A`. It once swept four agent worktrees into a
  commit (fantasy-edge).

## 9 · App Store

- **Signing and builds.** The owner's existing Apple team (the same one as moon-club, kin and 18-0), with
  `asc.mjs` for certificates and profiles. Build numbers are UTC timestamps.
- **Info.plist:** `ITSAppUsesNonExemptEncryption = false`.
- **Review preflight** (18-0: Apple refuses with no reason given): primary category (Games › Racing or Sports),
  content rights, the price schedule, `usesIdfa` = no, and App Privacy, which is set by hand in the browser.
- **Expect a guideline 2.1 "Information Needed"** (18-0's v1.0 got one). Have these ready before submitting:
  - Review notes.
  - A recording on a physical device.
  - The answer on rights to third-party material: everything is original, it's a fan game with no real brands,
    and the fonts are OFL.
- **Screenshots.** The 6.9" set goes in `APP_IPHONE_67` (there's no `APP_IPHONE_69`). The `APP_IPHONE_DUO` set
  with a 27.1+ SDK build earns the "Made for iPhone Duo" badge.
- **TestFlight's `whatsNew` rejects emoji.**
- **Submitting** to TestFlight's external group or to review happens **only on a fresh yes from the owner in chat.**

## 10 · Phases (each ends at a gate; tickets in docs/backlog)

| # | Phase | Gate |
|---|---|---|
| 0 | **Spike** (0146 vectors, 0147 determinism, 0148 first frame) | `dmath` and one `vehicle.step` slice bit-identical on macOS, Linux and an iPhone; native Rapier matches the WASM build over the vectors; the exported roadster draws at 120 Hz on the Duo simulator |
| 1 | **Core** | All of the sim plus the scorer in Swift; every vector bit-exact; 32 of 32 naive players land; 0 B/tick |
| 2 | **The Show drawn** | Course, car, plumes, mist, director; binary archive (no compile in a run); the governor; p95 ≤ 8.3 ms on the simulator bench |
| 3 | **Playable + haptics** (0149) | Touch (one-thumb, classic), tilt, pad, keyboard; the HUD; audio; the full haptic track; a newcomer lands on Assist |
| 4 | **Results** | Judges streaming, the theatre, the receipt, the board (post with telemetry), medals, the daily jump, challenge payloads, share |
| 5 | **The Wall and the Lineup** | Both courses, drills, the coach, replays |
| 6 | **Duo and Pro Max pass** | Layout tests in every pose; hardware pass (120 Hz held, haptics felt, fold mid-run) |
| 7 | **TestFlight → App Store** | §9's preflight; an owner's yes |
