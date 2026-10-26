// The screen stays on while there's something to watch (0060): a run, the judging (up to 35 s with no
// input) and the replay. A Screen Wake Lock, where the browser has one; the browser drops it whenever the
// page is hidden, so `syncWake` asks again on the way back. Nothing here throws: no lock, no harm.
let lock = null, want = false, asking = false, refused = false, timer = 0;
// Asked a moment after it's wanted, not in the frame a run starts (the Jump tap's first frame is budgeted:
// tests/e2e/lifecycle.spec.js); no screen dims in a quarter second.
const ASK_DELAY_MS = 250;

export function syncWake(on) {
  want = !!on;
  if (!want) { refused = false; clearTimeout(timer); timer = 0; const l = lock; lock = null; l?.release().catch(() => {}); return; }
  if (lock || asking || refused || timer || document.hidden || !navigator.wakeLock) return;
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
