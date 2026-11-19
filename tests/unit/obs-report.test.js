// 0293: npm run obs:report, the owner's one screen on production health. It splits the iPhone app's builds (ios-*) from
// the web's, and its exit code is the alert (docs/AUDIT-2026-11-18.md "How the owner sees it").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarize, render, ALERT, parsePerf } from '../../scripts/obs-report.mjs';

const digest = JSON.parse(readFileSync(new URL('../fixtures/obs-digest-ios.json', import.meta.url), 'utf8'));

describe('obs:report', () => {
  it('splits the web from the iPhone by build and orders the iPhone builds newest first', () => {
    const s = summarize(digest);
    expect(s.web.map((r) => r.key)).toEqual(['aaaaaaaaaaaa']);
    expect(s.ios.map((r) => r.key)).toEqual(['bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd']);
    expect(s.iosBuilds).toEqual(['ios-1.2.0-202611181400', 'ios-1.1.0-202611101200']);
  });
  it('pages (exit 2) on enough iPhone hangs; looks (1) at a P1 or the newest build; is quiet (0) otherwise', () => {
    const s = summarize(digest);
    expect(s.exit).toBe(2);   // 6 hangs ≥ 5
    expect(s.alerts.some((a) => a.level === 2 && /hangs/.test(a.why))).toBe(true);
    expect(s.alerts.some((a) => a.level === 1 && /P1 new/.test(a.why))).toBe(true);
    expect(s.alerts.some((a) => a.level === 1 && /ios-1\.2\.0.*crash/.test(a.why))).toBe(true);
    expect(s.alerts.some((a) => /board timeout/.test(a.why))).toBe(false);   // only on the older build
    const calm = summarize({ ...digest, top: digest.top.filter((r) => r.kind !== 'frame'), regressions: [] });
    expect(calm.exit).toBe(1);
    expect(summarize({ top: [], regressions: [] }).exit).toBe(0);
    expect(summarize({ top: [{ ...digest.top[1], n: ALERT.iosCrashes }], regressions: [] }).exit).toBe(2);
    const black = summarize({ top: [{ ...digest.top[3], mod: 'render', kind: 'error', msg: 'renderer: no command queue' }], regressions: [] });
    expect(black.exit).toBe(2);
    expect(summarize({ top: [], regressions: [{ ...digest.regressions[0], severity: 'P0' }] }).exit).toBe(2);
  });
  it('renders one screen', () => {
    const text = render(summarize(digest));
    expect(text).toMatch(/Web: top signatures \(1\)/);
    expect(text).toMatch(/iPhone: top signatures \(3\) · builds ios-1\.2\.0-202611181400, ios-1\.1\.0-202611101200/);
    expect(text).toMatch(/ALERT \(exit 2\)/);
    expect(text).toMatch(/people 120/);
  });
});

// 0300: the iPhone's session summaries ride the same digest as rows `perf@<build>` and `use@<build>`. They're read into a
// per-build table, the features used, and the newest build against the one before it; they're never alerted on as faults.
const perfDigest = JSON.parse(readFileSync(new URL('../fixtures/obs-digest-ios-perf.json', import.meta.url), 'utf8'));
describe('obs:report: the iPhone\'s performance and feature use (0300)', () => {
  it('reads the summary words back', () => {
    expect(parsePerf('perf p50_9 p95_12 hitch_lt1 hz120 look_real scale_100 heat_fair mem_lt500 launch_lt2s'))
      .toEqual({ p50: '9', p95: '12', hitch: 'lt1', hz: '120', look: 'real', scale: '100', heat: 'fair', mem: 'lt500', launch: 'lt2s' });
  });
  it('keeps the summaries out of the faults and builds a table per build', () => {
    const s = summarize(perfDigest);
    expect(s.ios.map((r) => r.key)).toEqual(['ffffffffffff', 'gggggggggggg']);
    expect(s.iosBuilds).toEqual(['ios-1.2.0-202611190900', 'ios-1.2.0-202611181400']);
    const now = s.sessions.builds['ios-1.2.0-202611190900'], before = s.sessions.builds['ios-1.2.0-202611181400'];
    expect(now).toMatchObject({ sessions: 7, p50: '9', p95: '17', hitching: 1, hot: 1, at120: 0.57 });
    expect(before).toMatchObject({ sessions: 6, p95: '12', hitching: 0, hot: 0, at120: 1 });
    expect(s.sessions.features['ios-1.2.0-202611190900']).toEqual({ look_anime: 3, drift_off: 3, roam: 3, roamch: 3, club: 2, replay: 2 });
  });
  it('compares the newest build with the one before and looks (exit 1) when it is slower or hotter', () => {
    const s = summarize(perfDigest);
    expect(s.compare.newest).toBe('ios-1.2.0-202611190900');
    expect(s.compare.previous).toBe('ios-1.2.0-202611181400');
    expect(s.compare.newFaults.map((r) => r.key)).toEqual(['ffffffffffff']);
    expect(s.compare.goneFaults.map((r) => r.key)).toEqual(['gggggggggggg']);
    expect(s.compare.worse).toHaveLength(3);
    expect(s.exit).toBe(1);
    expect(s.alerts.some((a) => /worse than ios-1\.2\.0-202611181400.*p95/.test(a.why))).toBe(true);
    expect(s.alerts.some((a) => /perf p50/.test(a.why))).toBe(false);   // a summary is never a fault
    // Too few sessions to call it: no verdict on frames.
    const few = summarize({ ...perfDigest, top: perfDigest.top.map((r) => (r.fr?.startsWith('perf@') ? { ...r, n: 1 } : r)) });
    expect(few.compare.worse).toEqual([]);
  });
  it('renders the table, the features and the comparison', () => {
    const text = render(summarize(perfDigest));
    expect(text).toMatch(/iPhone: performance by build/);
    expect(text).toMatch(/ios-1\.2\.0-202611190900\s+7\s+≤9\s+≤17\s+100 %\s+100 %\s+57 %/);
    expect(text).toMatch(/features used[\s\S]*look_anime 3/);
    expect(text).toMatch(/newest build ios-1\.2\.0-202611190900 vs ios-1\.2\.0-202611181400/);
    expect(text).toMatch(/new: drive\/error "drive car input not finite"/);
  });
  it('says so when there is nothing yet', () => {
    const text = render(summarize({ top: [], regressions: [] }));
    expect(text).toMatch(/performance by build[^\n]*\n {2}none yet/);
  });
});
