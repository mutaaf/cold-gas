---
id: 0228
title: Portal builds for CrazyGames and GameDistribution (their SDKs, no server, store art, a submit checklist)
status: in-progress
priority: P1
size: L
lens: platform
created: 2026-11-13
by: operator
---

## Why
The owner, 2026-11-13: get COLD GAS ready to submit to the HTML5 portals CrazyGames and GameDistribution, which host the
game and share ad revenue. Players are the focus; the portals bring them. The owner makes the accounts and submits.

## What
- A separate build target per portal (`npm run build:crazygames`, `npm run build:gamedistribution`): relative paths,
  `dist-portals/<portal>/game/` and a zip, gated (no mutaafaziz.com, Marquee, Box Office, root-absolute path, service
  worker). The production build and mutaafaziz.com/coldgas are unchanged.
- src/portal/: the adapter over both SDKs (loading, gameplay start/stop, midgame and rewarded ads, device type, mute
  setting, the CrazyGames data module), a no-op without an SDK (an ad blocker); the ads object main.js already drives
  (src/ads.js's interface) with the portal behind it; no server (the API refused locally: local lines, a board on this
  device, the local quest generator); saves through the data module.
- store/portals/: CrazyGames covers (1920×1080, 800×1200, 800×800) and both videos from real frames of the reference
  jump (scripts/portal-art.mjs), GameDistribution images, descriptions and controls, SUBMIT.md.

## Acceptance criteria
- [x] `npm run build:crazygames` and `npm run build:gamedistribution` produce gated zips under dist-portals/ (gitignored).
- [x] tests/unit/portal.test.js: the index.html edits, both SDK adapters (incl. blocked and throwing), saves, the offline guard, the local board, the ads object's breaks.
- [x] scripts/portal-playtest.mjs passes for CrazyGames (SDK up, blocked, phone) and GameDistribution: a hand-flown run in a sandboxed iframe on another origin, gameplayStart, the midgame ad at the break, no request to mutaafaziz.com, no console errors.
- [x] The production build's behaviour is unchanged (every portal branch is behind `ON_PORTAL`, 'none' in production).

## Test plan
`npm test`; `npm run build:portals`; `node scripts/portal-playtest.mjs crazygames [--blocked|--phone]`;
`node scripts/portal-playtest.mjs gamedistribution` (built with a test game id).

## Out of scope
CORS on the Worker for the portals' origins (the online board and the AI panel there): an owner decision (SUBMIT.md).
