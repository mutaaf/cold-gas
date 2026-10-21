# Changelog

2026-10-21 · Score checks fit the free plan's CPU budget (SIM_VERSION 20). Production's judge started failing with Cloudflare error 1102 ("Worker exceeded resource limits") after about five back-to-back score checks: one Show replay costs about 240 ms of CPU on the rigid-body engine, and the free plan gives a request 10 ms, with slack only for the occasional heavy one. Four changes:
- **One replay per run.** The judge's card is kept, keyed by a SHA-256 of the exact log, course and SIM_VERSION (64 in memory per isolate, plus a D1 `replays` table kept for two days). Submitting to the board reads that card instead of replaying the run a second time. Only the server writes cards, so a log can only ever find the card it earned.
- **Rays clear of everything skip the engine.** A ray from the roadster that clears every collider's bounds (the floor's top, the curl's and kicker's boxes, the steel, each parked body's sphere) is a miss without a WASM call. The result is bit-identical across 40 fuzzed crash runs; 25–100 % of rays are skipped, depending on the course.
- **The hull meets the curl only when it can reach it.** The deck is the inside of a circle and the whole slab lies outside it, so the hull's farthest corner bounds its clearance exactly. While that clearance beats 2 cm plus a tick of travel, the engine doesn't test the hull against the curl's triangles. That halves the step time on the Show and the Wall. The engine restarts its pair caches when the pair comes back, so a crash into the curl can differ in the last bits; hence the SIM bump. The references replay to the same bits (Show 94, Wall 96, Lineup 92), and Node and workerd stay bit-identical, crashes included.
- **The engine starts only for a replay** (not for the board, the health check or the provider list), and the client retries a judge call or a submission twice on a 503 (after 1.2 s and 3 s).
CPU per Show replay: 240 → 170 ms (Wall 225 → 170, Lineup 81 → 70), and one replay per run instead of two.
2026-10-21 · #0019 · The Wall starts where the reveal's run 1 did: parked at the foot of the curl, 6 m from the arc, not 120 m away (SIM_VERSION 19). The reference spools its fans at rest for a second (104 kgf, telemetry 79–186), rolls on at a crawl and reaches 25° of pitch 3.7 s after the start (run 1: about 3 s) at 343 kgf (telemetry 434). The whole run, start to settled, takes 17.8 s instead of 35.3 s and still scores 96; release to touchdown stays 4.8 s. The broadcast camera opens on the side shot with the car and the curl together. The Show and the Lineup are unchanged.
2026-10-21 · #0014 · No hover after the kickflip (SIM_VERSION 18). LAND now sizes its set-down to the fall it ends. After the Wall's 20 m drop it still brakes hard and sets down from 2.5 m, spending 2.0 s below 3 m as in the telemetry, and those runs are bit-identical. After the Lineup's 7 m kickflip it brakes straight onto the wheels: upright to touchdown in 1.6 s (it was 3.0 s), 3.5 s from lift-off to touchdown (was 4.8 s; the reveal took about 3 s), 26 m covered (was 35 m) and 107 kg of nitrogen (was 152 kg). It still touches down at 0.8 m/s. The Lineup's landing mark moves from 44 m to 28 m, just past the row, where the reveal landed, so the precision score no longer rewards drifting. The reference kickflip lands 0.5 m from it and scores 92 (was 85.3).
2026-10-21 · Driving feel (SIM_VERSION 17). Traction control now holds drive torque at what the tyre can carry (its slip peak) on every surface, instead of cutting to 15 % and letting the rears thrash at 20–80 % slip: launches are clean, 0–60 on tyres alone 3.3 s (the grip limit with weight on the rears). Keyboard steering slows with speed: full lock in 0.25 s at a crawl, ≈0.6 s at 60 km/h, ≈1 s at 120 km/h, so a tap at road speed is a lane change, not a swerve; it still centres in 0.12 s. Keyboard throttle ramps in over 0.3 s and the brake over 0.15 s. The phone's steering stick goes through the same speed-aware hands on the ground. Full lock at 144 km/h peaks at 1.45 G (was a 2 G wobble). References: Show 94, Wall 96.3, Lineup 85.3.
2026-10-21 · #0018 · The HUD reads the livestream's channels. PITCH runs up the deck from 0 to 90° on the vertical and 170° hanging at the top, then shows the nose's signed angle from level in the air. G is specific force over the last half-second, the window the results chip uses, so it reads 1.0 cruising and matches the braking peak (3.08 G off the Wall). The N₂ gauge shows kilograms left and tank pressure in bar (297 kg at 690 bar full, adiabatic blowdown), plus REG while the regulator holds line pressure and BLOWDOWN once it can't (about 192 kg left, during the Wall's brake). It all fits on a 390×844 phone, a phone held sideways, and a desktop. No sim change.
2026-10-21 · #0015 · Tyres take a moment to bite (SIM_VERSION 16). Turn the wheel or touch down with some sideslip, and the side force now builds up over the tyre's relaxation length, about 0.35 m of rolling at the front and 0.4 m at the rear (longer under load). Before, it arrived in the same tick. At 20 m/s that is about 18 ms to 63 % of the force; at walking pace about 0.2 s. A wheel that leaves the ground comes back with no side load and builds it up again. At a crawl the lag fades out, so parking and slow manoeuvres feel as before. 0–60, braking and steady cornering are unchanged (cornering 1.36 g against 1.35 g), and the reference scores are the same.
2026-10-21 · #0013 · Off the ledge the car now falls almost free, like the reveal's G trace (SIM_VERSION 15, on the rigid-body engine). LAND rolls it out in about 1.1 s using only the thrust the roll needs, upside down: 0.55 G over the first second off the Wall, against 1.27 G before (the telemetry shows 0.2–0.4 G). It then brakes late and hard through the blowdown, peaking at 3.1 G (0.5 s average) about 3.3 m up; the livestream showed 3.3 G at 6.5 m, and we read 2.1 G before. It reaches the top of the set-down (2.5 m) still behind its profile, catches it, and touches down at 0.8 m/s, 4.8 s after release (telemetry: 4.5 s). The front down-jets are now 23 kN and the rears 16 kN (research §11.5), giving 3.2 G of pitch-free lift. LAND reads the roofs below: passing over a parked vehicle it holds 1.2 m over the roof and keeps the ground beyond as its target, and only sets down on a roof if it has stopped over it. The references roll off the ledge instead of hanging, like run 2: the Wall at 2.5 m/s and the Show at its 7.5 m/s carry. The results chip shows the braking peak and its height, not the release kick, and a run settles only after the 0.3 s wheel-sync window.
## Unreleased — the rigid-body engine (SIM_VERSION 14)

**Every body and every contact on an open-source engine.** The sim's rigid-body dynamics, collisions and contacts now run on Rapier (rapier.rs, Apache-2.0), its cross-platform-deterministic WASM build. Evaluation (Rapier, Jolt, PhysX, Bullet/ammo.js, cannon-es, Oimo), the determinism proof and the numbers: docs/PHYSICS_ENGINE.md.
- **Determinism, proven.** An engine spike and the game's own clean and crash logs replay bit-identically in Node, Chromium, WebKit and workerd (the Worker that verifies scores), parked bodies' poses included (`scripts/engine-determinism.mjs`, `scripts/determinism.mjs`, `scripts/engine-worker/check.mjs`).
- **Every parked vehicle is its own 3D rigid body**: its own mass, CoM height and inertia tensor (LINEUP_SPEC first, class estimates after: `parkedPhysics`), a box collider from its ground clearance to its roof, and a suspended corner per wheel position from its axles (1.3 Hz cars / 1.8 Hz tractor, ζ 0.3) on parked tyres (locked, μ 0.8). It sleeps until touched; hit it and it rocks, slides at μ·g, shoves its neighbour, tips back below its static stability angle and rolls past it. Standing the roadster on a roof sinks it on its springs. Replay frames carry each body's full pose.
- **The roadster's hull is rigid** (a convex hull of its faceted body) over compliant skirts; its bodywork folds by the energy a contact puts into it (past the 4.2 kJ a patch stores elastically, by the excess over its 100 kN yield). Impact events (hit, scrape, tyre slam, crush) come from the engine's contacts, closing speed measured against what was hit before the step.
- **Materials per collider**: concrete floor, the Wall's deck (a closed trimesh sampled along its profile), the truss tower and the posts beside the curl (steel), the landing mark (paint: 0.85 of concrete's grip), parked paintwork, the roadster's skin; friction by the pair's lower value, restitution by their mean, with sources in courses.js.
- **The fan seals in strips**: eight patches of the skirts' sealed floor (2 across × 4 along) each leak on their own and pull where they are; the scheduled controller (#31) still reads the deck under the centre. (The single-point fan held full suction with the floor half over the Wall's lip.)
- **Touchdown sink** is read before the step as well as after (a rigid contact takes it out within the tick); a car at rest on its roof is flipped, not settled.
- Free Drive: the tyres read the exact road; the engine gets a 96 m near-car heightfield and the rails, walls and tunnel roofs as boxes, with its origin moved along with the car.
- The engine's WASM (1.2 MB gzip) streams in while the stage builds (first 3D frame +5 %); the Worker grows to 1.53 MB gzip (free limit 3 MB). A Show flight costs ≈0.8 ms per frame on a 4×-throttled CPU.
- References (with the Integrity category): Show 91.0 (90.7), Wall 93.0 (92.3), Lineup 86.7 (86.3); Advanced 100 / 100 / 98. The Wall reference now brakes at 93 % of the curl so it hangs with four wheels and its whole sealed floor on the ledge (it used to hang over the lip on a seal the old geometry faked). Naive sweeps 32/32 and 54/54 (unchanged); human Show with Assist 162 → 164 of 300 (HUD followers 62 → 60 of 62), median clean score 81.7 → 84.7; Pro 39 → 34; Advanced by hand 0 → 2 of 120.


2026-10-20 · #0012 · The fan is scheduled like the livestream's DOWNFORCE channel (SIM_VERSION 13): armed, it asks for the suction the deck's tilt needs (≈130 kgf rolling on the pad, ≈1,900 at 75°, ≈2,450 on the vertical, the 4,690 kgf cap hanging inverted), spools in 1.5 s and holds its demand; full throttle or a full stop fills the grip void up to the cap. The HUD's FAN reads kgf. The Wall reference climb reads within ±26 % of all six telemetry rows (was +981 % at 25°).

## 0.12.0 — 2026-10-20

**An instrument-grade HUD, and a Show you can fly with one thumb.** No sim change (SIM_VERSION unchanged): every new control writes ordinary, quantised inputs into the same log.
- **One HUD system** (src/ui.js, src/hud-landing.js, src/styles.css): a mission clock (T−3 → T+mm:ss.s), a phase timeline (run-up → climb → hang → release → carry → brake → touchdown; the Lineup: run-up → lift-off → roll → brake → touchdown), the primary instrument (speed on the ground; in the air the sink with the landing predictor built in: state, limit, time to ground, the descent tape with the BRAKE line), a telemetry strip (SPD km/h · ALT m · SINK m/s · LOAD g · N₂ % with the stop-cost tick · ATT bank/pitch °; FAN % on the deck), attitude (ADI + roll), and the vehicle (thruster array + the damage sensor as a first-class instrument: zones, %, Intact/Scuffed/Damaged/Wrecked, hit flash and buzz). Michroma for names, Geist for labels, Geist Mono tabular numerals; nothing under 11 px; every number carries its unit; numbers glide (≈90 ms lag) and touch the DOM only when their digits change; colour is state only (ink nominal, amber caution, red warning). Three layouts: a bottom cluster (fine pointer), a top stack (touch portrait), a top band with a dashboard strip (touch landscape). Free Drive's HUD speaks the same language.
- **Measured, not eyeballed.** `scripts/hud-audit.mjs` flies the Show at 13 viewports × 6 phases (+ Free Drive) and measures overlaps, text size and WCAG contrast on the screenshots (text against the worst 10 % of the pixels behind it, text hidden). Before → after: overlaps 19 → 0, off-screen 54 → 0, text < 11 px 1011 → 0, labels < 4.5:1 895 → 0. The title holds at every viewport (`scripts/title-audit.mjs`: 6 → 0 issues; the eyebrow no longer runs under the top bar at 1440×900).
- **One-thumb Assist** (src/onethumb.js, the touch default on the Show and the Wall): hold to climb (a crawl governor that stops on the ledge; let go and it brakes), tap to let go, hold to land (LAND's roll-out and brake, plus just enough carry over the row), and it brakes to a stop after touchdown. Classic (stick + pedals) remains for every tier.
- **Classic touch, rebuilt by reach** (`scripts/thumb-reach.mjs` heatmaps): the action you need now sits mid-band under the right thumb, the rest either side on the same arc, and each phase shows only what it uses (RELEASE appears at the top of the curl, BOOST until the row is behind you, LAND or LIFT by tier). A 15 % stick dead zone (a resting thumb used to fly the car). Left-handed mirror.
- **Tilt steering** (off by default; iOS permission from a tap; calibrate; ±20° = full lock in 5 % steps) and **haptics** on Android (release, touchdown by sink, the descent leaving green, contact). No pinch zoom, double-tap zoom or long-press callouts. Low-memory phones default to `gfx=low`.
- **Phone success, same seeded population** (`scripts/human-phone.mjs`, the human-show players with thumbs, reach, a resting thumb; 300 runs each): 390×844 classic 41 % → 63 %, one-thumb 100 %; 430×932 41 → 63 / 100 %; 844×390 42 → 65 / 100 %; 932×430 43 → 67 / 100 % (SIM_VERSION 14; keyboard human-show on the same sim: 55 %). On the real page (`scripts/play-human.mjs … thumb`), one-thumb landed 5/5 at 390×844 and 844×390 (score 83.3, 8.6 m from the mark vs 28 m for the classic bot).

## 0.11.0 — 2026-10-20

The damage sensor.
- `src/sim/damage.js`: per-zone damage (nose, tail, left, right, roof, floor, suspension) from the sim's own impact events and permanent crush: hits ∝ impact energy (100 % at 14 m/s ≈ a barrier test), scrapes grind, tyre slams past 3 m/s bend suspension, crush sets a floor. Integrity = 100 − (0.6·worst + 0.4·mean). Deterministic, so the Worker's re-simulation agrees.
- HUD: the car from above, each zone shaded (scuff / amber ≥ 10 % / red ≥ 40 %), the total %, a flash on each hit.
- Judges: a new Integrity category on every event (Engineer weighs it 15 %, Designer 12 %, Coordinator 8 %); 60 % damage or worse is a wreck, capped like a crash, verdict "Wrecked". Results show "% intact"; the AI panel gets the damage line with the worst zones.
- Reference runs read ≤ 2 % (skirts brushing the ledge); a drop onto the row reads ≈37 %.


## 0.10.0 — 2026-10-20

**Learn to land, then fly it by hand** (SIM_VERSION 11). The landing was the wall people hit: a model of human play (reaction time, keys, following the cues; `scripts/human-show.mjs`) landed the Show clean 10 % of the time with Assist and never in Pro. Diagnosis: holding LAND upside down rolled the car out at ≈0.5 rad/s (the leveller's sine law asks for nothing at 180°), so a player who held it from the release hit the ground still rolling; the cues said to roll first and LAND after, which left 10 m to stop from 19 m/s; boosting until the cue went (one reaction time of 80 kN) carried 19 m/s and landed 60 m long; full throttle up the curl threw the car off the lip at 24 m/s; the governor planned its brake on today's tank pressure and ran out of thrust in the last metre once the tanks blew down; nothing on screen said when braking had to start; and Shift (LAND in the air) fired the rear jets after touchdown.
- **Assist's flight computer, tuned for a novice.** LAND rolls out decisively (inverted: 2 rad/s per radian of tilt, the nearer way; banked past 20°: 3 rad/s per radian, so it isn't braking sideways for the last half of the roll-out); plans its brake on the pressure left at the end of the stop; holds the line (banks up to 11° against sideways drift, stick centred); and protects the lift it needs (falling faster than its profile, the stick's tilt authority drops to a quarter). Assist also limits the crawl up the curl (drive torque fades above 8 m/s on any slope) and the airborne carry (the rear jets fade out at 10 m/s, and shut while LAND brakes: a thumb left on BOOST no longer drains the stop's gas). Traction control and ABS are on in every tier (they're the drivetrain, not the flight computer). Shift boosts only on the run-up.
- **Tiers that keep scores honest.** Assist ×1.00 (governed), Pro ×1.08 (rate control, no LAND governor), Advanced ×1.15 (ten valves by hand, no computer at all). The tier comes from the replayed inputs (any Assist tick makes an Assist run), so the client, the replay and the Worker agree without trusting a flag. The results say what the tier paid, and the AI panel is told.
- **Advanced: per-thruster control.** The input log gains `manual` and ten valve channels (23 channels; 12-channel logs from older clients still verify, missing channels as zero). Keyboard laid out like the car: Q E Z C the down-jets, W S A D a pair (side pairs trimmed: a pure roll), Space all four at the pitch-free trim, V B N M the rear row, F all four, 1 3 the fender jets, Shift half-open; held keys open over 0.2 s; with Space held, a pair key throttles the opposite pair back. Gamepad: bumpers and analog triggers are the four corners, A boost, Y lift, X/B the fender jets, d-pad the rear pairs. Phone: a car-shaped nozzle pad with a pad per nozzle and LIFT / BOOST / FRONTS chords, multi-touch, slide between pads, pressure where the device reports it. The HUD's nozzle diagram shows each valve's ring and key.
- **The landing HUD** (src/sim/predict.js, src/hud-landing.js): sink in a green / amber / red band calibrated to outcomes (red = even full lift touches down harder than 3 m/s; amber = the stop has to start within 0.6 s), the descent tape with the BRAKE line (the roll-out, the stop at the mean of today's and the end-of-stop thrust, a reaction time and a metre), time to ground, a gas tick for what the stop costs, an attitude indicator whose horizon turns over when you're upside down, a roll-out cue that says LET GO a reaction time early, and a touchdown ring on the ground. An optional pilot view (L) rides behind the car for the descent: the side shots see a roll end-on.
- **Practice.** Four drills from deterministic moments of the reference flight: on the ledge inverted, just let go, over the row (the boost alone), 10 m up. Instant retry (R), slow motion (T: ½×, ¼×), the reference's ghost alongside (warm) as well as your best (cool). Not scored, never posted, no AI call.
- **The coach.** After every run and drill, the fixes that matter, with the numbers from a replay of your log: "You started braking at 4.8 m, falling 17.8 m/s. With 9.8 m/s² of braking available, the stop needed to start at 16 m."
- Human success, same seeded population (`node scripts/human-show.mjs 300`): with Assist, 10 % → 53 % landed clean (98 of 100 players who follow the cue or the HUD; those who brake at 8 m or 4 m can't be saved by any controller). Pro 0 % → 12 %. A cue-following player on the real page (`scripts/play-human.mjs`, reading only the screen, real keys and multi-touch): production 0/3 on keyboard and 0/3 on a phone (touchdown at ≈20 m/s), this build 3/3 and 3/3 (1.4–1.7 m/s). Naive sweeps: Show 46/54 → 54/54, Wall 32/32. Advanced flown by perfect hands (the reference pilot on the valves, 5 % steps): Show 100, replays bit-exactly in Node, Chromium and WebKit, and the Worker gives the same card.
- References: Show 89.0 (was 87.3), Wall 91.0 (88.0), Lineup 85.0 (85.0). The reference pilots are unchanged; with LAND no longer braking sideways through the roll-out they land nearer the mark (Wall 11.2 → 5.7 m from it, Show 2.6 → 2.3 m), and the sink and tilt are the same. That precision is the whole gain.

## 0.9.2 — 2026-10-20

- Fixed NaN mid-trick in Pro mode (SIM_VERSION 10). A held roll + yaw spun the car up until the explicit gyroscopic term overshot in one tick and the state went NaN (HUD showed NaN, car froze). Rotation now integrates angular momentum in the world frame (stable at any spin rate) and air resists a spinning body (quadratic rotational drag, ESTIMATE). A non-finite state now ends the run cleanly ('sim-fault') instead of drawing NaN. Fuzzed: 0 NaN in 3,000 random Pro tricks. References: Show 87.3, Wall 88, Lineup 85.

## 0.9.1 — 2026-10-20

- Restart, Jump again and the title now clear everything the last run layered over the stage. The judges' theatre (and its in-flight call) is aborted instead of playing on over the next run; the AI sheet and cues close too. Regression test: tests/e2e/overlays.spec.js.

## Unreleased

**The launch complex and the film look** (rendering only; no SIM_VERSION change).
- **A launch vehicle on the horizon** (`src/render/rocket.js`, docs/ROCKET.md): a reusable two-stage orbital vehicle at real scale (70 m, 3.66 m core, 5.2 m fairing, grid fins, folded legs, interstage), our own livery (flight-proven soot, one red hairline, no marks), on its mount on a raised pad with a lattice strongback, crew access arm, three lightning masts, a water tank, a tank farm and four flood banks. Night: floodlit with a key, a fill and a rim, vapour venting off the vents and the cold base, synchronised obstruction beacons, the floods' beams. It stands 265 m off the Show and the Wall (in frame on the title, the climb and the carry over the row) and on the Lineup's horizon. Rare on the title: a static fire (glow under the mount and at the trench exit, the vehicle lit orange, a steam cloud); never with reduced motion. A lazy chunk (8 kB gzip) streamed in after the first frame and compiled off the main thread; ~6 draw calls, one shader, no scene lights.
- **Atmosphere** (desktop, `src/render/film.js`): exponential height fog integrated per pixel from the depth buffer, and the light every lamp scatters into the air along each ray (closed form, cut off by whatever stands in front), plus a soft vignette.
- **Wet slab**: the night stage's concrete is damp with standing water in places (smoother, darker where wet, every tier); on desktop a half-resolution planar reflection of the Wall, the LEDs, the row, the car and the rocket, smeared along the view like wet concrete.
- **Contact shadows** under every parked vehicle and under the car (fading as it leaves the ground), every tier.
- The roadster's clear coat is crisper over the same satin base; the glass is a touch more reflective.
- New tools: `scripts/perf-show.mjs` (frame times and render CPU per course, phone 4× throttle or desktop) and `scripts/shots-film.mjs` (title, climb, carry, landing, Lineup, phone, static fire, a close look at the vehicle). `scripts/flicker.mjs` waits for the backdrop and reports it as its own region.
**The parked row, at true size** (SIM_VERSION 12). The five vehicles from the reveal's lineup were researched (docs/VEHICLES.md: owner's-manual dimensions, EPA and press figures, every number tagged and sourced) and rebuilt.
- Physics data (`LINEUP_SPEC`, src/sim/courses.js): sedan 4.720 × 1.850 × 1.440 m, 1,705 kg; crossover 4.790 × 1.920 × 1.624, 1,842 kg; semi tractor 6.32 × 2.59 × 4.11 (the reported height as parked), 10,433 kg; pickup 5.683 × 2.032 × 1.794, 3,009 kg; cab 4.445 × 1.753 × 1.407, 1,412 kg. Each entry also carries plain data for a rigid-body engine: mirror width, ground clearance, wheelbase, axles (position, track, tyre radius and width, twin tyres), CoM height and position, and roll/pitch/yaw inertia (ESTIMATE). `PARKED_MASS` now reads the researched curb masses.
- The row is 0.33 m shorter along the approach (pickup and cab are narrower), the semi 0.26 m taller; the Show's row still starts at `rowNear` −10 m. References unchanged: Show 89 (clearance over the row 12.2 → 11.9 m), Wall 91, Lineup 85; naive sweeps 32/32 and 54/54; human-show 159/300 (same as before). A crash test's too-low pass now flies a 2.9 m apex (was 2.8) to still clip and roll.
- Models (src/render/parked/): each vehicle is built from its spec entry (length, width, height, axle positions, track, tyre sizes), with its own silhouette: the sedan's glass-roofed fastback and wrap-around tail lamps; the crossover's tall fastback, full-width nose and tail bars; the semi's bullet cab with a wrap-around screen, built-in roof fairing, chassis fairings, fifth wheel, twin-tyre tandem, amber roof markers; the pickup's flat stainless triangle with angular black arch flares and full-width bars; the cab's gold teardrop with one canopy, no mirrors, no rear window, flat colour-matched covers and bigger rear wheels. Lamp strips are laid on each body by raycasting and run as subtle sliver-guarded running lights at night. All our own designs: no badges, no names.
- Budget: the row drops from 166 meshes to 63 (merged per material, instanced wheels): 126 draw calls with the shadow pass, was 332; 101k triangles, was 131k (`node scripts/shots-lineup.mjs`, which also takes the studio and row screenshots). Before/after sheets: docs/shots/vehicles/.

**Build, power-ups and side quests** (no SIM_VERSION change: the scored courses never construct the layer). A Sandbox (a flat 400 m apron, `?drive=sandbox`) and every Free Drive road gain:
- **Build mode** (B): kicker, wedge, quarter-pipe, half-pipe, loop (18 m, a helix with guide rails), wall blocks, boost pads, landing pads, rings, parked cars, a barge, crates, and power-up pickups. Grid snap (0.5 m, 15°, 0.25× scale), Place/Edit, ghost in ice (fits) or signal red (and why not), stacking, materials (concrete, steel, wood, rubber: their own grip and slide in the tyres and the hull), undo/redo, an 80-point budget. Keyboard path for everything; on a phone a radial menu, tap to aim, drag the ghost, pinch zoom, two-finger twist to turn, drag from the palette onto the world. Saved on the device as you go, named saves, and share links that carry the whole build in the URL hash (11 bytes a piece, no server).
- **Colliders are real**: each piece is an exact signed distance field in the same `surface()` the car already drives on (src/build/colliders.js), so the car drives up a kicker and flies (≈6 m and 35 m at 80 km/h), loops the loop at 90 km/h, rides a quarter-pipe up and back. The meshes are drawn from the same numbers.
- **Power-ups** (Arcade toggle, opt-in): nitrogen refill, overpressure, fan overdrive, slow-mo, magnet landing, shield (impact events dropped, crush held, and a damage sensor told to skip them). HUD gauges.
- **Side quests** (J): rings, landings, jumps, airtime, rotations, speed, deliveries, hidden pieces, collecting; time limits; rewards unlock pieces, paints and titles on this device. Eight built-in quests, a deterministic offline generator, and an **AI quest designer**: the free edge model or the player's own key writes a quest as JSON; the Worker (`POST /coldgas/api/quest`) and then the browser validate it against a strict schema (closed keys, catalogue pieces, bounds, budget, winnable objectives, no brand names); anything else falls back to the local generator. The call plays through the theatre (prompt → compute → check → quest) with real model, tokens, time and cost.


**Free Drive: the endless road, and back on the road from the grass** (no SIM_VERSION change: the
stunt courses never touch the changed surfaces, and their reference runs are bit-identical,
`node scripts/ref-hash.mjs`).
- **Back on the road from the grass.** Off the road you often couldn't get back on. Two causes: the
  ground beside the road was the natural mountainside, or the structural 1:1.5 fill / 1:1 cut, right
  up to the shoulder (34–45°, where a rear-driven car on grass climbs ≈ 17°, and a 1:1 cut tipped it
  over its nose); and traction control's floor (15 % of 11.8 kN·m) was more than a tyre carries on
  grass, so the wheels stayed spun up at κ ≈ 13, at half the tyre's force, and the car slid back down
  an 11 % verge. Now the roadside is a graded 1:4 apron for 7 m past the shoulder (the AASHTO
  "recoverable" slope; rounded hinge; blended where hairpin legs meet), and on loose ground (grass,
  gravel, rock, sand: a new `loose` flag) traction control scales its floor with grip² and holds
  torque to what the tyre can carry. Drives back on from 4 m out: 61–73 % → 84–100 % of verges per
  road; from 8 m: 56–80 % → 76–97 % (`node scripts/grass-probe.mjs`, unit-tested on every road).
- **Endless** (`?drive=endless&seed=…`, a fifth card in the road picker with a seed and a share
  link): a world generated as you drive, deterministic from its seed (docs/WORLD.md). Mountain passes,
  a coast road above the sea, desert mesas and dunes, forest; viaducts, guard rails, delineators;
  spruces, broadleaves, shrubs and boulders. Terrain in four LOD rings out to the horizon and the
  road chunks are built in a Web Worker; GPU-instanced vegetation pools; LRU + IndexedDB tile caches;
  GPU and cache budgets with disposal; a per-frame upload budget; quality tiers. At 250 km/h on a
  4×-throttled phone profile: 60 fps, 0.75 ms/frame on the main thread, never behind.
- **A world API** for building in it: `addObject` / `removeObject` / `objectsNear` /
  `objectsInChunk` / `groundAt` / `nearestRoad` / …, deterministic object ids, and ramps, blocks and
  loops that collide through the course's one physics query (boost pads and power-ups are triggers).

**Free Drive** (no SIM_VERSION change: the scored courses and their replays are untouched). The same roadster and physics on real roads rebuilt from open data: Stelvio Pass (13.3 km, 45 hairpins, to 2,749 m), Transfăgărășan (14.6 km to Bâlea Lake), Big Sur on CA-1 (15.4 km over Bixby Creek) and the Atlantic Ocean Road (9.0 km, eight bridges).
- Data (build time only, `scripts/roads/build.mjs`, docs/ROADS.md): OpenStreetMap centrelines and tags (ODbL) and AWS Terrain Tiles (EU-DEM, USGS 3DEP, Kartverket, ETOPO1), resampled every 3 m, graded to each road's design maximum, widened through hairpins, banked from curvature; barriers from OSM and drop-offs; terrain, tree cover, lakes and a DEM skyline. 182–472 KB gzip per road, fetched from our own origin only when picked.
- Physics (`src/sim/roads.js`, pure, no transcendental Math calls): a road course whose `surface()` is the ribbon (continuous through bends), terrain conformed to the road (cut 1:1, fill 1:1.5), and rails, stone walls, parapets and tunnel walls as solids; asphalt, gravel, grass, rock and barrier materials. Courses gain one hook (`course.sdf`), `createVehicle` accepts a course object.
- Rendering (`src/render/road.js`, `roadlook.js`): streamed 3-level terrain with holes and skirts, 192 m road chunks (asphalt and paint in one shader, verges, walls, W-beam rails with instanced posts, delineators or Norwegian snow poles, bridge decks and piers), instanced spruces and oaks from the OSM forest mask, sea and lakes, a time-of-day sky (Day, Dusk with headlamps), haze toward the sun.
- UX: a Free Drive card on the title opens a road picker (silhouette, profile, length, climb, hairpins); HUD with speed, elevation, grade, distance, minimap and profile, and the data credits; chase, bumper and cinema cameras (C), Day/Dusk (T), suction fan (X), back on the road (R, and automatically after a rollover or a swim), reverse by holding brake; a best time start to end per road. Deep link `?drive=<road>[&tod=dusk]`.
- Crash effects land on whatever the ground is (sparks, chips and torn-off parts used to assume y = 0).

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
