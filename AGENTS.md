# AGENTS.md — Operating manual for COLD GAS

Everything an agent (or human) needs to work on this game. Read it fully before changing
anything. `CLAUDE.md` points here.

## 1 · Product vision

COLD GAS is one perfect moment, made playable: a roadster runs up a kicker, fires ten cold-gas
thrusters to clear a row of parked EVs, rolls 360° in the air, retro-burns and sticks the
landing on a pad, and a three-judge panel scores it. It is inspired by the October 2026
roadster thruster-jump reveal, and its whole aesthetic is **keynote restraint**: blue-hour
light, matte concrete, clear-coat paint, hairline type, near-silence and the hiss of the jets.
Every object is our own design. No brand names, logos, badges or real model names, ever
(invariant 3.7).

The game is the jump. There's no campaign and no garage sprawl. Depth comes from mastery:
amplitude, rotation (360 → 720), clearance, touchdown sink rate, wheel sync, precision on the
mark, and air left in the tanks.

### The 10x pillars (north star — the Scout steers here, in this order)

1. **Perfection of the one moment.** Physics that feels exact (the sim is the IP), a landing
   you can feel in the camera and the sound, plumes that look like cold gas rather than fire,
   and a replay you want to watch twice. Polish beats features.
2. **Mastery and fairness.** A deterministic sim, server-verified scores (the Worker replays
   the input log), legible judging (every category explained), three flight tiers (Assist,
   Pro, Advanced: ten valves by hand), a skill ladder (drills, the landing HUD, the coach), and an
   honest leaderboard.
3. **The panel.** The AI judges' voices (src/worker → Claude) must be specific, short and in
   character, never generic. The numbers come from `src/sim/judge.js` and nowhere else.
4. **Craft.** Every pixel intentional: Michroma/Geist type, hairlines, a single signal red,
   motion with an ease and a reason, `prefers-reduced-motion` honored. The procedural vehicles
   (src/render/cars.js) should keep getting more beautiful.
5. **Everywhere.** Keyboard, gamepad and touch are first-class; it runs well on phones.
6. **Code health** that enables the above: pure sim modules with tests, zero per-frame
   allocations in hot paths.

## 2 · Live

- Production: https://mutaafaziz.com/coldgas/. It's served by the `cold-gas` Cloudflare Worker on the
  route `mutaafaziz.com/coldgas*`. The rest of mutaafaziz.com is another repo. Never touch it
  from here.
- API (src/worker/, frozen):
  - `POST /coldgas/api/judge/stream` replays the log, scores it, and streams the AI panel as
    server-sent events: `verify → prompt → reasoning/token… → done | error`.
  - `POST /coldgas/api/quest` (side-quest designer) calls the same providers (edge default, or the
    player's key as `x-cg-key` for that one call), streams through the theatre, and sends a quest only
    if it passes `src/build/quest-schema.js` (the browser checks again). Rate-limited (edge: 12/h per
    player, 250/day; BYOK shares the judges' 90/h).
  - `POST /coldgas/api/models` (BYOK connect) asks a provider for its live models and suggests one.
  - `GET /coldgas/api/providers`.
  - `POST /coldgas/api/scores` (verified board entry) and `GET /coldgas/api/scores?board=today|all`.
  - `POST /coldgas/api/obs` (src/worker/obs.js): the client's observability beacon. ≤ 8 kB, strictly
    validated (`cleanObs`), 30/h per player and 3,000/day overall; aggregated in D1 (`obs_err` per
    signature/build/day, `obs_frames` histograms per device class/tier, `obs_evt` counters, `obs_ex`
    exemplar stacks; month-long retention). No IPs, user agents or headers stored.
  - `GET /coldgas/api/obs/digest[?build=]`: top signatures, `regressions` (new or ≥ 2× per session
    vs the previous build, and p95 frame-time regressions), frame percentiles. Cached 5 min.
  - D1 database `cold-gas` (binding `DB`, auto-provisioned, tables self-created).
- **The judges' brain** (src/worker/ai/):
  - Default: Workers AI (binding `AI`). `@cf/google/gemma-4-26b-a4b-it` runs with thinking off;
    if it's unavailable, `@cf/meta/llama-3.1-8b-instruct-fp8` takes over. A judging costs about
    13 neurons. The cap is 700 a day and 40 an hour per player, inside the 10k-neuron free allowance.
  - Bring your own key: Anthropic (official SDK, low effort), and OpenAI, xAI and Gemini (OpenAI SDK
    against each one's OpenAI-compatible endpoint). The key lives in the player's localStorage. It
    reaches the Worker as `x-cg-key` for one call and is never stored or logged. Base URLs are
    fixed, and the prompt is built server-side from the verified card, so the Worker can't be used
    as an open relay.
  - When no provider answers, the panel speaks from local lines (src/panel.js).
- **The judges' theatre** (src/ai/theatre.js, a lazy chunk with `aurora-field`) shows every call live:
  - Particle stages: circuit board → telemetry as text → compute die (one signal per token) → verdict.
  - Panels around it: a model card, counters (tokens, time to first token, tok/s, neurons, cost)
    and the raw stream.
  - Afterwards the results receipt offers *Replay the call* and *Inspect the call*: the system
    prompt, the user prompt and the raw response.
- Deploy = merge to `main`: Workers Builds (connected 2026-10-19) runs `npm run build` then
  `npx wrangler deploy`, and pull requests get preview builds. Rollback = revert the PR.

## 3 · Invariants (breaking any of these fails review)

1. **It must boot.** A playable title with zero console errors on current Chrome, Safari and
   Firefox, desktop and phone. `tests/e2e/smoke.spec.js` guards this.
2. **Base path.** Served under `/coldgas/` (Vite `base`, `build.outDir` = `dist/coldgas/`).
   Never use root-absolute URLs. Use `import.meta.env.BASE_URL`.
3. **Own origin only.** Everything is bundled (fonts via `@fontsource`), and the only API is
   `/coldgas/api/*`. No third-party hosts, analytics, trackers or CDNs. The smoke test fails on
   any non-localhost request. No accounts and no personal data. Initials are 3 letters.
   **One exception: ads (the owner's decision, 2026-10-30, "split by audience").** The page may load
   Marquee's same-origin loader `/ads/v1/ads.js` (the Marquee Worker beside ours on mutaafaziz.com, so
   this one URL is root-absolute, an exception to 3.2) through `src/ads.js` only, with `data-app="coldgas"`
   and the slots `title:banner:menu`, `postrun:interstitial:menu` and `reroll:rewarded:menu`. Rules:
   - **No ads during a run.** Nothing in the countdown, a live run, a drill or Free Drive/the Sandbox: the
     banner is on the title, the interstitial fires only when a results sheet is left (Retry/Home) after the
     judges have spoken, never after the first run of a session and at most once per 3 minutes.
   - **Google ads (via Marquee) appear only in menu contexts.** Every slot is declared `menu`; never declare
     a `gameplay` slot.
   - **Rewarded is opt-in only:** the player presses "Watch an ad · ask the panel again"; the reward is fresh
     words from the panel, never a score (5). The button is hidden when the slot can't fill.
   - **Never block the game on an ad:** every call resolves at once with no fill; `beforeAd` holds the
     replay and the audio, `afterAd` resumes them; a missing `window.marquee` is a no-op.
   - The loader is fetched only off localhost (or with `?marquee=`), so the smoke test's own-origin rule still
     holds locally; `tests/e2e/ads.spec.js` proves no ad call fires during a run.
   No other third party, analytics or tracker is allowed by this.
4. **Determinism and realism.** `src/sim/*` is pure. Its rigid-body engine is Rapier's
   cross-platform-deterministic WASM build (docs/PHYSICS_ENGINE.md: bit-identical in Node,
   Chromium, WebKit and workerd; re-run `scripts/engine-determinism.mjs` and
   `scripts/engine-worker/check.mjs` after bumping it). Our own code uses `dmath.js` (dsin, dcos, datan,
   datan2, dacos, dhypot), never `Math.sin`/`atan2`/`hypot`/`pow`: engines differ in those by an
   ulp and the stunt physics is chaotic, so runs would score differently on Safari, Chrome and the
   Worker. `npm run determinism -- logs.json` replays logs in Node, Chromium and WebKit and
   must print IDENTICAL. It uses no `Math.random`, no wall clock, no DOM and no
   three.js, and it's fixed-step at 240 Hz. A run replays bit-exactly from its input log
   (`tests/unit/sim.test.js`). Any change to the sim or the scorer that changes outcomes bumps
   `SIM_VERSION` in `src/sim/run.js`. Physical numbers live in `spec.js` with a source or an
   ESTIMATE note; never tune the car to "feel" without saying what real quantity changed.
   `node scripts/physics-bench.mjs` (0–60, braking, cornering) and `node scripts/naive-players.mjs`
   (32 simple strategies must all land upright with Assist) are the realism and accessibility
   gates: run them for any physics change, with `node scripts/human-show.mjs 300 assist --cues=new`
   (players who follow the cue or the HUD land ≥ 95 %).
5. **Scores are decided by `scoreRun`.** The AI writes words only. The client never sends a
   score: the Worker replays the log.
5½. **AI usage is always visible and honest.** Every model call goes through the theatre and
   the receipt. Real model ids, token counts and costs are shown, with an estimate only where
   the provider doesn't report them. Keys are never logged, persisted server-side or echoed.
   No AI call may block the results: a 35 s deadline falls back to local lines.
6. **Frame budget.** 60 fps on a mid-range laptop and playable on a recent phone. No per-frame
   allocations in hot paths (reuse vectors and arrays). Graphics tiers: `?gfx=low|mid|high`. One look
   everywhere (0097): phones and tablets boot `high` like a desktop (same effects, shadows, film look,
   reflection, mist, geometry, pixel-ratio cap 2); only a ≤ 2 GB Android phone starts `low`. What a device
   can't afford comes out of its pixels first (the governor in-session, the ledger at boot); a tier drops
   only for a device still slow at the resolution floor (src/gfx-tier.js, src/obs/ledger.js).
7. **IP caution.** No real brand, product or person names, logos or likenesses anywhere: code,
   copy, assets or AI prompts. Vehicles are invented ("Sedan", "Crossover", "Pickup", "Cab",
   "Semi"). The fine print says it is an independent fan game.
8. **Accessibility floor.** Every control has a keyboard path, text holds 4.5:1 contrast on the
   HUD (measured on screenshots: `node scripts/hud-audit.mjs <url> <dir>`), no HUD text under 11 px,
   no overlaps at 390×844 · 430×932 · 768×1024 · 1280×720 · 1920×1080 (both orientations), the iPads
   (820×1180, 1024×1366, both ways), a 320 px column, a notch-inset pass, and the book-style folding phone
   as measured, each pose with its own insets (in a tab 382×580 · 594×368 · 678×384 · 669×871 · 951×589 and
   the 466×498 mid-fold; installed 669×930 · 951×648 · 466×657 · 678×445; scripts/audit-plan.mjs FOLD, 0103), a flip
   phone's screens (estimates: 360×748 · 800×300 inner, 360×380 · 424×360 cover; FLIP, 0104), and a reported hinge kept
   clear (tests/e2e/segments.spec.js, 0105)
   (`node scripts/title-audit.mjs`
   too; both are a gate, `npm run audit`, and the judges' theatre's controls are 44 px targets), colour on the HUD means state only (ink nominal, amber caution, red warning), and `prefers-reduced-motion`
   disables shakes and big transitions.

## 4 · System map

```
index.html            Markup: canvas, top bar, title, HUD, touch, results, board, pause
src/main.js           Entry: state machine (title → countdown → live → results ⇄ replay),
                        fixed-step clock, sim → scene sync, deep links, wiring
src/sim/              PURE, shared with the Worker:
  engine.js             the rigid-body engine: Rapier (deterministic build, Apache-2.0,
                          docs/PHYSICS_ENGINE.md); `initPhysics()` once per process before any run
                          (engine-web.js in the browser, src/worker/physics.js in the Worker, plain
                          call in Node, tests/unit/setup.js in Vitest)
  world.js              a run's engine world: the course's colliders (floor, the Wall's deck as a
                          trimesh, its steel; Free Drive's world near the car streamed in 16 m cells:
                          ground, rails, arches, bridges, trees, boulders, placed pieces), each parked vehicle as a
                          3D rigid body on four suspended parked tyres, the roadster's rigid hull,
                          ray casts, per-material friction/restitution
  m3.js                 allocation-free vec3/quat math
  spec.js               THE CAR: dimensions, mass, inertia, power, tyres, fan, nitrogen, ten
                          nozzles. Public reveal numbers where they exist, marked estimates elsewhere
  courses.js            THE COURSES as exact geometry: the Wall (9.5 m arc turning 170° + 5.5 m
                          inverted ledge, 19.8 m lip), the Lineup (no ramp, five parked EVs) and
                          the Show (one flight: the row parked across the approach under the
                          ledge, pad beyond it); MATERIALS (tyre grip, bodywork friction and
                          restitution per surface); parkedPhysics (each parked vehicle's mass,
                          CoM, inertia, suspension: LINEUP_SPEC first, class estimates after);
                          `surface()` = the exact geometry for the renderer, HUD and tests
  vehicle.js            physics v3: 6-DOF body (its contacts in the engine), raycast suspension, Pacejka tyres
                          with implicit wheel spin, TC/ABS, stiction, 2 g suction fan, cold-gas
                          nozzles with blowdown, mixer, flight computer (Assist: rates, LAND roll-out,
                          brake governor, auto-land, carry over the row, line hold, envelope, crawl and carry limits / Pro: rates /
                          Advanced: `manual`, valves straight to the nozzles)
  run.js                one attempt: input log (23 channels: 12, `manual`, ten valves; 12-channel
                          logs still verify), tier telemetry, phases drive → ramp →
                          air → landed, telemetry (Show: clearance, crossedRow), simulate();
                          replay frames carry each parked body's pose; run.impacts = the crash
                          ; the aftermath (browser only, unscored): after 'done' the car brakes to
                          rest on a fixed post-crash input before the world is freed (0062)
  impacts.js            impact events (hit / scrape / tyre slam / crush: tick, point, normal,
                          speed, part, body) in fixed typed arrays, written by vehicle.step
  autopilot.js          reference runs for both courses, closed-loop through the same physics
  judge.js              scoreRun: per-course categories → three judges → total /100 + verdict;
                          TIERS (Assist ×1, Pro ×1.08, Advanced ×1.15) from the flown inputs
  predict.js            the descent from here: sink band, BRAKE line, time to ground, touchdown
                          point, gas to stop, roll/pitch to level (HUD, coach, drills; not scored)
  damage.js             the damage sensor: per-zone % from impact events + crush; judges' Integrity
  coach.js              re-flies a log and names the fixes, with the numbers (results sheet)
  roads.js              FREE DRIVE's real roads as a course: parse the baked asset, segment grid,
                          ribbon (width, grade, banking) + conformed terrain + rails/walls/tunnels
                          as one `surface()` (courses.js defers to `course.sdf`); unscored.
                          Beside the road: a graded 1:4 apron, then the structural slopes
  endless.js            FREE DRIVE's endless road: seeded terrain (four biomes) and a road generated
                          northward forever, the same shape as a baked road; `course.sdf` (docs/WORLD.md)
  noise.js              integer-hashed value noise with analytic gradients (pure, deterministic)
  scenery.js            FREE DRIVE's trees, shrubs and boulders: one placement (per 128 m tile, a fixed grid
                          on every gfx tier) the renderer draws and the physics streams near the car (trunks
                          and boulders solid, brush and crowns soft): what you see is what you hit
  objects.js            placed objects (ramps, loops, boost pads, power-ups): deterministic ids,
                          SDF colliders, triggers, collider primitives for another engine
  complex.js            THE LAUNCH COMPLEX as geometry: pad, mount, vehicle, strongback, masts, tank,
                          buildings; the renderer draws it, world.js makes it solid near the car
  rocket.js             THE ROCKET as a machine: engines, static fire (thrust, mass flow, mass,
                          hold-down), the trench's jet on a car, the ascent (Tsiolkovsky, drag, gravity turn)
  props.js              loose things: cones, barriers, the Sandbox's parked car as rigid bodies
                          (mass, CoM, inertia, colliders, materials), streamed and pooled by world.js
                          (docs/OBJECTS.md: what every visible object is to the physics)
src/build/            BUILD · POWER-UPS · SIDE QUESTS (the arcade layer; Free Drive and the Sandbox only,
                        never a scored event): catalogue.js (pieces, materials, power-ups, budgets) ·
                        colliders.js (each piece as an SDF + the mesh drawn from the same numbers: the
                        thin collision adapter a rigid-body engine would replace) · objects.js (the
                        world-object store: addObject / removeObject / objectsNear / sdf, composeCourse)
                        · layer.js (host interface, sensors, quest runtime, saves) · editor.js (build
                        mode) · ui.js + build.css · render.js (instanced) · encode.js (#b= builds) ·
                        quest-schema.js (the gate every quest passes, shared with the Worker) ·
                        quest-gen.js (deterministic local generator) · ai-quest.js · powerups.js ·
                        quests.js · sandbox.js / arena*.js (the Sandbox) · road-host.js (roads)
src/drive/            FREE DRIVE (lazy chunk): index.js (picker → load → drive loop, reset (lets go: freshRun),
                        timer, AI drive: O / a pad's Y / the HUD switch, offered after two resets in 2 min),
                        load.js (fetch + gunzip from our origin), camera.js (chase / bumper /
                        cinema), hud.js (picker cards, HUD + the AI drive switch, minimap, credits), pilot.js (a road-
                        following driver for tests and shots), manifest.js (GENERATED), drive.css
src/world/            THE ENDLESS WORLD, drawn (lazy, docs/WORLD.md): endless-world.js (LOD rings,
                        budgets, caches, the world API), terrain.worker.js (tilegen.js tiles and
                        roadchunk.js road chunks off the main thread), cache.js (LRU + IndexedDB),
                        pool.js (instanced props), lod.js (detail swaps with hysteresis), look.js, objects-view.js
src/render/           three.js (r186):
  scene.js              renderer, composer, course switching (`setCourse`), lineup world,
                          sliced first load (`stage.ready`: build, bake, compileAsync, fade in)
  wall.js               the night stage: the Wall's deck sampled from `wallProfile`, truss,
                          LED edges, searchlights, pad
  roadster.js           the hero car, matched to the reveal (research §10): faceted body, lamps,
                          wake / brake / aero / skirt / nozzle states from what the renderer sees
  cars.js               the ghost, `wheelCenterY` contract, makeParked → parked/
  parked/               the lineup, one procedural model per LINEUP_SPEC entry at its researched
                          size (docs/VEHICLES.md): kit.js (curves, swept and faceted bodies, lamp
                          strips and panels raycast onto a body, instanced wheels, per-material
                          merging), smooth.js (sedan / crossover / cab builder), one file per vehicle
  plumes.js             per-nozzle shock-diamond cones + condensation mist pool
  crash.js              everything a crash shows, keyed to run.impacts (live and replay): sparks,
                          chips, dust, dents, torn-off parts, lamps/hazards, shake, slow-mo, cut
  debris.js             torn-off parts as small rigid boxes on the concrete (cosmetic)
  sliver.js             minimum on-screen width for thin lights/paint/struts (anti-flicker),
                          DECAL polygon-offset layering for anything painted on the ground
  director.js           chase / broadcast air cam / replay rigs / title turntable; live on the Wall and the
                          Show it turns just enough to keep the car below the top HUD (on a very short touch screen also a set number of px down, 0107) and, upright, right of the rail;
                          the Show's release cuts to a locked-off hold, then to the tracking carry before the row
src/input.js          keyboard + gamepad + touch → sim input (context: ground vs air; tier); stick dead zone;
                        every run starts with nothing held, a held control counts again on a fresh press (freshRun, 0099)
src/fold.js           a screen that folds (pure, 0105): the segments and the posture Chromium reports → rows | cols and the
                        hinge's edges (main.js syncFold: :root[data-fold], --fold-a/b; the scene above a horizontal fold)
src/hands.js          the driver's hands (pure): keys and sticks → wheel and pedals per tick (slower at speed),
                        stick shaping, reverse at a standstill; shared with the drive bench and tests
src/driving.js        driving levels (pure, 0066): Easy / Standard / Advanced on the ground in every mode. Writes only
                        the ordinary input channels (unscored grounds also: assist, and the car's tcOff / tcSport /
                        absOff / handbrake flags, never set on a scored run). Easy: road-speed governor, lane keep,
                        slide catch; Standard: the hands, bit for bit; Advanced: direct, analog pedals. AI drive
                        (0109, `ai`, on unless turned off; only where ctx.road is given: Free Drive's roads and the
                        endless road, never a scored run or the Sandbox): over any level, pure pursuit along the lane
                        (dmath; the whole road through a hairpin), the safe speed for the bend ahead, slide catch, a
                        stock car with ESC; the player's GO is the pace, steer past what the bend asks moves the target
                        across the road (lane, pull-over), a hard one held ≥ 0.8 s takes the wheel inside the edges
src/rookie.js         Rookie mode (pure, 0074): crashed runs in a row; from the third the results offer Easy driving +
                        Assist flight in one tap (src/main.js draws it on the sheet and, 0076, the theatre's phone bar; reset by a clean run or a level/tier change)
src/adapt.js          Adapt to me (pure, 0079): the session's performance model over rookie.js; between runs only, 3 crashes in a
                        row on Pro/Advanced step the tier down (Undo), every 3 good runs offer a harder step; a run's tier is
                        latched at its start (S.flyTier)
src/pointer.js        the coach in the device's words (pure, 0079): controls per device/scheme, the "how to fly" card's rows
                        (and the pause sheet's, 0092: touch and pad never see the keyboard's key lists),
                        the post-run pointer (no third repeat, "Better: …"), the live cue-line pointers
src/render/interp.js  the car drawn between 240 Hz ticks (no sim change)
src/onethumb.js       one-thumb Assist: hold to climb (crawl governor, stops on the ledge), tap to let go,
                        hold to land (LAND + the carry over the row); plain sim inputs, pure, no DOM
src/touch-settings.js touch scheme (one-thumb | classic), hand, tilt steering (DeviceOrientation, iOS
                        permission, calibrate, 5 % steps), haptics (navigator.vibrate)
src/valves.js         Advanced: keyboard layout like the car, chords, key ramp, gamepad, the touch
                        nozzle pad
src/hud-landing.js    the landing predictor (sink band, descent tape, ADI, roll-out cue) + touchdown ring
src/practice.js       drills from moments of the reference flight, retry, drill scorecards
  road.js               Free Drive's world: 3-level streamed terrain, road chunks (ribbon,
                          verges, walls, rails, bridges, delineators), trees, sea, skyline ring
  roadlook.js           Free Drive's sky, time of day, haze and shader-patched materials
src/input.js          keyboard + gamepad + touch → sim input (context: ground vs air)
src/audio.js          procedural WebAudio: motor, tyres, wind, nozzle hiss, chimes, crash crunch/grind
src/ui.js             the HUD as one instrument system (mission clock, phase timeline, primary, telemetry
                        strip, attitude, vehicle: thrusters + damage; values glide, DOM on change), results, board
src/units.js          what the player reads: US customary first with metric beside it (or the other way,
                        one tap on any unit readout or U); factors for live readouts, `localize` for SI prose
src/instruments.js    every HUD instrument answers a tap: peak G, burn time, splits, attitude, thrusters
src/damage-view.js    the damage map opened up (lazy): zones, hits, what damage does in this sim
src/drive/minimap.js  Free Drive's canvas minimap (north/heading-up, trail, ghost, profile) and the full map
src/share-card.js     Share (0081): the run as a 1080×1350 card drawn on the device (replay frame, score, verdict,
                        three numbers) → navigator.share({ files }) → text + link → copy + toast
src/panel.js          board client (tolerant rows) + local judge lines (offline fallback)
src/pace.js           the title draws at ~30 fps (pure pacer, 0049); the shadow map redraws on the title only when the hero moves
src/net.js            every network call: fetchWithDeadline (deadline + cancel), withDeadline, postRetry; lazyOnce + reimport
                        (a failed lazy chunk is asked for again, 0057), judgesOverran (the judge breaker counts their own overrun)
src/wake.js           the screen wake lock (0060): held through a run, the judging and the replay, asked again on return;
                        main.js syncLife() also suspends the audio when paused, hidden or idle on the title
src/ads.js            Marquee ads between runs only (§3.3's exception): loader on production, title banner,
                        postrun interstitial, opt-in reroll rewarded; a no-op without window.marquee. The loader goes in
                        only on the title or the results; the title's slot is placed after 4 s on the title, and dropped on leaving it unless filled (0117)
src/obs/              OBSERVABILITY + SELF-HEAL (client): index.js (capture: errors, rejections, traps,
                        lost context, shaders, fetches, lazy imports, audio; frames; beacons) ·
                        signature.js (stable ids, shared with the Worker) · frames.js (ring +
                        histogram, zero per-frame allocation; slow = past the display's own cadence,
                        so a 30 fps cap isn't a hitch) · ledger.js (per-device health ledger,
                        boot tier and resolution from past runs: a slow session costs a resolution step,
                        a tier only at the floor (0097); resolution governor; scene.js applies a step at the
                        next render, never between a draw and its presentation) · breaker.js (judge, audio,
                        world, rocket) · heal.js (guarded frame loop, context restore + look rebake,
                        trap → title, reload-once) · reload.js (when a reload is allowed: online, origin
                        answers, a new build for a missing chunk) · panel.js (For nerds → Health).
                        index.html's boot watchdog offers a reload if the title isn't wired in 15 s
src/worker/obs.js     POST /obs + GET /obs/digest (regression detection); scripts/heal.mjs files tickets
src/ai/               config.js (provider/key on this device) · stream.js (SSE client) ·
                        settings.js (the judges' brain picker) · theatre.js (lazy: aurora-field show)
src/worker/index.js   Worker (frozen): verify by replay, streaming judge, BYOK models, D1 board
src/worker/ai/        prompt.js (brief + tolerant line parser) · providers.js (edge, anthropic,
                        openai, xai, gemini; model picking; prices)
tests/unit/           Vitest: sim, course, mixer, determinism, judging, engine (parked bodies, tyres, springs)
tests/e2e/            Playwright: boot + reference jump + judging, deep link, phone
scripts/fly.mjs       Headless reference flight with telemetry (tuning tool)
scripts/engine-*.mjs  the engine: determinism spike across browsers and the Worker (engine-worker/),
                        logs for the determinism checks, ticks/s benchmark; vendor-rapier.mjs
                        rebuilds src/vendor/rapier3d.js after a Rapier bump
scripts/shots.mjs     Screenshots of key moments against a running preview
scripts/human-show.mjs     human-like players on the Show (reaction time, keys, cues): the
                           learnability gate. --cues old|new, assist|pro
scripts/human-advanced.mjs Advanced by a person: taps on the valve keys
scripts/play-human.mjs     a cue-following player on the real page (keyboard, touch or thumb)
scripts/human-phone.mjs    the human-show population on a phone (thumbs, reach, a resting thumb):
                           --scheme=classic|thumb --build=before|after --geom=<thumb-reach geom.json>
scripts/thumb-reach.mjs    touch control geometry per phone viewport + reach heatmap screenshots
scripts/hud-audit.mjs      flies the Show at every viewport: overlaps, text < 11 px, WCAG contrast on screenshots;
                           the judges' theatre and the pause sheet too (44 px targets; Resume and Home on the glass,
                           0092); a touch frame's HUD cover under audit-plan.mjs coverCeiling (0112); a gate (exit 1), --shard=N/M
scripts/hud-cover.mjs      how much of the scene the HUD covers, per size and touch scheme (the Show's run-up and air, Free
                           Drive): cover / solid / shade %, the car's and the road ahead's box under chrome; `p` = installed (0112)
scripts/title-audit.mjs    the title at every viewport: no overlaps, CTA in view; a gate (exit 1)
scripts/serve-and-audit.mjs  `npm run audit`: vite preview on a private port + both audits, their exit code
scripts/audit-plan.mjs     the audit's viewports and its shard plan, balanced by estimated CI seconds (0087)
scripts/brand.mjs          the install assets from brand/icon.svg (the mark: icons, maskable, Apple, favicons;
                           --check the safe zone) and, with --shots <url>, og.png + the manifest's screenshots
scripts/shots-learn.mjs    screenshots of the HUD, drills, coach and nozzle pad
scripts/shots-lineup.mjs   studio shots of each parked vehicle + the row, and the row's draw budget
scripts/shots-look.mjs     the same moments (title, release, landing, results, a road) on desktop, phone and iPad,
                           before vs after side by side (0097: one look everywhere)
scripts/flicker.mjs   Temporal flicker probe: per-region frame-to-frame jitter (+ --heat maps)
scripts/flicker-budget.mjs  gates a flicker.mjs --json run against docs/flicker-budget.json (per label)
scripts/roads/        build-time only: OSM + terrain → public/roads/*.bin.gz (docs/ROADS.md)
public/               manifest.webmanifest, icons/, apple-touch-icon.png, favicon*, og.png, screenshots/ (0081;
                        rendered by scripts/brand.mjs, never hand-edited). No service worker, on purpose
public/roads/         the baked Free Drive roads (fetched only when a road is picked)
```

Frame flow: `frame()` → `liveStep(dt)` runs whole 1/240 s sim ticks, then syncs the car, HUD,
plumes and audio once → `director.update` → `stage.render`. The renderer only reads sim
state. It never writes it.

### URL parameters (deep links — the site launcher uses these)

| Param | Effect |
|---|---|
| `?play=jump` | Skip the title, straight into a countdown |
| `?play=reveal` | Watch the reference jump, then its scorecard |
| `?board=today` / `?board=all` | Open the leaderboard |
| `?gfx=low\|mid\|high` | Force a graphics tier |
| `?drive=stelvio\|transfagarasan\|bigsur\|atlantic[&tod=dusk]` | Free Drive on that road |
| `?drive=sandbox[#b=<build>]` | The Sandbox (build, power-ups, side quests); `#b=` carries a shared build (also on a road link) |
| `?drive=endless[&seed=<text>][&tod=dusk][&idb=0]` | Free Drive's endless road from that seed (same seed, same world) |

One deep link wins when several are given: `?drive=` over `?play=` over `?board=` (the others are
ignored; `?gfx=` and `?course=` combine with any of them).
Renaming or removing a deep link breaks the mutaafaziz.com launcher and Digital Craft /labs.
Keep the old ones working.

## 5 · Commands

```
npm run up         install, browsers, dev server (one command, idempotent)
npm run dev        Vite dev server at http://localhost:5173/coldgas/
npm test           unit tests (fast, pure)
npm run e2e        Playwright against a production build
npm run check      backlog + lint + unit + e2e (what CI runs)
npm run check:fast backlog + lint + unit + build (cloud sandboxes)
npm run audit [-- --shard=N/M] [--port=4655]   the HUD + title audits as a gate on dist/ (build first): serves it, runs
                   one HUD shard (+ the title audit with the shard the plan gives it), exits 1 on any overlap, offscreen box,
                   text < 11 px, label < 4.5:1, theatre target < 44 px or missed frame (0082); shards are balanced by
                   estimated cost (scripts/audit-plan.mjs, 0087); CI runs --shard=1/6 … 6/6 in parallel. Its frames are
                   deterministic: condition waits (CI=1 doubles them), the results stepped in the page, not the wall clock
node scripts/fly.mjs '{"apex":7,"rolls":1}'   headless reference flight telemetry
node scripts/perf.mjs <url> [label] [runs]      first-load probe: FCP/LCP, title wired, first 3D frame, long tasks, bytes
node scripts/roads/build.mjs [road]             rebuild Free Drive roads from OSM + terrain (network; cached)
node scripts/perf-drive.mjs <url> [phone|desktop] [roads] [secs]   Free Drive frame times (phone = 4× CPU throttle)
node scripts/shots-drive.mjs <outdir> <url> [phone|land] [roads] [tods]   Free Drive screenshots
node scripts/perf-endless.mjs <url> [phone|desktop] [cruise|drive] [secs] [seed]   endless: fps, main ms/frame, worker ms/tile, memory, fell-behind frames
node scripts/shots-endless.mjs <outdir> <url> [desktop|phone|land] [seed] [tods]   endless: each biome, chase + cinema
node scripts/endless-probe.mjs [seed] [km] [secs]     endless road in Node: generation speed, biomes, bridges, a drive
node scripts/grass-probe.mjs [roads] [off] [angle]    off the road and back on, every road (the verge regression)
node scripts/verge-steps.mjs [roads]                  steps in the ground beside the road
node scripts/ref-hash.mjs                             fingerprints of the stunt references (a physics change is bit-neutral or not)
node scripts/drive-feel.mjs [bench|road|levels|bench-levels] [assist|pro]   driving feel: step steer, lane change, on-centre, 60–0, slides; a keyboard driver on the four roads; `levels`: the driving levels (naive keys/touch, skilled pad)
node scripts/drive-feel.mjs diag [standard,easy,ai] [roads]   0109: the four roads + the endless one, road-reading drivers (keys, stick, tilt) and naive input (mash, hold, zigzag, swerve, GO only): exits and rails per km, spins, first loss, pace
node scripts/objects-bench.mjs [--reps=5]             what the world's objects cost a tick: the scored replays (verify path), a crash, the pad's static fire, a Sandbox slalom
npm run heal [-- --dry|--check|--max=N|--digest=<url|file>]   production's /obs/digest → backlog tickets for new/regressed signatures
npm run obs:bench                                     obs's per-frame cost and allocation (Node, a million frames)
npm run alloc:bench                                   what the per-tick input path allocates (sample, hands, the input log): 0 B/tick with keys and touch
node scripts/flicker.mjs <url> [--gl=swiftshader] [--phone] [--only=a,b] --json=run.json   flicker probe (title, approach, wide, replay, jets, live jets, retry countdown, lineup, Free Drive, endless, z-fight)
node scripts/flicker-budget.mjs run.json [--write]    fail if any region's pops rise > 25 % (or 0.5 ‰) over docs/flicker-budget.json
```

Local Worker: `npx wrangler dev` (serves dist + the API with a local D1, and uses
`.dev.vars` for `ANTHROPIC_API_KEY`).

## 6 · The agents

Four Claude Code cloud routines run this repo. Their prompts are thin pointers to
`agents/prompts/{common,scout,critic,builder,keeper}.md`:

- **Scout** plays the build (the reference jump plus a manual attempt), compares it with the
  pillars and grooms `docs/backlog/`.
- **Critic** plays production like the most demanding engineer alive, measures it against
  `docs/REVEAL_RESEARCH.md`, writes `docs/critique/`, files `by: critic` tickets, and re-checks
  shipped ones live (reopening any that miss the bar). Critique → fix → critique.
- **Builder** ships the top `ready` ticket test-first, one PR at a time (`by: critic` first).
- **Keeper** handles upkeep: dependencies, flaky tests, perf drift, LESSONS.

**Self-healing from past runs.** Every page captures its errors (signature = message + top
frame + build) and frame times (src/obs/) and heals what it can in place: the tier comes from
this device's past sessions, the resolution steps down on a hitching run and back up with
headroom, flaky subsystems sit behind circuit breakers, a lost GPU context is restored, a
physics trap ends the run cleanly. What it can't heal reaches `GET /coldgas/api/obs/digest`
as a new or regressed signature, and `npm run heal` turns that into a `ready` ticket
(`obs: <key>@<build>` in its frontmatter, `by: operator`). The **Keeper** runs `npm run heal`
every run (keeper.md step 2) and PRs the tickets; the **Builder** runs `npm run heal -- --check`
before picking (builder.md step 2) and heals first if the digest has something unticketed.
Production's own health: For nerds (`) → Health.

The operator steers through `agents/control.json` (paused, focus, caps, frozen_paths). Branch
prefixes `scout/`, `build/`, `fix/` and `keep/` get auto-merge when CI is green.

## 7 · Definition of done

- Acceptance criteria met, and tests added or updated (unit for sim/scoring, e2e for flows).
- `npm run check` is green locally or in CI.
- Works at 390×844 touch and 1280×720 keyboard.
- No new runtime hosts (Marquee's same-origin `/ads/` is the one allowed, §3.3), no brand names, no per-frame allocations.
- Rendering, camera or effects changed → `flicker-budget` passes for both screens of your label
  (`--gl=swiftshader` in a sandbox, about an hour a screen; `--only=` the scenarios you touched when short).
- Sim or scoring outcome changed → `SIM_VERSION` bumped and noted in the CHANGELOG.
- **Launcher registration** (standing policy): a new or changed deep link, or a rename, also
  updates the mutaafaziz.com ⌘K launcher (mutaaf/mutaafaziz-site) and the Digital Craft
  `/labs` page (mutaaf/digital-craft-architect). Open those PRs alongside, and merge them only
  once this change is live.
- CHANGELOG entry, ticket marked `shipped` with the PR number.
