// When may the page reload itself? Pure (the probe and the clock are passed in), so the decision is
// unit-tested (tests/unit/net.test.js) and the page only does what it says.
//
// A reload throws away whatever the player was doing, and offline it lands on the browser's "no
// internet" page: the game is gone. So the page reloads only when
//   - the browser says it is online, and
//   - a fresh fetch of our own index.html answered (the origin is reachable), and
//   - for a missing chunk: that index.html names a different entry script than the one this page
//     booted from (a deploy really replaced the build; otherwise it was the network), and
//   - it hasn't already reloaded in the last two minutes (no reload loops).

export const RELOAD_GAP_MS = 120_000;

// The entry script an index.html boots from (Vite: <script type="module" crossorigin src="…/index-HASH.js">).
export function entryOf(html) {
  if (typeof html !== 'string') return null;
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!/\btype\s*=\s*["']?module/i.test(attrs)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src) return src.replace(/^https?:\/\/[^/]+/i, '');
  }
  return null;
}

/**
 * @param {object} o
 * @param {boolean} o.online         navigator.onLine (undefined counts as online)
 * @param {{ok:boolean, html?:string}|null} o.probe   the no-store fetch of index.html (null: it failed)
 * @param {string|null} o.current    the entry this page booted from
 * @param {boolean} o.needNewBuild   a missing chunk: reload only into a different build
 * @param {number} o.lastReload      when this tab last reloaded itself (ms epoch, 0: never)
 * @param {number} o.now
 * @returns {{reload:boolean, why:string}}
 */
export function decideReload({ online = true, probe = null, current = null, needNewBuild = false, lastReload = 0, now = 0, gapMs = RELOAD_GAP_MS }) {
  if (online === false) return { reload: false, why: 'offline' };
  if (!probe || !probe.ok) return { reload: false, why: 'unreachable' };
  if (needNewBuild) {
    const next = entryOf(probe.html);
    if (!next || !current) return { reload: false, why: 'unknown build' };
    if (next === current) return { reload: false, why: 'same build' };
  }
  if (now - lastReload < gapMs) return { reload: false, why: 'reloaded recently' };
  return { reload: true, why: needNewBuild ? 'new build' : 'reachable' };
}
