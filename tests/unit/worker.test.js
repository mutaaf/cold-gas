import { describe, it, expect } from 'vitest';
import worker from '../../src/worker/index.js';
import { parseWords, userPrompt, complete } from '../../src/worker/ai/prompt.js';
import { pickModel, costUsd } from '../../src/worker/ai/providers.js';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';

function referenceLog() {
  const run = createRun(); const ap = createAutopilot();
  while (run.phase !== 'done') stepRun(run, ap(run));
  return { log: run.inputLog, card: scoreRun(run.t, { assist: true }) };
}

// A fake Workers AI binding that streams an OpenAI-style SSE body.
function fakeAI(text, { fail = false } = {}) {
  return {
    async run(model) {
      if (fail && model.includes('gemma')) throw Object.assign(new Error('capacity'), { status: 503 });
      const enc = new TextEncoder();
      const chunks = text.match(/.{1,7}/gs).map((t, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }], usage: { prompt_tokens: i === 0 ? 300 : 0, completion_tokens: 2, neurons: 0.1 } })}\n\n`);
      return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
    },
  };
}

async function readSSE(res) {
  const text = await res.text();
  return text.trim().split('\n\n').map((block) => {
    const ev = block.match(/^event: (.+)$/m)?.[1];
    const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] || 'null');
    return { ev, data };
  });
}

const REPLY = 'HEADLINE: Stuck clean at blue hour\nENGINEER: Sink 1.3 m/s, four wheels in 33 ms. Sign it off.\nCOORDINATOR: Eight metres and a full roll. That is the shot.\nDESIGNER: Fifty-three percent in reserve. Quiet and exact.';

describe('judge prompt', () => {
  it('parses four labelled lines, tolerating markdown and case', () => {
    const w = parseWords('**Headline:** Big air\n- engineer: Tidy.\nCOORDINATOR - Wow.\nDesigner: Clean.');
    expect(w).toEqual({ headline: 'Big air', engineer: 'Tidy.', coordinator: 'Wow.', designer: 'Clean.' });
    expect(complete(w)).toBe(true);
  });
  it('builds a facts prompt with no score the AI could change', () => {
    const { card } = referenceLog();
    const p = userPrompt(card);
    expect(p).toContain(`Total ${card.total}/100`);
    expect(p).toContain('roll');
  });
});

describe('model picking', () => {
  it('prefers the cheapest current chat model per provider', () => {
    expect(pickModel('openai', ['gpt-4.1', 'gpt-5-mini', 'gpt-5.4-nano', 'gpt-5.4-mini', 'text-embedding-3-large', 'gpt-5.4-nano-2026-03-01'])).toBe('gpt-5.4-nano');
    expect(pickModel('gemini', ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-pro', 'text-embedding-004'])).toBe('gemini-3.5-flash-lite');
    expect(pickModel('xai', ['grok-4.7', 'grok-4.1-fast', 'grok-2-image'])).toBe('grok-4.1-fast');
    expect(pickModel('anthropic', ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5'])).toBe('claude-haiku-5-5');
  });
  it('prices known models and leaves unknown ones to the provider', () => {
    expect(costUsd('@cf/google/gemma-4-26b-a4b-it', 1e6, 0)).toBeCloseTo(0.1);
    expect(costUsd('gpt-unknown', 100, 100)).toBeNull();
  });
});

describe('POST /judge/stream (edge)', () => {
  const ctx = { waitUntil: (p) => p };
  const req = (body, headers = {}) => new Request('https://x/coldgas/api/judge/stream', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('verifies the run, streams the words, and reports usage', async () => {
    const { log, card } = referenceLog();
    const res = await worker.fetch(req({ log, assist: true }), { AI: fakeAI(REPLY) }, ctx);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSSE(res);
    const names = events.map((e) => e.ev);
    expect(names[0]).toBe('verify');
    expect(events[0].data.card.total).toBe(card.total);
    expect(names).toContain('prompt');
    expect(names.filter((n) => n === 'token').length).toBeGreaterThan(5);
    const done = events.find((e) => e.ev === 'done').data;
    expect(done.words.engineer).toContain('four wheels');
    expect(done.inTokens).toBe(300);
    expect(done.neurons).toBeGreaterThan(0);
    expect(done.costUsd).toBeGreaterThan(0);
  });

  it('falls back to the second edge model when the first is unavailable', async () => {
    const { log } = referenceLog();
    const events = await readSSE(await worker.fetch(req({ log }), { AI: fakeAI(REPLY, { fail: true }) }, ctx));
    const done = events.find((e) => e.ev === 'done').data;
    expect(done.model).toContain('llama');
  });

  it('rejects a BYOK call without a usable key, and bad logs', async () => {
    const { log } = referenceLog();
    expect((await worker.fetch(req({ log, provider: 'openai' }), {}, ctx)).status).toBe(400);
    expect((await worker.fetch(req({ log: [[0, 1]] }), { AI: fakeAI(REPLY) }, ctx)).status).toBe(400);
  });
});

import { detectProvider, cleanKey } from '../../src/ai/detect.js';
describe('caveman key detection', () => {
  it('knows each provider by the shape of its key', () => {
    expect(detectProvider('sk-ant-api03-' + 'a'.repeat(40)).provider).toBe('anthropic');
    expect(detectProvider('sk-proj-' + 'b'.repeat(40)).provider).toBe('openai');
    expect(detectProvider('sk-' + 'c'.repeat(40)).provider).toBe('openai');
    expect(detectProvider('xai-' + 'd'.repeat(40)).provider).toBe('xai');
    expect(detectProvider('AIza' + 'e'.repeat(35)).provider).toBe('gemini');
  });
  it('forgives sloppy pastes', () => {
    expect(cleanKey('  "Bearer sk-ant-xyz"\n')).toBe('sk-ant-xyz');
    expect(cleanKey('ANTHROPIC_API_KEY=sk-ant-xyz')).toBe('sk-ant-xyz');
  });
  it('explains look-alikes instead of failing', () => {
    expect(detectProvider('gsk_' + 'x'.repeat(40)).reason).toMatch(/Groq/);
    expect(detectProvider('ghp_' + 'x'.repeat(36)).reason).toMatch(/GitHub/);
    expect(detectProvider('abc').reason).toMatch(/too short/);
  });
});

import { nice } from '../../src/ai/settings.js';
describe('model display names', () => {
  it('reads like a person wrote it', () => {
    expect(nice('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(nice('gpt-5.4-nano')).toBe('GPT-5.4 Nano');
    expect(nice('grok-4.1-fast')).toBe('Grok 4.1 Fast');
    expect(nice('gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite');
    expect(nice('@cf/google/gemma-4-26b-a4b-it')).toBe('Gemma 4');
  });
});
