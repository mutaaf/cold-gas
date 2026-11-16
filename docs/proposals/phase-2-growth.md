# Phase 2 · Growth: play first, reward immediately, share effortlessly, progress naturally

2026-11-13. Source: the owner's Phase 2 playtester brief, plus the owner's call the same day that the iPhone app gets
usage metrics too. This doc audits the code on main (04ff3f6), proposes the design, and files tickets 0245–0260 (the
share ticket is 0260: 0250 is the iPhone sound ticket's, PR #360). 0246, 0249 and 0258 have since shipped (#370, #378, #377). It
changes no gameplay, haptics, sim or scorer, and touches no frozen path.

## 1 · Decisions this doc asks for (short list)

| # | Decision | Default proposed |
|---|---|---|
| 1 | **Where the iPhone's universal-link file lives.** `apple-app-site-association` must be at `mutaafaziz.com/.well-known/`, which this repo can't serve (§4). | A cross-repo PR to mutaaf/mutaafaziz-site (like the launcher registration), plus Associated Domains turned on for the App ID (an account action). The alternative, adding a route in the frozen `wrangler.jsonc`, is not proposed. |
| 2 | **The iPhone's App Privacy label once metrics ship.** A random install id is a Device ID, and `ios/store/app-privacy.md` already says an install id makes rows "linked". | Usage Data → Product Interaction and Identifiers → Device ID, both for Analytics, **linked**, **not tracking**. If "not linked" matters more than return-rate per install, drop the install id and send `returning`/`days_since_last` computed on the device (§6). The operator changes the label in App Store Connect at submission. |
| 3 | **Box Office's own rule 6** says "native apps: not until the App Store reviews of Nov 2026 have cleared". | Record the operator's 2026-11-13 call in mutaaf/box-office's AGENTS.md in 0246's cross-repo PR, and ship native metrics in the same submission as the label change. |
| 4 | **Licenses don't lock tiers.** | Free play keeps Assist, Pro and Advanced open to everyone; licenses recommend a tier and lead the title, they never gate one (§5). |
| 5 | **The fifth license is "Ace", not "Pro"**, so it can't be confused with the Pro flight tier. | Rookie · Bronze · Silver · Gold · Ace · Legend. |

## 2 · Current state (audit)

| Area | Web | iPhone |
|---|---|---|
| Title and demo | A still title (turntable, ~30 fps). No idle autoplay. A newcomer reaches a passive demo two ways: **`?play=reveal`** (an inbound deep link: the autopilot's reference run, touch controls hidden; src/main.js:2089, :429) and the **Watch the reference** button beside Jump (index.html:91). | **The title loops the reference flight** of the saved course behind the menu, from launch, restarting every 2 s (`Game.showTitleLoop()`, Game.swift:86; Renderer.swift:389). A fresh install sees the demo loop until it taps Fly. |
| First-run handling | `coldgas_howto` gates the how-to card in front of the first Jump ("Got it · Jump"); `coldgas_flown` drives the calm sheet (first 3 runs, 0199) and live pointers (first 5, adapt.js). Load → control: **2 taps + the 3 s READY/GO**. | **None.** No first-run key, no onboarding. How to play is a sheet behind "?". Load → control: 1 tap + a 3-2-1 countdown, after the demo loop. |
| First landing | beat.js: a 2.4 s overlay for every clean landing (verdict, score count-up, judges); the calm sheet after it. No first-landing variant. | No beat. Results open with `.success` haptic for a landing **and** a crash (Game.swift:360). Core Haptics on touchdown per wheel and a "stuck it" settle are good (HapticScore.swift). |
| Results order | Retry (primary) · Home · Replay · Share · Post. **No Next.** | Post row first, then Fly again · Roam, then Watch it · Share · Board · Home. **No Next.** (Being redone in 0230, PR #368.) |
| Share | share-card.js: a 1080×1350 card from the replay → `navigator.share({files})` → text + link → copy + toast. Gaps: **no stunt name**, the image prints the plain address not the challenge, no personal best. | **Text link only**: `ShareLink(challengeURL, "… Beat it.")`, only for board-qualifying runs. No image. |
| Challenge links | `#vs=` carries log, SIM_VERSION, course, tier, score, initials; re-flown and checked on the recipient's device; card → Take the challenge → ghost → "You beat ABC by 2.1" → Send it back. Gaps: a first-timer taps twice (card, then the how-to); **`take()` doesn't switch to the sender's tier** (comeback.js:208) so a Pro run is raced on Assist; no own-best comparison. | `Challenge.swift` encodes and **can decode** bit-exactly (vectors), but the app target never calls the decoder. **No URL handling at all**: no URL types, no `onOpenURL`, no associated domains, no entitlements file. |
| Universal links | n/a | Need `/.well-known/apple-app-site-association` at the **domain root**. This Worker's only route is `mutaafaziz.com/coldgas*` and `public/` is served under `/coldgas/` (vite base, wrangler assets `./dist`), so a `public/.well-known/` file would appear at `/coldgas/.well-known/…`, where iOS never looks. Not servable from this repo without the frozen `wrangler.jsonc`. |
| Tiers | Assist/Pro/Advanced on the title, results, top-bar chip and picker; `coldgas_tier`; rookie.js offers Assist after 3 crashes; adapt.js steps down/up. Medals per course × tier (`coldgas_medals`). | Capsules on the title, `cg.tier`; medals in `coldgas.save.v1`. |
| Review prompt | n/a | None. |
| Analytics | Box Office `track()` (src/insights.js → `window.boxoffice`, production only): `game_start`, `game_over`, `share`. The obs funnel (`/coldgas/api/obs`) counts a **fixed** PLAY_EVENTS list that the frozen Worker enforces, so **new obs names would be dropped**. | **Nothing.** One host (`/coldgas/api`): board posts and the judges' fallback. Label: Gameplay Content, not linked, no tracking. |

## 3 · Gaps against the brief

1. **P0 first run.** The iPhone shows a demo loop and has no first-run state; the web gates the first jump behind a card
   and sends `?play=reveal` newcomers into a passive demo. Neither teaches inside the run, and neither celebrates the first
   landing differently.
2. **P0 sharing.** The web has the parts but not the stunt name or the dare. The iPhone shares a text link and can't open
   one.
3. **P1 progression.** The tier is a setting, not a goal. Nothing says what to do next.
4. **Metrics.** The first-run steps (first input, first landing, second jump) aren't events anywhere, and the iPhone has
   no events at all.

## 4 · Sharing and deep links: the architecture

**No backend, no accounts, no new link format.** The challenge link already carries the whole run:

```
https://mutaafaziz.com/coldgas/?play=jump&course=<show|wall|lineup>#vs=<base64url(deflate(log + course + tier + score + initials + SIM_VERSION))>
```

- **The same stunt configuration** = course + tier from the payload (the recipient flies the sender's tier, 0251) + the
  stunt name derived from the card (0260). A future Wreck challenge adds a field behind the payload's existing format byte,
  so old links keep decoding.
- **Sender, web (0260):** a stunt name from `scoreRun`'s card (pure `src/stunt-name.js`, in the vectors); the card's headline;
  a personal best mark; the challenge address printed on the image; the message "Beat my 82.4 on The Show · 360".
  `navigator.share({files})` → link → clipboard → the URL shown.
- **Sender, iPhone (0252):** the same card drawn with `ImageRenderer` off the frame loop; `ShareLink` with the image and the
  URL; every flown run is shareable.
- **Recipient, web (0251):** one tap from the card to the countdown, on the sender's course and tier; "You beat ABC by 2.1"
  and "Your best"; Send it back packs their run as a new `#vs=`.
- **Recipient, iPhone (0253):** universal links for `mutaafaziz.com/coldgas/*`. The AASA file goes in the domain root's repo
  (decision 1), the app gets `applinks:mutaafaziz.com` (project.yml + an entitlements file + the App ID capability). The
  app routes `onOpenURL` → `Challenge.vsFromHash` → the challenge card → the ghost run. Fallback with no server: a
  `coldgas://` scheme the web card can offer as "Open in the app"; never a forced redirect. Without the app, the same link
  plays on the web, as today.
- **Measuring the loop:** `share_tap` → `share_done` → `challenge_open` → `challenge_play` (§6), with the course, never an id.

## 5 · Licenses and Wreck Club: one progress, two tracks

Wreck Club (approved 2026-11-13) already plans ranks from crash feats that unlock cosmetics (0242). The brief's licenses
are a skill ladder that replaces the difficulty selector. They don't compete if each has one job:

| | **Licenses** (0254–0256) | **Wreck Club ranks** (0242) |
|---|---|---|
| Measures | Skill at the stunt: Style card, tier, precision | Crash feats: Wreck card, combos |
| Shape | Six licenses, each 2–4 measurable tests: Rookie (launch and land) · Bronze (a controlled 360) · Silver (consistency and precision) · Gold (aerial control on Pro) · Ace (combinations: 720 over the row, on the mark) · Legend (Advanced, high-risk mastery) | Lifetime feats → ranks |
| Unlocks | The next test and the visible mastery; a recommended tier. **Nothing is locked**: Free play keeps every tier and course. | Cosmetics only: paint, plume tint, decals. Never a score, physics or tier. |
| On the title | The primary action is the next license test; Free play beside it | A tab on the same screen (Licenses \| Wreck Club) |
| Store | `coldgas_progress` (one versioned record: first-run state, sessions, jumps, landings, licenses, feats, rank, unlocks), migrating `coldgas_flown` and `coldgas_medals`; medals stay per course × tier | Same record |

Rules: a test is judged only from `scoreRun`'s card and the run's tier (numbers the server agrees with), never a new score;
every test is reachable by play; no dark patterns (no timers, no paid or ad-bought progress, no streak punishment). The
names and art are our own (invariant 3.7): no racing game's license names, letter grades, test layouts or badges.

**Re-sequencing 0235–0244:** 0242 now depends on 0254 and keeps its feats in that store, with skill feats moved to the
licenses; 0238 notes that licenses read only the Style card; 0235's milestones include a license passed and the first
landing. 0237–0241, 0243 and 0244 are unchanged. Superseded and dropped: 0196 (by 0247), 0172, 0197 and 0144 (by 0248).

## 6 · Metrics

One vocabulary (`src/metrics/events.js`, 0245) for both platforms, Box Office's snake_case verbs, props numbers and enums
only:

| Metric | Event(s) | Web | iPhone |
|---|---|---|---|
| Time to first interaction | `first_input` {ms_since_load} | 0245 | 0246 |
| First-jump completion | `jump_start` / `jump_end` {n: 1} | 0245 | 0246 |
| First landing rate | `first_landing` {n}, `jump_end` {landed} | 0245 (and obs `run-landed`) | 0246 |
| Second-jump conversion | `jump_start` {n: 2} ÷ `jump_end` {n: 1} | 0245 (and obs `retry`) | 0246 |
| Share rate | `share_tap`, `share_done` {via} | 0245 (and obs `share`) | 0246 |
| Share-open-to-play | `challenge_open` → `challenge_play` | 0245 (and obs `challenge-open`/`-run`) | 0246 |
| License progress | `license_pass` {license} | 0255 | 0256 |
| Return rate | `session_start` {returning, days_since_last} (+ PostHog's own returning visitors on the web) | 0245 | 0246 |

- **Web:** through `src/insights.js` only (production only, GPC/DNT honoured by Box Office). No new obs names, because the
  frozen Worker drops them; the existing obs counts stay as our first-party cross-check.
- **iPhone (the operator's call, 2026-11-13; AGENTS.md §3.3):** the same events to the same first-party collector. Box
  Office's relay (`/boxoffice/e/*`) forwards PostHog's capture API and admits an event only when its Referer is a
  general-audience Cast List URL, so the app can POST PostHog's batch shape there with `Referer:
  https://mutaafaziz.com/coldgas/` and `platform: ios`, with no Box Office change (0246; flag: if that's judged too loose, a
  small box-office PR adds an explicit native header). No SDK, no IDFA or ATT, no fingerprinting, no personal data; a random
  install id in UserDefaults (reset by a reinstall); batched, offline-tolerant, never from the frame loop; a Settings switch.
  Same submission: the App Privacy label (operator), the privacy manifest, `public/privacy/index.html`,
  `ios/store/privacy-policy.md`, `ios/store/review-notes.txt`.

## 7 · Tickets, in dependency order

P0 (the first-run and sharing work, measured from the start):

1. **0245** The Phase 2 funnel is measured from day one, one vocabulary for the web and the iPhone
2. **0246** The iPhone app sends the web's privacy-conscious usage events to Box Office (Mac)
3. **0247** A first-time visitor is flying within about three seconds, and the reference demo is a second choice
4. **0248** The first jump is taught by playing it, and the first landing is celebrated
5. **0249** On the iPhone a first launch flies in three seconds, the first jump is taught, the first landing celebrated (Mac; waits for 0230)
6. **0260** Share sends the moment in one tap: the stunt, the score and a link to the same challenge
7. **0251** A friend's challenge plays in one tap on the same stunt, and beating it sends it straight back
8. **0252** On the iPhone, Share sends a picture of the moment and the challenge (Mac; waits for 0230)
9. **0253** A challenge link opens in the iPhone app, straight into that challenge (Mac; decision 1)

P1:

10. **0254** One progress store on the device, and the licenses as pure rules
11. **0255** On the web, licenses replace the selector as the way forward; free play keeps every tier
12. **0256** On the iPhone, licenses lead the title (Mac; waits for 0230)
13. **0257** After a landing: next jump, then beat this score, then share (web)
14. **0258** On the iPhone the results lead with the next jump (Mac; waits for 0230)
15. **0259** The iPhone asks for a rating only after real success (Mac)

**The native UI is being redone right now** (0230, PR #368: `ios/ColdGas/UI/` title, results, HUD). 0249, 0252, 0256 and 0258
build on it, so none starts before it lands.
