// The one place a portal build reads its settings from (store/portals/SUBMIT.md).
//
// GameDistribution's game id: it exists only once the game is created in the GameDistribution developer dashboard
// (developer.gamedistribution.com → your game → the "Game ID" / hash). Paste it here, then `npm run build:gamedistribution`
// and upload the new zip. Until then the build warns, and the game runs with no ads (the SDK is not loaded).
// `CG_GD_GAME_ID=<id> npm run build:gamedistribution` overrides it for one build (scripts/portal-build.mjs).
export const GD_GAME_ID_PLACEHOLDER = 'PASTE-GAMEDISTRIBUTION-GAME-ID';
export const GD_GAME_ID = import.meta.env?.VITE_CG_GD_GAME_ID || 'PASTE-GAMEDISTRIBUTION-GAME-ID';

// The judges' "ask again" rewarded break (src/ads.js `reroll`): off on the portals. The reward is fresh words from the
// AI panel, and a portal build has no server, so the panel speaks local lines, which are the same for the same run:
// the ad would buy nothing. Turn it on only with a reward that changes something (the portals' ad rules).
export const REWARDED_REROLL = false;

// How long the game waits for the portal's SDK before it starts without it (an ad blocker fails fast; this is for a
// slow network). The SDK is adopted if it lands later only for ads, never for saves already read.
export const SDK_WAIT_MS = 5000;

// Between-runs breaks: never after the first run of a session, and our own floor between two (the SDKs keep their
// own: CrazyGames one midgame per 3 minutes, GameDistribution its own interval).
export const MIDGAME_GAP_MS = 180_000;
