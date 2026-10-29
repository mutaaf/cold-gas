import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4175;

// CI splits the suite in 3 (`--shard=N/3`), and Playwright cuts shards by test count in file order. The heavy
// files come first alphabetically (build, course-switch, drive, endless, hud-collapse), so equal counts ran
// 35+ / 25 / 15 min on #155 and shard 1 hit its 35-minute job limit twice. Weighted by those runs' per-file
// times, 23:28:49 gives ≈ 24 / 25.5 / 25.5 min. Playwright reads the weights after loading this file. Only for
// the whole suite: the flake guard (scripts/e2e-repeat-changed.mjs) names its spec files and shards those evenly.
const wholeSuite = !process.argv.slice(2).some((a) => /\.spec\.js|^tests\//.test(a));
if (wholeSuite && process.argv.some((a) => a.startsWith('--shard'))) process.env.PWTEST_SHARD_WEIGHTS ??= '23:28:49';

export default defineConfig({
  testDir: 'tests/e2e',
  // CI's runners vary (unit tests alone have run 1.8× slower on some): 90 s there, 60 s locally.
  timeout: process.env.CI ? 90_000 : 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/coldgas/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
