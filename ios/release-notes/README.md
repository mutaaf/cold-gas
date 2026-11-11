# Release notes

Every TestFlight build's "What to Test" (and, from the second App Store release, "What's New") comes from
`release-notes/<MARKETING_VERSION>.md`. `make testflight` refuses to build without it, and `make rules` lints it
(after moon-club's release-notes/).

- Plain and specific, in the voice of the backlog: what changed, then what to try. No marketing, no emoji (TestFlight
  refuses emoji in What to Test).
- Every feature line says what to test.
- 4000 characters at most (TestFlight's limit). Markdown is stripped before it is sent.
- Bumping `MARKETING_VERSION` in `project.yml` means a new file. Builds within one version share the file, so edit it
  as features land.

## The in-app "What's new" modal reads the same file

The file is bundled into the app (project.yml), and after an update the app shows it once as a modal
(ColdGas/UI/WhatsNewView.swift, parsed by ColdGasClient's `ReleaseNotes`). So every release adds notes in this shape:

```
# Cold Gas <version>

The hero headline: one line, a playful nod.

An optional lede: one short paragraph.

## Highlights
- **A few words.** One short line. <!-- icon: an.sf.symbol -->
- **A few words.** One short line. <!-- icon: an.sf.symbol, go: settings -->

## What is in this build
...the full notes, folded under the cards in the modal...
```

- **Highlights**: 2 to 4 bullets, each a callout card. The title is a few words; the line is one short sentence
  (90 characters at most). The icon is an SF Symbol name in an HTML comment (comments never reach TestFlight or the store).
- **Callouts go to the feature.** A card whose feature has a screen names it with `go:` in the same comment: `board`,
  `settings`, `howTo` or `practice` (ColdGasClient's `WhatsNewDestination`). The card becomes a button that closes the
  modal and opens that sheet over the title. A card about something with no screen (the cameras, the sky) has no `go:`
  and stays plain. An unknown name is a plain card, and the tests fail on it.
- **The headline** (or the lede, or a card) carries one nod at pop culture and one at something genuinely current for
  the players (a sky event, a launch, the season's weather), real and from the last few weeks: its source and date go in
  the PR, never in the app. If nothing safe turns up, a seasonal nod instead; never invented. Tropes only: no real characters, franchise or brand names, logos, quotes or real people. No politics or tragedy.
  Family-friendly.
- **Every claim is true** and comes from the git history since the last release (`git log` on `ios/` and the
  CHANGELOG's iPhone entries).
- It never shows on a fresh install (the first launch records the version as seen), once per version after an update,
  and never when the app is launched with a tool or test flag (`-uitest`, `-bench`, `-cam-log`, `-course`…). In a
  DEBUG build `-whatsNew` forces it (shots and review) and records nothing, so the real gate is untouched.
- **To see it on a simulator or a phone** (DEBUG build): launch with `-whatsNew`, e.g. from `ios/`:
  `make build && xcrun simctl install "ColdGas Pro Max" build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app &&
  xcrun simctl launch "ColdGas Pro Max" com.mutaafaziz.coldgas -whatsNew`, or in Xcode add `-whatsNew` under the
  scheme's Run > Arguments. A Release build ignores it.
- `make test` (WhatsNewTests) and `npm test` (tests/unit/ios-release-notes.test.js) fail when the current version's file
  doesn't have this shape.
