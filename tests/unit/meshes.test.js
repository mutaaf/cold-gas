// 0148: the native app's meshes (ios/ColdGas/Resources/Meshes) are current with the web's generators.
// CI runs `npm test`: a change to src/render/roadster.js regenerates them (`node scripts/meshes.mjs`) in the same PR.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('native meshes (0148)', () => {
  it('roadster.bin/json match scripts/meshes.mjs', () => {
    let out = '';
    try { out = execFileSync(process.execPath, ['scripts/meshes.mjs', '--check'], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout) + String(e.stderr); }
    expect(out).toContain('meshes: current');
  }, 60000);
});
