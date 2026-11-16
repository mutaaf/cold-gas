# Creative direction: beyond the reveal

2026-11-13. These are options for the owner to choose from. Nothing is built until the owner picks one.

A playtester said the game "is fun but feels like it is chasing an older meme". They praised the crashing, the haptics
and the concept. This doc names the meme, measures how much of the game leans on it, and proposes three directions
that make the stunts and crashes entertaining on their own merits. **Recommendation: Direction 2, Wreck Club.**

## The meme, and how much of the game hangs on it

The trend is **the October 15, 2026 roadster reveal**: a production car crawls up a curl on a suction fan, hangs
inverted, and flies over a row of parked EVs on cold-gas thrusters. The game was started four days later
(`docs/REVEAL_RESEARCH.md`, 2026-10-19), and AGENTS.md §1 defines it as "one perfect moment, made playable … inspired
by the reveal". A month on, the clip has had its moment, and the game still presents itself as its recreation.

What depends on it:

| Layer | Dependence | Where |
|---|---|---|
| Premise and vision | Total | AGENTS.md §1 ("the game is the jump", "no campaign"), the title's fine print |
| Events | High | The Wall is the reveal's ramp run, the Lineup is its kickflip over the row, and the Show combines them. "Watch the reference" replays it. |
| Hero car | High | `src/render/roadster.js` is "matched to the reveal (research §10)"; `src/sim/spec.js` uses the reveal's public numbers |
| Look and tone | High | "Keynote restraint": blue-hour light, hairline type, near-silence. It's a product-launch stage. |
| Judges | Medium | The Chief Vehicle Engineer and the Head of Design are the launch's on-stage roles |
| Quality bar | Medium | The Critic measures the game against `REVEAL_RESEARCH.md` |
| Set dressing | Low | The launch complex (`docs/ROCKET.md`) nods to the same ecosystem |

What owes nothing to it:

- **The physics and the crash.** That covers the deterministic Rapier sim, impacts, damage zones, torn-off parts,
  debris, slow-mo, and Core Haptics driven by the sim. This is what the playtester liked.
- **The replay systems:** ghosts, challenge links, the Daily with streaks, medals, the board, drills.
- **The playgrounds:** Free Drive (real roads and an endless world), the Sandbox (build pieces, power-ups, side quests,
  `#b=` share links), Roam (iPhone) and the forge's asset pipeline.

So the meme is the **frame**, not the engine. Changing the frame is cheap compared with what's already built.

## Constraints on every direction

- **Stays:**
  - the crashing (`src/render/crash.js`, `damage.js`, `impacts.js`);
  - the haptics;
  - the core stunt loop: run-up, release, flight on the thrusters, touchdown, card;
  - determinism and server-decided scores (invariants 4 and 5);
  - the three existing events, as courses inside whatever comes next.
- **Invariant 3.7:** no real brands, logos, model names or people. A new world means invented names, invented
  machines and invented places. The hero car stops being "the reveal's car" and becomes ours.
- **No dark patterns** (`agents/control.json` focus; the Scout's engagement lens):
  - no energy timers, loot boxes or paid or ad-bought progress;
  - no punishing a lost streak, and no fake scarcity;
  - rewarded ads stay opt-in and never touch a score;
  - unlocks are earned by play, and all of them are reachable.
- **Worker is frozen.** A new board (a wreck board, a combo board) needs a scorer change in `src/worker/` (operator).
  Each direction can start with bests kept on the device (like `src/medals.js`) and add a server board when the
  operator opens it.

## Direction 1 · The Proving Ground

**Pitch.** COLD GAS is a fictional test facility where a crew of engineers certifies one impossible prototype, and
every run is a test, logged and stamped. It keeps the game's restraint and precision, but the world, the car and the
people are ours, not a launch event's.

**What changes:**

- **Premise.** A named, invented proving ground with its own sign language: test-card numbering, hazard chevrons,
  crash-test targets on the car's flanks. The hero car is redesigned as our prototype, with its own silhouette and
  livery from the forge.
- **Progression.** A *test programme*: about 30 certification tests across the Wall, the Lineup, the Show and new
  rigs (a sled, a drop tower, a barrier). Each has a pass bar. Passing stamps the car's logbook, and the logbook
  unlocks the next rigs. Medals become grades.
- **Replayability:**
  - The Daily becomes "today's test order".
  - Ghosts are "the previous test driver".
  - A *crash test* category scores how a wreck went: deformation, energy absorbed, and whether the cabin held. Failing
    well is content.
- **Personality.** The three judges become named crew with running opinions: the Engineer who hates you denting the
  car, the Coordinator who wants it bigger, the Designer who mourns the paint. They speak authored lines (see
  `ai-judge-audit.md`, Option B).
- **Free Drive and Roam.** Roam becomes the facility's grounds between rigs. Free Drive is the "road test" off-site,
  unscored, as now.

**Effort:** M–L. That's about 8–10 tickets: the test programme and logbook (M), new rigs from existing sim pieces (M
each), the hero redesign through the forge (M), copy and judge lines (M), title and onboarding (S).

**Risks:**

- **The tone stays dry.** It fixes the meme, but it may not make the game more *fun*.
- **The hero redesign is the riskiest art task.** The current car's beauty is a pillar.
- It's still a "prototype supercar", so an echo of the reveal remains.

## Direction 2 · Wreck Club (recommended)

**Pitch.** The stunt is the setup and the crash is the punchline: every run scores *Style* (today's card) and *Wreck*
(how spectacularly it came apart), and both count. A small, scrappy, invented stunt crew runs it, with the sim's real
crash physics as the star.

**What changes:**

- **A second score, and its own mode.**
  - **The Wreck score** is a pure module beside `scoreRun` (unit-tested and in the native vectors). It reads data the
    sim already records: impact energy from `run.impacts`, damage zones, parts torn off, parked bodies displaced or
    toppled, distance tumbled and time airborne after the first hit.
  - **Destruction combos** chain these within a window (*roof-scrape → topple → tumble → part off* = ×4), shown live
    as the crash happens and paid out on the card. Today a wreck ends the fun with "write-off". Here it opens a second
    scorecard.
  - **Wreck mode** runs on the same courses, with the parked row as targets.
- **Progression.**
  - Medals per event for both Style and Wreck.
  - *Wreck Club ranks*, earned by lifetime crash feats ("Topple a semi", "Lose all four wheels", "Land after losing a
    door"). Unlocks are cosmetic and earned only: paint, plume colour, number decals of our own.
  - Rank feats double as the player's own stunt goals.
- **Replayability:**
  - The Daily alternates Stunt days and Wreck days.
  - Ghosts and challenge links carry either score ("beat my 4× combo").
  - A Wreck board starts on the device, with a server board later (operator).
  - The Sandbox becomes the *stunt editor*: build a crash course from the existing pieces and share it with `#b=`.
    Side quests can ask for wrecks.
- **Personality.**
  - The panel becomes the crew. The Coordinator cheers the wreck, the Engineer keeps a running repair bill ("that's
    a door, a wheel and my weekend"), and the Designer only loves clean landings.
  - Their lines are authored and stat-driven, so they're instant, specific and free.
  - The look loosens from a keynote stage to a working backlot: the same restraint and lighting, plus more dust, tyre
    marks and a crowd line.
- **Free Drive and Roam.**
  - Roam is the backlot between runs: drive to the row, line up your own approach, and hit "Fly" or "Wreck" from where
    you stand.
  - Free Drive stays the unscored open road, now with Wreck combos reported (not scored) when you crash out there.
  - The roadside breaks (0227) and the marks Free Drive leaves on the world (0223) fit naturally.

**Effort:** M, about 6–8 tickets:

- the wreck scorer and combo detector (M; pure, it reads existing impact data, adds no sim change and needs no
  `SIM_VERSION` bump);
- the combo HUD and card (M);
- crash haptic patterns per combo step on the iPhone (S);
- ranks and feats on the device (S);
- Daily Wreck days (S);
- crew lines (M);
- a Wreck board, which needs an operator ticket because the Worker is frozen.

**Risks:**

- **It rewards failure.** Mastery players may feel the Style score is cheapened. Mitigation: two separate scores and
  boards, never blended.
- **Tuning:** combos must come from physics, not exploits. The naive-players gate gets a wreck counterpart, so a
  holding-GO crash can't top the board.
- **Tone:** gleeful destruction must stay family-friendly. There are no people in the cars' world: drones and dummies
  only.

## Direction 3 · The Travelling Show

**Pitch.** COLD GAS becomes an invented travelling stunt show that tours made-up towns, each with its own arena,
crowd and signature act. You drive the road between towns and perform when you arrive.

**What changes:**

- **Premise.** A season is a tour of 8–12 venues. Each venue is a course composed from Sandbox pieces, the parked
  row and props: a harbour pier, a quarry, a car park, a frozen lake. It has its own lighting and a headline stunt.
  The Wall, the Lineup and the Show become the first three acts.
- **Progression.** Each venue's acts unlock the road to the next town, and medals gate encores, not the route. There's
  a season's end and a new tour, with no timers.
- **Replayability:**
  - The Daily is "tonight's show" at one venue.
  - Ghosts are rival performers (the player's own past runs, or a friend's challenge link).
  - Crash-score acts sit beside clean acts.
  - A *stunt editor* lets players design their own act and share it as a link.
- **Personality.** A ringmaster and a small troupe of invented characters, with authored banter between towns. Each
  town has a crowd with its own taste: one loves height, one loves wrecks.
- **Free Drive and Roam.** Free Drive becomes *the road between towns*: the endless world (`src/sim/endless.js`) is
  the tour route, with towns placed on it. Roam is walking the venue before the show.

**Effort:** L–XL, 15+ tickets. It needs venue authoring tools, per-venue lighting and props, a tour state, the
characters' writing, and venues placed in the endless world on the web and the iPhone.

**Risks:**

- **It contradicts AGENTS.md §1 ("no campaign").** The owner would be rewriting the vision, not adjusting it.
- **The content treadmill:** venues have to keep coming, and the agent fleet's cap (10 ready tickets) would spend
  months here.
- It delays the PLAYERS focus (the funnel shows 16 human sessions in 13 days). A campaign doesn't help the first run.

## Recommendation

**Direction 2, Wreck Club.**

- It builds on exactly what the playtester praised (the crash and the haptics) and on systems that already exist and
  are deterministic.
- It turns the most common outcome in production's funnel (6 wrecks to 3 landings) from a dead end into a payoff, which
  also serves the PLAYERS focus's first-run goal.
- It needs no Worker change to start.

It sheds the meme by changing **what the game celebrates**, not by repainting it. Its crew lines pair with the judge
audit's Option B (authored commentary).

Direction 1's renamed hero car and invented world can follow later as polish. Direction 3 is a later season, if ever.

**Decisions for the owner before anything is built:**

1. Pick a direction, or none.
2. Rewrite AGENTS.md §1 to match. For Wreck Club: "the game is the stunt and the crash", and drop "inspired by the
   reveal" from the vision and the fine print.
3. Whether the hero car is redesigned as our own (this is required eventually for Direction 1, and optional for 2).
4. Whether the operator will open `src/worker/` for a Wreck board, or bests stay on the device.
