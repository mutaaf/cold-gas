import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4175;

// CI splits the suite in 3 (`--shard=N/3`), and Playwright cuts shards by test count in file order. The heavy
// files come first alphabetically (build, course-switch, drive, endless, hud-collapse), so equal counts ran
// 35+ / 25 / 15 min on #155 and shard 1 hit its 35-minute job limit twice. Weighted by those runs' per-file
// times, 23:28:49 gave ≈ 24 / 25.5 / 25.5 min. #158 (0064's theatre-gl, ≈ 6 min in shard 3) then ran 26 / 31.8 / 36+
// and shard 3 hit the limit with 104 of 108 green: 67:81:90 moves hud-collapse into shard 1 and obs..phone-flip
// into shard 2, ≈ 32 / 31 / 31 min from that run's per-file times. 0083 added judges-deploy (≈ 3–5 min) to shard 2.
// Runners differ up to 2× (network.spec: 9.5 min on one, ≈ 4 on another), so every shard must fit a slow one:
// 67:66:105 ran shard 3 past 35 min (103 of 106 green). 80:75:83 (82 / 77 / 84 tests) moves hud-fit, hud and
// input into shard 1 and keeps shard 3 near main's: ≈ 31 / 30 / 28 min on the slow runners. #161's new tests then moved
// the cut: install joined shard 1 (82 → 87 tests) and main's e2e 1/3 hit 35 min on a runner 1.33× the median. From the
// per-test medians of four runs (#159, #160, #161 twice), 83:78:77 cuts 87 / 79 / 79 tests ≈ 28.2 / 29.4 / 29.5 min, where
// 80:75:83 was 28.2 / 27.4 / 31.4; no cut of the ≈ 87 min suite survives a 1.33× runner. Main's e2e 1/3 then hit 35 min
// again on 83:78:77 (76 of 87 green, a 1.18× runner): with group boundaries that cut is 31.0 / 28.0 / 25.4 by the per-test
// medians of four runs (#161 and #162 as PRs, main on each). 71:80:87 cuts 74 / 82 / 89 tests ≈ 28.1 / 28.3 / 27.9 min, as
// even as file boundaries allow. #165's new pause tests then moved the cut to 82 / 76 / 91 (31.1 / 27.3 / 31.0 by the
// per-test medians of six runs, #163 to #165) and main's e2e 1/3 hit 35 min on a 1.11× runner (76 of 82 green). 71:90:88
// cuts 74 / 87 / 88 ≈ 28.5 / 30.5 / 30.5, the best any weights give the ≈ 89.5-minute suite (a 1.15× runner still fails;
// a third worker buys nothing on these 4-CPU runners). Main on #169 then ran 30.3 / 17.0 / 31.6 min: shard 2's 88 tests
// are short ones (≈ 34 worker-minutes), shard 3's long. 0108 adds touchdown-frame (3 tests, 26 stepped flights, ≈ 3.4
// worker-minutes) to shard 3, and 71:109:70 cuts 74 / 112 / 67: phone-frame's replay tests, replay-phone and
// restart-lets-go (≈ 9.5 worker-minutes on #169) join shard 2, ≈ 30.3 / 21.7 / 28.6 min by that run's per-test times. Main on
// #171 then cancelled e2e 2/3 at 35 min (95 of 112 green, a 1.22× runner): by per-test times from three runs (#170, #171 as
// PRs, main on #171), each job's runner factored out, 71:109:70 is 32.6 / 33.3 / 25.0 min. 65:100:85 (66 / 101 / 86) then
// ran e2e 2/3 past 35 min twice on #172 at 1.22× those times: hud-fit..phone-flip run slow in four runs of five, so it was the
// files, not the runners. By each test's median over six runs (#170, #171, main, #172 thrice), 69:92:89 cuts 70 / 93 / 90 ≈
// 31.7 / 31.6 / 31.9 min (p75: 33.8 / 34.1 / 34.1); the suite is ≈ 95 median minutes. Check a cut with
// `PWTEST_SHARD_WEIGHTS=a:b:c npx playwright test --list --shard=N/3`.
// 0117 adds two ads.spec tests (≈ 1 min) to shard 1; 71:92:89 keeps shards 2 and 3 exactly main's cut (with 69:92:89
// hud-collapse's 820×1180 flight moved into shard 2, and #183's e2e 1/3 and 2/3 both ran into 35 min on slow runners).
// Playwright reads the weights after loading this file. Only for the whole suite: the flake guard
// (scripts/e2e-repeat-changed.mjs) names its spec files and shards those evenly.
// Three weights fit only a total of 3 (Playwright throws on any other), so a hand-run `--shard=1/2` stays even.
const args = process.argv.slice(2);
const wholeSuite = !args.some((a) => /\.spec\.js|^tests\//.test(a));
const thirds = args.some((a, i) => /^--shard=\d+\/3$/.test(a) || (a === '--shard' && /^\d+\/3$/.test(args[i + 1] ?? '')));
if (wholeSuite && thirds) process.env.PWTEST_SHARD_WEIGHTS ??= '71:92:89';

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
