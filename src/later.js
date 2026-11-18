// The modules a run needs only once it has started or ended (0053): the coach's lines, the drills, the HUD's
// instruments, the judges' settings sheet, the share card's drawing, the board's client, the sheet's Post and the
// landing's beat. On a phone over cellular every byte of the entry chunk is parsed and run before the title's Jump is
// wired; these ride in this chunk instead, which main.js asks for beside the physics engine (src/sim/engine-web.js),
// far smaller than its WASM, and a run waits on both. tests/unit/entry-lean.test.js keeps them out of the entry.
export { coach } from './sim/coach.js';
export { drillById, drillsFor, buildDrill, drillResult, drillCoach } from './practice.js';
export { createInstruments } from './instruments.js';
export { openSettings } from './ai/settings.js';
export { drawShareCard, shareRun } from './share-card.js';
export { localWords, localMeta, fetchBoard } from './panel.js';
export { createPost, postEligible } from './post.js';
export { createBeat, beatEligible } from './beat.js';
