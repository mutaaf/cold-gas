import { describe, it, expect, beforeAll } from 'vitest';

// Pause goes quiet for real (0060): suspend/resume follow the latest wish even though an
// AudioContext's state only changes when its suspend()/resume() promise settles.
class FakeContext {
  constructor() { this.state = 'running'; this.sampleRate = 8000; this.currentTime = 0; this.destination = node(); this.calls = []; }
  resume() { this.calls.push('resume'); return Promise.resolve().then(() => { this.state = 'running'; }); }
  suspend() { this.calls.push('suspend'); return Promise.resolve().then(() => { this.state = 'suspended'; }); }
  createBuffer(_c, n) { return { getChannelData: () => new Float32Array(n) }; }
}
// Every audio node the graph builds: params with a value and setTargetAtTime, connect() chains.
function node() {
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const n = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (t[k] = k === 'connect' ? () => n : k === 'start' || k === 'stop' ? () => {} : param())) });
  return n;
}
for (const m of ['createGain', 'createDynamicsCompressor', 'createOscillator', 'createBiquadFilter', 'createBufferSource']) FakeContext.prototype[m] = node;

let audio, ctx;
const settle = () => new Promise((r) => setTimeout(r, 0));
beforeAll(async () => {
  globalThis.window = { AudioContext: class extends FakeContext { constructor() { super(); ctx = this; } } };
  audio = await import('../../src/audio.js');
  audio.initAudio();
});

describe('audio suspend/resume (0060)', () => {
  it('suspends and resumes', async () => {
    audio.suspendAudio(); await settle();
    expect(audio.audioState()).toBe('suspended');
    audio.resumeAudio(); await settle();
    expect(audio.audioState()).toBe('running');
  });

  it('a gesture on the pause sheet (resume, then quiet again) ends suspended', async () => {
    audio.suspendAudio(); await settle();
    audio.initAudio();      // the gesture's resume, still in flight…
    audio.suspendAudio();   // …when the page decides it should stay quiet
    await settle(); await settle();
    expect(audio.audioState()).toBe('suspended');
  });

  it('hidden and back within a moment ends running', async () => {
    audio.resumeAudio(); await settle();
    audio.suspendAudio();   // in flight: the state still reads 'running'
    audio.resumeAudio();
    await settle(); await settle();
    expect(audio.audioState()).toBe('running');
  });

  it('resumes from Safari\'s interrupted state', async () => {
    ctx.state = 'interrupted';
    audio.initAudio(); await settle();
    expect(audio.audioState()).toBe('running');
  });
});
