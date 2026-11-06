# If App Review rejects or asks again: a correction is owed

Our 5 November reply (answer 3) said the server flies each posted run's inputs again to check its score. It doesn't. Include this in the next reply:

> A correction to answer 3 of our 5 November reply: the server does not re-fly posted runs. It scores the run's telemetry with its own scorer after plausibility checks against the input log, so a client can't send a score directly, but the telemetry itself comes from the client. The build reviewed then also said this in How to play; later builds don't.

# Ready for a guideline 2.1 "Information Needed"

18-0's v1.0 was held under 2.1 with six questions, because the developer account has little review history. Expect the
same (docs/NATIVE.md §9). The answers, ready to paste; `review-notes.txt` already carries most of them.

**1. A screen recording on a physical device.** Record on the iPhone (Control Center → Screen Recording), about
90 seconds, and attach it to the reply:
1. Cold launch to the title.
2. Jump on Assist, One-thumb: hold to climb, tap to let go, hold to land.
3. The results: the score card, one category opened, the judges' commentary.
4. Post to the board with three initials, then open the board.
5. Settings: the flight tier, haptics and the controls.
6. On an iPhone Duo, unfold mid-title to show the inner layout.

**2. The app's purpose and audience.** A skill game about a single stunt jump, for anyone who enjoys driving and
physics games. No accounts, no purchases, no ads.

**3. How to reach its features.** See "HOW TO PLAY" in the review notes. Nothing is locked; no sign-in exists.

**4. External services.** One: our own server at mutaafaziz.com/coldgas (a Cloudflare Worker we wrote). It scores runs,
keeps the board, writes the judges' commentary with an AI model it hosts, and receives the anonymous health report.
Optionally, a player's own AI provider key, used only for that player's judging requests. No third-party SDKs.

**5. Regional differences.** None. The app is the same everywhere.

**6. Rights to third-party material.** Everything is original and our own design: the cars, the courses, the art and
the sounds (synthesised in code). It is an independent game: no real brand, vehicle model, logo, trademark or person
appears in the app or the listing. Typefaces: Michroma and Geist, SIL Open Font License 1.1. Physics: Rapier, Apache
License 2.0.

## If Apple asks about user-generated content (guideline 1.2)

The only user-generated content is three letters, A to Z, as initials on the board. There is no free text, no
profile, no chat and no messaging. Today the server accepts any three letters and has no report control, so
**before submitting, decide** (owner): a denylist of offensive three-letter combinations, applied in the app before
posting and (in the Worker, which is frozen) on the server, and a way to hide an entry. 18-0 needed all three: a
filter, a report control, and the ability to hide a reported name.
