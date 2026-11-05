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
