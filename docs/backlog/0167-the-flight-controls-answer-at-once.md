---
id: 0167
title: "The iPhone app's flight controls answer at once: raw touches, no edge-gesture delay, nothing can stick"
status: in-progress
priority: P1
size: S
lens: platform
created: 2026-11-05
pr: 262
by: operator
---

## Why
The owner, flying on their phone: the control buttons are terrible and latent, and need to be super tuned.

## What
Runs on: the operator's Mac (Xcode) and the phone. iPhone app only. The sim's dead zones and shaping (Hands.swift) don't change, so scores don't.
- `preferredScreenEdgesDeferringSystemGestures` is `.all`: iOS held touches near the screen edge, where the controls sit, while it looked for a system swipe.
- `ios/ColdGas/Input/ControlSurface.swift`: the thumb pad, stick and buttons on raw UIKit touches instead of SwiftUI's DragGesture. Highlights change in the same frame, with no blur layer.
- Forgiving zones: nothing dead between buttons, 12 pt past the block, 24 pt past the stick, 28 pt past the thumb pad. A finger slides from button to button; a drifting thumb keeps what it holds.
- A cancelled touch or a view going away releases what it held. Haptic generators are kept prepared.
- `-input-log` prints each press's delay; `-frame-latency` tries a shorter frame queue.

## Acceptance criteria
- [x] Six touch tests pass on the Pro Max simulator.
- [ ] On a real iPhone, `-input-log`: delivery and on-glass times measured, before and after.
- [ ] The owner says the controls feel right on their phone.
- [ ] Two fingers at once on a real phone: stick plus button, and a slide between buttons.

## Test plan
`ios/ColdGasUITests/FlightUITests.swift` drives the pad and the GO button by touch on the simulators. The edge deferral and multi-touch feel only show on a device: `devicectl … -- -course lineup -tier pro -input-log`.
