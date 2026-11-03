import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const BASE = '/coldgas/';

// The build id every error signature carries (src/obs/): Workers Builds' commit, else git's, else 'dev'.
if (!process.env.VITE_CG_BUILD) {
  let sha = process.env.WORKERS_CI_COMMIT_SHA || '';
  if (!sha) { try { sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = ''; } }
  process.env.VITE_CG_BUILD = sha.slice(0, 7) || 'dev';
}

// The production address, for the few places that must be absolute (link previews: og:url, og:image,
// canonical in index.html as %VITE_CG_SITE%). Everything else stays relative to the base path.
process.env.VITE_CG_SITE ||= 'https://mutaafaziz.com/coldgas/';

// Response headers for the static assets (Workers Static Assets reads dist/_headers).
// - HTML: Cloudflare Web Analytics auto-injects a beacon into HTML on the mutaafaziz.com zone; the
//   game opts out with `Cache-Control: no-transform` (AGENTS.md §3.3: no analytics, no third
//   parties). It revalidates on every load so a deploy shows up at once.
// - Everything under assets/ has a content hash in its name, so it never changes: cache it for a
//   year and never revalidate (a repeat visit costs one request, the HTML).
// - The install files (0081) keep their names, so they revalidate: the manifest every time (an
//   installed app re-reads it), the icons, screenshots and share card after a day.
const HEADERS = ['/coldgas/', '/coldgas/index.html']
  .map((path) => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('') + '/coldgas/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
  + '/coldgas/manifest.webmanifest\n  Content-Type: application/manifest+json\n  Cache-Control: public, max-age=0, must-revalidate\n'
  + ['/coldgas/icons/*', '/coldgas/screenshots/*', '/coldgas/og.png', '/coldgas/apple-touch-icon.png', '/coldgas/favicon*']
    .map((path) => `${path}\n  Cache-Control: public, max-age=86400\n`).join('');
const staticHeaders = {
  name: 'static-headers',
  apply: 'build',
  closeBundle() { writeFileSync('dist/_headers', HEADERS); },
};

// First paint: the title is plain HTML + CSS, so it can paint before any JavaScript arrives, as
// long as the stylesheet isn't one more round trip. Inline it into index.html (it's small: fonts
// are latin-only) and preload the display face so the wordmark doesn't re-flow when it lands.
const inlineCss = {
  name: 'inline-css',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, { bundle }) {
      if (!bundle) return html;
      for (const [file, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !file.endsWith('.css')) continue;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        if (!link.test(html)) continue;
        html = html.replace(link, () => `<style>${String(asset.source).trim()}</style>`);
        delete bundle[file];
      }
      // Preload the three faces the title paints with: the wordmark, the text face and the mono
      // (the spec's numbers; without it they paint in a fallback and swap when it lands).
      for (const re of [/michroma-latin-400-normal-[\w-]+\.woff2$/, /geist-latin-wght-normal-[\w-]+\.woff2$/, /geist-mono-latin-400-normal-[\w-]+\.woff2$/]) {
        const font = Object.keys(bundle).find((f) => re.test(f));
        if (font) html = html.replace('</title>', `</title>\n  <link rel="preload" href="${BASE}${font}" as="font" type="font/woff2" crossorigin />`);
      }
      // No preload for the physics engine's WASM (1.17 MB gzip, the largest download), on purpose (0053). On a
      // phone over cellular the link is the bottleneck: preloaded with the HTML it shared the link with the
      // entry script (≈ 220 kB), which landed at 4.7 s instead of 3.4 s (Slow 4G), and the Jump was wired 1.3 s
      // later. main.js asks for it first thing (src/sim/engine-web.js), once the entry is in. Its last byte
      // arrives ≈ 0.7 s later, but the engine was ready no later in our runs: at 4× CPU its compile dominates.
      // tests/e2e/layout.spec.js holds the order; scripts/serve-gz.mjs + scripts/perf.mjs measure it.
      return html;
    },
  },
};

// Served at https://mutaafaziz.com/coldgas/ — the base path is an invariant (AGENTS.md §3.2).
export default defineConfig({
  base: BASE,
  plugins: [staticHeaders, inlineCss],
  build: { outDir: 'dist/coldgas', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node', setupFiles: ['tests/unit/setup.js'],
    // Whole flights through the engine: a fuzz of 40 Pro runs takes ≈5 s on a laptop, more on CI. Hooks too: the four
    // Free Drive roads build in one beforeAll (tests/unit/roads.test.js), ≈ 10 s beside the whole suite.
    testTimeout: 30000, hookTimeout: 30000 },
});
