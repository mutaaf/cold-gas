// Response headers for the static assets: vite.config.js writes HEADERS to dist/_headers, which
// Workers Static Assets reads (tests/unit/privacy.test.js checks the rules).
// - HTML: Cloudflare Web Analytics auto-injects a beacon into HTML on the mutaafaziz.com zone; our
//   pages opt out with `Cache-Control: no-transform` (AGENTS.md §3.3: no analytics, no third
//   parties). They revalidate on every load so a deploy shows up at once. That is the game itself and
//   the privacy page (0155): `/coldgas/privacy` and `/index.html` answer a 307 to `/coldgas/privacy/`,
//   and all three spellings carry the rule so no answer is ever transformed. The player's guide
//   (`/coldgas/guide/`, public/guide/) and the native app's beta page (`/coldgas/beta/`, public/beta/) are served
//   the same way.
// - Everything under assets/ has a content hash in its name, so it never changes: cache it for a
//   year and never revalidate (a repeat visit costs one request, the HTML).
// - The install files (0081) keep their names, so they revalidate: the manifest every time (an
//   installed app re-reads it), the icons, screenshots and share card after a day.
export const HTML_PAGES = [
  '/coldgas/', '/coldgas/index.html',
  '/coldgas/privacy', '/coldgas/privacy/', '/coldgas/privacy/index.html',
  '/coldgas/guide', '/coldgas/guide/', '/coldgas/guide/index.html',
  '/coldgas/beta', '/coldgas/beta/', '/coldgas/beta/index.html',
];

export const HEADERS = HTML_PAGES
  .map((path) => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('') + '/coldgas/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
  + '/coldgas/manifest.webmanifest\n  Content-Type: application/manifest+json\n  Cache-Control: public, max-age=0, must-revalidate\n'
  + ['/coldgas/icons/*', '/coldgas/screenshots/*', '/coldgas/og.png', '/coldgas/apple-touch-icon.png', '/coldgas/favicon*']
    .map((path) => `${path}\n  Cache-Control: public, max-age=86400\n`).join('');
