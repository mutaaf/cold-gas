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
   the input log), legible judging (every category explained), Assist and Pro modes, and an
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
  - `POST /coldgas/api/models` (BYOK connect) asks a provider for its live models and suggests one.
  - `GET /coldgas/api/providers`.
  - `POST /coldgas/api/scores` (verified board entry) and `GET /coldgas/api/scores?board=today|all`.
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
4. **Determinism and realism.** `src/sim/*` is pure. It uses `dmath.js` (dsin, dcos, datan,
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
   gates: run them for any physics change.
5. **Scores are decided by `scoreRun`.** The AI writes words only. The client never sends a
   score: the Worker replays the log.
5½. **AI usage is always visible and honest.** Every model call goes through the theatre and
   the receipt. Real model ids, token counts and costs are shown, with an estimate only where
   the provider doesn't report them. Keys are never logged, persisted server-side or echoed.
   No AI call may block the results: a 35 s deadline falls back to local lines.
6. **Frame budget.** 60 fps on a mid-range laptop and playable on a recent phone. No per-frame
   allocations in hot paths (reuse vectors and arrays). Graphics tiers: `?gfx=low|mid|high`.
7. **IP caution.** No real brand, product or person names, logos or likenesses anywhere: code,
   copy, assets or AI prompts. Vehicles are invented ("Sedan", "Crossover", "Pickup", "Cab",
   "Semi"). The fine print says it is an independent fan game.
8. **Accessibility floor.** Every control has a keyboard path, text holds 4.5:1 contrast on the
   HUD, and `prefers-reduced-motion` disables shakes and big transitions.

## 4 · System map

```
index.html            Markup: canvas, top bar, title, HUD, touch, results, board, pause
src/main.js           Entry: state machine (title → countdown → live → results ⇄ replay),
                        fixed-step clock, sim → scene sync, deep links, wiring
src/sim/              PURE, shared with the Worker:
  m3.js                 allocation-free vec3/quat math
  spec.js               THE CAR: dimensions, mass, inertia, power, tyres, fan, nitrogen, ten
                          nozzles. Public reveal numbers where they exist, marked estimates elsewhere
  courses.js            THE COURSES as exact geometry: the Wall (9.5 m arc turning 170° + 5.5 m
                          inverted ledge, 19.8 m lip), the Lineup (no ramp, five parked EVs) and
                          the Show (one flight: the row parked across the approach under the
                          ledge, pad beyond it); MATERIALS (grip/slide per surface); createWorld/
                          stepWorld: each parked vehicle is a body (mass, parked-tyre friction,
                          body-body contact); `surface()` = signed distance + normal + material +
                          body (wheels, hull, fan)
  vehicle.js            physics v2: 6-DOF body, raycast suspension on any surface, Pacejka tyres
                          with implicit wheel spin, TC/ABS, stiction, 2 g suction fan, cold-gas
                          nozzles with blowdown, mixer, flight computer (Assist / LAND / Pro)
  run.js                one attempt: input log (12 channels incl. fan), phases drive → ramp →
                          air → landed, telemetry (Show: clearance, crossedRow), simulate();
                          replay frames carry each parked body's pose
  autopilot.js          reference runs for both courses, closed-loop through the same physics
  judge.js              scoreRun: per-course categories → three judges → total /100 + verdict
src/render/           three.js (r186):
  scene.js              renderer, composer, course switching (`setCourse`), lineup world,
                          sliced first load (`stage.ready`: build, bake, compileAsync, fade in)
  wall.js               the night stage: the Wall's deck sampled from `wallProfile`, truss,
                          LED edges, searchlights, pad
  roadster.js           the hero car: faceted body from SPEC, nozzles at NOZZLE_SPEC, fan, wing
  cars.js               lineup vehicles, ghost, `wheelCenterY` contract
  plumes.js             per-nozzle shock-diamond cones + condensation mist pool
  director.js           chase / broadcast air cam / replay rigs / title turntable
src/input.js          keyboard + gamepad + touch → sim input (context: ground vs air)
src/audio.js          procedural WebAudio: motor, tyres, wind, nozzle hiss, chimes
src/ui.js             HUD (in-place updates), results sheet, board
src/panel.js          board client + local judge lines (offline fallback)
src/ai/               config.js (provider/key on this device) · stream.js (SSE client) ·
                        settings.js (the judges' brain picker) · theatre.js (lazy: aurora-field show)
src/worker/index.js   Worker (frozen): verify by replay, streaming judge, BYOK models, D1 board
src/worker/ai/        prompt.js (brief + tolerant line parser) · providers.js (edge, anthropic,
                        openai, xai, gemini; model picking; prices)
tests/unit/           Vitest: sim, course, mixer, determinism, judging
tests/e2e/            Playwright: boot + reference jump + judging, deep link, phone
scripts/fly.mjs       Headless reference flight with telemetry (tuning tool)
scripts/shots.mjs     Screenshots of key moments against a running preview
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
node scripts/fly.mjs '{"apex":7,"rolls":1}'   headless reference flight telemetry
node scripts/perf.mjs <url> [label] [runs]      first-load probe: FCP/LCP, title wired, first 3D frame, long tasks, bytes
```

Local Worker: `npx wrangler dev` (serves dist + the API with a local D1, and uses
`.dev.vars` for `ANTHROPIC_API_KEY`).

## 6 · The agents

Three Claude Code cloud routines run this repo. Their prompts are thin pointers to
`agents/prompts/{common,scout,builder,keeper}.md`:

- **Scout** plays the build (the reference jump plus a manual attempt), compares it with the
  pillars and grooms `docs/backlog/`.
- **Builder** ships the top `ready` ticket test-first, one PR at a time.
- **Keeper** handles upkeep: dependencies, flaky tests, perf drift, LESSONS.

The operator steers through `agents/control.json` (paused, focus, caps, frozen_paths). Branch
prefixes `scout/`, `build/`, `fix/` and `keep/` get auto-merge when CI is green.

## 7 · Definition of done

- Acceptance criteria met, and tests added or updated (unit for sim/scoring, e2e for flows).
- `npm run check` is green locally or in CI.
- Works at 390×844 touch and 1280×720 keyboard.
- No new runtime hosts, no brand names, no per-frame allocations.
- Sim or scoring outcome changed → `SIM_VERSION` bumped and noted in the CHANGELOG.
- **Launcher registration** (standing policy): a new or changed deep link, or a rename, also
  updates the mutaafaziz.com ⌘K launcher (mutaaf/mutaafaziz-site) and the Digital Craft
  `/labs` page (mutaaf/digital-craft-architect). Open those PRs alongside, and merge them only
  once this change is live.
- CHANGELOG entry, ticket marked `shipped` with the PR number.
