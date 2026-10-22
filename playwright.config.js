import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4175;

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
