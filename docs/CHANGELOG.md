# Changelog

## 0.9.2 — 2026-10-20

- Fixed NaN mid-trick in Pro mode (SIM_VERSION 10). A held roll + yaw spun the car up until the explicit gyroscopic term overshot in one tick and the state went NaN (HUD showed NaN, car froze). Rotation now integrates angular momentum in the world frame (stable at any spin rate) and air resists a spinning body (quadratic rotational drag, ESTIMATE). A non-finite state now ends the run cleanly ('sim-fault') instead of drawing NaN. Fuzzed: 0 NaN in 3,000 random Pro tricks. References: Show 87.3, Wall 88, Lineup 85.

## 0.9.1 — 2026-10-20

- Restart, Jump again and the title now clear everything the last run layered over the stage. The judges' theatre (and its in-flight call) is aborted instead of playing on over the next run; the AI sheet and cues close too. Regression test: tests/e2e/overlays.spec.js.

## Unreleased

**Crashes** (SIM_VERSION 9). A crash used to just happen; now the physics folds, the record says what hit what, and the renderer, camera and sound make it land.
- Bodywork is elastic to a yield, then it folds and stays folded. Each body hull probe springs at 1.2 MN/m up to 100 kN (≈8 cm), then crushes plastically, up to 0.35 m. The yield is an estimate from crash tests: a 56 km/h full-frontal barrier test crushes a 1.5–2 t car ≈0.6–0.7 m (≈350–400 kN mean force over the ≈4 probes a nose engages), and FMVSS 216 holds roofs to ≥3× vehicle weight (≈72 kN here) within 127 mm. The old fully elastic 0.3 MN/m spring let a hard hit sink the body 0.3–0.5 m into the ground and fired it back out. Drop tests (roof, side, nose at 6–15 m/s) now rebound at e ≈ 0.18–0.33 (was 0.27–0.5, and 0.98 for a slow nose hit), with 40–77 g peaks and up to 0.33 m of crush. The floor probes (skirts and pan) keep the old compliant law, so clean runs are untouched.
- No artificial spin damping while the hull is in contact. The 0.997-per-tick grounded damper (it halved a spin every second) ate tumbles and rollovers. Scraping contact removes that energy itself.
- Impact events (src/sim/impacts.js): every hull hit, slide, tyre slam and fold, with its tick, world point, normal, speed, body part and the parked body it struck. They are recorded in the sim, so they replay bit-exactly and the replay re-shows the crash.
- What a crash shows (src/render/crash.js, src/render/debris.js):
  - Sparks: instanced streaks, hot white cooling to orange, bouncing off the concrete.
  - Glass, carbon and paint chips, a dust ring, and a nitrogen line venting condensation after a big hit.
  - The wing, intake vanes, barge boards and skirts tear off as small rigid bodies that tumble and settle.
  - The body dents where the physics folded it, as deep as it folded. Struck parked cars dent and rock on their springs.
  - The canopy crazes. The lamps flicker out and the hazards come on.
  - The camera shakes with the impact, slow motion holds a beat, and a locked-off crash camera cuts in.
  - A procedural crunch layered by severity (thump, crack, folding metal, glass), plus a grind while the body slides.
- `prefers-reduced-motion` now also drops the landing shakes, the crash shake, the slow motion and the cut.
- Reference runs within ±1 of SIM_VERSION 8: Show 87.3 (was 87.0), Wall 87.0 (87.7), Lineup 85.0 (85.0). Naive players unchanged (Wall 32/32, Show 46/54). `node scripts/crash-probe.mjs` prints the crash cases; `node scripts/shots-crash.mjs outdir url` screenshots them.


## 0.8.0 — 2026-10-20

A taller Wall, and the car's mass where the research puts it (SIM_VERSION 8).
- The Wall's curl radius goes 9.5 → 13.5 m: the lip is 27.7 m up (the reveal's was 19.8 m; taller by design). Cameras, lights and copy scale with it.
- Centre of mass from a component build-up (REVEAL_RESEARCH §11: floor battery, both motors at the rear axle, tanks behind and beside the driver): 42 : 58, 1.62 m behind the front axle, 0.40 m up. Fixed a naming bug: `comFromFront` was being used as the distance from the REAR axle.
- Inertia 615 / 2,680 / 3,080 kg·m², held fixed (the gas sits near the CoM, so blowdown barely changes it).
- Down-jets rated 20 kN each (the rear nozzles' rating), placed 0.47 m behind the front axle and 0.53 m behind the rear (PHOTO). With the sourced CoM the trimmed lift is ≈67 kN, up from ≈51 kN.
- Every nozzle is now placed from the axles, so a CoM change moves nothing on the car.
- Each axle's springs and dampers are rated to its share of the weight, so the car sits level.
- Wall: touching the deck while still high is a scrape, not a landing. The reference pilot pushes off the ledge on the lift jets (as a player taps RELEASE) and levels for the last 4 m.
- References: Show 87, Wall 87.7, Lineup 85. Naive players: Wall 32/32; Show 46/54 (crawling up at the cued speed — half throttle up the taller curl throws you off the ledge at 30 m/s).
## 0.7.1 — 2026-10-20

- Body text finally renders in Geist. The CSS asked for 'Geist' but the package registers another name, so it had always fallen back to the system font. Now one variable font (every weight, 29 kB latin), preloaded.
- The page is gzipped by the Worker (37.5 → 10.3 kB). `no-transform` keeps the zone's analytics beacon out but also stopped Cloudflare compressing the HTML; the Worker compresses it itself and passes the bytes through (`encodeBody: 'manual'`).


## 0.7.0 — 2026-10-20

The car's real geometry in the physics (SIM_VERSION 7), from the body research (docs/REVEAL_RESEARCH.md §10).
- Length 4.65 → 4.33 m, front overhang 0.85 m (PHOTO): the hull is 0.3 m shorter at the tail.
- Rear nozzles moved up to 0.42 m (≈ the CoM height), 0.26 m apart: a burn no longer pitches the car.
- Down-jets moved to just behind each wheel (OFFICIAL "behind each wheel"). They are no longer symmetric about the CoM, so the mixer trims each jet's lift share to cancel the pitch moment; pure lift is ≈51 kN.
- The model draws every nozzle exactly where the physics fires it.
- The Show's pad moved to z −32 and the reference carry to 8.5 m/s; reference 90.3 (Wall 94, Lineup 84.3). Naive Show players: 30/36 land clean (was 24/36).


## Unreleased

**No more flicker** (render only). `node scripts/flicker.mjs <url> [--engine=webkit] [--phone]` drives the game frame by frame and measures per-pixel temporal jitter by region; the PR has the before/after numbers.
- The approach paint, the pad rings and the Show's red row outline were losing the depth test to the approach strip (its slope-scaled offset beat their millimetre lift at grazing angles), so they flickered in and out and mostly vanished. Every ground decal now has a stronger offset than the surface under it and a fixed draw order; the camera's near plane is 0.3 m (was 0.1) for 3× the depth precision.
- Thin bright things (the Wall's LED strips, lamp heads, painted lines) and thin dark ones (truss members, lamp poles, the far tower) keep a minimum on-screen width (`src/render/sliver.js`), dimmed to match; under 4 px the lights are padded by up to a pixel and the paint gets coverage-faded edges, so they no longer step, bead or pop in and out of the bloom at range. Close up they draw exactly as before. Surface decals and lights draw before mist, plumes and smoke (fixed `renderOrder` layers).
- The key light's shadow camera snaps to whole shadow-map texels, so shadow edges don't crawl as the car moves.
- The deck's bump map fades out where a pixel spans many bump texels (it sparkled at range); stars are round dots with soft edges, not pixel squares that twinkled; the Lineup's beacon ramps on and off.

**The judges' theatre is readable** (every text clears WCAG AA, measured from pixels: worst 5.2:1; was 3.1:1 on desktop and 4.2:1 on a phone, where the results sheet also ghosted through)
- Particle text (aurora-field `fromText`): the facts and the verdict stack one word per line, rasterised from a real Geist Mono 700 (lazy font face), 72% of particles on the outlines, flat (depth 0), the field held still (autonomy 0) and lifted toward white while it spells. Phones get 2,600 particles (was 1,800). The facts hold 2.4 s (was 1.7 s) and arrive in 0.7 s.
- The raw stream sits on its own dark glass panel and leaves the stage when the verdict lands; the phone theatre is opaque, so the results sheet no longer ghosts through it; the Skip button no longer covers the rail.
- Secondary inks raised inside the theatre and the results sheet (0.46 → 0.66, 0.72 → 0.86), caption 300 → 400 weight, a soft dark halo under rail and caption text, 11 px labels on phones.
- `node scripts/theatre-shots.mjs` reproduces it: screenshots of every stage (local lines and a mocked stream, 1280×720 and 390×844) plus a contrast table. Before/after in docs/shots/theatre-legibility/.
2026-10-20 · #0002 · The touchdown lands in the body: a camera dip, an FOV punch-in, a ring of mist from each tyre and a thud whose depth and weight follow the sink rate (energy, v²). A 1 m/s landing is a light tap, a 4 m/s one is a deep thump with a suspension crunch. Reduced motion keeps the sound and the mist but drops the dip, the punch and every camera shake (the lift-off shake wasn't gated before).

**First load** (phone, 4× CPU, Slow 4G, local build: first paint 1.48 s → 0.75 s, title wired 3.63 s → 2.99 s, longest main-thread task 588 ms → 284 ms)
- The stylesheet is inlined into index.html (latin-only font faces) and the display face is preloaded, so the title paints from the HTML alone.
- The title is wired before the 3D is built. The course is then built in ~10 ms slices between frames, the environment baked, and every shader (the ghost's and idle plumes' too) compiled with `compileAsync`. The canvas fades in on its first frame.
- SMAA (desktop only) is its own chunk: phones download 37 kB less JavaScript.
- Hashed assets are cached for a year as immutable, so a repeat visit only revalidates the HTML.
- `node scripts/perf.mjs <url>` measures all of this.

The car looks like the reveal car. This change is render-only: the sim, scores and replays are unchanged.

**Shape.** The body is rebuilt from the official studio renders and the livestream, measured in docs/REVEAL_RESEARCH.md §10:
- a hood leading edge 0.42 m up, with fender peaks rising to 0.81 m on either side;
- a 20°-raked screen whose base sits 0.11 m behind the front axle (cab-forward);
- a 1.14 m roof peak, then a straight wedge to the tail;
- a black lower body that rises toward the rear;
- buttressed rear quarters around a recessed gold-glazed rear glass;
- small quarter-lights;
- a squared carbon diffuser box: four bronze nozzles at 0.42 m, with four fan impellers below them;
- six twin-blade spokes over light-grey aero discs.

**Lights, in their measured places:**
- a full-width DRL bar on the hood edge;
- pop-down headlamps in the V-notches;
- amber repeaters;
- a full-length red taillight under the deck lip, wrapping the corners;
- red corner lenses, plate lamps, and a red cabin glow through the glass.

There is no underglow and nothing on the car glows that the real car doesn't.

**Animated states, driven by what the renderer already sees:**
- On every new placement the car wakes: the cabin glow comes up first, then the DRL and the taillight sweep out from the centre, then the headlamp covers drop.
- The brake lamps light when the car decelerates on its wheels by more than the slope explains.
- The deck panel lifts into the wing with speed and kicks up as an airbrake; the intake wings and barge boards follow it.
- The skirts drop with the fan, and the front and rear skirts lift above about 50 mph.
- The fan impellers spin.
- A nozzle shows a faint jet core while it fires, and frost builds on its lip.

**Draw calls.** The car went from 169 meshes to 48 because static parts are merged per material. Triangles: about 17k.

**Physics mismatches, reported and not changed.** Measured against spec.js:
- the real car is 4.33 m long, not 4.65 m;
- its rear nozzles sit 0.42 m up, not 0.22 m;
- its down-jets are behind the wheels.

The rear nozzles and their plumes are drawn at the measured place. Fixing the rest needs a SIM_VERSION bump.

## 0.6.0 — 2026-10-20

The Show is one flight, and every object has its own physics (SIM_VERSION 6).

**The Show**
- One run: start just short of the Wall, crawl up the curl on fan suction, hang inverted, let go, fire the rear jets to carry out over five parked vehicles, roll upright on the way down, land on a pad beyond them. No service stop, no lane change.
- The row is parked across the approach under the ledge (z −10 to −23, the semi in the middle); the pad is at z −35.
- One fill of nitrogen for the whole flight. The reference uses a ≈0.15 s rear burn to reach 9 m/s, clears the roofs by 4.4 m, touches down at 0.8 m/s and scores 89.3. Too little carry puts you on a roof (contact, crash).
- New BOOST control in the air for the rear jets: F, gamepad RB, or the GO button (relabelled BOOST in the air).
- Scoring: climb, inversion, roll-out, clearance, landing, precision, gas left. Contact is a crash; falling short of the row caps each judge at 5.

**Physics per object**
- Every surface has a material: tyre grip and sliding friction (concrete 1.0 / 0.5, a parked car's paint and glass 0.55 / 0.3).
- Every parked vehicle is a rigid body with its own mass (1.6 t cab to 10.5 t semi tractor) and parked-tyre friction (μ 0.8). Wheel and hull contact push back on it; it slides and yaws, and shoves its neighbour.
- Each run owns its world, and replay frames carry the bodies' poses, so a shove replays exactly and the server verifies it.


## 0.5.0 — 2026-10-20

The Show and expert steering (SIM_VERSION 5).

**The Show (new default event)**
- Both reveal stunts in one run: climb the Wall, hang inverted, release, roll, land.
- Then stop on the pad while the crew tops up the nitrogen. The reveal flew each stunt on a fresh fill: after the Wall the tanks hold about 95 of 297 kg, too little pressure to lift the car again. The fill is fast-forwarded, and the game says so.
- Then steer onto the lineup lane beside the approach, lift off flat ground, kickflip the five parked vehicles and land on the second pad.
- The lineup leg is the Lineup course turned 180° onto its lane (`SHOW`, `showLocalX/Z`), so its rules run unchanged.
- Scoring: each judge's mark is the mean of their Wall and Lineup marks. Stopping after the Wall caps the run at 50.
- The reference run scores 90.

**Steering**
- Fixed mirrored controls. The sim's +x is the car's left, so steer, roll and yaw all went the wrong way on screen.
- Inputs are now driver-relative: + is right.
- Full lock is grip-limited: L·μg/v² + 0.04 rad. Full stick asks for the tyres' peak grip at any speed (about 1.2–1.35 g) and never saws the front into understeer.
- Lateral tyre stiffness raised to a track tyre's: B 9.5 → 16, peak slip angle 14° → 8.4°, so turn-in is crisp.
- Keyboard steer and roll ramp in over about 0.25 s, so a tap is a correction.
- The chase camera follows the direction of travel.

**Fixes**
- The Lineup's on-screen hints and replay read the removed ramp's position and threw. They now use `liftOffZ`.
- Ghosts are stored per course.
- Lift-jet ids now name the side they're on.

## 0.4.0 — 2026-10-20

Sourced specs (SIM_VERSION 4), from `docs/REVEAL_RESEARCH.md`: Tesla's statements, the livestream's on-screen telemetry and the press.

**The Wall's geometry**
- A 9.5 m arc turning 170°, then a 5.5 m inverted ledge to a 19.8 m lip, on a 3.7 m deck.
- The car crawls up at about 4 m/s on fan suction and hangs upside down.

**The car**
- 2,150 kg dry plus 297 kg of nitrogen at 690 bar.
- Staggered Trofeo RS tyres (20″ front, 21″ rear) at μ 1.25, and 1,400 N·m × 8.4 at each rear wheel.
- Four 20 kW fans with deployable skirts make 46 kN of suction.
- Four 20 kN rear jets, four 17 kN corner down-jets and two front yaw jets.
- The pressure regulator holds 5,500 psi of line pressure before the tanks blow down.

**The reference runs reproduce the reveal**
- The Wall: about 4.5 s from release to touchdown, a roughly 180° roll-out, braking near 3.3 G, and a soft four-wheel landing.
- The Lineup: lift-off from flat ground, a peak of 7–8 m and a 360° roll.
- 0–60 with fan and thrusters comes out at 0.60 s against 0.67 s net live.

**Tests**
- New reveal-fidelity tests fail CI if the physics drifts from the telemetry.

## 0.3.0 — 2026-10-20

The realism rework (SIM_VERSION 2):

**The Wall, the reveal's stunt**
- A 25 m quarter-pipe curls through vertical into an overhang, on a night stage with a steel truss, red LED edges and searchlights.
- You climb it on the 2 g suction fan, hang inverted, release, roll upright on the jets and land on the target.

**The car**
- Built from the public numbers: 2,825 mm wheelbase, about 2.0 m wide, 1,000 kW to the rear wheels, 600 L of nitrogen at 690 bar (about 280 kg), ten thrusters and a 2 g fan.
- The model is a faceted wedge with a full-width light bar, four rear nozzles in the diffuser, gold glass, and an active wing and fan.

**Physics v2**
- Pacejka tyres with spinning wheels, traction control, ABS and stiction.
- Stiff fan-car suspension and exact curved-surface contact.
- Thrust falls off as the tank pressure drops.
- Measured: 0–60 mph in 3.5 s on tyres alone, 1.65 s with the fan and 1.2 s with the thrusters; 60–0 in 27 m at 1.35 g with ABS.

**Landing for everyone**
- LAND rolls the car upright, levels it, eases the sink rate and nearly hovers until it's flat.
- All 32 simple player strategies land upright.

**Mobile**
- Touch v2: a steer stick, GO and BRAKE pedals, LIFT (RELEASE on the wall) and LAND, laid out by phase.
- The HUD sits at the top on touch devices and adds g-load and fan readouts.

## 0.2.1 — 2026-10-19

Bring your own key, made caveman-simple:
- **One paste box:** the provider is detected from the key itself (Anthropic `sk-ant-`, OpenAI `sk-`, xAI `xai-`, Google `AIza`).
- **No setup:** the key is checked against the provider's live model list, the cheapest fast model is picked, and it's saved. No buttons.
- **Forgiving pastes:** quotes, `Bearer `, `NAME=` prefixes and stray whitespace are cleaned up.
- **Look-alike keys explained:** Groq vs Grok, OpenRouter, GitHub tokens and others get a friendly explanation and are never sent.
- **Help getting a key:** a Paste-from-clipboard button and one-tap "get a key" tiles with the exact steps.
- **Easy switching:** Advanced has a model picker, and one tap goes back to the free judges.

## Unreleased

2026-10-20 · #0001 · Ghost of your best run: your best jump (or the reference, until you land one) rides alongside the next attempt as a translucent silhouette; toggle it with G or the ghost button.

## 0.2.0 — 2026-10-19

The judges' brain and theatre:
- **Free default:** an open model (Gemma 4 26B-A4B) on Cloudflare Workers AI. It costs about $0.0001 a judging, with Llama 3.1 8B as the fallback.
- **Bring your own key:** for Anthropic, OpenAI, xAI (Grok) or Google (Gemini). Connecting lists the provider's live models and suggests the cheapest current fast one.
- **Streaming:** judgings stream over SSE.
- **The theatre:** shows each call as an aurora-field particle sequence: circuit → text → compute → app. It has live tokens, latency, neurons and cost, plus a receipt with the call to replay and inspect.

## 0.1.0 — 2026-10-19

First playable: deterministic 6-DOF sim with ten cold-gas nozzles, Assist/Pro flight computer, reference jump autopilot, six-category three-judge scoring, AI panel commentary via the Worker (server-verified by replay), D1 daily board, blue-hour range with procedural vehicles, keyboard/gamepad/touch, deep links `?play=jump|reveal`, `?board=today|all`, `?gfx=`.
