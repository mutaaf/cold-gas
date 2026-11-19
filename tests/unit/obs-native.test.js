// 0293: the iPhone app's health batch is the web's `/obs` beacon. tests/fixtures/obs-ios-batch.json is the batch the Swift
// queue builds (ios/Packages/ColdGasCore/Tests/ColdGasClientTests/ObsTests.swift holds it byte for byte), and the Worker's
// own validation must take every entry in it, with the same signatures the web would compute.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanObs } from '../../src/worker/obs.js';
import { hash12, normMessage } from '../../src/obs/signature.js';

const batch = JSON.parse(readFileSync(new URL('../fixtures/obs-ios-batch.json', import.meta.url), 'utf8'));

describe('the iPhone app\'s /obs batch', () => {
  it('passes cleanObs with every entry kept', () => {
    const b = cleanObs(batch);
    expect(b).not.toBeNull();
    expect(b.build).toBe('ios-1.2.0-202611181400');
    expect(b.errs).toHaveLength(batch.errs.length);
    expect(b.rec).toEqual(batch.rec);
    for (const [i, e] of b.errs.entries()) {
      expect(e.fr).toBe(batch.errs[i].fr);   // FRAME_RE took the Swift frame
      expect(e.st).toBe(batch.errs[i].st);
    }
  });
  it('never counts a session or a player (the digest\'s current build stays the web\'s)', () => {
    const b = cleanObs(batch);
    expect(b.first).toBe(false);
    expect(b.play).toEqual({});
  });
  it('signs and normalises each fault as the web does', () => {
    for (const e of batch.errs) {
      expect(normMessage(e.msg)).toBe(e.msg);
      expect(e.sig).toBe(hash12(`${e.msg}|${e.fr}|${batch.build}`));
      expect(e.key).toBe(hash12(`${e.msg}|${e.fr.replace(/:\d+:\d+$/, '')}`));
    }
  });
  it('carries nothing about the device or the player', () => {
    const text = JSON.stringify(batch);
    for (const banned of ['deviceType', 'osVersion', 'region', 'install', 'uuid', 'iPhone', 'initials']) expect(text).not.toContain(banned);
    expect(Object.keys(batch).sort()).toEqual(['auto', 'build', 'dc', 'errs', 'first', 'rec', 'tier', 'v']);
  });
});

// 0300: a session's performance summary and feature use ride the same batch: two rows the Worker keeps as signatures
// (frame `perf@<build>`, `use@<build>`) and the session's frame-time histogram in `fr` (obs_frames). Still never a session.
const session = JSON.parse(readFileSync(new URL('../fixtures/obs-ios-session.json', import.meta.url), 'utf8'));
describe('the iPhone app\'s session summary in the /obs batch (0300)', () => {
  it('passes cleanObs with the summary rows and the histogram kept', () => {
    const b = cleanObs(session);
    expect(b).not.toBeNull();
    expect(b.first).toBe(false);
    expect(b.errs.map((e) => e.fr)).toEqual(['perf@ios-1.2.0-202611181400', 'use@ios-1.2.0-202611181400', 'pipeline@Renderer.swift:1010:0']);
    expect(b.fr).toEqual(session.fr);
    expect(b.fr.n).toBe(b.fr.h.reduce((a, c) => a + c, 0));
  });
  it('keeps every word of the summary through the Worker\'s normalisation', () => {
    for (const e of session.errs) {
      expect(normMessage(e.msg)).toBe(e.msg);
      expect(e.sig).toBe(hash12(`${e.msg}|${e.fr}|${session.build}`));
    }
    expect(session.errs[0].msg).toMatch(/^perf p50_\d+ p95_\d+ hitch_\w+ hz(120|60|mix) look_\w+ scale_\d+ heat_\w+ mem_\w+ launch_\w+$/);
  });
  it('carries nothing about the device or the player', () => {
    const text = JSON.stringify(session);
    for (const banned of ['deviceType', 'osVersion', 'region', 'install', 'uuid', 'iPhone', 'initials', 'model']) expect(text).not.toContain(banned);
    expect(Object.keys(session).sort()).toEqual(['auto', 'build', 'dc', 'errs', 'first', 'fr', 'rec', 'tier', 'v']);
    expect(session.dc).toBe('phone-hi');
  });
});
