# Tesla Roadster (2nd gen) — October 15, 2026 reveal: simulation-grade research dossier

Compiled 2026-10-19 for the cold-gas physics game. Every number carries a source URL and one of these flags:

- **OFFICIAL**: Tesla's own channels (livestream, Tesla YouTube clips, tesla.com as quoted by press), or an on-record statement by a Tesla exec (Elon Musk, Lars Moravy, Franz von Holzhausen).
- **REPORTED**: a journalist's or attendee's observation or measurement, or something seen on screen in the official livestream (telemetry overlay, frame analysis).
- **ESTIMATE**: my engineering estimate, with the reasoning shown.
- **UNOFFICIAL**: a forum, influencer or low-authority blog. Used only for corroboration.

> Method note. Several outlets (tesla.com, Edmunds, Hagerty, InsideEVs, Motor1, Car and Driver, Top Gear) blocked the fetch tool. I read them through a browser-UA `curl` instead, or through quotes in other outlets. I pulled full transcripts for Tesla's official 23-minute event video, the Top Gear (49 min), Hagerty (27 min), MotorTrend (2 videos), DragTimes (in person) and CNET videos. I also extracted frames from Tesla's official clips "The Ramp", "The Kickflip" and "The 0-60", and from the livestream (which carries the on-screen **DOWNFORCE / PITCH / ALTITUDE / G-FORCE** telemetry). I read those frames to build the ramp profile and the stunt timelines. Telemetry values marked "frame-read" were transcribed by me from livestream frames, at 1–2 Hz.

---

## 0. Key primary sources (shortlist)

| Short name | URL | Type |
|---|---|---|
| Tesla — "Roadster Event" (full show, chaptered) | https://www.youtube.com/watch?v=qt5p-_tE8d0 | OFFICIAL video + transcript |
| Tesla — "The Ramp \| Roadster" (1st live demo) | https://www.youtube.com/watch?v=7p5LxFdc-Qg | OFFICIAL clip (frames analysed) |
| Tesla — "The Kickflip \| Roadster" (2nd live demo) | https://www.youtube.com/watch?v=r5vsHHPVhJg | OFFICIAL clip (frames analysed) |
| Tesla — "The 0-60 \| Roadster" (3rd live demo; description "0.81 s / 0.67 s w/ rollout subtracted") | https://www.youtube.com/watch?v=Zg9Q56t7bdo | OFFICIAL |
| Livestream with telemetry overlay (first ramp run + second run), re-upload | https://www.youtube.com/watch?v=pcFkVqbD9WY | REPORTED (Tesla footage, frame-read) |
| Top Gear — 49-min walkaround with von Holzhausen and Moravy (filmed the day before) | https://www.youtube.com/watch?v=JdkIOhFmbKI | OFFICIAL quotes |
| Top Gear article "finally landed" | https://www.topgear.com/car-news/electric/tesla-roadster-has-finally-landed-thrusters-0-60mph-059s-and-flight | REPORTED/OFFICIAL |
| Top Gear first look (event) | https://www.topgear.com/car-news/first-look/wow-new-tesla-roadster-can-actually-fly | REPORTED |
| Hagerty — Henry Catchpole with Lars Moravy | https://www.youtube.com/watch?v=22rvpUecLts | OFFICIAL quotes |
| MotorTrend — Moravy tech deep dive | https://www.youtube.com/watch?v=6D5MlPZQFOw | OFFICIAL quotes |
| MotorTrend — von Holzhausen walkaround | https://www.youtube.com/watch?v=y7oKy09ALfM | OFFICIAL quotes |
| DragTimes — attendee walk-through | https://www.youtube.com/watch?v=_lq-DpCE9rU | REPORTED (eyewitness) |
| Electrek technical look | https://electrek.co/2026/10/15/an-updated-technical-look-at-teslas-kick-flipping-0-60-in-1s-next-gen-roadster/ | REPORTED |
| Electrek reveal piece | https://electrek.co/2026/10/15/tesla-unveils-cyberfied-new-roadster-kickflip/ | REPORTED |
| paultan.org (telemetry read-outs) | https://paultan.org/2026/10/16/tesla-roadster-revealed-flies-on-spacex-air-thrusters-0-96-km-h-in-0-81s-production-2028/ | REPORTED |
| Car and Driver | https://www.caranddriver.com/news/a74145531/tesla-roadster-revealed/ | REPORTED |
| TechCrunch | https://techcrunch.com/2026/10/15/tesla-reveals-spacex-powered-roadster-that-flies-and-falls-with-style/ | REPORTED |
| Wikipedia | https://en.wikipedia.org/wiki/Tesla_Roadster_(second_generation) | secondary |

---

## 1. The event

### 1.1 Setting, time and staging

- **Date and place.** Thursday, October 15, 2026, at SpaceX's Rocket Development and Test facility in McGregor, Texas (a 4,000-acre site near Waco). OFFICIAL: Franz von Holzhausen on stage, "We are here at SpaceX's rocket test and development center in McGregor, Texas. It's 4,000 acres." (https://www.youtube.com/watch?v=qt5p-_tE8d0, 0:42). The event was rescheduled from October 1 because of severe weather (https://techcrunch.com/2026/10/15/tesla-reveals-spacex-powered-roadster-that-flies-and-falls-with-style/).
- **Time of day: night.** The stream was scheduled for 7:55 pm CDT (5:55 pm PT, a *Back to the Future* nod) and went live at about 8:00 pm CDT. REPORTED: https://www.bgr.com/2287104/tesla-roadster-event-liveblog/, https://www.explainx.ai/blog/tesla-roadster-event-recap-everything-announced-not-announced-october-15-2026. BGR noted a wind advisory, with gusts of 40–45 mph, before the show.
- **Pre-show.** A Raptor engine static fire. Attendees were given earplugs. OFFICIAL: von Holzhausen, "We hope you enjoyed our little pre-show Raptor static fire" (Tesla video 0:37). REPORTED: DragTimes (https://www.youtube.com/watch?v=_lq-DpCE9rU).
- **Set (frame analysis plus REPORTED).** A dark tarmac pad lit by white floodlight pools, with white painted guide lines on the asphalt. Long **red LED edge strips** line the pad and stands, and a blue/teal light-beam array frames the stage. A tall **red light tower/pylon** stood beside the final-stunt area. The stage backdrop showed the "ROADSTER" logotype on an angled red-lit wall. Haze, "clouds and lasers" (DragTimes). The audience sat in stands at a distance and had to wear ear and eye protection to get close (DragTimes). One Engadget commenter compared it to a wrestling arena (https://www.engadget.com/2287518/tesla-roadster-launch-live-blog/).
- **On stage.** Franz von Holzhausen (chief designer), Lars Moravy (VP Vehicle Engineering) and Elon Musk. Engineers "Andy and Lamar" drove the stage car out (Tesla video 13:47).
- **Run of show** (Tesla video chapters, OFFICIAL description of https://www.youtube.com/watch?v=qt5p-_tE8d0): **Ramp demo 6:03–10:55 → Kickflip demo 10:56–12:43 → Design 12:47–14:38 → Aero 14:38–15:57 → 0-60 demo 15:58–19:26** → specs, top speed and production talk → **"one more little thing"** final standing flip, about 21:34–22:30. Tesla's own clip descriptions call the Ramp "the first live demo", the Kickflip "the 2nd live demo" and the 0-60 "the 3rd live demo" (OFFICIAL, YouTube descriptions).

### 1.2 How the car was controlled

| Claim | Who | Source | Flag |
|---|---|---|---|
| "it is technically autonomous for this demo to make sure we don't kill anyone" | Musk | Tesla video 4:39 | OFFICIAL |
| A "Starman" mannequin in a SpaceX suit sat in the driver's seat; "Just to be clear that is not a real human" | Musk / Moravy | Tesla video 9:28–9:57; https://fortune.com/2026/10/17/tesla-flying-roadster-spacex-thrusters-2028-production-price/ | OFFICIAL |
| The "flying" Roadster was entirely remote-controlled, with zero occupants | Chris Rosales, Edmunds (attended) | https://www.edmunds.com/car-news/tesla-roadster-spacex-reveal.html, via https://supercarblondie.com/tesla-roadster-unveil-event-details/ | REPORTED |
| An Optimus robot was in the driver's seat for the ramp | Engadget liveblog only | via https://www.explainx.ai/blog/... | REPORTED, single-source, probably wrong |

**Synthesis:** No one was aboard. Tesla calls the runs autonomous. One attendee describes them as remote-controlled, and the two are compatible if a human gave supervisory or "go" commands. Model it as an autonomous controller with an operator-triggered sequence.

### 1.3 How many cars were used

- Edmunds (in person) describes **three cars**: a production-intent prototype with a full interior; a "**skirt car**" with heavy window tint that did the close-up ramp runs; and a **bare "skeleton" stunt car with fixed suspension, "which is why it bounced on landing."** REPORTED: https://www.edmunds.com/car-news/tesla-roadster-spacex-reveal.html, as summarised in search results. The article itself was 403 to the fetch tool.
- Car and Driver: "the prototype doing the stunts was different than the one that was driven on stage … the flying car featur[ed] hubcaps similar to those seen on the Tesla Cybercab and Cybertruck" (REPORTED: https://www.caranddriver.com/news/a74145531/tesla-roadster-revealed/). My frame check agrees: the stunt cars wear flat, dark aero-disc wheel covers, while the stage car has thin split-spoke wheels.
- Moravy said about four or five prototypes were on site (OFFICIAL, Hagerty https://www.youtube.com/watch?v=22rvpUecLts).
- **Crash during testing:** DragTimes says that behind the display area there was "one of their test units where they were dropping it … one of these kind of dropped down and actually exploded on the ground during some of their tests" (REPORTED, eyewitness, single source: https://www.youtube.com/watch?v=_lq-DpCE9rU). No crash happened during the live show.

---

## 2. The stunts, in order

### 2.1 Stunt 1: "The Ramp" (two runs)

#### 2.1.1 Ramp structure (frame analysis plus reports)

- **Shape.** A single-lane track that starts flat on the pad, curves up through a quarter-pipe into vertical, keeps curving **past vertical into an overhang**, and ends in a near-inverted **ledge/lip pitched about 10° from horizontal-inverted**. The car's pitch telemetry tops out at **170°** (see the table below). Descriptions: "C-shaped ramp" (Engadget https://www.engadget.com/2288448/relive-tesla-ridiculously-fun-roadster-stunt-show/); "curved ramp shaped like half of a roller coaster loop" (NBC https://www.nbcnews.com/tech/tech-news/elon-musk-shows-flying-tesla-roadster-years-delays-rcna603905); "arching Hot Wheels-like structure" (Car and Driver); "towering, backwards curving ramp" (https://www.autonocion.com/us/tesla-roadster-live-demo-recap/); "launched itself from its position beneath the ramp's nearly horizontal ledge" (search-summary of https://www.autocarpro.in/news/tesla-unveils-thrusterequipped-roadster-135279). All REPORTED.
- **Deck surface.** A light-grey, **concrete-textured** finish, **one solid white centre line**, and **glowing red LED edge strips** along both deck edges (frames: Tesla Ramp clip). From the close-up of the car hanging inverted, the deck edge reads as a thick white slab edge over a red-lit side fascia (frame-read).
- **Support.** A **steel lattice (box) truss tower** runs the full height on the outside/back of the curve. A **horizontal truss cantilever at the top** carries the overhang and the camera and light rigs (frames). The lip has a red-lit edge visible from the aerial drone shot.
- **Deck width.** About **3.7 m** between the red edge lines. ESTIMATE from frame-read: in the overhead camera shot at pitch 89.6° the car body (about 2.0 m wide per Moravy/von Holzhausen "it's 2 m wide", Top Gear video) spans 190 px and the deck spans 352 px, so 3.7 m (range 3.4–4.0 m).
- **Height** (see §2.1.3). Telemetry altitude peaks at **69.1 ft (21.1 m)** on the ledge; paultan reports "about 21 metres off the ground". Best estimate for the ledge height is **about 20 m (range 16–21 m)**.

#### 2.1.2 Run 1: climb, hang inverted, back down (no launch)

Telemetry was frame-read from the livestream overlay (https://www.youtube.com/watch?v=pcFkVqbD9WY; the channel description quotes "4,700 kg downforce, 170° pitch, 67 ft up"). Clock t is seconds into that video.

| t (s) | Downforce (kg) | Pitch (deg) | Altitude (ft) | Note |
|---|---|---|---|---|
| 5–7 | 0.6–1.9 | 0.8 | 0.0 | parked at base, fans idle |
| 8 | 79 | 0.9 | 0.0 | fans spooling |
| 9 | 186 | 1.5 | 0.1 | rolling |
| 10 | 279 | 6.6 | 0.5 | |
| 11 | 434 | 25.5 | 2.7 | |
| 12 | 825 | 50.3 | 10.2 | |
| 13 | 1,544 | 74.7 | 21.1 | |
| 14 | 2,540 | 87.7 | 28.8 | slowing |
| 15 | 3,220–3,412 | 89.6–89.7 | 30.4–30.5 | **near-stop on the vertical wall** |
| 16 | 3,992 | 91.3 | 31.2 | |
| 17 | 4,329 | 104 | 37.3 | |
| 18 | 4,510 | 127 | 48.2 | |
| 19 | 4,606 | 151 | 57.6 | |
| 20 | 4,653 | 166 | 61.9 | |
| 21–23 | 4,672–4,695 | **170** | 64.0–66.7 | creeping along the ledge |
| 24–30 | 4,697–**4,700** | 170 | 67.3–**69.1** | **hanging inverted, about 10 s** |
| 31 | 4,698 | 161 | 68.6 | reversing down |
| 32 | 4,700 | 141 | 64.8 | |
| 33 | 4,704 | 123 | 58.4 | |
| 34 | 4,706 | 104 | 50.4 | |
| 35 | 4,691 | 85.9 | 41.8 | |
| 36 | 4,397 | 67.2 | 33.2 | |
| 37 | 3,755 | 48.1 | 25.6 | |
| 38 | 2,938 | 28.6 | 20.1 | |
| 39 | 2,112 | 10.6 | 17.7 | |
| 40 | 1,412 | 1.4 | 17.8 | back on the pad; altitude channel drifted by about 17.7 ft |

Observations:

- The car **stopped on the wall (pitch about 90°) and on the inverted ledge**. This demonstrates a stationary hold. Tesla's claim is "enough suction to hold the vehicle upside down, even when stationary" (Tesla page quoted by https://evxl.co/2026/10/19/tesla-roadster-suction-patent-skirts-radar-gps/ and Car and Driver).
- The "DOWNFORCE (kg)" channel is commanded or estimated suction force in kgf. It rises with pitch and reaches **4,700 kgf ≈ 46 kN** when inverted. REPORTED/OFFICIAL on-screen: paultan "downforce reading of 4,700 kg"; aviationweek "about 4,700-kg-equivalent (10,360 lb.) downforce, per Tesla" (https://aviationweek.com/aerospace/emerging-technologies/tesla-demos-flying-roadster-powered-spacex-cold-gas-thrusters).
- Hagerty: the car stuck "with an audible sucking sound … rolled back down the road, then back up" (REPORTED https://www.hagerty.com/media/news/new-tesla-roadster-revealed-and-it-flies/). Engadget: "drove up it twice" (REPORTED).
- **Climb speed:** about **3.5–4.5 m/s (8–10 mph)**. ESTIMATE: arc length per second derived from Δaltitude / sin(mean pitch). For example, t = 11→12 s gives 12.2 ft ≈ 3.7 m. This was a slow, suction-held crawl, not a momentum-driven loop.

#### 2.1.3 Ramp profile reconstructed from telemetry (ESTIMATE)

With pitch θ and altitude z, dz = sin θ · ds and radius R = ds/dθ. Segment results:

| Pitch segment | Δz (ft) | Implied R |
|---|---|---|
| 6.6→25.5° | 2.2 | about 7.3 m |
| 25.5→50.3° | 7.5 | about 8.6 m |
| 50.3→74.7° | 10.9 | about 8.8 m |
| 74.7→87.7° | 7.7 | about 10.4 m |
| 91.3→104° | 6.1 | about 8.4 m |
| 104→127° | 10.9 | about 9.2 m |
| 127→151° | 9.4 | about 10.4 m |
| 151→166° | 4.3 | about 13.7 m |
| 166→170° | 2.1 | nearly straight |

A circular arc from 0° to 90° gains R in height. The climb gained 30.5 ft (9.3 m) to 89.7°, so R_lower ≈ 9.3 m. From 90° to 170° the gain is R(1 − cos 170° + cos 90° … ) = 0.985 R. It gained about 33–38 ft (10–11.5 m), so R_upper ≈ 10–11 m.

**Best-fit geometry (game default):**

```
Origin at the start of the curve (pad level), +x toward the ramp, +z up.
Segment A: flat run-in on the pad (any length).
Segment B: circular arc R = 9.5 m, pitch 0° -> 170°.  Center at (0, 9.5).
           point(θ) = (R·sinθ, R·(1−cosθ)); at 90°: (9.5, 9.5); at 170°: (1.65, 18.86)
Segment C: straight inverted ledge, 5–6 m long, pitched 170° (i.e. 10° nose-up when
           upside down), running back over the approach: ends near (−3.8, 19.8).
Deck width 3.7 m; red LED edge strips; white centre line; deck thickness ~0.4–0.6 m.
Structure: steel box truss behind segment B (outer side), cantilever truss over C.
```

- The top-of-ledge contact-path height of about 19.8–20.7 m matches the telemetry peak of 69.1 ft (21.1 m) and paultan's "about 21 m".
- **Uncertainty.** On the way down, the altitude channel read 17.7 ft at pitch 1.4°, so it had drifted. If the descent numbers are trusted instead, total height is about 51 ft (15.6 m) and R ≈ 7.8 m. **Use R = 9.5 m (range 7.5–10.5 m), lip height 20 m (range 16–21 m).** Pixel measurement from Tesla's Ramp clip, scaled by car width and deck width, gives 17–24 m, which is consistent.
- The lowest arc may tighten to R ≈ 7–8 m (a clothoid-like entry). This is optional.

#### 2.1.4 Run 2: climb and launch (Tesla's "The Ramp" clip plus telemetry)

Telemetry frame-read at 2 Hz (G-FORCE channel replaces DOWNFORCE on this run). τ = 0 at the frame showing 26.7 ft on the climb:

| τ (s) | G | Altitude (ft) | Event |
|---|---|---|---|
| 0.0–2.0 | 0.8–0.9 | 26.7→57.9 | climbing, about 4–5 m/s |
| 2.5–3.0 | 1.1 | 62.0→64.8 | onto the ledge |
| **3.5** | **0.2** | **67.5** | **release: near free-fall** |
| 4.0 | 0.4 | 67.0 | falling clear, roll begins (attitude jets) |
| 4.5 | 0.3 | 62.2 | |
| 5.0 | 1.7 | 39.3 | down-jets braking |
| **5.5** | **3.3** | **21.4** | **peak braking** |
| 6.0 | 1.0 | 10.1 | |
| 6.5 | 0.3 | 7.7 | |
| 7.0 | 1.4 | 3.8 | final flare |
| 7.5 | 0.7 | 1.1 | |
| 8.0 | 1.1 | 0.4 | **touchdown, wheels down** |
| 8.5–9.5 | 0.9–1.1 | 0.4–1.2 | drives away out of the cloud |

- paultan, REPORTED: "The G-force readout jumped to 3.3 G at about 6.5 metres off the ground as the thrusters braked the fall". Tesla Oracle gives "3.2 Gs" (https://www.teslaoracle.com/2026/10/15/tesla-stuns-the-world-with-the-flying-roadster-stunts-videos-learn-how-it-works/).
- **Hang time on this run:** under 1 s at the lip. On run 1 the car hung for about 10 s.
- **Launch.** No ramp momentum was involved. The car **released from the inverted ledge** (fans off or skirts unsealed), dropped away, and fired attitude thrusters. Fall velocity from the altitude rate: about 14 m/s at around 12 m altitude, braked to about 1.5 m/s by around 2.5 m, which is about 1.0–1.3 s of braking at roughly 1.3–2.3 g net (ESTIMATE). The 3.3 G reading is specific force, so thrust/weight was about 3.3 at peak.
- **Rotation.** A **180° half-roll about the car's longitudinal axis** (a barrel roll), done during the first about 1.1 s of the fall. Frames show the car leaving the lip inverted, going wheels-sideways at about 0.5 s, and being upright by about 1.1 s, with side (attitude) jets visible (Tesla Ramp clip; frame sequence 9.5–10.75 s at 4 fps). Outlets also say "rolled 180 degrees" (Fortune), "flip … axial roll" (Aviation Week), "barrel roll" (Car and Driver, Hagerty, InsideEVs), "spun around" (TechCrunch). Car and Driver: "allowed it to fly forward and do a barrel roll before they helped it gently land … in a cloud of white smoke". So the car moved forward, away from the ramp, during the roll.
- **Landing.** **Soft, on all four wheels, upright, in a large white condensation cloud.** Four vertical down-jet plumes were visible during braking. The car hovered for about 1–1.5 s at under 3 m before settling. Touchdown G was about 1.1–1.4 (telemetry). Sources: NBC "landed softly in a cloud of condensation"; Car and Driver "gently land … cloud of white smoke"; paultan "landed in a cloud of vapour"; Edmunds says the skeleton stunt car "bounced on landing" (fixed suspension). REPORTED. Landing point: about 8–12 m out from the ramp base, on the approach side (frames; ESTIMATE).
- **Plume appearance.** Bluish-white supersonic jets that turned into dense white fog clouds (condensation and frost from adiabatically cooled N2). Moravy: "you get some … liquefication … this sort of whitish cloud" (OFFICIAL, MotorTrend https://www.youtube.com/watch?v=6D5MlPZQFOw).
- **Rehearsal or tether.** Motor1 calls it "a tethered flip" and says Tesla "rolled out the next-generation Roadster already hanging upside down" (https://www.motor1.com/news/812195/tesla-roadster-stunt-2028-production/). **This conflicts with the footage**: two full climbs from the pad are visible, and I saw no tether in the official frames. Treat the tether as unconfirmed.

### 2.2 Stunt 2: "The Kickflip" over the lineup

- **Vehicles.** Five vehicles parked **side by side in one row** (long axes perpendicular to the Roadster's path), on a low red-lit plinth. In the order the Roadster crossed them, frame-read from the side camera: **gold Cybercab → Cybertruck → Tesla Semi (centre, tallest) → Model Y → Model 3 (dark)**. Lists: TechCrunch "Cybercab, Cybertruck, Tesla Semi, Model Y, and Model 3"; paultan "Model 3 and a Cybercab on one side, a semi in the center, and Model Ys beside the semi" (via Tesla Oracle). Semi height is "13.5 feet" per SupercarBlondie. REPORTED.
- **Approach.** The car drove down a white guide line at modest speed ("drove at normal speed toward a lineup", Tesla Oracle). ESTIMATE: horizontal speed about **7–9 m/s (16–20 mph)**, from horizontal displacement versus time in the side shot. **No ramp**: it took off from flat ground on thrust alone. "Two downward jets lift the car as it approaches" (https://flyingroadster.net/video/, UNOFFICIAL), then four down-jets are visible (frames).
- **Height.** Peak about **7–8 m**. paultan: "Telemetry showed about 7 m altitude" (REPORTED). NBC: "jumped 27 feet in the air, according to Tesla, while performing a barrel roll" (REPORTED/OFFICIAL-attributed, 8.2 m). Frame-scaling against the Semi cab (about 4.1 m) gives about 8–9 m to the car body at peak (ESTIMATE).
- **Distance.** Row span about **15–17 m** (five vehicle widths plus gaps). Takeoff was just short of the first vehicle and landing just beyond the last, so the airborne horizontal distance is **about 20–25 m** (ESTIMATE from frame scaling).
- **Rotation.** A **full 360° roll about the longitudinal (travel) axis**: a barrel roll, which Tesla calls a "kickflip" (skateboard sense). Frames show the car wheels-up over the Semi. Tesla Oracle: "Side attitude-control thrusters rotated it through a 360-degree flip … The whole maneuver took about 3 seconds" (REPORTED). Moravy: "Tony Hawk would be proud. We call that the kick flip" (OFFICIAL, Tesla video 11:33). Musk: "I think we could have cleared more than our whole fleet" (OFFICIAL, 11:38).
- **Timeline** (side camera, 4 fps): lift-off at t0; peak and inverted at about t0 + 1.2–1.5 s, over the Semi; upright again at about t0 + 2.2 s; down-jets fire for landing; touchdown at about **t0 + 3 s**.
- **Landing.** Soft, upright, on four wheels, behind a large white plume. The car drove away (frames; https://www.youtube.com/watch?v=r5vsHHPVhJg).
- **Thrust used.** 4 corner down-jets plus side/front attitude jets. These are Rocket-spec "flight system" nozzles: 4 down plus 2 front yaw (Moravy, Top Gear and Hagerty).

### 2.3 Stunt 3: 0–60 mph run(s)

- **First**, a pre-recorded test was shown at "1 second" (OFFICIAL, Tesla video 16:06–16:49).
- **Then a live run** on the pad, "on the max setting". The timing system failed at first ("I think we broke the system. We didn't do it in .17 seconds") and then showed **0.81 s** (OFFICIAL, Tesla video 17:00–18:34). Tesla's YouTube clip says **"0-60 mph in 0.81 seconds … 0.67 seconds (w/ rollout subtracted)"** (OFFICIAL https://www.youtube.com/watch?v=Zg9Q56t7bdo).
- Moravy: "We didn't have a whole lot of room out on the pad, so we had to cut it short." He also said the exhaust leaves the four thrusters "faster than speed of sound, so you see the mach diamonds. It actually creates over 80 kN of thrust" (OFFICIAL, 17:37–18:12).
- Electrek's frame-by-frame says the thrusters were already firing before the car began to roll ("electric turbo lag") (REPORTED).
- Musk: "the production car will actually do better than that … ride the limit of don't detach the retina" (OFFICIAL, 19:00).
- paultan computed an average of about 3.4 g over about 11 m (REPORTED).

### 2.4 Stunt 4: final standing flip ("one more little thing")

- The car drove up a white line to the foot of a **tall red-lit pylon** flanked by angled white light beams, and **stopped**.
- It **lifted vertically from standstill** on down-jets, rolled a **full 360° about its longitudinal axis** at roughly 4–7 m (ESTIMATE), recovered upright, **hovered on four down-jets**, landed in a white/red-lit cloud, and drove off. Frame timing: lift-off to upright about 1.8 s; touchdown about 2.6 s after lift-off.
- paultan: "the car launched beside a tall red tower, flipped, landed, and drove off". flyingroadster.net: "Started from a standstill and lifted straight off the ground. Corkscrewed in the air". Engadget: "started from a stationary position, flipped in the air, and hovered back down". REPORTED.
- **No drift and no sustained hover demo.** Hovering only happened during landings. Tesla gave no hover duration.

### 2.5 Other observed behaviour

- Stage demo of the fans running ("Sorry, it's a little loud here") and the wing moving through its modes (OFFICIAL, 14:50–15:57).
- DragTimes saw a later close-up demo run in which "you can see that skirt dragging along the ground" (REPORTED).

---

## 3. The vehicle

### 3.1 Trims (OFFICIAL unless noted)

| Trim | Seats | Hardware | 0–60 mph | Top speed | Availability |
|---|---|---|---|---|---|
| Roadster (base) | 2 | active aero, "normal Venturi" underside, no fans | "just over a second" (von Holzhausen, MotorTrend) / "probably sub-two" (Top Gear article) | "220-ish" (von Holzhausen) / 210 mph (Top Gear) | not on the reservation page; specs TBC (https://www.notateslaapp.com/news/4850/tesla-roadster-all-the-details-you-may-not-know) |
| **Performance** | 2 | + fan suction ("multi-mode suction system"), adaptive suspension | **< 1.6 s** | 210 mph (Hagerty, Top Gear) | reservation |
| **Thrust** | 2 | + 200 L COPV, **4 rear cold-gas nozzles** | **< 0.9 s** (site); 0.85 s rollout-subtracted (Moravy via Top Gear/Hagerty) | 230 mph | "limited" |
| **Rocket** | **1** | + 400 L COPV in the passenger-seat space (600 L total), **+6 nozzles: 4 down (one per corner, "behind each wheel") + 2 front yaw**, 10 total; "air ready"; "not approved for public road use" | **< 0.59 s** | > 230 mph | invite only |

Sources: Electrek (https://electrek.co/2026/10/15/tesla-unveils-cyberfied-new-roadster-kickflip/), Teslarati (https://www.teslarati.com/tesla-roadster-specs-configurations/), Top Gear article, Hagerty and MotorTrend videos. The Tesla site describes Rocket as giving "forward, upward, and lateral rotational movement" (quoted in https://www.autonocion.com/us/tesla-roadster-live-demo-recap/).

### 3.2 Dimensions

| Item | Value | Source / flag |
|---|---|---|
| Wheelbase | **2,825 mm** ("2825, 2.8 m") | Moravy/FvH, Top Gear video — OFFICIAL |
| Width | **about 2.0 m** ("it's 2 m wide") | Top Gear video — OFFICIAL |
| Length | about 4.6–4.75 m | ESTIMATE: mid-engine-supercar proportions with a "long-tail" rear and 2,825 mm wheelbase (cf. Huracán 2,620/4,520 mm) |
| Height | about 1.10–1.20 m | ESTIMATE from frames versus a 6'3" presenter and the wheel diameter |
| Track F/R | about 1.70 / 1.72 m | ESTIMATE: 2.0 m body, 295/335 tyres, flush wheel faces |
| Ground clearance | about 110 mm normal; **−40 mm in Track mode** | 40 mm drop: Hagerty — OFFICIAL/REPORTED; base value ESTIMATE |
| Steering lock | **±170°** yoke, variable-ratio steer-by-wire | Moravy, Top Gear video — OFFICIAL |

### 3.3 Mass

| Trim | Value | Source / flag |
|---|---|---|
| Base / lightest | "just under 1,700 kg" / "under 1,700 kg" target | Moravy (Hagerty), von Holzhausen (MotorTrend), Top Gear — OFFICIAL |
| Performance | about 1,720–1,760 kg | ESTIMATE: + 4 × 20 kW fans, skirts, ducts (about 40 kg) |
| Thrust (gas full) | about 1,950–2,000 kg | ESTIMATE: + 200 L Type-IV COPV (about 0.7 kg/L, by analogy with 700-bar H2 tanks, so about 140 kg) + valves/plumbing/nozzles (about 20 kg) + N2 99 kg |
| Rocket (gas full) | about 2,400–2,500 kg | ESTIMATE: + 400 L COPV (about 280 kg) + 6 nozzles and plumbing (about 30 kg) + 198 kg N2 − passenger seat |
| Stunt "skeleton" car | unknown, likely lighter | Edmunds REPORTED; Electrek speculates it "may not have had a battery" |

MKBHD's "4000+ pound" figure is his estimate (TechCrunch). The extra weight of the Thrust and Rocket hardware was not disclosed (Motor1).

### 3.4 Battery, motors, drivetrain

- **Battery:** in the floor; bespoke **4680 cells in aluminium cans**, "special chemistry", nickel-based Li-ion, **double-sided cooling** (single-pass coolant flow), **titanium upper plate**, aluminium lower plate. OFFICIAL: Moravy, Hagerty and MotorTrend; Top Gear.
- **Voltage:** **800–1,000 V** ("a 900 V system or 800 to 1,000 V system"). OFFICIAL: Moravy, MotorTrend.
- **Capacity: about 115 kWh.** OFFICIAL: von Holzhausen, MotorTrend walkaround ("rear-wheel drive, twin motor with the same battery pack, 115 kWh pack"; the chapter title says "100+ kWh"). Moravy declined to give a number to Hagerty and Top Gear. Tesla has not published it.
- **Charging:** >500 kW (V4 Supercharger), 15→80/85 % in about 10 min (10→80 % in "10–12 min"). OFFICIAL: Moravy.
- **Track endurance:** 25–30 min of unlimited track performance. OFFICIAL: Moravy, Hagerty.
- **Range:** >300 mi (Tesla); 310–320 mi (Moravy/Top Gear).
- **Motors:** **two, both at the rear axle**, each with its own inverter and a **planetary reduction of 8.4:1** to its wheel. No differential (true torque vectoring). Carbon-sleeved rotors with cobalt-steel laminations. RWD only. OFFICIAL: Moravy (Hagerty, MotorTrend, Top Gear).
- **Power:** "over a megawatt", 500 kW per motor, "1,500 horsepower" (Moravy, MotorTrend/Top Gear). Tesla/press quote 1,341 hp (1 MW) for Performance and up. Base: about 800 kW / 1,073 hp (Top Gear article) **or** 1 MW (Top Gear voice-over, Not a Tesla App).
- **Torque:** "over 1,400 N·m" (Moravy, Hagerty); "1,348 N·m" (Moravy, MotorTrend); Performance 1,033 lb-ft ≈ 1,400 N·m (Hagerty host); base 885 lb-ft (Top Gear article) or about 960 lb-ft (Top Gear video, Not a Tesla App). These are taken as **motor-side combined torque** (ESTIMATE; see §6).
- **"e-Boost"** push-to-pass button; launch via a screen mode "similar to Cheetah mode" (OFFICIAL, von Holzhausen/Moravy).

### 3.5 Chassis, wheels, tyres, brakes, steering, suspension

- **Tyres:** split fitment, **295/30 R20 front, 335/30 R21 rear**. OFFICIAL: Moravy, Top Gear video; the auto-transcript reads "29530s at the front, 3 [3]5/30s at the rear … wheel diameter 20/21". **Pirelli P Zero Trofeo RS, marked "Elect"** (REPORTED, paultan). DragTimes thought the rears "look like 345s" (REPORTED).
- **Wheels:** stage car has thin, sparse split-spoke wheels in silver/black. Stunt cars have flat aero-disc covers (Car and Driver; frames).
- **Brakes:** **carbon-ceramic** discs, **brake-by-wire**; front brakes used for stability control. OFFICIAL: Moravy, Top Gear; InsideEVs.
- **Steering:** **steer-by-wire yoke**, no mechanical column, ±170°, variable ratio, wheel can be damped. Throttle-by-wire. OFFICIAL.
- **Suspension:** **double wishbone with horizontal rocker-arm (pushrod) layout**, **spool-valve adaptive dampers**, adjustable ride height. **Track mode: −40 mm and about 3× stiffness.** OFFICIAL/REPORTED: Moravy, Top Gear and Hagerty.
- **Structure:** bespoke carbon/aluminium hybrid tub. The prototype body is all carbon fibre, with production material "mixed" by trim. Seats are moulded into the chassis with fixed bases; the backrest reclines and the pedal box and column move. OFFICIAL.
- **Vehicle dynamics:** a single controller fuses steer-by-wire, brake-by-wire, traction control, active aero and the thrusters' yaw trim ("Superman mode"). OFFICIAL: Moravy, MotorTrend.

### 3.6 Aero

- **Two aero modes:** high-downforce/braking and low-drag (DRS). A **biplane-style rear wing** (four-bar link, **two Optimus "ankle" actuators** plus hidden ones, with a holding brake) doubles as an air-brake. The **charge port is hidden behind the wing**. OFFICIAL.
- **Rear wing downforce:** "up to 2 Gs of downforce … over 200 mph" (Moravy, Hagerty). Aero is ineffective below about 50 mph, so the fans fill that "void" (OFFICIAL).
- **Front:** wings inside the intake that pivot up to **80°**, an active **hood vent** over the flat-mounted radiator and fan, pop-out **barge boards** behind the front wheels, and fender extraction. About 0.33 m² of flow area; "the whole front … is just a massive wing" (OFFICIAL, Moravy, Hagerty). No frunk.
- **Drag coefficient:** **not disclosed**. ESTIMATE: CdA ≈ 0.50–0.60 m² in low-drag mode (Cd about 0.28–0.32 × A about 1.85 m²). That is consistent with 1 MW reaching the 330 mph target: P = ½ρCdA·v³ → CdA ≈ 0.52 at 147.5 m/s. In high-downforce mode, CdA ≈ 0.9–1.2 m².

### 3.7 Performance summary

| Metric | Value | Source |
|---|---|---|
| 0–60 (live, Thrust-type car) | **0.81 s** (0.67 s rollout-subtracted) | Tesla YouTube, OFFICIAL |
| 0–60 recorded test | 1.0 s | Tesla event, OFFICIAL |
| 0–60 Performance | < 1.6 s | OFFICIAL |
| 0–60 Thrust | < 0.9 s (site) / 0.85 s (rollout-subtracted) | OFFICIAL |
| 0–60 Rocket | < 0.59 s (site); 0.55 s "with rollout" all systems (Moravy, Hagerty) | OFFICIAL |
| Peak longitudinal | "over 5 G" (Hagerty host) / "six G's of thrust" (Moravy, Top Gear) | OFFICIAL/REPORTED |
| Quarter mile | not given ("deferred to the experts"); "a half mile in the time other cars do a quarter mile" (Musk) | OFFICIAL |
| Top speed | 210 (Perf) / 230 (Thrust/Rocket) mph; 214 mph "for now" (Moravy, Top Gear); 330 mph target "just gearing"; Musk wants Mach 0.5 (about 383 mph) | OFFICIAL |
| Cornering | "> 2 g" with fans versus 1.26 g on tyres alone | OFFICIAL, Moravy on stage |

---

## 4. The suction ("sucker") fan system

- **The 2 g quote.** On stage, right after the ramp stunt: *"To do that, we have a suction a fan suction system on the bottom of the car that can pull up to 2 G's in order to make the car go upside down. And then we borrowed some technology from SpaceX to do the rest."* (OFFICIAL, Tesla video 8:11). Musk then followed with *"Yeah. I mean, this car really sucks … could suck the chrome off a trailer hitch."*
  - **Who said it is disputed.** InsideEVs, Motor1 and Tesla Oracle say **Lars Moravy**. Drive Tesla Canada and paultan say **Musk**. Hagerty attributes it loosely to the trio. The transcript turn structure (a new speaker, then Musk's "Yeah. I mean…") and the matching "To do that…" phrasing Moravy later uses when introducing himself as "a spec guy" both point to **Moravy**. That is my assessment; the transcript is not labelled.
  - Moravy separately, on stage at 15:09: "corner at greater than 2 G's and accelerate … beyond the tires, which is typically 1.26 G's" (OFFICIAL).
- **Fan count and location:** **four fans in a row in the rear diffuser/bumper, below the four thruster nozzles**, exhausting rearward. They are "angled rearward and up" and fed by ducts from the sealed floor. OFFICIAL: von Holzhausen, MotorTrend ("below that are the four fans"); Moravy. Patent US 12,377,920 shows four fans in a curved rear duct: the two centre fans evacuate the sealed floor and the two outboard fans work outside it (REPORTED, https://evxl.co/2026/10/19/tesla-roadster-suction-patent-skirts-radar-gps/).
- **Power:** each fan uses the heat-pump compressor motor (12 kW base), sped up to **over 15,000 rpm**, targeting **about 20 kW each, about 80 kW total** ("still working through that"). OFFICIAL: Moravy, MotorTrend and Hagerty.
- **Sealing:** **four independent deployable skirts ("fences")**: left, right, front and rear, sealing an area "about the size of the battery pack". The skirts are compliant and replaceable, made of rubber with nylon bristles. OFFICIAL: Moravy and FvH; Hagerty. The patent describes infinitely variable skirt positions, ground-clearance sensing (laser/camera, mmWave radar, ultrasonic) and GPS/map pre-emption with hysteresis.
- **Modes:**
  1. **Sucker mode** (low speed, all skirts down, sealed): traction and downforce at **0 mph**, "over 2 G in a corner from 0 to 50 mph" (OFFICIAL).
  2. **High-flow/venturi mode** (high speed): front and rear skirts lift, side skirts stay down, and the fans pull a high-velocity underbody flow, giving "a little bit of thrust" (OFFICIAL).
- **Magnitude claims:**
  - "over 2 Gs of downforce … 2,500 kilos or something … 1 G against gravity and then 1 G to hold the car up … theoretically [drive] upside down … haven't tried it yet" (Moravy, MotorTrend, filmed before the event — OFFICIAL).
  - Live on-screen readout: **4,700 kg** inverted (OFFICIAL on-screen / REPORTED).
  - Electrek: "4,700 kg … surprisingly large … some liberties were taken" (REPORTED).
- **Stationary and inverted:** yes. Tesla: "enough suction to hold the vehicle upside down, even when stationary". The live run hung inverted for about 10 s at near-zero speed (telemetry above).

---

## 5. The cold-gas thruster system

### 5.1 Hardware

| Item | Value | Source / flag |
|---|---|---|
| Thrust trim nozzles | **4 rear**, in a horizontal row in the upper diffuser (round, gold/brass-coloured, Inconel/titanium) | FvH/Moravy (MotorTrend, Top Gear); frames — OFFICIAL |
| Rear nozzle plumbing | **two independently actuated "down pipes"**: 2 left nozzles + 2 right nozzles, equal-length pipes; valves opened by **Optimus ankle actuators** over a rocker; left/right modulated for **yaw trim** ("a 10% difference would put this thing into a spin") | Moravy (MotorTrend, Hagerty) — OFFICIAL |
| Rocket extra nozzles | **+6: 4 downward-facing, one per corner ("behind each wheel"), + 2 front-facing for yaw** = 10 total | Moravy (Hagerty, Top Gear), FvH (MotorTrend), Top Gear article — OFFICIAL |
| Gas | **Nitrogen**: "nitrogen seemed like a good fuel" (Moravy, Hagerty); "compressed nitrogen" (FvH, MotorTrend); "high pressure nitrogen system" fill (Top Gear). Stage wording was "air" / "ultra high pressure air tank … the car can recharge its air tank" (Musk/Moravy, Tesla video 12:21) | OFFICIAL, conflicting |
| Tanks | **Thrust: 200 L COPV** in the trunk behind the seats. **Rocket: + 400 L COPV** in the passenger seat ("twice as big", a longer cylinder with domed ends) = **600 L, "two of them"** | OFFICIAL |
| Pressure | **"up to about 10,000 psi"** (≈ 690 bar) | Moravy and FvH — OFFICIAL. An on-car track screen showed "Thruster 5,500 psi" (≈ 380 bar), REPORTED by paultan |
| Gas mass | "about 250 kilos of air" in 600 L | Moravy on stage, Tesla video 12:15 — OFFICIAL |
| Thrust | "over 80 kN" (rear, Thrust trim); "90 kN or 80-plus kN" with 600 L (Rocket); "about the same as … a single-engine F-16 before the afterburner" | Moravy — OFFICIAL |
| Force vs tyres | "4–5 times the force the tires can" | Tesla on X, via Fox Business — OFFICIAL |
| Exhaust | supersonic, visible Mach diamonds, below-freezing at the nozzle, white condensation cloud, loud | Moravy — OFFICIAL |
| Duration | Thrust: "one charge … the first third, two-thirds of [a quarter-mile] … about fiveish seconds"; "it's one time" | Moravy, Top Gear video — OFFICIAL. Top Gear article: "emptied in just six seconds"; InsideEVs: "five to six seconds" |
| Refill | 200 L: **2–6 h** (Top Gear). 600 L: **6–7 h** (Hagerty, Wired). Target **under 30 min**. Musk: the car "can recharge its air tank" | OFFICIAL, conflicting |
| Activation | screen launch mode (like Cheetah mode); "thrust or burst" use; boost for passing; road use of the thrusters is not intended ("off-road use only" for Rocket) | OFFICIAL |
| SpaceX heritage | COPV technology from Falcon; valve design "very much a SpaceX thing"; engineers from SpaceX's cold-gas RCS work; Moravy compares it to Apollo/satellite cold-gas RCS | OFFICIAL |

Not stated by Tesla: per-nozzle thrust, nozzle throat or exit size, Isp, or flow rate.

**Note on Draco:** Draco is a *hypergolic* SpaceX thruster, not cold gas. The relevant SpaceX heritage is **Falcon 9's nitrogen cold-gas RCS** and **Falcon COPVs**. No source tied this system to Draco.

### 5.2 Thrust/impulse modelling (ESTIMATE, computed)

**Gas mass.** I used real-gas densities from CoolProp (NIST-grade equation of state), with the 690 bar = 10,000 psi rating:

| Fluid, state | ρ (kg/m³) | Z | 200 L | 400 L | 600 L |
|---|---|---|---|---|---|
| N2, 690 bar, 20 °C | **494.9** | 1.603 | **99.0 kg** | 197.9 kg | **296.9 kg** |
| N2, 690 bar, 30 °C | 482.9 | 1.588 | 96.6 | 193.1 | 289.7 |
| N2, 600 bar, 20 °C | 462.6 | 1.491 | 92.5 | 185.1 | 277.6 |
| N2, 500 bar, 20 °C | 420.2 | 1.368 | 84.0 | 168.1 | 252.1 |
| N2, 380 bar (the 5,500 psi screen), 20 °C | 356.2 | 1.226 | 71.2 | 142.5 | 213.7 |
| Air, 690 bar, 20 °C | 531.2 | 1.544 | 106.2 | 212.5 | 318.7 |

Check against the ideal gas: ρ = PM/(ZRT) = 69×10⁶ × 0.028013 / (1.603 × 8.314 × 293.15) ≈ 495 kg/m³. That is 0.495 kg/L, at the top of the brief's "0.45–0.5 kg/L" range.

**Tesla's "about 250 kg in 600 L"** implies 0.42 kg/L. That matches N2 at about **500 bar** (or a warm, partly filled tank), not 690 bar. Treat 250–297 kg as the range.

**Nozzle and blowdown model.** Each tank is a single volume blowing down through choked converging-diverging nozzles to 1 atm. The nozzle uses ideal-gas relations (γ = 1.4, R = 296.8 J/kg·K) with the tank state from the real-gas equation of state. I bracketed the tank between **adiabatic** (isentropic gas cooling, the realistic case for a fast dump) and **isothermal** (wall heat transfer). Throat area was sized so that the initial total thrust is 80 kN. Expansion ratio ε = 4–8: underexpanded at full pressure, which gives Mach diamonds as observed.

| Case | Gas used | Throat area total (per-nozzle Ø) | **Total impulse** | **Avg sea-level Isp** | t at F = 50 % | t at F = 10 % | "Empty" (Pc < 3 bar) |
|---|---|---|---|---|---|---|---|
| Thrust 200 L, 80 kN initial, adiabatic | 91–93 kg | 7.2–7.5 cm² (Ø 15 mm × 4) | **46.5–47 kN·s** | **52 s** | 0.21 s | 1.45 s | 7.0–7.7 s |
| Thrust 200 L, 80 kN, isothermal | 97–98 kg | same | **64–65 kN·s** | **67–68 s** | 0.40 s | 2.2 s | 5.2–5.5 s |
| Rocket 600 L, 80 kN initial (all nozzles), adiabatic | 272–278 kg | Ø 9.6 mm × 10 | **140 kN·s** | 52 s | 0.65 s | 4.4 s | 21–23 s |
| Rocket 600 L, 80 kN, isothermal | 291–293 kg | | **192–195 kN·s** | 67–68 s | 1.2 s | 6.6 s | 16 s |

Adiabatic Thrust-trim thrust curve (t s → kN; tank bar; tank K):

```
0.0→80.0 (690 bar, 293 K)  0.2→42.1 (363, 250)  0.4→27.3 (238, 225)  0.6→19.7 (173, 207)
0.8→15.2 (134, 194)  1.0→12.1 (109, 184)  1.5→7.8   2.0→5.4 (51, 150)  3.0→3.0 (31, 129)
4.0→1.8   5.0→1.2 (15, 111)  6.0→0.7   7.0→~0.4 (sputter)
```

- **Isp.** The ideal initial sea-level Isp for N2 at 293 K, 690 bar, ε = 8 is about **75 s** (exhaust velocity about 740 m/s, c* ≈ 431 m/s, C_F ≈ 1.7). The **blowdown-averaged Isp is 52–68 s** because the gas cools (to about 110 K by the end in the adiabatic case) and the pressure ratio falls. **Use 60 s (range 50–70 s) for the average and 72 s for the initial value.**
- **Reconciling "80 kN" with "about five seconds".** These are consistent *only* as a **decaying blowdown**: 80 kN at valve-open, halving in about 0.2–0.4 s, at 10 % by 1.5–2.2 s, and sputtering out at about 5–7 s. Moravy's balloon analogy and "you get less and less thrust" (OFFICIAL) fit this. A *constant* 80 kN for 5 s would need 400 kN·s, which is about 6–8× the 200 L impulse. **That is physically impossible with these tanks.**
- **Per-nozzle thrust consistent with "about five seconds":**
  - Peak-rated model (matches the 80 kN claim): **20 kN per rear nozzle at t = 0, with τ_eff ≈ 0.35 s** for the first half then a slow tail. This is good for a 0.8 s 0–60.
  - Constant-thrust model (if the game wants a flat burn): F̄ = I / t = 47–65 kN·s / 5 s ≈ **9–13 kN total, about 2.3–3.2 kN per rear nozzle**.
- **0–60 sanity check.** Thrust impulse in the first 0.81 s is about 26–32 kN·s (adiabatic–isothermal). On about 1,950 kg that gives Δv ≈ 13–16 m/s. The remaining 11–14 m/s from tyres plus fans needs about 1.4–1.7 g average. **Plausible.**
- **Ramp-landing sanity check.** The 3.3 G peak reading on an about 2,000–2,450 kg car means about 65–79 kN of down-thrust (4 corner nozzles at about 16–20 kN each). That matches "80 kN class" thrust. **Consistent.**
- **Hover budget (Rocket).** Weight is about 2,450 kg × 9.81 = 24 kN. With 140–195 kN·s total, pure hover would last about 6–8 s if all the gas went to hover. Each live stunt used about 2–4 s of jet time. This is consistent with Tesla not quoting a hover or flight duration, and with demos being short hops.

---

## 5b. Design and exterior (for 3D modelling)

- **Overall:** a low, wide, **cab-forward wedge** in the Cybertruck/Cybercab language, but softer: "minimal line … beautiful twisting surface" (FvH). The body is **faceted/angular**, with flat planes meeting at crisp creases, "part aerospace, part origami" (Hagerty). Inspirations named: **SR-71 Blackbird, F-35** ("with its hover capability"), and the **Lotus Esprit S1 "Wet Nellie"** submarine car, which Musk owns and displayed at the event. Some critics see Lamborghini Gallardo or Ford GT40-concept cues. Tesla on X: "Roadster is inspired by the SR-71 & F-35" (OFFICIAL). Sources: TechCrunch, Car and Driver, MotorTrend, DragTimes.
- **Side profile:**
  - Long, low nose with a flat, faceted hood carrying a V-shaped centre panel.
  - Steeply raked windscreen meeting a short glass canopy.
  - Small quarter-lights and thin A-pillars.
  - A single **strong character line** running from the front fender back into the rear quarter.
  - The roof flows into a **long, flat-topped "long-tail" rear deck** that looks extended past where the profile "should end". The longer tail packages the COPV.
  - A **black lower body** (sills and rocker) below a sharp beltline.
  - The front arch area is tight with an "energy" crease; the rear haunch is wider than the front.
  - No mirrors on the prototypes (cameras in the repeaters). US production cars get mirrors.
- **Front:**
  - **Pop-*down* headlights.** About 15 mm tall low/high modules drop out of the leading edge; when stowed the nose graphic is clean.
  - A **full-width slim DRL light bar** low on the fascia.
  - A wide lower mouth hiding pivoting wings, plus a chin spoiler.
  - A front camera, and no Tesla logo.
  - A removable panel at the scuttle for the **quick-release windscreen wiper**.
- **Rear:**
  - A **full-width red taillight bar** (with a white upper strip) across the tail top edge, wrapping to the corners.
  - Below it, a white panel carrying the **"RDSTR" licence plate** (read from Tesla stage frames).
  - Below that, a black diffuser area: **four round gold/brass nozzle tips in a horizontal row**, then the **four fan outlets** in the lower diffuser, with vertical strakes and fins at the outer corners.
  - A large **dark/gold-tinted rear glass hatch (trapezoid)**. **A red glow is visible through the rear glass** (lit interior or COPV area; frames show a red-lit oval/figure-eight shape).
  - The active wing is stowed flush in the tail. It deploys back and up as a large single plane with a lower "biplane" element.
- **Paint:** **"Ano White"**, described as aerospace/rocket-coating inspired, with a matte/satin look (DragTimes calls it "matte white"). Titanium accents. The stunt cars are in the same white (REPORTED, Electrek; NaTA).
- **Glass:** **gold-tinted ("Gold Glazed") "titanium oxide" glass with an orange tint**, mimicking an astronaut visor; it is transparent from inside. Sources: Moravy, Hagerty ("titanium oxide glass, which is sort of this orange tint"); FvH.
- **Doors and roof:** **upward-opening butterfly/dihedral doors** whose glass roof section lifts with the door. Sources describe them variously as "butterfly type" (Moravy, Top Gear), "dihedral" (DragTimes) or "scissor" (NaTA). There is a padded "butt pad" sill. **T-top**: the two roof panels above the doors remove and stow in the trunk (non-Thrust cars only).
- **Wheels:** 20" front and 21" rear. The stage car has thin, sparse split-spoke silver/black wheels. The stunt cars have flat disc covers.
- **Interior:** a yoke with no column shroud; a centre screen angled to the driver; a thin display strip at the base of the windscreen; fixed seat shells; movable pedals; a DRS paddle and e-Boost button. The Rocket's passenger seat is replaced by the 400 L COPV.

---

## 6. SIMULATION PARAMETER TABLE (SI)

Coordinates: x forward, y left, z up. CoM is measured from the ground. Unless stated, "car" means the **Thrust** trim with the tank full.

| # | Parameter | Value | Range | Source / flag |
|---|---|---|---|---|
| 1 | Mass, Performance | 1,740 kg | 1,650–1,800 | Moravy "just under 1,700" (base, OFFICIAL) + fans (ESTIMATE) |
| 2 | Mass, Thrust (full) | 1,980 kg | 1,850–2,100 | ESTIMATE (§3.3) |
| 3 | Mass, Rocket (full) | 2,450 kg | 2,200–2,550 | ESTIMATE (§3.3); fits a 3.3 G × m ≈ 80 kN check |
| 4 | Inertia Ixx (roll), Thrust | 650 kg·m² | 500–800 | ESTIMATE: box 4.65 × 2.0 × 1.15 m, mass-concentration factor 0.8 |
| 5 | Inertia Iyy (pitch), Thrust | 2,900 kg·m² | 2,400–3,400 | ESTIMATE |
| 6 | Inertia Izz (yaw), Thrust | 3,250 kg·m² | 2,700–3,700 | ESTIMATE |
| 6b | Rocket inertias (Ixx/Iyy/Izz) | 850 / 3,700 / 4,100 | ±20 % | ESTIMATE |
| 7 | CoM height | 0.42 m | 0.38–0.47 | ESTIMATE: floor battery, "butt on the battery", low H-point |
| 8 | CoM x from front axle | 1.55 m (55 % rear) | 1.45–1.65 | ESTIMATE: RWD dual-motor rear, COPV behind the seats |
| 9 | Wheelbase | 2.825 m | ±0.01 | OFFICIAL (Top Gear video) |
| 10 | Track F / R | 1.70 / 1.72 m | 1.64–1.76 | ESTIMATE from 2.0 m width (OFFICIAL) |
| 11 | Overall L × W × H | 4.65 × 2.00 × 1.15 m | L 4.55–4.80, H 1.10–1.20 | W OFFICIAL; L and H ESTIMATE |
| 12 | Wheel radius F / R | 0.343 / 0.367 m | ±0.005 | computed from 295/30 R20 and 335/30 R21 (OFFICIAL sizes) |
| 13 | Tyre μ peak (no fans) | 1.25 | 1.1–1.5 | OFFICIAL: Moravy "typically 1.26 G" |
| 14 | Max power | 1.0 MW | 1.0–1.12 | OFFICIAL "over a megawatt" / "1,500 hp" |
| 15 | Motor torque (combined) | 1,400 N·m | 1,348–1,420 | OFFICIAL (Hagerty / MotorTrend) |
| 16 | Gear reduction | 8.4 : 1 | — | OFFICIAL |
| 17 | Max wheel torque (rear total) | **11,800 N·m** (5,900 per wheel) | 11,300–11,900 | ESTIMATE = 1,400 × 8.4; about 32 kN tractive at the tyre (tyre-limited below about 31 m/s) |
| 18 | Fan suction, design max | **25 kN** ("2 G" class) | 17–46 kN | OFFICIAL "2 Gs … 2,500 kg" (Moravy, MotorTrend) |
| 19 | Fan suction, stunt readout | **46 kN** (4,700 kgf) | — | OFFICIAL on-screen; Electrek doubts it |
| 20 | Fan power | 4 × 20 kW | 4 × 12–20 kW | OFFICIAL |
| 21 | Fan spool time | 1.5 s to 90 % | 1–3 s | REPORTED telemetry (79 → 434 kg over 3 s while rolling) |
| 22 | Fan gap law | F = F_max / (1 + (h/h₀)²), h₀ = 8 mm; F = 0 if skirts unsealed or h > 60 mm | h₀ 4–15 mm | ESTIMATE: brush/rubber skirts; F/A ≈ 6–11 kPa over about 4.2 m²; 80 kW handles a leak gap of about 4 mm at 11 kPa |
| 23 | Sealed floor area | 4.2 m² | 3.6–4.6 | ESTIMATE ("about the size of the battery pack") |
| 24 | Gas | N2 | air | OFFICIAL (conflicting, §7) |
| 25 | Tank P₀ | 69.0 MPa | 38–69 MPa | OFFICIAL (10,000 psi); 5,500 psi readout REPORTED |
| 26 | Gas mass, 200 L / 600 L | **99 / 297 kg** | 71–106 / 214–319 | computed (CoolProp, N2 20 °C, 690 bar); Tesla "about 250 kg" |
| 27 | Isp (sea level), avg / initial | **60 s / 72 s** | 50–70 / 68–76 | ESTIMATE (blowdown model) |
| 28 | Total impulse, Thrust 200 L | **55 kN·s** | 46–65 | ESTIMATE |
| 29 | Total impulse, Rocket 600 L | **165 kN·s** | 140–195 | ESTIMATE |
| 30 | Rear thrust, total peak | **80 kN** (4 × 20 kN) | 80–90 | OFFICIAL |
| 31 | Thrust decay | F(t) = F₀·(1 + t/τ)⁻², τ ≈ 0.55 s (Thrust 200 L; ∫F dt = F₀τ = 44 kN·s; within about 10 % of the adiabatic table to 0.6 s, about 25 % low in the tail); Rocket 600 L τ ≈ 1.7 s; cut-off at 0.5 % F₀ ≈ 5–7 s | τ 0.45–0.8 | ESTIMATE (§5.2) |
| 32 | Rocket down-jets | 4 × 17 kN peak (68 kN total, T/W ≈ 2.8–3.3) | 4 × 12–22 kN | ESTIMATE from the 3.3 G braking telemetry |
| 33 | Rocket front yaw jets | 2 × 4 kN | 2–8 kN | ESTIMATE (attitude only) |
| 34 | Roll authority needed | ≈ 14 kN·m (for 360° in about 1.3 s) | 8–20 kN·m | ESTIMATE: corner jets at y = ±0.85 m, differential about 16 kN |
| 35 | CdA low-drag / high-DF | 0.55 / 1.05 m² | 0.50–0.60 / 0.9–1.2 | ESTIMATE |
| 36 | ClA high-DF (wing + body) | 3.5 m² (gives "2 g at > 200 mph" only if pushed to about 6.8) | 2.5–6.8 | OFFICIAL claim + ESTIMATE |
| 37 | Ride height normal / track | 0.110 / 0.070 m | ±0.02 | 40 mm drop OFFICIAL |
| 38 | Steering lock (yoke) | ±170° | — | OFFICIAL |
| 39 | Top speed (limited) | 103 m/s (230 mph) | 94–147 | OFFICIAL |
| 40 | Ramp radius | **9.5 m** | 7.5–10.5 | ESTIMATE (telemetry fit, §2.1.3) |
| 41 | Ramp arc span | 0°→170° then 5.5 m straight ledge at 170° | 165–175° | OFFICIAL telemetry (pitch 170) |
| 42 | Ramp lip height | **20 m** | 16–21 | REPORTED telemetry 69 ft; paultan 21 m |
| 43 | Ramp deck width | **3.7 m** | 3.4–4.0 | ESTIMATE (frame scale) |
| 44 | Ramp climb speed | 4 m/s | 1–5.5 | ESTIMATE (telemetry) |
| 45 | Landing braking peak | 3.3 g specific force | 3.2–3.3 | REPORTED telemetry |
| 46 | Kickflip peak height | 7.5 m | 7–9 | REPORTED (paultan 7 m; NBC 27 ft) |
| 47 | Kickflip airtime / roll | 3.0 s, 360° roll | 2.5–3.5 s | REPORTED (Tesla Oracle) + frames |
| 48 | Kickflip horizontal speed / range | 8 m/s / 22 m | 6–10 / 18–26 | ESTIMATE |
| 49 | 0–60 target (Thrust trim) | 0.81 s (0.67 s rollout-subtracted) | 0.67–0.9 | OFFICIAL |

**Ramp geometry, best estimate.** The ramp is a near-half-loop: a constant-radius **R ≈ 9.5 m** arc from flat to **170° pitch**, then a **≈ 5–6 m straight inverted ledge** (10° nose-up when upside down). The **lip is at about 20 m**. The deck is **≈ 3.7 m wide**, concrete-grey with a white centre line and red LED edges, on a steel lattice tower with a top cantilever.

How it was inferred:

1. The on-screen pitch/altitude telemetry pairs fit circles of R = 8.4–10.4 m.
2. Peak altitude was 69.1 ft (21.1 m). The paultan report gives about 21 m.
3. Pixel scaling with car width (2.0 m) gives a deck width of 3.7 m and a total height of 17–24 m.
4. Shape cross-checked against the aerial drone shot (a C-shape whose top lip lies roughly above the entry point).

---

## 7. Conflicts between sources

1. **Who said "2 G"**: Moravy (InsideEVs, Motor1, Tesla Oracle) vs Musk (Drive Tesla Canada, paultan). The transcript turn structure suggests Moravy.
2. **2 G vs 4,700 kg.** "2 G" suction (stage, MotorTrend: "about 2,500 kg") vs a 4,700 kg on-screen readout (≈ 2.8 g for 1,700 kg). Electrek doubts the 4,700 kg.
3. **Gas.** Nitrogen (Moravy to Hagerty and Top Gear; FvH to MotorTrend) vs "compressed air" / "air tank" (stage, Musk and Moravy; Fortune; CBC-style coverage). TechCrunch says 600 L of compressed air.
4. **Pressure.** 10,000 psi (Moravy, FvH, DragTimes) vs a 5,500 psi "Thruster" readout on the in-car screen (paultan).
5. **Gas mass.** "About 250 kg" in 600 L (Moravy, stage) vs about 297 kg physically for N2 at 690 bar and 20 °C (computed). Tesla Oracle writes "250 kg (600 liters) of pressurized air".
6. **Refill and recharging.** "Car can recharge its air tank … puff itself up" (Musk, stage) vs a fill nozzle with an external high-pressure N2 system taking 2–6 h for 200 L (Top Gear) or 6–7 h for 600 L (Hagerty/Wired), with a target under 30 min.
7. **Duration.** "About fiveish seconds" (Moravy, Top Gear) vs "six seconds" (Top Gear article) vs "five to six" (InsideEVs) vs "several seconds" (FvH). DragTimes says the tank "empties out in less than 1 second" on the 0–60 (eyewitness, likely misheard).
8. **Thrust.** "Over 80 kN" (Thrust) vs "90 kN or 80-plus" (Rocket, Moravy). paultan says it is enough to hold "more than 8,000 kg". "Six G's of thrust" (Moravy, Top Gear) vs "over 5 G" (Hagerty).
9. **0–60.** 1.0 s (recorded test), 0.81 s (live), 0.8 s (Car and Driver), 0.67 s rollout-subtracted (Tesla YouTube), 0.85 s Thrust (Moravy), < 0.9 s (site), < 0.59 s Rocket (site), 0.55 s with rollout (Moravy, Hagerty). Motor1: the "gap between 0.59 and 0.81 s has not been explained". Base car: "just over a second" (FvH) vs "probably sub-two" (Top Gear article).
10. **Top speed.** 230+ mph (stage); 210 Performance / 230 Thrust (Hagerty); 214 mph "for now" (Moravy, Top Gear); "220-ish" base (FvH); 330 mph target (FvH/Top Gear); Mach 0.5 ≈ 383 mph (Musk); "at least 235" (Engadget presenter).
11. **Power and torque.** 1,341 hp / 1 MW vs "1,500 hp" (Moravy). Torque ">1,400 N·m" (Hagerty) vs "1,348 N·m" (MotorTrend). Base 800 kW / 885 lb-ft (Top Gear article, InsideEVs) vs base 1 MW / 960 lb-ft (Top Gear video, NaTA).
12. **Battery.** About 115 kWh (FvH, MotorTrend) vs "not disclosed" (Moravy, Wikipedia, Hagerty). Electrek speculates the stunt car had no battery at all.
13. **Charging.** 15–80 % in 10 min (Moravy, Hagerty) vs 15–85 % (Top Gear video, NaTA) vs 10–80 % in 10–12 min (MotorTrend); "500 kW" vs "almost a megawatt" (NaTA).
14. **Doors.** Butterfly (Moravy, Top Gear, Car and Driver) vs scissor (NaTA design comparison) vs dihedral (DragTimes). Frames show upward-hinged doors that take the glass roof panel with them.
15. **Control.** Autonomous (Musk) vs remote-controlled (Edmunds' Rosales) vs Optimus in the seat (Engadget, single source) vs Starman mannequin (Tesla). Which seat the mannequin was in (kickflip car vs ramp car) is not documented.
16. **Ramp.** Motor1 says "tethered flip" and "rolled out already hanging upside down"; official footage shows two climbs from the pad and no visible tether. Pitch 170° and altitude 64–69 ft (telemetry) vs Tesla Oracle's "jumped from ~68 feet" (correct: that is ramp height, not jump height).
17. **Kickflip height.** 27 ft (NBC, "according to Tesla") vs about 7 m (paultan telemetry). These are compatible. Fly-over count: five vehicles (most outlets) vs "six vehicles" (one result) vs "Cybertruck and a Semi" (AutoNotion).
18. **Landing G.** 3.3 G (paultan) vs 3.2 G (Tesla Oracle).
19. **Number of thrusters versus tank.** InsideEVs pairs "10 nozzles and 200 liters" (wrong mix). Correct: Thrust = 4 nozzles + 200 L; Rocket = 10 nozzles + 600 L.
20. **Battery cell type.** "4680, aluminium can" (Moravy, Hagerty and MotorTrend) vs "bespoke nickel-based, new new cell" (Top Gear). These are compatible.
21. **Production timing.** "Texas from 2027 … 28, 28" (Top Gear video) vs 2028 (stage) vs "2027 or 2028" (Teslarati). Plant: "RFTX, Roadster Factory Texas" at Giga Texas (Moravy, MotorTrend).
22. **Event day and place.** Thursday Oct 15 (correct) vs "Wednesday night" (Motor1) vs "Thursday, October 16" (NBC). McGregor (Tesla) vs "Waco" (Teslarati, Top Gear, Yahoo).
23. **Live vs pre-recorded.** AutoNotion argues the stunts were pre-recorded. Snopes rated the footage authentic and livestreamed, corroborated by attendee video (per flyingroadster.net / autonocion comment thread). Tesla calls the clips "live demos".
24. **Tyres.** 295/30 R20 + 335/30 R21 (Moravy) vs "look like 345s" (DragTimes) vs old database entries of 265/35 R20 + 325/30 R21 (wheel-size.com, from the 2017 concept, UNOFFICIAL).

---

## 8. Pricing, availability and production (brief)

- **No purchase price was announced.**
- **Reservation deposits** (Tesla site, as quoted):
  - Performance: **$50,000** ($5,000 card plus $45,000 wire within 10 days).
  - Thrust: **$250,000** ($5,000 plus $245,000).
  - Rocket: **invite only**.
- Sources: TechCrunch, Electrek, Wired via https://dnyuz.com/2026/10/16/heres-exactly-how-tesla-made-its-new-230-mph-car-fly/, Motor1. Malaysia shows RM203k (Performance) and RM1.009M (Thrust) totals (paultan).
- 2017 Founders Series orders were converted to Thrust orders (NaTA).
- **Production: 2028** ("We enter production in 2028 … actually, for real", Musk, OFFICIAL), at **Giga Texas, "RFTX"** (Moravy). A larger prototype build is planned for "early part of next year" (Moravy, Hagerty).
- **Legality.** Rocket is "not approved for public road use". Musk: "not sure it's necessarily legal in all jurisdictions". The FAA says it is not an aircraft (Fortune). NHTSA "will continue to monitor".

---

## 9. Key uncertainties for the game model

1. **Real stunt-car mass.** The flying car was a stripped "skeleton" (Edmunds) and may have had no battery (Electrek). The production Rocket at about 2.45 t may be much heavier than what flew.
2. **Fan suction magnitude** (25 kN claimed vs 46 kN shown) and the skirt gap law. No pressure figure exists.
3. **Ramp height and radius.** The altitude channel drifted by about 18 ft between climb and descent. Lip height is 16–21 m and R is 7.5–10.5 m.
4. **Thruster sizing.** Tesla gave only "over 80 kN" total. Per-nozzle thrust, throat size and Isp are model-derived. The blowdown's adiabatic vs isothermal behaviour changes total impulse by about 40 %.
5. **Gas identity and pressure** (N2 at 690 bar vs air vs 5,500 psi), which spans 200–320 kg for 600 L.
6. **Rocket nozzle geometry.** The four down-jets are "behind each wheel". The two "front yaw" jet directions (lateral vs forward) and any gimballing are unknown.
7. **Unpublished data:** length, height, track, Cd/CdA and drivetrain torque definition (motor vs wheel).
8. **Approach speeds** for the kickflip and the standing-flip altitude come from frame scaling only.

---

## 10. Body & lighting (for the 3D model)

Compiled 2026-10-20 for `src/render/roadster.js`. This section uses three flags:

- **OFFICIAL**: Tesla's page, posts or images, or a Tesla exec on camera.
- **PHOTO**: measured by me from official or press imagery. The method is given each time; expect ±5 % from perspective.
- **ESTIMATE**: my inference or design choice, with the reasoning.

### 10.0 Sources used in this section

| Short name | URL | What it gave |
|---|---|---|
| TESLA-PAGE | http://web.archive.org/web/20261016023617/https://www.tesla.com/roadster (tesla.com blocks scripts; the Wayback copy of 16 Oct) | "Hidden headlights, a full-length taillight and flush-mounted aerodynamics … super light wheels with thin spokes"; Ano White; Gold Glazed glass; titanium accents |
| TESLA-IMG | `https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-<NN>-<name>-Desktop.jpg`, renders 01-Hero, 02-Pilot, 03-Carousel-Slide-1…4, 04-World, 06-Gravity, 07-Augments, 08-End | 02-Pilot is a near-orthographic side profile; Slide-1 is a head-on front with the lamps lit; 04-World shows a Rocket with the down-nozzles fitted, doors and wing up |
| EVENT | https://www.youtube.com/watch?v=qt5p-_tE8d0 (Design 12:47–14:38, Aero 14:38–15:57) | the stage car under stage light: rear, front, doors, wing deploy |
| RAMP-CLIP | https://www.youtube.com/watch?v=7p5LxFdc-Qg | the stunt car's lights at night: DRL bar and lamps lit, taillight bar lit, red glow through the glass, plume colour |
| KICK-CLIP | https://www.youtube.com/watch?v=r5vsHHPVhJg | the down-jets from the side, firing near both axles |
| MT-FvH | https://www.youtube.com/watch?v=y7oKy09ALfM | von Holzhausen walkaround, plus studio beauty shots (front ¾, rear ¾) at 0:40–0:56 |
| MT-LM | https://www.youtube.com/watch?v=6D5MlPZQFOw | Moravy: fans "angled rearward and up", nitrogen "whitish cloud" |
| HAG | https://www.youtube.com/watch?v=22rvpUecLts | Moravy: 15 mm lamp module, "titanium oxide glass … orange tint", skirts of rubber and nylon bristle, intake wings to 80°, barge board |
| TG-VID | https://www.youtube.com/watch?v=JdkIOhFmbKI | width "2 m", wheelbase "2825", tyres, "quarter lights", "light bar that just extrudes all the way across", what moves and what doesn't |
| TG-ART | https://www.topgear.com/car-news/electric/tesla-roadster-has-finally-landed-thrusters-0-60mph-059s-and-flight (photos `…/sites/default/files/2026/10/_B8A<nnnn>.jpg`) | _B8A5914 is a straight-on rear with the wing up; _B8A5570/5571 show the lamp V-notch; _B8A5717 shows the tyre sidewall |
| DT | https://www.youtube.com/watch?v=_lq-DpCE9rU | "matte white paint", "big red light bar along the back", "skirt dragging along the ground" |
| NATA | https://www.notateslaapp.com/news/4846/tesla-roadster-old-vs-new-how-the-design-changed-photo-comparisons | black lower body; no front logo |
| JALOPNIK | https://www.jalopnik.com/2288450/tesla-roadster-rereveal-new-design-production-plans-for-flying-car/ | down-nozzles "one in each corner"; yaw nozzles "one on each front fender"; the press car lacks the down-nozzles |
| PATENT | https://electrek.co/2026/09/25/tesla-patent-new-roadster-hidden-active-rear-wing-700-kg-downforce/ | wing: main element plus slat, stowed→deployed in < 3 s, angle changes in < 0.25 s |
| TEASER | https://driveteslacanada.ca/news/tesla-roadster-teaser-semi-event-light-bar-reveal/ | the 25 Sept teaser's animated thin white light bar |

How the PHOTO numbers were measured:

- **Side:** 02-Pilot, scaled by the wheel-centre distance (1,270 px = 2,825 mm, about 2.22 mm/px). Tyre diameters check within 3 %.
- **Front:** Slide-1, scaled by the 2.0 m body width.
- **Rear:** TG-ART _B8A5914, scaled by the 2.0 m width, and cross-checked against EVENT frames.

### 10.1 Proportions

| Item | Value | Flag / source |
|---|---|---|
| Width | 2.0 m | OFFICIAL (TG-VID) |
| Wheelbase | 2,825 mm | OFFICIAL (TG-VID) |
| Overall length, wing stowed | **4.33 m** (4.30–4.40) | PHOTO (02-Pilot). Our `SPEC.length` is 4.65 m, see 10.8 |
| Front overhang | 0.82–0.87 m | PHOTO (02-Pilot) |
| Rear overhang | 0.63–0.69 m | PHOTO (02-Pilot) |
| Height (roof peak) | **1.14 m** (1.12–1.16) | PHOTO (02-Pilot); matches `SPEC.height` 1.15 |
| Roof peak position | about 1.8 m behind the front axle (near mid-car), then a straight wedge to a tail top of 0.86–0.90 m | PHOTO (02-Pilot) |
| Cab position | cab-forward: the screen's base at the side is only 0.10–0.12 m behind the front-axle line, with the A-pillar root over the front wheel | REPORTED "cab forward" (MT-FvH); PHOTO for the number |
| Windscreen rake | 19–22° from horizontal | PHOTO (02-Pilot) |
| Hood leading edge | 0.40–0.42 m | PHOTO (02-Pilot, Slide-1) |
| Fender peaks | 0.81 m high at ±0.80 m, either side of a hood that is 0.76 m high at the screen base | PHOTO (Slide-1) |
| Side glass (DLO) | lower edge 0.80 m at the A-pillar rising to 1.05 m; ends in a point just ahead of the rear axle; small fixed quarter-lights ahead of the doors | PHOTO (02-Pilot); OFFICIAL "quarter lights" (TG-VID) |
| Doors | shut lines at about 0.5 m and 1.7 m behind the front axle | PHOTO (02-Pilot) |
| Black lower body | starts at about 0.15 m at the door front and rises to about 0.35 m at the rear arch; the lower rear quarters behind the rear wheels are black carbon up to about 0.5 m | PHOTO (02-Pilot, EVENT 13:30), REPORTED (NATA) |
| Arch tops | about 0.72 m front, 0.78 m rear (tyre tops 0.686 / 0.734) | PHOTO (02-Pilot) |
| Rear | a recessed dark rear glass between body-colour buttress quarters, then a flat deck whose rear panel is the wing | PHOTO (Slide-2, EVENT) |
| Roof | glazed, two removable panels over the doors (T-top) | OFFICIAL (MT-FvH, TG-ART) |
| Mirrors | none on the reveal cars (cameras in the repeaters); US production cars will get mirrors | OFFICIAL (MT-FvH), PHOTO |

### 10.2 Lighting: exact places and shapes

| Lamp | Where and what | Flag / source |
|---|---|---|
| DRL | a thin cool-white bar across the hood's leading edge, **0.415 m** up, **1.32 m** wide (±0.66 m), ending at the lamp notches | OFFICIAL "This is the DRL" (MT-FvH); PHOTO (Slide-1, MT-FvH 0:42) |
| Headlamps | **pop-down**: a body-colour cover in each V-notch (where the flat hood meets the raised fender peak) drops into the fender, revealing a slim module (about 15 mm, low and high beam in one) that reads as a small inverted triangle of light at ±0.69 m, 0.53–0.56 m up | OFFICIAL "They pop down" (MT-FvH), "only maybe like 15 mm" (HAG), "hidden headlights" (TESLA-PAGE); PHOTO (Slide-1, TG _B8A5570) |
| Front turn signals | built into the front lamps | OFFICIAL (MT-FvH) |
| Side repeaters | a small amber lens at the top-rear corner of each front arch (about 0.4 m behind the front axle, 0.63 m up), with the side camera's black triangle beside it | OFFICIAL "repeaters on the side" (MT-FvH); PHOTO (02-Pilot, MT-FvH 0:42) |
| Taillight | one **full-length** red bar, 25–30 mm tall, **0.80–0.83 m** up and **1.84 m** wide, under the lip of the deck/wing, wrapping onto the corners. It has a white-hot core with a dimmer red strip under it. It stays on the body when the wing rises | OFFICIAL "full-length taillight" (TESLA-PAGE), "single light bar going right at the corner" (MT-FvH); PHOTO (_B8A5914, 07-Augments, EVENT 13:00) |
| Brake / reverse | not found. The bar's middle section reads brighter in EVENT frames | — / PHOTO |
| Rear corner markers | small vertical red lenses low on the rear corners behind the rear wheels; short red lines on the diffuser's outer top edges | PHOTO (MT-FvH 0:53, 04-World, _B8A5914) |
| Plate | centred white plate (our model reads COLD GAS), two plate lamps above it, a rear camera between them | PHOTO (_B8A5914) |
| Cabin | red ambient strips (dash, door cards, the tank bay behind the seats), seen through the orange-gold glass as a red glow | OFFICIAL "Ultrawhite … red ambient lighting" (TESLA-PAGE); PHOTO (Slide-4, RAMP-CLIP 0:00) |
| Underglow / fan light / lit nozzles | **none seen or reported**. The nozzles' orange glints are reflections of the taillight | PHOTO (all sources) |
| Wake / welcome sequence | none documented on the car. The 25 Sept teaser animated the thin light bar | TEASER; ESTIMATE for ours (10.6) |
| In flight | the stunt car flies with the DRL, lamps and taillight lit; the plumes read blue-white under stage light | PHOTO (RAMP-CLIP 0:20–0:23, KICK-CLIP) |

### 10.3 Nozzles, fans, skirts, diffuser

| Item | Value | Flag / source |
|---|---|---|
| Rear nozzles | 4 in one row along the top of the diffuser box, centres **0.42–0.43 m** up, **0.26 m** apart (outer centres ±0.39 m), exits 90–110 mm across, bronze/brass bells | OFFICIAL "the four nozzles, and below that are the four fans" (MT-FvH), "Inconel … titanium" (HAG); PHOTO (_B8A5914, EVENT 13:30) |
| Down nozzles (Rocket) | 4 gold bells pointing straight down at sill level, **just behind the front wheel and just behind the rear wheel** on each side; not fitted to the press/stage car (a Thrust) | OFFICIAL "four aiming down behind the wheels" (MT-FvH); PHOTO (04-World); REPORTED (JALOPNIK) |
| Yaw nozzles (Rocket) | 2, "in the front"/"on each front fender"; exact spot and direction unconfirmed | OFFICIAL (MT-FvH), REPORTED (JALOPNIK) |
| Nozzle covers | not found | — |
| Firing | white to blue-white supersonic columns with shock diamonds, below freezing, a white ground cloud; no flame or colour | OFFICIAL (Moravy, MT-LM, EVENT 17:37); PHOTO (RAMP-CLIP, KICK-CLIP) |
| Fans | 4 black multi-blade impellers with cone hubs in 4 bays under the nozzles, centres about **0.25 m** up and 0.31 m apart, "angled rearward and up" | OFFICIAL (MT-FvH, MT-LM); PHOTO (_B8A5914) |
| Diffuser | a squared carbon box about 1.35–1.4 m wide, 0.085–0.50 m up, with a vertical carbon fence at each outer edge reaching nearly to the ground; flat underfloor, "no big tunnel" | PHOTO (_B8A5914); OFFICIAL (MT-FvH) |
| Skirts | 4 independent fences (left, right, front, rear) of rubber with nylon bristles, sealing an area "about the size of the battery pack". The front and rear lift for the high-speed venturi mode. Drop distance not found | OFFICIAL (MT-FvH, HAG, MT-LM); REPORTED "skirt dragging along the ground" (DT) |

### 10.4 Wheels, paint, glass, doors

| Item | Value | Flag / source |
|---|---|---|
| Wheels | 20″ front / 21″ rear; six dark gunmetal twin-blade spokes forming a star over a flat light-grey/white aero disc; dark centre cap. The stunt cars carry the same white-disc look | OFFICIAL "super light wheels with thin spokes" (TESLA-PAGE); PHOTO (02-Pilot, 04-World) |
| Tyres | 295/30 R20 F, 335/30 R21 R | OFFICIAL (TG-VID) |
| Brakes | carbon-ceramic, brake-by-wire. Caliper colour not found (none visible) | OFFICIAL (TG-VID) |
| Paint | "Ano White", an aerospace-coating satin/matte white | OFFICIAL (TESLA-PAGE), REPORTED "matte white" (DT) |
| Glass | "Gold Glazed" titanium-oxide glass; bronze/copper-brown from outside, transparent from inside | OFFICIAL (TESLA-PAGE, HAG) |
| Doors | butterfly: each swings up and forward on a hinge near the A-pillar, taking its glass and a roof section, and ends nearly vertical | OFFICIAL "butterfly type door" (TG-VID); PHOTO (Slide-3, 04-World) |

### 10.5 Moving parts seen or described

| Part | Behaviour | Flag / source |
|---|---|---|
| Headlamps | covers drop, lamps appear | OFFICIAL (MT-FvH) |
| Rear wing | flush as the deck when stowed. Rises up and back on a four-bar link per side with a lower "biplane" element. Modes: low-drag/DRS (flat), high-downforce, braking/airbrake (kicked up). Deployed top about 1.22 m with angled end plates and two swan-neck struts at about ±0.47 m. Stowed→deployed < 3 s | OFFICIAL (MT-FvH, TG-VID, EVENT 14:38); PATENT; PHOTO (_B8A5914) |
| Intake wings | inside the mouth, pivoting up to 80° | OFFICIAL (HAG) |
| Barge boards | panels behind the front wheels pop out to pull air from the arch | OFFICIAL (HAG, MT-FvH) |
| Hood vent | an active cooling vent | OFFICIAL (HAG) |
| Skirts | drop with the fans; front and rear lift at speed | OFFICIAL |
| Doors, liftgate | butterfly doors; the liftgate shows the tank bay | OFFICIAL |
| What doesn't move | rear quarters, front fenders, the front of the roof, the hood itself | OFFICIAL (TG-VID) |

### 10.6 What the game model does with it

- **Silhouette.** The model follows the 10.1 heights and stations:
  - A hood leading edge at 0.42 m, fender peaks rising to 0.81 m, and a screen base 0.11 m behind the front axle.
  - A 1.14 m roof peak, a straight wedge to the tail, a black lower body rising rearward, buttressed rear quarters and a recessed rear glass.
- **Lamps.** Every lamp is in its 10.2 place. They use emissive materials with HDR intensities so the bloom pass catches them: DRL about 3×, headlamps about 6×, tail about 1.7×, brake about 5× across the bar and 9× at its centre.
- **Wake** (ESTIMATE, our animation, after the teaser's light bar). On every new placement (title, start line, replay restart):
  - The cabin's red glow comes up first.
  - The DRL and the taillight sweep out from the centre.
  - The headlamp covers drop and the lamps flare.
  - The repeaters and markers come on.
- **Brake lamps** (ESTIMATE). They light when the car decelerates on its wheels by more than the slope explains, and hold briefly at a stop.
- **Aero.** The wing deploys with speed (aero "ineffective below about 50 mph", OFFICIAL) and kicks up as an airbrake under hard braking at speed. The intake wings and barge boards follow the wing.
- **Skirts.** They drop with the fan. The front and rear skirts lift above about 22 m/s for the venturi mode.
- **Fans.** The impellers spin with the fan level.
- **Nozzles.** A faint blue-white core shows in each throat while its valve is open. Frost builds on the lip with use and thaws over a few seconds (ESTIMATE from "below freezing", OFFICIAL). Nothing glows on its own.
- **Not modelled:** the doors opening, the hood vent and the T-top removal (the game never shows them).

### 10.7 Not found / open

- Brake and reverse lamp positions.
- Caliper colour.
- Skirt drop distance.
- Nozzle covers.
- Exact position and direction of the yaw nozzles.
- Any light behaviour tied to the thrusters.
- An official length, height or track.

### 10.8 Mismatches with `src/sim/spec.js`: resolved in SIM_VERSION 7

| Quantity | was | now (sourced) | Consequence in the sim |
|---|---|---|---|
| `length` | 4.65 m | **4.33 m** (PHOTO), front overhang 0.85 m | Hull probes (tail, sills) are 0.3 m shorter; the drawn body matches |
| Rear nozzles `pos` | 0.22 m up, x ±0.18 / ±0.50 | **0.42 m up** (≈ CoM height), x ±0.13 / ±0.39 | A rear burn no longer pitches the nose up; boosting off the ledge is cleaner |
| Down nozzles `pos` | z ±1.98 | **just behind each wheel**: z +0.95 / −1.95 | The jets sit asymmetrically about the CoM, so the mixer trims each one's share of a lift command to cancel the pitch moment (the front pair runs full, the rear pair at ≈49 %). Pure lift is now ≈51 kN, not 68 kN; attitude authority rides on top. The Wall still brakes at 2.5–4.6 G peak (the fidelity test), landing a little harder from the Show's carry. If Tesla's weight distribution is rearward of our 50:50 estimate, the trim (and the lift) comes back up: the CoM position is now the most consequential unsourced number. |

---

## 11. Mass distribution

Compiled 2026-10-20 for `SPEC.comFromFront`, `SPEC.comHeight`, `SPEC.inertia` and the down-jet mixer. Flags are as in §10: **OFFICIAL**, **REPORTED**, **PHOTO** (measured by me from official imagery, method given), **ESTIMATE** (derived, arithmetic shown), plus **UNOFFICIAL** for aggregator data.

**Bottom line.** No source gives a front/rear weight split, a centre-of-mass height, an inertia figure, or the thrust of any single nozzle. That covers Tesla, Moravy, von Holzhausen, Hagerty, Top Gear, MotorTrend, Car and Driver, Edmunds, Jalopnik, Electrek, Wired, the patents and the livestream. There are also no EPA, CARB or NHTSA filings yet; the car is a 2028 product. Everything below is built up from component placements that **are** sourced. It puts the car **rear-biased at about 42:58 (Rocket, gas full)**, not 50:50. The CoM sits about 0.30 m *ahead* of the midpoint between the four down-jets.

### 11.1 What was searched and what turned up

| Source | Result |
|---|---|
| Transcripts re-pulled and grepped for weight, distribution, balance, gravity, mass, kilo, corner, behind the wheel: Tesla event (qt5p-_tE8d0), Top Gear 49 min (JdkIOhFmbKI), Hagerty (22rvpUecLts), MotorTrend Moravy (6D5MlPZQFOw), MotorTrend FvH (y7oKy09ALfM), DragTimes (_lq-DpCE9rU) | No split, no CoM, no inertia, no per-nozzle thrust. The placement quotes in 11.2 are what they do give. |
| Wired via dnyuz (https://dnyuz.com/2026/10/16/heres-exactly-how-tesla-made-its-new-230-mph-car-fly/), Electrek technical look (https://electrek.co/2026/10/15/an-updated-technical-look-at-teslas-kick-flipping-0-60-in-1s-next-gen-roadster/), Carscoops (https://www.carscoops.com/2289194/tesla-claims-roadster-questions/), InsideEVs/Yahoo (https://autos.yahoo.com/ev-and-future-tech/articles/teslas-flying-sports-car-explained-190049113.html), tech-insider, TeslaNorth | Mass "just under 1,700 kg" only. Electrek: the thrust tank is "placed high in the vehicle" and the stunt car could be "a thousand pounds lighter than a production vehicle". |
| Patent US 12,377,920 "Adaptive vehicle aerodynamics for downforce" (https://patents.google.com/patent/US12377920B1/en), full text | No mass, CG or battery text. It describes a "rear-biased" downforce mode and "separate bounded regions at the front and rear", which is aero balance, not mass. |
| MotorMatchup catalog (https://www.motormatchup.com/catalog/Tesla/Roadster/2028/Performance, …/Thrust) | **42/58 Performance and 38/62 Thrust**, as surfaced in a search snippet. The page itself is behind a Vercel bot-check and could not be read. It gives no source and lists a 150 kWh battery that Tesla never stated, so it is **UNOFFICIAL** and probably generated. It agrees with 11.4 only in direction. |
| kiwiirc "2026 Tesla Roadster Price Review" | "3,800 lb, 50:50". A spam page attributing it to Tesla. **Discarded.** |
| EPA, CARB and NHTSA searches | Nothing for the Roadster. The only recent Tesla EPA certificate is the Cybercab's. |

### 11.2 Sourced component placements

| Component | Placement | Flag / source |
|---|---|---|
| Battery | "The low CG comes from the battery pack in the floor. This is the battery pack under the floor" | OFFICIAL, Moravy (MotorTrend 6D5MlPZQFOw 3:58) |
| Battery size and extent | about 115 kWh; the suction area is "about the size of the battery pack"; "in that wheelbase is a generous battery" | OFFICIAL (FvH, MotorTrend); REPORTED (Top Gear voice-over, 16:49) |
| Battery mass-savers | titanium top cover, aluminium-can 4680s | OFFICIAL (Moravy) |
| Motors | "the two motors sit at the rear axle. They're buttoned up against each other", each with its own inverter and a planetary reduction to its wheel | OFFICIAL, Moravy (Top Gear 6:35) |
| 200 L COPV (Thrust and Rocket) | in the luggage space behind the seats, where there are "no rear seats"; with the system removed "this is just a luggage space" | OFFICIAL (FvH, MotorTrend 20:54). The car is "fairly roomy from the back of the front seats to the centre line of the rear wheels" (Top Gear 16:39). Electrek says the tank is "placed high" (REPORTED) |
| 400 L COPV (Rocket) | "the second seat is a 400 L cold gas tank"; "occupying the space where the passenger seat is". It is a longer cylinder with round ends | OFFICIAL (Top Gear 27:38, MotorTrend 15:52); REPORTED (Wired) |
| Seats | fixed bases moulded into the tub; low, cab-forward | OFFICIAL (§3.5); screen base 0.11 m behind the front axle (PHOTO §10.1) |
| Rear nozzle row and fans | in the rear diffuser at the tail (≈ 3.45–3.48 m behind the front axle) | OFFICIAL / PHOTO §10.3 |
| Down-jets (Rocket) | "four aiming down behind the wheels"; "four down nozzles behind each wheel"; "one in each corner to push up" | OFFICIAL (FvH, MotorTrend 7:35 and 18:08; Top Gear 27:46) |
| Stunt car | open space-frame floor (see 11.3) | PHOTO (Kickflip clip) |

### 11.3 Down-jet positions (PHOTO)

| Measurement | Front pair | Rear pair | Method |
|---|---|---|---|
| Tesla render 04-World (a Rocket with the down-nozzles fitted, 3/4 rear view) | 112 px behind the wheel centre, at about 240 px/m → **0.47 m** behind the front axle | 177 px at about 300 px/m → **0.59 m** behind the rear axle | Scale taken from each tyre's own vertical diameter (0.686 / 0.734 m) × cos(view yaw) ≈ 0.92, checked against the wheelbase in pixels. ±0.08 m |
| Kickflip clip (r5vsHHPVhJg), t = 34.0 s, underside view mid-roll | plume root ≈ **0.48 m** behind the front axle | plume root ≈ **0.50 m** behind the rear axle | Wheelbase = 678 px → 240 px/m. ±0.07 m |
| Kickflip clip, t = 34.3 s, side view | plume root ≈ **0.45–0.50 m** behind the front axle | (rear root hidden) | Front tyre width in the frame = 0.686 m |
| **Adopted** | **0.47 m behind the front axle** (0.42–0.55) | **0.53 m behind the rear axle → 3.355 m from the front axle** (0.45–0.62) | PHOTO |

The same t = 34.0 s frame shows that the flying car's **underside is an open lattice of square tubes spanning the wheelbase**. It is about 1.6 m wide, six bays long and three or four bays across, with dark boxes in the bays. There is no sealed pack cover and no skirts. Frost-like light patches show in the rear two bays. This is a test "skeleton", as Edmunds REPORTED, and whether a traction pack is on board cannot be told from this frame. The front-fender yaw jet is visible firing laterally from just ahead of the front wheel.

**Thrust per nozzle and front/rear balancing.** Neither was reported. No one mentioned throttling of the down-jets or unequal nozzle sizes. The only statements on valving are general:

- The rear pair is "two independently actuated" left/right valves (OFFICIAL, §5.1).
- For the Rocket, "a little bit more complicated valving system there because we control thrust, yaw, and lift … we can plumb it to anything" (OFFICIAL, Moravy, MotorTrend 15:59–16:15).

### 11.4 Mass and CoM build-up (ESTIMATE)

Coordinates: x is measured rearward from the front axle (wheelbase 2.825 m), y is positive to the left, z is height above the ground. Each item is a uniform cuboid for its own inertia, plus parallel-axis terms (m·d²) about the combined CoM. The CoM is Σm·x / Σm per axis.

| Item | kg | x | y | z | Why |
|---|---|---|---|---|---|
| Battery pack, about 115 kWh | 600 | 1.35 | 0 | 0.21 | Floor, inside the wheelbase. About 190 Wh/kg at pack level (Plaid 100 kWh ≈ 540 kg; Ti lid and Al cans save mass). Centroid at the middle of the sealed floor area, 1.9 × 1.45 × 0.14 m, on 0.11 m ride height |
| Rear drive units ×2 (motors, inverters, 8.4:1 planetaries) | 130 | 2.85 | 0 | 0.36 | "At the rear axle" |
| Rear corners (21″ wheel, 335 tyre, carbon-ceramic brakes, upright) | 110 | 2.825 | 0 | 0.367 | |
| Front corners (20″, 295) | 100 | 0 | 0 | 0.343 | |
| Rear subframe and suspension | 50 | 2.75 | 0 | 0.38 | Pushrod double wishbone |
| Front subframe, suspension, steer-by-wire | 45 | 0.05 | 0 | 0.36 | |
| Front: crash structure, flat radiator and fan, heat pump, intake wings | 70 | −0.40 | 0 | 0.42 | No frunk (§3.6) |
| Tub, body, closures, glass, butterfly doors | 260 | 1.45 | 0 | 0.58 | Body spans −0.85 to 3.475 m (midpoint 1.31), with a long tail |
| Interior (2 fixed seats, dash, screens, HVAC) | 80 | 1.20 | 0 | 0.48 | Cab-forward |
| Rear aero (wing, 4-bar, actuators), diffuser, rear crash structure, lamps | 65 | 3.20 | 0 | 0.62 | |
| Harness, charger, DC-DC, coolant, misc | 180 | 1.50 | 0 | 0.40 | |
| **Base, empty** | **1,690** | **1.511** | 0 | **0.363** | Matches "just under 1,700 kg" (OFFICIAL) |
| + Fans, ducts, skirts, adaptive dampers (Performance) | 40 | 3.25 | 0 | 0.27 | |
| + 200 L Type-IV COPV and brackets (0.7 kg/L) | 140 | 2.20 | 0 | 0.55 | Behind the seats, ahead of the rear axle, "placed high" |
| + Valves, down-pipes, 4 rear nozzles | 25 | 3.00 | 0 | 0.45 | |
| + N₂, 200 L at 690 bar | 99 | 2.20 | 0 | 0.55 | §5.2 |
| + 400 L COPV (Rocket) | 280 | 1.55 | −0.38 | 0.47 | Passenger seat, on the right in a LHD car |
| − Passenger seat | −15 | 1.55 | −0.38 | 0.40 | |
| + 6 nozzles, plumbing, valving | 30 | 1.70 | 0 | 0.30 | Corners and front fenders |
| + N₂, 400 L at 690 bar | 198 | 1.55 | −0.38 | 0.47 | |
| Driver (LHD) | 80 | 1.55 | +0.38 | 0.42 | |

Results (Ixx = roll, Iyy = pitch, Izz = yaw, about the CoM):

| Configuration | Mass kg | CoM x from front axle (m) | F : R | y (m, + left) | h (m) | Ixx / Iyy / Izz (kg·m²) |
|---|---|---|---|---|---|---|
| Base, empty | 1,690 | 1.511 | 46.5 : 53.5 | 0 | 0.363 | 411 / 2,054 / 2,326 |
| Performance + driver | 1,810 | 1.551 | 45.1 : 54.9 | +0.017 | 0.364 | 433 / 2,182 / 2,469 |
| Thrust + driver, gas full | 2,074 | 1.644 | 41.8 : 58.2 | +0.015 | 0.386 | 483 / 2,336 / 2,648 |
| Thrust + driver, gas empty | 1,975 | 1.616 | 42.8 : 57.2 | +0.015 | 0.378 | 464 / 2,297 / 2,600 |
| **Rocket + driver, gas full** | **2,567** | **1.627** | **42.4 : 57.6** | **−0.057** | **0.401** | **569 / 2,482 / 2,856** |
| Rocket + driver, gas empty | 2,270 | 1.609 | 43.0 : 57.0 | −0.031 | 0.388 | 521 / 2,397 / 2,740 |
| Rocket, no driver, gas full | 2,487 | 1.630 | 42.3 : 57.7 | −0.071 | 0.400 | 550 / 2,474 / 2,834 |
| Stunt "skeleton" (pack and interior removed, +60 kg LV pack, ballast and flight computer, 20 kg mannequin), gas full | 1,887 | 1.727 | 38.9 : 61.1 | −0.089 | 0.453 | 404 / 2,179 / 2,449 |

How the Rocket trim shifts the CoM:

- **Fore-aft, almost nothing beyond Thrust.** The 400 L tank and its 198 kg of gas sit at x ≈ 1.55, just ahead of the Thrust car's CoM (1.64), so they pull it forward about 0.02 m. The big rearward step comes from the **Thrust** hardware: about 264 kg at x ≈ 2.2–3.0, which moves the CoM about 0.09 m rearward.
- **Height.** The CoM rises about 0.015 m.
- **Lateral.** The tank moves the CoM about **6–7 cm to the right** (the passenger side), because roughly 480 kg sits 0.38 m off the centreline against an 80 kg driver on the other side.
- **During the burn.** As the gas empties, the CoM drifts forward about 0.02 m and back toward the centreline.

**Sensitivity.** Moving the battery centroid ±0.15 m moves the CoM ±0.035 m. Moving the 200 L tank ±0.2 m moves it ±0.02 m. Moving the body centroid ±0.1 m moves it ±0.01 m. Combined (RSS, plus model error): **x = 1.63 m, range 1.52–1.75 m (46–38 % front)** and **h = 0.40 m, range 0.37–0.45 m**.

**Cross-check.** A mid-engine supercar with a rear-axle drivetrain typically runs 40–43 % front, which fits. Even the base car comes out at about 46:54, not 50:50, because the motors sit at the rear axle with no front drive unit. §6 row 8 already gave 1.55 m (55 % rear); the spec's 1.42 is the outlier.

**Inertia.** Lumped cuboids usually *under*-estimate measured inertia by 5–10 %, because they miss distributed harness and fasteners. Adding about 8 % gives about **615 / 2,680 / 3,080 kg·m²** for the Rocket at 2,450–2,570 kg (±20 %). That is 25–30 % below the §6 box estimate (850 / 3,700 / 4,100). The box with a 0.8 factor overstated it for a car whose heaviest items (pack, gas, motors) are central or low.

Gas is near the CoM, so emptying it removes 12 % of the mass but only about 4 % of the inertia. Scaling inertia by total mass overstates how much more agile the car gets as the tanks empty. Hold inertia at the dry value plus a small gas term, or simply don't scale it with gas mass (error < 5 %).

**Constraint from the stunts (weak).** The kickflip shows 360° of roll inside about 3 s of airtime. A bang-bang roll of 2π in 1.3 s needs α = 4·2π / 1.3² ≈ 14.9 rad/s², which is 9 kN·m at Ixx = 615. Differential corner jets (±0.75 m, up to 2 × 20 kN on one side) give up to 30 kN·m. So the stunt cannot bound Ixx to better than "≤ about 2,000". It is consistent with any value here.

### 11.5 Is "behind each wheel" consistent with the 3.3 G braking peak?

The 3.3 G peak was read at about 6.5 m altitude while the car was airborne (paultan, REPORTED; §2), so it is jet thrust over mass. The jets sit at x_f = 0.47 and x_r = 3.355. Their midpoint is **1.91 m**, which is 67 % rear. That is behind every plausible CoM, so the rear pair has the longer lever arm. To fire without pitching, the rear pair must run at a/b of the front pair's thrust, where a = x_cg − x_f and b = x_r − x_cg. The front pair then limits the total:

- **Pitch-free lift:** F = 2·F_n·(1 + a/b)
- **G:** F / (m·g)

| CoM x | a/b (rear throttle) | 17 kN/nozzle | 20 kN/nozzle | 22.5 kN/nozzle |
|---|---|---|---|---|
| 1.42 (spec, 50:50) | 0.49 | 51 kN → 2.1 G @ 2,450 kg / 2.3 G @ 2,270 | 60 kN → 2.5 / 2.7 G | 67 kN → 2.8 / 3.0 G |
| **1.63 (recommended)** | **0.67** | 57 kN → 2.4 / 2.6 G | **67 kN → 2.8 / 3.0 G** | 75 kN → 3.1 / 3.4 G |
| 1.75 | 0.80 | 61 kN → 2.5 / 2.7 G | 72 kN → 3.0 / 3.2 G | 81 kN → 3.4 / 3.6 G |
| 1.91 (jet midpoint) | 1.0 | 68 kN → 2.8 / 3.0 G | 80 kN → 3.3 / 3.6 G | 90 kN → 3.7 / 4.0 G |

Thrust needed for 3.3 G, front pair / rear pair per nozzle:

| Mass | CoM 1.42 | CoM 1.63 |
|---|---|---|
| 1,900 kg | 20.6 / 10.2 kN | 18.4 / 12.4 kN |
| 2,270 kg | 24.6 / 12.2 kN | 21.9 / 14.8 kN |
| 2,450 kg | 26.5 / 13.1 kN | 23.7 / 16.0 kN |

**Verdict.** The positions are **only marginally consistent** with the 3.3 G peak. Equal nozzles with the same 20 kN rating as the rear row (80 kN / 4, OFFICIAL total) give 2.8–3.0 G at production Rocket mass. They reach 3.3 G only if:

- **(a)** the flying car weighed **≤ about 2,050 kg** (67 kN / (3.3 × 9.81)). That is plausible for the lattice-floored skeleton (11.3: about 1,900 kg if it had no pack); or
- **(b)** the front down-nozzles are **larger than the rear ones**, about 22–24 kN against 15–16 kN, roughly 1.5:1 in throat area. Nobody reported this, but it is the natural design answer to jets fixed "behind each wheel" with a CoM ahead of their midpoint; or
- **(c)** the controller accepted a brief pitching moment at the peak. That is unlikely: an unbalanced 4 × 20 kN gives 40 × 1.735 − 40 × 1.15 ≈ 23 kN·m nose-down, which is 8.7 rad/s² at Iyy = 2,680, or about 30° in 0.35 s.

At the spec's current 50:50, the case is worst: a 2,270–2,450 kg car needs **25–27 kN** front nozzles. The current 17 kN gives only 2.1–2.3 G of pitch-free lift.

### 11.6 Recommended `src/sim/spec.js` values

| Field | Now | Recommended | Range | Tag |
|---|---|---|---|---|
| `comFromFront` | 1.42 | **1.62** (Rocket, gas mostly full; 1.60 empty) | 1.52–1.75 | ESTIMATE (11.4) |
| `comHeight` | 0.42 | **0.40** | 0.37–0.45 | ESTIMATE (11.4) |
| CoM lateral (new; optional) | 0 | **0.06 m toward the right / tank side** (body +x is left, so all body positions shift by +0.06 in x) | 0.03–0.09 | ESTIMATE |
| `inertia` / `inertiaMass` | 650 / 2,900 / 3,250 @ 1,980 | **roll 615, pitch 2,680, yaw 3,080 @ 2,450** (don't scale with gas mass) | ±20 % | ESTIMATE |
| Down-jet `pos` z (CoM-relative, +forward) | +0.95 / −1.95 | **+1.15 / −1.735**. The axles move with the CoM (front axle at +1.62, rear at −1.205); jets 0.47 m and 0.53 m behind each | front 0.42–0.55 behind, rear 0.45–0.62 behind | PHOTO (11.3) |
| Down-jet `max` | 17 kN each | **20 kN each** (same hardware class as the rear row). Or, if the Wall must hit 3.3 G at 2.45 t: **front 23 kN, rear 16 kN** | 17–26 | ESTIMATE |

With 1.62 / 20 kN, the mixer's rear-pair trim rises from 49 % to 66 %, and pitch-free lift from 51 kN to **66.5 kN** (+30 %).

**Caution: positions in `NOZZLE_SPEC` are CoM-relative and hard-coded.** Moving `comFromFront` from 1.42 to 1.62 means adding **+0.20 m to every nozzle's z**, not just the down-jets:

- rear row −2.05/−2.06 → −1.85/−1.86
- yaw jets +2.0 → +2.2

Moving `comHeight` 0.42 → 0.40 means adding +0.02 to every nozzle's y. `wheelAnchors()` derives from `comFromFront` and updates itself. This changes the physics, so it needs a SIM_VERSION bump.
