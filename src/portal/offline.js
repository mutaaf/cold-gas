// A portal build has no server: the game's API (/coldgas/api/*: the judges, the board, side quests, the obs beacon)
// lives on mutaafaziz.com, which answers no other origin (no CORS), and the portals' own hosts have no /api. Every
// call the game would make to `api/` under its own folder is refused here at once, without touching the network, so
// nothing 404s in the console and every caller takes the offline path it already has (local lines, the local board).
export function isServerCall(url, base) {
  try {
    const u = new URL(url, base), b = new URL(base);
    return u.origin === b.origin && /\/api\//.test(u.pathname);
  } catch { return false; }
}

export function guardFetch(win = globalThis.window) {
  if (!win?.fetch || win.fetch.__cgPortal) return;
  const real = win.fetch.bind(win);
  const guarded = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (isServerCall(url, win.location.href)) return Promise.reject(new TypeError('No server in this version'));
    return real(input, init);
  };
  guarded.__cgPortal = true;
  win.fetch = guarded;
  const nav = win.navigator;
  if (nav?.sendBeacon) {
    const beacon = nav.sendBeacon.bind(nav);
    try { nav.sendBeacon = (url, data) => (isServerCall(url, win.location.href) ? false : beacon(url, data)); } catch { /* read-only */ }
  }
}
