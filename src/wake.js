// The screen stays on while there's something to watch (0060): a run, the judging (up to 35 s with no
// input) and the replay. A Screen Wake Lock, where the browser has one; the browser drops it whenever the
// page is hidden, so `syncWake` asks again on the way back. Nothing here throws: no lock, no harm.
let lock = null, want = false, asking = false;

export function syncWake(on) {
  want = !!on;
  if (!want) { const l = lock; lock = null; l?.release().catch(() => {}); return; }
  if (lock || asking || document.hidden || !navigator.wakeLock) return;
  asking = true;
  navigator.wakeLock.request('screen').then((l) => {
    asking = false;
    if (!want || document.hidden) { l.release().catch(() => {}); return; }   // not wanted any more by the time it came
    lock = l;
    l.addEventListener?.('release', () => { if (lock === l) lock = null; });
  }, () => { asking = false; });   // refused (battery saver, no permission): the screen may dim
}

export const wakeHeld = () => !!lock;
