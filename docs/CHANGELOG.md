# Changelog

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
