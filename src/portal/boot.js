// A portal build's first module (src/portal/entry.js imports it before the game): the portal's SDK is loaded and
// started, the saves are read from its data module, and the server calls are refused, all before src/main.js and the
// modules it reads saves in run. Top-level await: the game waits for this, at most SDK_WAIT_MS (an ad blocker fails at
// once). The title is plain HTML and CSS, so it paints meanwhile.
import { PORTAL } from './flag.js';
import { createPortal } from './sdk.js';
import { hydrate, mirror } from './storage.js';
import { guardFetch } from './offline.js';

guardFetch(globalThis.window);
export const portal = createPortal(PORTAL);
await portal.init();
portal.loadingStart();
globalThis.__cgPortalDevice = portal.deviceType();
let ls = null;
try { ls = globalThis.localStorage; } catch { /* storage blocked: the game copes */ }
const data = portal.data;
if (data && ls) { hydrate(ls, data); mirror({ ls, data }); }
// For the playtests (scripts/portal-playtest.mjs) and anyone debugging on a portal: what the adapter did.
globalThis.__cgPortal = portal;
