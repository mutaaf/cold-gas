// The portal builds (CrazyGames, GameDistribution): what Vite does differently for them. Imported by vite.config.js
// only; with no CG_PORTAL the production build never calls any of this.
//
// - index.html: the entry is src/portal/entry.js (the portal's SDK first, then the game), and everything a portal
//   forbids comes out: the web app manifest (no install prompt), the link-preview tags (absolute mutaafaziz.com URLs),
//   the iPhone beta links, the guide link, Box Office's loader. Each edit must match exactly once, or the build
//   fails: a change to index.html that a portal build would silently ship is caught here (tests/unit/portal-html.test.js).
// - Module swaps: src/ads.js (Marquee) → src/portal/ads.js (the portal's SDK), src/insights.js (Box Office) →
//   src/portal/insights.js (nothing). Only for imports from outside src/portal/, which reuses ads.js's pure helpers.
import { resolve, sep } from 'node:path';

export const PORTALS = ['crazygames', 'gamedistribution'];

// Hidden on a portal (no server to share to, no AI key to bring, no store or other-site links), the text selection
// the portals ask for (CrazyGames: user-select none on body, every prefix), and the blocker shown while an ad is asked.
export const PORTAL_CSS = [
  '[data-share],[data-vs-send],[data-rc-change],[data-ai-open],.beta-chip,.beta-btn,.fp-beta{display:none!important}',
  'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}',
  '.portal-busy{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(5,7,12,.55)}',
  '.portal-busy i{width:28px;height:28px;border-radius:50%;border:2px solid rgba(233,237,243,.25);border-top-color:#e9edf3;animation:portal-spin .9s linear infinite}',
  '@keyframes portal-spin{to{transform:rotate(1turn)}}',
  '@media (prefers-reduced-motion:reduce){.portal-busy i{animation:none}}',
].join('');

// [what, pattern, replacement]. Every pattern must match exactly once.
const EDITS = [
  ['entry', /<script type="module" src="\/src\/main\.js"><\/script>/g, '<script type="module" src="/src/portal/entry.js"></script>'],
  ['manifest', /\n\s*<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/g, ''],
  ['install metas', /\n\s*<meta name="mobile-web-app-capable" content="yes" \/>\n\s*<meta name="apple-mobile-web-app-capable" content="yes" \/>/g, ''],
  ['link previews', /\n\s*<!-- Link previews:[^]*?<meta name="twitter:image:alt"[^>]*\/>/g, ''],
  ['beta chip', /\n\s*<!-- The native app's public beta[^\n]*\n\s*<a class="chip beta-chip"[^]*?<\/a>/g, ''],
  ['beta button', /\n\s*<a class="course-btn drive-btn beta-btn"[^]*?<\/a>/g, ''],
  ['fineprint links', / <a href="guide\/">How to play<\/a><span class="fp-beta"> · <a href="beta\/">iPhone beta<\/a><\/span>/g, ''],
  ['box office', /\n\s*<!-- Box Office usage analytics[^]*?<\/script>/g, ''],
  // The boot watchdog reads any error as a failed start; on a portal the SDK's script may be blocked (an ad
  // blocker) and that is not the game failing. Script and resource errors (an element target) are ignored.
  ['watchdog', /addEventListener\('error', function \(\) \{ if \(!up\(\)\)/g, "addEventListener('error', function (e) { if (e && e.target && e.target !== window) return; if (!up())"],
  ['portal mark', /<html lang="en"/g, '<html lang="en" data-portal="%PORTAL%"'],
  ['portal css', /<\/head>/g, `  <style data-portal-css>${PORTAL_CSS}</style>\n</head>`],
];

// Anything that must never reach a portal's index.html.
export const FORBIDDEN = [/mutaafaziz/i, /%VITE_CG_SITE%/, /\/boxoffice\//, /\/ads\/v1/, /href="beta\//, /href="guide\//, /rel="manifest"/, /src="\/src\/main\.js"/];

export function portalHtml(html, portal) {
  if (!PORTALS.includes(portal)) throw new Error(`unknown portal ${portal}`);
  let out = html;
  for (const [what, re, rep] of EDITS) {
    const n = (out.match(re) || []).length;
    if (n !== 1) throw new Error(`portal build: index.html edit "${what}" matched ${n} times (expected 1): update scripts/portal-html.mjs`);
    out = out.replace(re, rep.replace('%PORTAL%', portal));
  }
  for (const re of FORBIDDEN) if (re.test(out)) throw new Error(`portal build: index.html still has ${re}`);
  return out;
}

export function portalPlugin(portal, root = process.cwd()) {
  const src = resolve(root, 'src');
  const portalDir = resolve(src, 'portal') + sep;
  const SWAP = { [resolve(src, 'ads.js')]: resolve(src, 'portal/ads.js'), [resolve(src, 'insights.js')]: resolve(src, 'portal/insights.js') };
  return {
    name: 'cold-gas-portal',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(portalDir) || !/(^|\/)(ads|insights)\.js$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && SWAP[r.id] ? SWAP[r.id] : null;
    },
    transformIndexHtml: { order: 'pre', handler: (html) => portalHtml(html, portal) },
  };
}
