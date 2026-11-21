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
// 31.7 / 31.6 / 31.9 min (p75: 33.8 / 34.1 / 34.1); the suite is ≈ 95 median minutes. On d56c58e (0117) that cut ran
// 16.8 / 35+ / 33.5 min on main #573 and 17.5 / 35+ / 18.7 on #187: e2e 2/3 was cancelled at 35 min three times running
// (84 of 99 done, ≈ 37 min whole). 86:75:89 hands its first files (hud-collapse's last flight, hud-fit, hud, input,
// install: 21 tests, ≈ 15 worker-minutes in #573's log) to shard 1, ≈ 24.5 / 29.5 min, and shard 3's list stays main's.
// #181 (the players audit: board, comeback, daily, medals, thumb-aim specs; 277 tests) ran 69:92:89 at 35+ / 24.0 / 34.6
// min, then 71:117:89 ran shard 2 past 35 min (78 of 117 green): on those runners the suite is ≈ 101 minutes, more than
// three 35-minute jobs hold whatever the cut. CI now runs four (ci.yml). By each test's time in #181's two runs, at file
// boundaries, 46:71:86:74 is ≈ 25.0 / 25.8 / 26.1 / 24.3 min: shard 2 starts at fan, 3 at lazy-retry, 4 at restart-lets-go.
// 0266 (#452) added daily-goal-fit (5 tests, shard 1's files): 46 moved one file into each later shard (e2e 3/4 then hit
// 35 min). 50:71:86:74 keeps shards 2-4 exactly main's files (90 / 108 / 93) and shard 1 at 64.
// Main then ran e2e 3/4 past 35 min twice running (2ca517c, f47e74d: 102 and 103 of 108 done, every file ≈ 1.75× the
// PR's run of the same tree), and f47e74d's e2e 4/4 too. By each file's median over three runs (#452's PR run and
// both main runs, first attempts only; two slow runs of three, so these are near slow-runner times) 50:71:86:74 was 22.7 / 31.0 / 37.2 / 24.2 min; 72:68:72:90 cuts 88 / 79 / 83 /
// 105 tests ≈ 29.1 / 29.3 / 29.5 / 27.3 (shard 2 starts at fold, 3 at learn, 4 at release-frame's last thumb flight). The
// suite is ≈ 115 median minutes in four 35-minute jobs: a 2× runner still fails, the fix for that is ci.yml's.
// Main then cancelled e2e 1/4 at 35 min on 4cbabe8 (75 of 88 done) on a runner 1.53× the same shard's 24.5 min on #458's
// PR run of the same tree; that PR run's shards 2 and 4 took 33.7 and 33.5 min on 1.83× and 1.46× runners. Medians mix
// slow and fast runners, so this cut uses each test's fastest time over those eight jobs (a runner-free floor): 72:68:72:90
// was 48.6 / 34.6 / 41.5 / 44.5 worker-minutes (≈ 24.3 / 17.3 / 20.8 / 22.3 min on two workers); 68:103:87:97 cuts
// 68 / 103 / 87 / 97 tests ≈ 42.3 / 43.8 / 43.2 / 39.9 (≈ 21.9 min worst), the best any file-boundary cut gives
// (shard 2 starts at first-landing, 3 at lifecycle-fold, 4 at restart-lets-go). A 35-minute job now holds a ≈ 1.55× runner
// where it held ≈ 1.40×; a 1.8× runner still fails, the fix for that is still ci.yml's (proposal #456).
// Main then cancelled e2e 1/4 at 35 min on 4ecefe3 and ef2aa66 (62 and 65 of 68 done; both docs/pixels-only after #465's
// world train), and ef2aa66's e2e 4/4 too (86 of 97). Shard 1 summed 67.4 worker-minutes on both runners, so its files are
// slow, not its runners (LESSONS 2026-10-30): the fastest-time floor above under-read it by ≈ 60%. By each test's slowest
// time over those two runs' eight jobs (≈ 263 worker-minutes in all), 68:103:87:97 was 72.7 / 58.2 / 59.8 / 72.0;
// 61:112:98:84 cuts 61 / 112 / 98 / 84 tests ≈ 66.5 / 65.8 / 66.4 / 63.9 (≈ 33 min on two workers), the best any
// file-boundary cut gives (shard 2 starts at endless, 3 at lifecycle, 4 at scenery). That is ≈ 2 min of margin, not a
// cure: a slow runner still fails, and the fix is ci.yml's (proposal #456).
// Main on ef47c44 then cancelled e2e 2/4 at 35 min (92 of 112 done) while 1/4 ran 22.3 min, 3/4 24.4 and 4/4 33.1. The
// same files ran ≈ 1.25× slower in that 2/4 than in ef2aa66's 2/4 (first-landing..keys-carry ≈ 60 worker-minutes against
// ≈ 48), and 1/4's files ≈ 1.35× faster than in ef2aa66's 1/4: file costs hold from run to run, runner speed doesn't. A
// slowest-time cut prices every file at its worst runner at once, which no runner set is. This cut prices each region at its
// faster run of those two (≈ 224 worker-minutes in all): 80:93:105:77 cuts 80 / 93 / 105 / 77 tests ≈ 55.1 / 53.5 / 55.3 /
// 59.7 (≈ 28-30 min; shard 2 starts at first-title, 3 at lifecycle, 4 at smoke), where 61:112:98:84 was 50.7 / 59.9 / 48.8 /
// 66.2. A 1.25× runner still lands on 35 min: the cure is ci.yml's headroom (proposal #456), not another cut.
// Main on bd41a1c then cancelled e2e 3/4 at 35 min (104 of 105 done, ≈ 69 worker-minutes) while 1/4 ran 19.4 min (≈ 39),
// 2/4 20.9 (≈ 42) and 4/4 29.9 (≈ 60): the lifecycle..share-moment region (network ≈ 12, frame-probe ≈ 10, lifecycle ≈ 9,
// pause ≈ 6) cost ≈ 14 more than its price. Priced on that one run, all four shards on the same commit, 122:79:86:68 cuts
// 122 / 79 / 86 / 68 tests ≈ 55.7 / 50.0 / 52.5 / 51.7 (≈ 26-28 min; shard 2 starts at hud-fit, 3 at next-jump, 4 at
// start-pending). Still no margin for a slow runner: proposal #456 is the cure.
// Its own PR run (#470) then drew slower runners: e2e 1/4 cancelled at 35 min (116 of 122), 2/4 (76 of 79), while 3/4 ran
// 29.7 and 4/4 26.1 (≈ 258 worker-minutes in all, ≈ 210 on bd41a1c). Moving hud-collapse into 2 and network into 3, and smoke
// into 4, 113:78:87:77 is ≈ 63 / 66 / 67 / 61 on that run and ≈ 49 / 45 / 60 / 60 on bd41a1c's. At ≈ 64 worker-minutes a
// shard on a slow day, no cut fits 35 min with margin: proposal #456 (ci.yml) is the cure.
// Main on 64fb99a then cancelled e2e 2/4 at 35 min (76 of 78 done, ≈ 71 worker-minutes) while 1/4 ran 34.0 min (≈ 68),
// 3/4 23.3 (≈ 46) and 4/4 24.3 (≈ 48): ≈ 233 worker-minutes in all. Priced on that one run's four jobs (lifecycle's 5
// unrun tests at 60 s each), 88:79:91:97 cuts 88 / 79 / 91 / 97 tests ≈ 58.7 / 59.8 / 55.2 / 58.8 (≈ 28-30 min; shard 2
// starts at fold, 3 at learn, 4 at restart-lets-go), the best file-boundary cut of that run. Margin ≈ 15 %, under the
// runner swing: proposal #456 (ci.yml) is still the cure.
// Main on 0910f74 then cancelled e2e 1/4 at 35 min (62 of 88 done) while 2/4 ran 18.0, 3/4 31.7 and 4/4 21.4; 1/4 also
// spent ≈ 6 worker-minutes on build.spec's ring quest failing twice (its second page booted beside a live Sandbox; fixed in
// the spec). Priced on each test's mean over 64fb99a's and 0910f74's main runs (≈ 224 worker-minutes), 88:79:91:97 was
// 68.1 / 47.6 / 58.0 / 50.6; 61:101:89:104 cuts 61 / 101 / 89 / 104 tests ≈ 54.9 / 56.8 / 57.1 / 55.5 (≈ 28 min; shard 2
// starts at endless, 3 at lazy-retry, 4 at replay-phone). By each test's slower run it is ≈ 67 / 66 / 64 / 64: still
// no margin for a slow runner. Proposal #456 (ci.yml) is the cure; six re-cuts in a day have not been.
// That cut's own PR run (#472) then cancelled e2e 2/4 at 35 min (90 of 101 done, none failed) while 1/4 ran 28.9 min,
// 3/4 29.7 and 4/4 23.0; the ring quest passed in 1.6 min. On the mean of all three runs (64fb99a, 0910f74, #472; ≈ 230
// worker-minutes) 61:101:89:104 is 55.5 / 64.1 / 57.8 / 52.2; 63:90:84:118 cuts 63 / 90 / 84 / 118 tests ≈ 59.0 / 55.9 /
// 56.2 / 58.5 (shard 2 starts at fan, 3 at keys-carry, 4 at privacy). By each test's slowest run it is ≈ 69 / 69 / 64 / 72.
// Main on aa60bdd (#475) then cancelled e2e 1/4 (62 of 63 done) and 4/4 (93 of 118) at 35 min with nothing failing, while
// 2/4 ran 34.0 and 3/4 17.2; the same tree's PR run was all green at 19.9 / 24.4 / 30.6 / 24.1 (≈ 189 worker-minutes there,
// ≈ 235+ on main). On each test's mean over those two runs (≈ 217 worker-minutes) 63:90:84:118 is 52.9 / 55.7 / 46.3 / 62.2;
// 63:91:104:97 cuts 63 / 91 / 104 / 97 tests ≈ 52.9 / 56.1 / 56.3 / 51.7 (≈ 28 min; shard 2 starts at fan, 3 at layout, 4 at
// restart-lets-go), the best file-boundary cut. Main's shard 1 alone ran ≈ 68 worker-minutes on that runner with the same
// files: no cut cures a slow runner. Proposal #456 (ci.yml, the operator's) is the cure; seven re-cuts have not been.
// Main on e1f0a76 (#477) then cancelled e2e 3/4 at 35 min (99 of 104 done; one ✘, pause.spec's 1440×900 step-back, passed
// on retry) while 1/4 ran 23.5 min, 2/4 24.0 and 4/4 19.1 (97 tests, ≈ 38 worker-minutes). Shard 3's files summed ≈ 68
// worker-minutes with 6 tests unrun (≈ 74 whole). Moving replay-phone (7 tests, ≈ 6) into shard 4, 63:91:97:104 is ≈ 47 /
// 48 / 67 / 44 on that run and ≈ 53 / 56 / 50 / 58 on the mean of aa60bdd's two. The ninth re-cut: luck, not headroom.
// Proposal #456 (ci.yml, the operator's) is the cure.
// That cut's own PR run (#478) then ran 3/4 in 23.5 min and, on its one re-run, 4/4 in 23.8, but 1/4 hit 35 min twice: 61 of
// 63 done the first time, all 63 green in 34.5 min (≈ 69 worker-minutes) the second, while 2/4 ran 18.9 (≈ 38). Moving
// driving-levels and endless (6 tests, ≈ 9 worker-minutes on that run) into shard 2, 57:97:97:104 is ≈ 60 / 47 / 47 / 48 on
// #478's runs. Still luck, not headroom: proposal #456 (ci.yml) is the cure.
// Main on 664b085 (#478) then cancelled e2e 2/4 at 35 min (89 of 97 done, none failed; judges-deploy's last three and
// keys-carry unrun) while 1/4 ran 29.0 min, 3/4 19.3 (97 tests, ≈ 38 worker-minutes) and 4/4 23.0. Moving instruments,
// judges-deploy and keys-carry (12 tests, ≈ 10 worker-minutes on that run) into shard 3, 57:85:109:104 is ≈ 60 / 61 / 48 /
// 46 on that run. The tenth re-cut: still luck, not headroom. Proposal #456 (ci.yml, the operator's) is the cure.
// Main on 72008ae (#483) then cancelled e2e 3/4 at 35 min (81 of 109 done, none failed; frame-probe's tail, privacy and the
// layout files after it unrun) while 1/4 ran 29.4 min, 2/4 25.8 (85 tests, ≈ 52 worker-minutes) and 4/4 29.6. Priced on that
// run (unrun tests at ≈ 0.5 worker-minutes each, shard 3 ≈ 84 whole), handing instruments, judges-deploy and keys-carry back to
// shard 2 and privacy onward to shard 4, 57:97:83:118 is ≈ 59 / 62 / 65 / 67 (≈ 30-34 min). The eleventh re-cut, with ≈ 3 %
// margin on the slowest shard: luck, not headroom. Proposal #456 (ci.yml, the operator's) is the cure.
// Main on bb777b7 (#485) then cancelled e2e 4/4 at 35 min (93 of 118 done, none failed; top-bar-menu's tail, touch,
// touchdown-frame, wedge, wheel-ai-drive and the wreck files unrun) while 1/4 ran 16.3 min (≈ 31 worker-minutes), 2/4 27.7
// and 3/4 22.0. Priced on each test's mean over bb777b7's and 72008ae's main runs, both whole (≈ 211 and ≈ 248
// worker-minutes; a test unrun in one run takes the other's time), 57:97:83:118 is 43.7 / 59.8 / 51.5 / 74.5;
// 68:99:95:93 cuts 68 / 99 / 95 / 93 tests ≈ 53.0 / 59.5 / 57.7 / 59.4 (shard 2 starts at first-landing, 3 at learn,
// 4 at results-header), and no shard of it passes ≈ 66.5 on either run's runners, where 57:97:83:118 reached 82. The
// twelfth re-cut: luck, not headroom. Proposal #456 (ci.yml, the operator's) is the cure.
// Check a cut with `PWTEST_SHARD_WEIGHTS=a:b:c:d npx playwright test --list --shard=N/4`.
// Playwright reads the weights after loading this file. Only for the whole suite: the flake guard
// (scripts/e2e-repeat-changed.mjs) names its spec files and shards those evenly.
// Four weights fit only a total of 4 (Playwright throws on any other), so a hand-run `--shard=1/2` stays even.
const args = process.argv.slice(2);
const wholeSuite = !args.some((a) => /\.spec\.js|^tests\//.test(a));
const quarters = args.some((a, i) => /^--shard=\d+\/4$/.test(a) || (a === '--shard' && /^\d+\/4$/.test(args[i + 1] ?? '')));
if (wholeSuite && quarters) process.env.PWTEST_SHARD_WEIGHTS ??= '68:99:95:93';

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
