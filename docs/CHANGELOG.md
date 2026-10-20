# Changelog

## Unreleased

**First load** (phone, 4× CPU, Slow 4G, local build: first paint 1.48 s → 0.75 s, title wired 3.63 s → 2.99 s, longest main-thread task 588 ms → 284 ms)
- The stylesheet is inlined into index.html (latin-only font faces) and the display face is preloaded, so the title paints from the HTML alone.
- The title is wired before the 3D is built. The course is then built in ~10 ms slices between frames, the environment baked, and every shader (the ghost's and idle plumes' too) compiled with `compileAsync`. The canvas fades in on its first frame.
- SMAA (desktop only) is its own chunk: phones download 37 kB less JavaScript.
- Hashed assets are cached for a year as immutable, so a repeat visit only revalidates the HTML.
- `node scripts/perf.mjs <url>` measures all of this.

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
