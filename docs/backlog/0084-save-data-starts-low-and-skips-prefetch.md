---
id: 0084
title: A device that asked to save data starts on the low tier and prefetches nothing
status: proposed
priority: P2
size: S
lens: platform
created: 2026-10-23
pr:
by: scout
---

## Why
The first load ships a 660 kB entry chunk plus WASM and, on a good connection, warms lazy chunks. A phone on a
metered link with Data Saver on has told the browser it wants less, and the game ignores that:
`src/gfx-tier.js` reads only the touch flag, the user agent and `deviceMemory`; nothing reads `saveData`.
Lockdown asks for resilience and battery on real phones; honouring a stated preference is the cheapest of both.
Reference: MDN `NetworkInformation.saveData` and the `Save-Data` client hint
(https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/saveData).

## What
- `pickDeviceTier` (src/gfx-tier.js) takes `saveData` (from `navigator.connection?.saveData`) and returns
  `low` with reason "data saver" when it is true, unless `?gfx=` or a saved choice overrides it.
- Whatever idle-time prefetch of lazy chunks exists (theatre, Free Drive) is skipped while `saveData` is on;
  the chunk still loads on demand, with the existing deadlines.
- No new host, no new UI. The existing tier chip shows the reason.

## Acceptance criteria
- [ ] Unit: `pickDeviceTier({ saveData: true })` is `low`; `saveData: false` or absent changes nothing.
- [ ] Unit: `?gfx=high` still wins over `saveData`.
- [ ] e2e with `navigator.connection.saveData` forced true: boots `low`, makes no idle prefetch request, and
      the judges' theatre and Free Drive still load on demand.
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse; zero console errors.

## Test plan
`tests/unit/gfx-tier.test.js` for the pick; one e2e in `tests/e2e/` that stubs `navigator.connection` via
`addInitScript` and asserts the tier and the request log.

## Out of scope
Smaller assets, a data-saver banner, any change to the sim.
