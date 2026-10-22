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

// Response headers for the static assets (Workers Static Assets reads dist/_headers).
// - HTML: Cloudflare Web Analytics auto-injects a beacon into HTML on the mutaafaziz.com zone; the
//   game opts out with `Cache-Control: no-transform` (AGENTS.md §3.3: no analytics, no third
//   parties). It revalidates on every load so a deploy shows up at once.
// - Everything under assets/ has a content hash in its name, so it never changes: cache it for a
//   year and never revalidate (a repeat visit costs one request, the HTML).
const HEADERS = ['/coldgas/', '/coldgas/index.html']
  .map((path) => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('') + '/coldgas/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n';
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
    // Whole flights through the engine: a fuzz of 40 Pro runs takes ≈5 s on a laptop, more on CI.
    testTimeout: 30000 },
});
