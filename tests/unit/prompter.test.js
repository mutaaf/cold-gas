import { describe, it, expect } from 'vitest';
import { describeError, streamJudge } from '../../src/worker/ai/providers.js';

describe('the free judges through Prompter', () => {
  it("say plainly when today's shared allowance is used up", () => {
    const err = new Error("Prompter: today's shared AI allowance for cold-gas is used up. It resets at 00:00 UTC.");
    expect(describeError('edge', err)).toMatch(/resting until 00:00 UTC/);
  });

  it('pass no AbortSignal across the binding, and still time out', async () => {
    let args;
    const env = { AI: { run: async (...a) => { args = a; return new ReadableStream({ pull() { /* never answers */ } }); } } };
    const abort = new AbortController();
    const it = streamJudge({ provider: 'edge', env, model: '@cf/google/gemma-4-26b-a4b-it', system: 's', user: 'u', signal: abort.signal });
    const pending = it.next();
    setTimeout(() => abort.abort(), 10);
    await expect(pending).rejects.toThrow(/timed out/);
    expect(args.length).toBe(2);
  });
});
