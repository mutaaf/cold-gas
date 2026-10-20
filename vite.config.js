import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Cloudflare Web Analytics auto-injects a beacon into HTML on the mutaafaziz.com zone; the game
// opts out with `Cache-Control: no-transform` (AGENTS.md §3.3: no analytics, no third parties).
const HEADERS = ['/coldgas/', '/coldgas/index.html']
  .map((path) => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('');
const noAnalyticsHeaders = {
  name: 'no-analytics-headers',
  apply: 'build',
  closeBundle() { writeFileSync('dist/_headers', HEADERS); },
};

// Served at https://mutaafaziz.com/coldgas/ — the base path is an invariant (AGENTS.md §3.2).
export default defineConfig({
  base: '/coldgas/',
  plugins: [noAnalyticsHeaders],
  build: { outDir: 'dist/coldgas', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node' },
});
