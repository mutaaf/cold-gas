import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { plan, ticketFor, readTickets } from '../../scripts/heal.mjs';

const reg = (key, over = {}) => ({ status: 'new', severity: 'P0', key, sig: 'abcdefabcdef', mod: 'physics', kind: 'trap', msg: 'RuntimeError: unreachable', fr: 'step@rapier.wasm:0:0', cur: { build: 'b2', n: 9, sessions: 4, rate: 0.09 }, prev: null, stacks: [{ build: 'b2', st: 'step@rapier.wasm:0:0 < stepRun@index.js:1:2' }], ...over });
const frameReg = { status: 'regressed', severity: 'P1', type: 'frames', key: 'frames-phone-lo-mid', dc: 'phone-lo', tier: 'mid',
  cur: { build: 'b2', frames: 5000, p50: 22, p95: 31, p99: 48, hitchesPerKFrames: 3 }, prev: { build: 'b1', frames: 5000, p50: 16, p95: 20, p99: 30, hitchesPerKFrames: 1 } };

describe('scripts/heal.mjs', () => {
  it('dedupes against open tickets, skips dropped ones, and re-files a shipped one that recurs in a newer build', () => {
    const digest = { regressions: [reg('k-open'), reg('k-dropped'), reg('k-shipped'), reg('k-shipped-same', { cur: { build: 'b2', n: 3, sessions: 3, rate: 0.03 } }), reg('k-fresh'), frameReg] };
    const tickets = [
      { id: 40, status: 'ready', key: 'k-open', build: 'b2' }, { id: 41, status: 'dropped', key: 'k-dropped', build: 'b1' },
      { id: 42, status: 'shipped', key: 'k-shipped', build: 'b1', file: '0042-x.md' }, { id: 43, status: 'shipped', key: 'k-shipped-same', build: 'b2' },
    ];
    const p = plan(digest, tickets);
    expect(p.map((x) => x.reg.key)).toEqual(['k-shipped', 'k-fresh', 'frames-phone-lo-mid']);
    expect(p[0].recurredFrom.file).toBe('0042-x.md');
  });

  it('writes tickets in the backlog format: check-backlog accepts them, and heal reads its own marker back', () => {
    const root = mkdtempSync(join(tmpdir(), 'heal-'));
    const dir = join(root, 'docs/backlog');
    mkdirSync(dir, { recursive: true });
    const items = [{ reg: reg('k1') }, { reg: frameReg }, { reg: reg('k2', { status: 'regressed', severity: 'P1', mod: 'judge', kind: 'fetch', msg: 'fetch /api/judge/stream N # 503', prev: { build: 'b1', n: 1, sessions: 1, rate: 0.01 } }), recurredFrom: { file: '0007-old.md' } }];
    items.forEach((it, i) => { const t = ticketFor(it, 90 + i, '2026-10-21'); writeFileSync(join(dir, t.file), t.text); });
    const out = execFileSync('node', [resolve('scripts/check-backlog.mjs')], { cwd: root }).toString();
    expect(out).toMatch(/3 tickets OK \(3 ready\)/);
    const back = readTickets(dir);
    expect(back.map((t) => t.key).sort()).toEqual(['frames-phone-lo-mid', 'k1', 'k2']);
    expect(back.find((t) => t.key === 'k1')).toMatchObject({ status: 'ready', build: 'b2', id: 90 });
    const t = ticketFor(items[0], 90, '2026-10-21');
    expect(t.text).toMatch(/^priority: P0$/m);
    expect(t.text).toContain('rapier.wasm');
  });

  it('every real ticket in the repo still parses (the marker field is optional)', () => {
    expect(readTickets().length).toBeGreaterThan(10);
  });
});
