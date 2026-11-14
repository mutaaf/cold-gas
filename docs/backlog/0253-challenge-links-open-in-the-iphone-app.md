---
id: 0253
title: A challenge link opens in the iPhone app when it is installed, straight into that challenge with the sender's ghost
status: ready
priority: P0
size: M
lens: platform
created: 2026-11-13
pr:
by: operator
---

## Why
The challenge flywheel (play → share → a friend opens → beats it → shares back) breaks on the iPhone: the app has no
URL handling at all (no `CFBundleURLTypes`, no `onOpenURL`, no associated domains, no entitlements file), so every link
opens the web game, even for a player who has the app. The decoder is already there and bit-exact
(ColdGasClient/Challenge.swift `vsFromHash`, `decode`, `compare`, pinned by Tests/Vectors/challenge.json); the app target
never calls it.

## What
Runs on: the operator's Mac (Xcode, the Apple Developer account).
Depends on: 0251 (the web's challenge card and copy, so both feel the same).
- **Universal links** for `https://mutaafaziz.com/coldgas/*` with `?play=jump` and a `#vs=` fragment (the same links the
  web and the app already share; no new link format). Needs:
  - an `apple-app-site-association` file at `https://mutaafaziz.com/.well-known/apple-app-site-association`. This repo's
    Worker serves only `mutaafaziz.com/coldgas*` and `wrangler.jsonc` is frozen, so `public/.well-known/` here would be
    served at `/coldgas/.well-known/`, where iOS never looks. The file goes in the repo that serves the domain's root
    (mutaaf/mutaafaziz-site), as a cross-repo PR like the launcher registration (AGENTS.md §7), with `applinks` details
    for this app's Team ID + bundle id and components matching `/coldgas/` (and `/coldgas/?play=*`). The builder opens that
    PR and merges it only once the app build with the entitlement is in TestFlight.
  - `ios/ColdGas/ColdGas.entitlements` with `com.apple.developer.associated-domains = applinks:mutaafaziz.com`, wired in
    project.yml. Turning on Associated Domains for the App ID in the developer account is an operator action.
- **A fallback that needs no server:** a custom scheme `coldgas://` (CFBundleURLTypes) that carries the same query and
  fragment; the web's challenge card (0251) offers "Open in the app" on iOS only when it can't tell the app is absent, and
  plays on the web otherwise. Never a forced redirect or an App Store wall in front of the challenge.
- **In the app:** `onOpenURL` / `scene(_:continue:)` → `Challenge.vsFromHash` → the title holds on the challenge card
  (the sender's initials, score, course, tier) with one primary "Take the challenge" that flies it with the sender's run as
  the ghost (the native sim re-flies the log bit-exactly). A stale `SIM_VERSION` or a bad payload says "from an older
  version" and offers a plain Fly, like the web. A link opened mid-run waits until the run ends.
- After the run: "You beat ABC by 2.1" or "ABC still leads by 0.8" and "Send it back" (0252's share with the new run).
- Events: `challenge_open`, `challenge_play` through 0246.

## Acceptance criteria
- [ ] Unit: the URL router maps every link shape the web produces (`?play=jump&course=…#vs=…`, `#vs=` alone, stale, junk,
      the 12,000-char cap) to the right screen, using the existing challenge vectors.
- [ ] UI test: launching with a challenge URL shows the challenge card; Take the challenge flies with a ghost; the result
      line and Send it back appear.
- [ ] On the operator's iPhone with the TestFlight build: a link tapped in Messages opens the app on the challenge (the
      AASA PR merged); with the app deleted, the same link plays on the web.
- [ ] `wrangler.jsonc`, `src/worker/` and `.github/workflows/` untouched.

## Test plan
Router unit tests over the vectors; UI test with a launch URL; a manual Messages round trip on the device.

## Out of scope
A server-side challenge store or short links (the link carries the run; no backend). Android.
