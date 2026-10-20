# The parked fleet: research

The five vehicles parked in the reveal's kickflip lineup (docs/REVEAL_RESEARCH.md §2.2), researched for
size, mass and shape. The game uses them as **classes** ("Sedan", "Crossover", "Semi", "Pickup", "Cab"):
models are our own designs at the researched size, with no badges, names or logos (AGENTS.md 3.7). This
document names the sources, as research docs may.

Tags: **OFFICIAL** = the manufacturer's spec page or owner's manual, or a government filing (EPA, NHTSA).
**REPORTED** = press. **PHOTO** = measured from photographs. **ESTIMATE** = ours, with the reasoning.
Researched 2026-10-20. tesla.com refused plain fetches (403), so the owner's-manual pages were read in
a browser.

Where the numbers go: `LINEUP_SPEC` in `src/sim/courses.js` (the physics box, axles, tyres, mass, CoM,
inertia, all plain data), and the models in `src/render/parked/` build every dimension from those
fields.

## The reveal's row

- **Order**, as the roadster crossed it (side camera): Cybercab → Cybertruck → Semi (centre, tallest) →
  Model Y → Model 3. Sources: TechCrunch, Lifeboat, Tesla Oracle (REPORTED); frame read (PHOTO).
  The game's row is sedan → crossover → semi → pickup → cab from the side the roadster comes from,
  so the semi is in the centre as at the reveal; the order of the others is reversed. Unchanged here
  so the Show's geometry stays put.
- **Semi height as parked**: 13.5 ft = 4.11 m (REPORTED: https://insideevs.com/news/812152/tesla-roadster-backflip-suction-2g/ ,
  https://www.frunklab.com/news/tesla-roadster-revealed-kickflip-semi). It is also the standard US van-trailer height.
- **Trailer**: none reported, none seen. Modelled as a bare tractor.
- **Cybercab colour**: gold. Production Cybercabs have moulded-in gold panels, so this is very likely
  but not confirmed (ESTIMATE).

## Sources

- [M3-dim] https://www.tesla.com/ownersmanual/model3/en_us/GUID-56562137-FC31-4110-A13C-9A9FC6657BF0.html
- [M3-whl] https://www.tesla.com/ownersmanual/model3/en_us/GUID-FDDB10EF-FFA9-46EB-B8CC-03614AE92B6B.html
- [M3-web] https://www.tesla.com/model3
- [MY-dim] https://www.tesla.com/ownersmanual/modely/en_us/GUID-1E76B638-7B12-4D9A-8767-94B7F1E92A0E.html
- [MY-whl] https://www.tesla.com/ownersmanual/modely/en_us/GUID-FDDB10EF-FFA9-46EB-B8CC-03614AE92B6B.html
- [MY-web] https://www.tesla.com/modely
- [CT-dim] https://www.tesla.com/ownersmanual/cybertruck/en_us/GUID-12A976DD-EB60-431B-AFF1-5A37E95006DB.html
- [CT-whl] https://www.tesla.com/ownersmanual/cybertruck/en_us/GUID-9284C9F2-A2F2-4604-83BF-6599F47766B7.html
- [CC-arena] https://m.arenaev.com/the_golden_wedge_has_arrived-news-6210.php
- [CC-nata] https://www.notateslaapp.com/news/4657/tesla-cybercab-specs-supermanifold-v3-no-rare-earth-magnets-more
- [CC-tyre] https://www.notateslaapp.com/news/4362/tesla-cybercab-patent-reveals-unique-wheel-design
- [CC-epa] https://electrek.co/2026/06/15/tesla-cybercab-epa-specs-curb-weight-battery-motor-power/
- [SE-web] https://www.tesla.com/semi
- [SE-final] https://electrek.co/2026/02/09/tesla-reveals-final-semi-specs-with-two-trims-ahead-of-customer-deliveries/
- [SE-dims] https://www.dimensions.com/element/tesla-semi
- [SE-blog] https://www.basenor.com/blogs/news/tesla-semi-long-range-vs-standard-range-key-specs-compared
- [SE-wb] https://www.notateslaapp.com/news/3844/tesla-semi-is-finally-ready-for-mass-production-heres-whats-changed

## Sedan: Model 3 "Highland" (RWD)

| Field | Value | Tag | Source |
|---|---|---|---|
| Length | 4.720 m (185.8 in); Performance 4.724 m | OFFICIAL | M3-dim |
| Width, body | 1.850 m (72.8 in) | OFFICIAL | M3-dim |
| Width, mirrors folded / out | 1.933 / 2.089 m | OFFICIAL | M3-dim |
| Height | 1.440 m (56.7 in); Performance 1.431 m | OFFICIAL | M3-dim |
| Wheelbase | 2.875 m (113.2 in) | OFFICIAL | M3-dim |
| Track, front / rear | 1.584 / 1.584 m | OFFICIAL | M3-dim |
| Overhang, front / rear | 0.868 / 0.977 m | OFFICIAL | M3-dim |
| Ground clearance | 138 mm | OFFICIAL | M3-dim |
| Tyres | 235/45R18 on 18×8.5J (r = 0.335 m) | OFFICIAL | M3-whl |
| Curb mass | 1,705 kg (3,759 lb) | OFFICIAL | M3-web |
| Weight split | ≈47 / 53 | ESTIMATE | floor battery, rear motor |
| CoM height | ≈0.46 m | ESTIMATE | floor battery |
| Inertia roll / pitch / yaw | 620 / 2,770 / 2,920 kg·m² | ESTIMATE | box × 0.8 (see below) |

Shape: a fastback with an all-glass roof sweeping to a short trunk lid with a small ducktail lip. Slim
slit headlamps, no grille. Tail lamps wrap from the trunk lid onto the body sides; there is no
full-width rear bar. Flush handles, black B-pillar, aero-cover wheels on 18 in.

## Crossover: Model Y "Juniper" (2025+, Premium)

| Field | Value | Tag | Source |
|---|---|---|---|
| Length | 4.790 m (Premium); 4.794 Standard; 4.796 Performance | OFFICIAL | MY-dim |
| Width, body | 1.920 m (75.6 in) | OFFICIAL | MY-dim |
| Width, mirrors folded / out | 1.982 / 2.129 m | OFFICIAL | MY-dim |
| Height | 1.624 m (Premium); 1.621 Standard; 1.611 Performance | OFFICIAL | MY-dim |
| Wheelbase | 2.890 m (113.8 in) | OFFICIAL | MY-dim |
| Track | 1.636 m (Premium); 1.655 m Standard | OFFICIAL | MY-dim |
| Overhang, front / rear | 0.893 / 1.011 m (Standard) | OFFICIAL | MY-dim |
| Ground clearance | 167 mm unladen (Premium) | OFFICIAL | MY-dim |
| Tyres | 255/45R19 on 19×9.5J (r = 0.356 m) | OFFICIAL | MY-whl |
| Curb mass | 1,842 kg (4,061 lb), RWD | OFFICIAL | MY-web |
| Weight split | ≈47 / 53 | ESTIMATE | |
| CoM height | ≈0.53 m | ESTIMATE | |
| Inertia roll / pitch / yaw | 780 / 3,140 / 3,270 kg·m² | ESTIMATE | box × 0.8 |

Shape: a crossover fastback with a glass roof and a power liftgate. A thin full-width light bar on the
nose's upper edge, with slim headlamps low in the bumper corners. A full-width rear light bar across
the liftgate. Flush handles, aero covers.

## Semi: the electric Class 8 tractor (2026 production, Long Range, day cab)

Tesla publishes almost no dimensions for the Semi, so this is the weakest table.

| Field | Value | Tag | Source |
|---|---|---|---|
| Height as parked | 4.11 m (13.5 ft) | REPORTED | InsideEVs, Frunklab (above) |
| Height, 2021 pre-production | 3.96 m (156 in) | ESTIMATE | SE-dims |
| Length | **6.32 m**. Alternatives: 6.2 m Long Range (unsourced blog), 5.59 m Standard Range | ESTIMATE | SE-dims, SE-blog |
| Width, body | 2.59 m (102 in, the US legal maximum) | ESTIMATE | SE-dims |
| Width at the camera arms | ≈2.95 m (cameras, not glass mirrors) | ESTIMATE | |
| Wheelbase, steer axle to tandem centre | **3.96 m** (156 in); the Standard Range is "significantly" shorter | ESTIMATE | SE-dims, SE-wb |
| Tandem spread | 1.32 m (52 in, typical) | ESTIMATE | class norm |
| Track | ≈2.05 m steer; ≈1.86 m between the centres of the twin-tyre pairs (≈2.45 m outside the duals) | ESTIMATE | class norm |
| Tyres | 295/75R22.5 (r = 0.507 m), the class's usual size; Tesla's not found | ESTIMATE | |
| Curb mass, Long Range | 10,433 kg (23,000 lb) | REPORTED | SE-final |
| Curb mass, Standard Range | under 9,072 kg (20,000 lb) | OFFICIAL | SE-web |
| Gross combination | 37,195 kg (82,000 lb) | OFFICIAL | SE-web |
| Weight split | ≈45 / 55 without a trailer | ESTIMATE | |
| CoM height | ≈1.1 m | ESTIMATE | pack between the rails |
| Inertia roll / pitch / yaw | 14,360 / 34,590 / 28,390 kg·m² | ESTIMATE | box × 0.7 (mass low, between the axles) |

Shape: a bullet cab with a central driving seat and standing headroom; the roof fairing and cab
extenders are built in. The production nose carries a full-width light bar with the headlamps in it.
Short side windows. 6x4: a steer axle plus a tandem drive axle with three motors. Chassis fairings
and side skirts (the "tandem axle aero kit"); a fifth wheel behind the cab. Sold as a day cab only.

## Pickup: Cybertruck (Premium AWD, air suspension at medium)

| Field | Value | Tag | Source |
|---|---|---|---|
| Length | 5.683 m (223.74 in) | OFFICIAL | CT-dim |
| Width, body | 2.032 m (79.98 in) | OFFICIAL | CT-dim |
| Width, mirrors folded / out | 2.201 / 2.413 m | OFFICIAL | CT-dim |
| Height | 1.794 m at medium (1.739 entry, 1.944 extract); Dual Motor 1.788 m | OFFICIAL | CT-dim |
| Wheelbase | 3.635 m (143.11 in) | OFFICIAL | CT-dim |
| Track | 1.772 m front and rear | OFFICIAL | CT-dim |
| Overhang, front / rear | 0.878 / 1.170 m | OFFICIAL | CT-dim |
| Ground clearance | 257 mm medium (202 entry, 407 extract); Dual Motor 248 mm | OFFICIAL | CT-dim |
| Bed | 1.825 m × 1.295 m; side 0.728 m front, 0.504 m rear | OFFICIAL | CT-dim |
| Tyres | 285/65R20 on 20×9J (r = 0.439 m) | OFFICIAL | CT-whl |
| Curb mass | 3,009 kg (Premium AWD); Cyberbeast 3,113 kg; Dual Motor 2,965 kg | OFFICIAL | CT-dim |
| Axle loads | 1,491 / 1,518 kg = 49.5 / 50.5 | OFFICIAL (derived) | CT-dim |
| CoM height | ≈0.80 m | ESTIMATE | NHTSA rollover risk 12.4 % |
| Inertia roll / pitch / yaw | 1,470 / 7,120 / 7,310 kg·m² | ESTIMATE | box × 0.8 |

Shape: flat stainless panels in one triangular profile peaking over the B-pillar; sail panels run down
to the tailgate over a powered hard tonneau. Full-width light bar at the front, full-width red bar
across the tailgate. No door handles, six-sided black arch flares, aero covers on 20 in wheels.

## Cab: Cybercab (production, since April 2026)

| Field | Value | Tag | Source |
|---|---|---|---|
| Length | 4.445 m (175 in) | REPORTED | CC-arena |
| Width | 1.753 m (69.0 in); no mirrors, so also the overall width | REPORTED (rider guide) | CC-nata |
| Height | 1.407 m (55.4 in) | REPORTED (rider guide) | CC-nata |
| Ground clearance / step-in | 145 / 419 mm | REPORTED | CC-nata |
| Wheelbase | ≈2.70 m (one photo-scaled estimate gives 2.67 m; a 2.29 m forum figure would leave over 2 m of overhang) | ESTIMATE | |
| Track | ≈1.53 m | ESTIMATE | body width less tyre and body clearance |
| Overhang, front / rear | ≈0.80 / 0.945 m | ESTIMATE | from length and wheelbase, photos |
| Tyres | 215/60R18 front (r = 0.358 m), 225/60R21 rear (r = 0.402 m) | REPORTED | CC-tyre |
| Curb mass | 1,412 kg (3,113 lb); GVWR 1,692 kg | OFFICIAL (EPA certificate summary) | CC-epa |
| Weight split | ≈52 / 48 | ESTIMATE | front drive unit, 48 kWh floor pack |
| CoM height | ≈0.48 m | ESTIMATE | |
| Inertia roll / pitch / yaw | 480 / 2,050 / 2,150 kg·m² | ESTIMATE | box × 0.8 |

Shape: a two-seat liftback in moulded-in gold. Two butterfly doors without handles. No steering wheel,
pedals, side mirrors or rear window. Full-width light bars front and rear. Flat gold snap-on aero
covers (design patent US-D1130251-S). Tall-sidewall tyres, with the rear wheels visibly larger than the
fronts.

## Inertia estimate

Measured inertias aren't published for any of the five. We use a solid box of the vehicle's length,
width and height, scaled by κ: I_roll = κ·m·(w² + h²)/12, I_pitch = κ·m·(l² + h²)/12,
I_yaw = κ·m·(l² + w²)/12. κ = 0.8 for the cars, whose mass sits low and inboard (floor battery); for a
1,700 kg mid-size sedan that gives yaw ≈2,900 and roll ≈620 kg·m², within about 10 % of measured
values for the class in NHTSA's inertial-parameter database. κ = 0.7 for the tractor (the pack sits
between the axles, the tall cab is light). All ESTIMATE.

## The hero roadster, re-checked

| `src/sim/spec.js` | Finding | Tag |
|---|---|---|
| Length 4.33 m | Still no official figure. Third-party 4.40 m (evspecs.org, unlabelled) and 4.20 m (dated before the reveal) are unreliable. Keep 4.33 m. | PHOTO |
| Width 2.0 m | "About 2,000 mm" via Top Gear (and Wikipedia); not on tesla.com. Production adds mirrors (von Holzhausen). | REPORTED (was OFFICIAL) |
| Height 1.15 m | No official figure; third-party 1.195–1.199 m is unreliable. | ESTIMATE |
| Wheelbase 2.825 m | 2,825 mm via Top Gear / Wikipedia; no Tesla spec sheet. | REPORTED (was OFFICIAL) |
| Track 1.70 / 1.74 m | Nothing published. | ESTIMATE |
| Tyres 295/30R20 F, 335/30R21 R | The only source is one X post (https://x.com/CARN0N/status/2111094591038648483); Tesla's photos show Pirelli P Zero Trofeo RS. | REPORTED (was OFFICIAL) |
| Mass just under 1,700 kg | Unchanged: target under 1,700 kg / 3,700 lb (InsideEVs, Wikipedia). | REPORTED |
| 0–60 mph | 0.81 s live, not independently timed; targets < 1.6 s Performance, < 0.9 s Thrust, < 0.59 s Rocket. | OFFICIAL (claims) |

Sources: https://notateslaapp.com/news/4837/tesla-roadster-event-recap-it-flies-flips-and-hits-0-60-in-081s ,
https://insideevs.com/news/812242/tesla-roadster-2026-specs/ ,
https://en.wikipedia.org/wiki/Tesla_Roadster_(second_generation). The car's numbers stay as they are;
only the provenance changes. `src/sim/spec.js` tags are left for the physics owner, since the same
values hold.
