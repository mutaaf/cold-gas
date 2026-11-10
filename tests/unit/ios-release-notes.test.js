// The iPhone app's What's new modal reads ios/release-notes/<MARKETING_VERSION>.md (ios/release-notes/README.md): the
// same file TestFlight and the store get. CI has no Xcode, so this guards the current version's notes here too
// (the Swift side: ios/Packages/ColdGasCore/Tests/ColdGasClientTests/WhatsNewTests.swift).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const IOS = join(import.meta.dirname, '../../ios');
const version = readFileSync(join(IOS, 'project.yml'), 'utf8').match(/MARKETING_VERSION:\s*"([^"]+)"/)[1];
const file = join(IOS, 'release-notes', `${version}.md`);

describe(`ios release notes ${version}`, () => {
  it('exist for the current version', () => {
    expect(existsSync(file)).toBe(true);
  });

  const md = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const sections = md.split(/^## /m);
  const intro = sections[0].split('\n').filter((l) => l.trim() && !l.startsWith('# '));
  const highlights = sections.find((s) => /^highlights\s*$/im.test(s.split('\n')[0])) ?? '';
  const callouts = highlights.split('\n').filter((l) => /^[-*] /.test(l));

  it('open with a headline under the title', () => {
    expect(md.startsWith(`# Cold Gas ${version}`)).toBe(true);
    expect(intro[0]?.trim().length).toBeGreaterThan(0);
    expect(intro[0].trim().length).toBeLessThanOrEqual(60);
  });

  it('have 2 to 4 highlight cards: a few words, one short line, an icon', () => {
    expect(callouts.length).toBeGreaterThanOrEqual(2);
    expect(callouts.length).toBeLessThanOrEqual(4);
    for (const c of callouts) {
      const m = c.match(/^[-*] \*\*(.+?)\*\*\s*(.+?)\s*<!--\s*icon:\s*([A-Za-z0-9.]+)\s*(?:,\s*go:\s*([A-Za-z]+)\s*)?-->\s*$/);
      expect(m, c).not.toBeNull();
      expect(m[1].split(' ').length, c).toBeLessThanOrEqual(5);
      expect(m[2].length, c).toBeLessThanOrEqual(90);
      // go: the screen the card opens (ColdGasClient's WhatsNewDestination); optional.
      if (m[4]) expect(['board', 'settings', 'howTo', 'practice'], c).toContain(m[4]);
    }
  });

  it('keep the full notes after the highlights', () => {
    expect(sections.length).toBeGreaterThan(2);
  });
});
