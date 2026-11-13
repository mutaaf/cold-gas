// The screen stays on while there's something to watch (0060): a run, the judging (up to 35 s with no
// input) and the replay. A Screen Wake Lock, where the browser has one; the browser drops it whenever the
// page is hidden, so `syncWake` asks again on the way back. Nothing here throws: no lock, no harm.
import { ON_PORTAL } from './portal/flag.js';
let lock = null, want = false, asking = false, refused = false, timer = 0;
// A portal embeds the game in a frame that may not grant the wake lock (Permissions Policy); asking anyway is a
// console error there. Off the portals the page is the top document and this is always true.
const allowed = () => !ON_PORTAL || (document.permissionsPolicy || document.featurePolicy)?.allowsFeature?.('screen-wake-lock') === true;
// Asked a moment after it's wanted, not in the frame a run starts (the Jump tap's first frame is budgeted:
// tests/e2e/lifecycle.spec.js); no screen dims in a quarter second.
const ASK_DELAY_MS = 250;

export function syncWake(on) {
  want = !!on;
  if (!want) { refused = false; clearTimeout(timer); timer = 0; const l = lock; lock = null; l?.release().catch(() => {}); return; }
  if (lock || asking || refused || timer || document.hidden || !navigator.wakeLock || !allowed()) return;
  timer = setTimeout(ask, ASK_DELAY_MS);
}

function ask() {
  timer = 0;
  if (!want || lock || asking || document.hidden) return;
  asking = true;
  navigator.wakeLock.request('screen').then((l) => {
    asking = false;
    if (!want || document.hidden) { l.release().catch(() => {}); return; }   // not wanted any more by the time it came
    lock = l;
    l.addEventListener?.('release', () => { if (lock === l) lock = null; });
  }, () => { asking = false; refused = true; });   // refused (battery saver, no permission): not asked again until it's let go
}

export const wakeHeld = () => !!lock;
