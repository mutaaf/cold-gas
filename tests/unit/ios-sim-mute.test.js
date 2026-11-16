// A simulator never makes a sound on the Mac (the owner's rule, 2026-11-16; 0268). The app's `-mute` launch flag keeps the
// audio engine off (ios/ColdGas/App/App.swift Launch.mute, ios/ColdGas/Audio/Sound.swift wantsRunning), and every launcher
// in the repo passes it. CI has no Xcode, so this guards the launchers and the flag's wiring here.
import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const IOS = join(import.meta.dirname, '../../ios');
const read = (p) => readFileSync(join(IOS, p), 'utf8');

it('every simctl launch in ios/scripts passes -mute', () => {
  const scripts = readdirSync(join(IOS, 'scripts')).filter((f) => /\.(sh|py|mjs)$/.test(f));
  let launches = 0;
  for (const f of scripts) {
    const lines = read(join('scripts', f)).split('\n').filter((l) => !/^\s*#/.test(l));
    for (const l of lines) {
      if (/simctl launch|'simctl', 'launch'/.test(l)) {
        launches++;
        expect(l, `${f}: ${l.trim()}`).toMatch(/-mute\b|'-mute'/);
      }
    }
  }
  expect(launches).toBeGreaterThanOrEqual(6);
});

it('every UI test launches the app with -mute', () => {
  const dir = join(IOS, 'ColdGasUITests');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.swift'))) {
    for (const l of read(join('ColdGasUITests', f)).split('\n').filter((l) => /launchArguments\s*=/.test(l))) {
      expect(l, f).toContain('"-mute"');
    }
  }
});

it('-mute keeps the audio engine from starting', () => {
  expect(read('ColdGas/App/App.swift')).toMatch(/static let mute = args\.contains\("-mute"\)/);
  const sound = read('ColdGas/Audio/Sound.swift');
  expect(sound).toMatch(/private let muted = Launch\.mute/);
  expect(sound).toMatch(/if muted && !SoundLab\.capturing \{ return false \}/);
});
