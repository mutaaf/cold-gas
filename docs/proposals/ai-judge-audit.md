# AI judges: an audit, and what to do with them

2026-11-13. Research only: nothing here changes code. The owner decides; nothing is built until then.

A playtester said: "AI judge calls are interesting, but their value may be questionable for a small game." This audit
checks that claim against the code, the git history, the critiques and production's funnel.

**Bottom line.** A judging costs the owner **$0 in cash** and about **16 neurons** of a free allowance shared with other
apps. On the edge it answers in **about 1–2 s** (one outlier at 6.4 s), and on the iPhone it takes **8–10 s** on the
simulator; no physical phone has been measured. Cost was never the problem. The problems are elsewhere:

- **Real players rarely see the words.** For a player's first three runs, the web hides the judges' lines under More.
  That covers most of the people who have played.
- **Our own agents make most of the calls.** Production counted 160 automated sessions to 16 human ones.
- **The edge is a dependency, and it has failed.** It once went down for about six hours.
- **The machinery is large.** It needs a 737-line theatre, five providers and bring-your-own-key (BYOK), all for four
  short lines.

**Recommendation: Option B.** Authored, stat-driven commentary becomes the default voice everywhere. The iPhone's
on-device model stays as a $0 upgrade. The edge call becomes something the player asks for.

## When the judges run

| Platform | Trigger | Route |
|---|---|---|
| Web | Every finished scored run, after the sheet opens (`src/main.js` → `runPanel(run)`, line 526). It runs on wrecks too. It doesn't run on drills, Free Drive or the Sandbox. | Edge model via `POST /coldgas/api/judge/stream`, or BYOK. On a fallback, local lines. |
| Web, rewarded | The player presses "Watch an ad · ask the panel again" (`src/main.js:774`). The reward is a second call. | Same |
| Web, portal builds (0228) | Never. The portal builds have no server: local lines, labelled "The AI panel is not in this version". | Local |
| iPhone app | Every finished scored run (`ios/ColdGas/Net/Judges.swift`). | On-device first, then edge, then local lines |
| Sandbox side quests | On request (`POST /api/quest`). These are a separate call, at about 3× a judging's neurons. | Edge or BYOK |

The results never wait for the call (invariant 5½). The score, the landing beat (0199) and the sheet all come from
`scoreRun`. The model only writes four lines: a headline, then the Engineer, the Coordinator and the Designer.

## The three paths

### 1 · On-device: Apple's model (iPhone only; 0219, PR #337)

- **Model:** FoundationModels `SystemLanguageModel.default`, iOS 26+, on a device with Apple Intelligence turned on.
  The player can switch it off in Settings → Judges.
- **How it writes:** guided generation (`@Generable`) fills the four parts from the Worker's brief, ported word for word
  (`ios/Packages/ColdGasCore/Sources/ColdGasClient/OnDeviceJudge.swift`). The part schema replaces line parsing.
- **Budget:** `ON_DEVICE_MS = 20_000` of `JUDGE_MS = 35_000`. On any failure (guardrail, context, assets, language or
  deadline) the edge model gets the time left, then the local lines. These failures don't count against the cloud
  breaker.
- **Cost:** $0, and no network. The receipt says "no data left the device".
- **Latency** (the only figures recorded, PR #337): **10.5 s cold** on the Show (828 in, 99 out) and **8.3 s warm** on
  the Wall. Both were measured on the simulator on the operator's Mac, with Apple Intelligence supplied by the host.
  Nobody has measured a physical phone.
- **Shipped into store copy:** the 1.1.0 description has a "JUDGED ON YOUR DEVICE" section, the keywords include
  `ai judges`, and there's a What's-new card.

### 2 · The edge: Workers AI through Prompter (web, and the iPhone's fallback)

- **Config** (read-only; `wrangler.jsonc` and `src/worker/` are frozen):
  - The binding `AI` is a **service binding to `prompter`** with `props.app = "cold-gas"`. Prompter is the owner's AI
    gateway (PR #296, 2026-11-10).
  - Prompter shares the account's Workers AI free allowance (10,000 neurons/day) between the portfolio's apps. Cold Gas
    is guaranteed 3,000 a day and borrows idle shares.
  - There is no paid API key in the Worker, and no env var for one. `ANTHROPIC_API_KEY` is used only locally (`.dev.vars`)
    and by the forge's build-time brief.
- **Models** (`src/worker/ai/providers.js`): `@cf/google/gemma-4-26b-a4b-it` runs with thinking off. If it fails before
  the first token, `@cf/meta/llama-3.1-8b-instruct-fp8` takes over.
- **Call size:** about 1,236 input tokens (a 300-word system brief plus the run's facts) and 142–184 output tokens. The
  critiques measured **15.4–16.25 neurons** per call. AGENTS.md says ≈13, which is stale.
- **Real marginal cost:**
  - **$0 cash.** The account is on the Workers free plan (AGENTS.md §2 cites the free plan's 10 ms CPU), so usage past
    the allowance fails rather than bills. Prompter caps it before that anyway.
  - The receipt's **$0.00017** is a list-price equivalent: the token prices in `PRICES`, which match Workers AI's
    $0.011 per 1,000 neurons. It isn't a charge.
  - **The true cost is allowance.** Each call is about 0.5 % of Cold Gas's guaranteed 3,000 neurons, so roughly 190
    judgings a day are guaranteed and more are borrowed.
- **Caps** (`src/worker/index.js`): 40/h per player, plus a 700/day edge cap. That cap is stale:
  700 × 15.6 ≈ 10,900 neurons, more than the whole account's allowance. Prompter is now the real limit; when it runs
  out the player reads "The free judges are resting until 00:00 UTC." BYOK calls are limited to 90/h per player.
- **Latency** (server-side, from the critiques):
  - Total: **0.86–2.19 s** on most calls, with one at **6.36 s** (2026-10-23).
  - First token: **291–482 ms** server-side.
  - One client-side reading of the first token was **2.92 s** (2026-10-31), but that includes the network and a slow
    SwiftShader frame.
  - The theatre adds up to about 10 s of show on top (#104); Skip ends it at once.
- **Reliability:** on 2026-10-30/31 the edge failed **10 of 11 calls over about 6 hours**. Both models threw ("Cloudflare
  Edge couldn't be reached"), the fallback held, and players got local lines with an honest receipt. Prompter
  (2026-11-10) was introduced partly because Cold Gas alone could spend about 18,000 neurons and switch AI off for
  every other app.

### 3 · Local lines: canned, stat-aware (`src/panel.js` `localWords`)

- **What:** about 30 hand-written lines across the Lineup, the Wall and the Show. They branch on wrecked (≥ 60 %
  damage), no jump, contact, flipped, fell off, landed on the deck and short of the row. They interpolate the real
  numbers (sink, tilt, wheel spread, gas left, height, time inverted) and pick between two variants with a seed from
  the run.
- **Cost and latency:** $0, instant and offline. The native app has a bit-exact port, so its vectors include the
  lines.
- **Labelling:** never passed off as the model's (0083). The receipt says "local lines" and gives the reason.

### Fallback order, and what the player sees

1. **iPhone, Apple Intelligence on:** on-device words stream in part by part, and a "Judged on device" mark shows.
2. **Edge:**
   - On a desktop, the theatre shows the call (circuit, telemetry, compute die, verdict) with live counters, then a
     receipt with *Replay* and *Inspect the call*.
   - On a phone, the call runs as a docked live strip on the sheet.
   - On the calm sheet (a player's first three runs, 0199), both the strip and the judges' lines sit under **More**,
     unless the player uses BYOK.
3. **Edge fails, the 35 s deadline passes, or the breaker is open:** local lines, with a receipt saying why ("The judges
   are resting", "The judges' chunk didn't load", …).

**How often each path runs: unknown.** Nothing records it.

- The funnel (`/obs/digest → players`) has no judge events.
- The Worker's `ai_usage` buckets in D1 aren't exposed.
- The iPhone app sends no telemetry.

The nearest proxy is production's funnel on 2026-11-13. Over 2026-11-01..13 it counted **16 human sessions and 13 human
runs (3 landed, 6 wrecked), against 160 automated sessions**. Most edge judgings are made by our own Critic, Scout and
Builder runs, not by players.

## Does judging improve the experience?

**For it:**

- When the lines are good, they're specific. On 2026-11-01 the Engineer's line matched the facts exactly ("sink 0.8 m/s,
  one degree tilt").
- The on-device path is a real, $0, privacy-clean feature, and the iPhone store copy now promotes it.
- The theatre is distinctive craft.

**Against it:**

- **Most players never read it.** The calm sheet hides the judges for runs 1–3, and the funnel shows most human
  sessions end within three runs. The call is still made, and its words sit unread under More.
- **The headline moment is elsewhere.** The landing beat shows the scores counting up (`src/sim/judge.js`). The
  playtester praised the crash, the haptics and the concept, not the panel.
- **On a wreck, the words add little.** Wrecks outnumber landings 2:1 in the funnel, and on a wreck "the car is a
  write-off" is all the brief can say. The local "Wrecked" lines already say it.
- **It's a live dependency with a failure history,** and on the web it adds a 35 s budget, a breaker, a lazy chunk and
  a receipt to every run.
- **The surface is large for four lines.** It spans five providers, BYOK model listing, a settings modal, a 737-line
  theatre, invariant 5½'s receipt rules and the Critic's checks.
- **The authored path already does most of the job.** `localWords` uses the same facts. What the model adds is
  variety: a run-specific turn of phrase.

**Verdict:** the playtester is right about the web edge call. It's cheap, but its value is low, and it's mostly
invisible to the players it's for. The on-device path is a different case: its cost is genuinely zero, the App Store
listing now features it, and it has no shared allowance to protect.

## Options

All three are client-side. **None touches `src/worker/` or `wrangler.jsonc`.** The Worker's endpoints can stay as they
are for BYOK and old clients. None adds a paid dependency.

### A · Keep as is, and fix the edges (effort: S)

- Skip the call when its words would be hidden (the calm sheet), and make it on More instead.
- Update AGENTS.md's ≈13 neurons and the stale 700/day note in a proposal to the operator.
- Add `judge-ai`, `judge-device` and `judge-local` to `PLAY_EVENTS` so the funnel shows which path ran.
- *Pro:* the smallest change, and nothing is lost.
- *Con:* the edge dependency, the agent-driven allowance use and the machinery all stay. It doesn't answer the
  playtester.

### B · Authored first, AI on request (recommended; effort: M, 2–3 tickets)

- **Default voice everywhere:** a deterministic commentary engine grows out of `localWords`.
  - It's pure, unit-tested and ported to Swift through the vectors.
  - It works from the run's stats: the card, the coach's first finding and the damage zones.
  - It goes beyond today's lines: a pool of ~150 authored lines per judge, conditions on combinations (a high apex but
    a hard touchdown), a callback to the player's previous run on this course ("0.4 m/s softer than last time"),
    milestone lines (first landing, first 720) and seeded variety, so a retry doesn't repeat itself.
  - It's instant, so it can show **in the landing beat** where players actually look, not under More.
- **iPhone:** keep the on-device model as the upgrade when Apple Intelligence is on. It's $0, it's already shipped and
  in the store copy, and it doesn't touch the network.
- **Web:** the edge call becomes opt-in. "Ask the AI panel" on the full sheet runs the theatre as it does today. The
  rewarded "ask the panel again" keeps working as the same opt-in call, and BYOK stays.
- **Invariant 5½** stays true as written (every model call is visible; local lines are labelled). The label becomes
  "the panel" for authored lines, with the receipt saying "written by the game, not a model".
- *Pro:* $0, offline, instant and testable. It answers the playtester and makes the panel visible to new players. Edge
  use drops to people who ask for it.
- *Con:* someone has to write the lines (a few hundred, in three voices, under §3.7 and the What's-new tone). The free
  web player loses the theatre by default.

### C · Retire free text entirely (effort: M)

- Option B's commentary engine everywhere, with no model calls at all. The theatre, BYOK, `src/ai/` and the
  on-device judge come out of the clients, and the Worker endpoints are left dormant.
- *Pro:* the simplest product and the smallest bundle, with nothing to monitor.
- *Con:*
  - It throws away a shipped, $0, marketed iPhone feature, and the store copy and review notes need revising.
  - The rewarded ad's reward would need replacing.
  - It removes pillar 3 ("The panel … AI judges' voices") outright, a vision change the owner must make.

**Recommendation: B.** It keeps the one AI path that costs nothing (on-device), puts authored words where players
actually look, and turns the edge into a feature for the curious rather than a per-run dependency. **Before building,
the owner amends:**

- pillar 3, from "the AI judges' voices" to "the panel's voices, authored; a model on request or on the device";
- invariant 5½'s wording on the default path.

Then the Scout files the commentary engine (web and native) and the "Ask the AI panel" opt-in as tickets.
