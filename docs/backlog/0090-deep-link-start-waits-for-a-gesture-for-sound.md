---
id: 0090
title: A deep-link start (?play=jump) never builds the audio context outside a gesture
status: proposed
priority: P2
size: S
lens: tech-health
created: 2026-10-26
pr:
by: scout
---

## Why
Scout play-through with `?play=jump` in Chromium logged six `The AudioContext was not allowed to start. It must be resumed
(or created) after a user gesture` warnings in a few seconds. The mutaafaziz.com launcher and shared links use this deep
link, so every launcher start hits it: `startRunNow()` (src/main.js:331) calls `initAudio()` with no gesture, which builds
the whole graph (oscillators, noise loops) in a suspended context. The first key or touch then resumes it, so the player
hears nothing until they act, and the console is noisy on the one entry path that matters. Policy:
https://developer.chrome.com/blog/autoplay/#web-audio

## What
In `initAudio()` (src/audio.js) build the context only when called from a user activation (`navigator.userActivation?.isActive`,
or the gesture listener's own flag in src/main.js); otherwise return and let the first `pointerdown`/`keydown` listener
(main.js:75-82) build it. No behaviour change on a normal Jump tap.

## Acceptance criteria
- [ ] `?play=jump` and `?play=reveal` load with zero console warnings about the AudioContext
- [ ] After the first key or tap in such a run, `__coldgas.life.audio()` becomes `running` and the motor is audible
- [ ] A normal title → Jump flow is unchanged (context is running at the countdown)

## Test plan
e2e: load `?play=jump`, collect console, assert no AudioContext warning; dispatch a keydown, assert audio state `running`.

## Out of scope
An on-screen "tap for sound" prompt; any change to the mute setting.
