---
id: 0293
title: Every failure in the iPhone app is handled calmly and seen by the owner; the web reports a boot that never came up
status: in-progress
priority: P1
size: L
lens: tech-health
created: 2026-11-18
pr:
by: operator
---

## Why
The owner (2026-11-18): "thoroughly audit each feature and capability and have perfect error handling and reporting so we
can have an end to end fully completed and observed and monitored app."

The audit (docs/AUDIT-2026-11-18.md) found that the iPhone app reports nothing. Its failures are `print()`, which goes
nowhere on a device. It has no MetricKit, so crashes, hangs and memory kills are invisible. Its save resets silently and
then overwrites itself when the bytes won't parse. A failed renderer leaves a black stage with no word. A sim error sends
the player home without saying why. On the web, a build that throws before `obs.init` shows the boot watchdog but never
reaches `/obs`, so `npm run heal` can't see a deploy that doesn't boot.

## What
- **Native reporting:** `Report` (os.Logger categories, plus a persisted, deduped queue of web-shaped signatures) sent to
  the existing `POST /coldgas/api/obs`, batched, offline-tolerant, never during a run, behind Settings → Privacy. Also
  MetricKit diagnostics (crash, hang, CPU, disk, launch) and daily exit counts, mapped in pure, tested code.
- **Native handling:** the save is mirrored and restored, and damaged bytes are kept aside. The renderer names the step
  that failed, retries once without the binary archive, and the title says so calmly if it still can't draw. A sim stop
  gets a calm note on the title. The board retries GETs with backoff and has a Try again button. Renderer buffers are
  guarded (no force unwrap). A memory warning drops idle renderers. Audio, haptics and the world report their failures.
- **Web:** errors before boot and a watchdog that fired reach `/obs`.
- **Monitoring:** `npm run obs:report` (web vs iPhone, top signatures, regressions, funnel) with alert exit codes.
- **Backend (frozen):** the platform split for `/obs` is a proposal in the audit (B1–B3), not a change.

## Acceptance criteria
- [ ] docs/AUDIT-2026-11-18.md lists every feature with its failure modes, today's behaviour and a severity
- [ ] A save whose bytes won't parse is restored from the mirror and the damaged bytes are kept (unit test)
- [ ] `Obs` signatures hash as `src/obs/signature.js` does (unit test against the JS's values), and a batch is accepted by
      `cleanObs` (a JS unit test builds one the Swift way and validates it)
- [ ] MetricKit's diagnostic JSON maps to `/obs` entries with no device model, OS or locale (unit test on Apple's shape)
- [ ] A batch is ≤ 8 kB, never sent in a countdown, run or replay, and never sent with Share usage stats off or under a tool flag
- [ ] A renderer that can't be built is reported, retried once without the archive, and the title says so if it still fails
- [ ] Early errors and a fired boot watchdog reach `/obs` on the web (unit test)
- [ ] `npm run obs:report` prints the digest split by platform and exits 2 / 1 / 0 by the thresholds in the audit
- [ ] App Privacy: ios/store/app-privacy.md and PrivacyInfo.xcprivacy list Crash Data, Performance Data and Other
      Diagnostic Data (not linked, not tracking, App Functionality)
- [ ] `npm test` and `cd ios && make test` (52 run vectors) pass; no gameplay change

## Test plan
- `cd ios/Packages/ColdGasCore && swift test --filter "ObsTests|Saves"`: the hashes, the normalisation, the queue's caps
  and size limit, the MetricKit mapping, the save mirror
- `npx vitest run tests/unit/obs-native.test.js tests/unit/obs-boot.test.js`: a Swift-shaped batch passes `cleanObs`; the
  inline hash in index.html equals `hash12`; early errors are drained
- `cd ios && make test` and `npm test`: no vector moves
- On the ColdGas iPhone simulator (`-mute -obs-dry`): launch, fly one Show, go home. The title prints `OBS` lines only off
  the run. `-obs-fail-render` shows the calm stage note, and a tap rebuilds the stage
- `node scripts/obs-report.mjs --digest=tests/fixtures/obs-digest-ios.json`: the split and the exit code
