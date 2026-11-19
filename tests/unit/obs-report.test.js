// 0293: npm run obs:report, the owner's one screen on production health. It splits the iPhone app's builds (ios-*) from
// the web's, and its exit code is the alert (docs/AUDIT-2026-11-18.md "How the owner sees it").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarize, render, ALERT } from '../../scripts/obs-report.mjs';

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
