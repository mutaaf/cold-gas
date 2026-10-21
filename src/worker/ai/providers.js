// Judge providers. One shape for all: `stream(opts)` is an async generator of
// { type: 'reasoning' | 'text', text } chunks, and returns { inTokens, outTokens, neurons }.
//
// - edge:      Cloudflare Workers AI (an open model on Cloudflare's network; free daily allowance)
// - anthropic: Claude, via the official Anthropic SDK
// - openai, xai, gemini: their OpenAI-compatible endpoints, via the OpenAI SDK
//
// Bring-your-own keys arrive per request and are used for that one call only: never stored,
// never logged. Base URLs are fixed here, so the Worker can't be pointed at anything else.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const EDGE_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-3.1-8b-instruct-fp8'];

// USD per million tokens, where we know it. null = billed by the provider at its own rates.
const PRICES = {
  '@cf/google/gemma-4-26b-a4b-it': [0.1, 0.3],
  '@cf/meta/llama-3.1-8b-instruct-fp8': [0.152, 0.287],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};
export function costUsd(model, inTok, outTok) {
  const p = PRICES[model];
  return p ? (inTok * p[0] + outTok * p[1]) / 1e6 : null;
}

// Preference lists for picking a sensible, cheap, current chat model from a provider's live list.
// Patterns are tried in order; within a pattern the highest version wins.
const PREFER = {
  anthropic: [/^claude-haiku-\d/, /^claude-sonnet-\d/],
  openai: [/^gpt-\d+(\.\d+)?-nano$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d+(\.\d+)?-nano/, /^gpt-\d+(\.\d+)?-mini/, /^gpt-\d/],
  xai: [/^grok-[\d.]+-fast(?!.*(image|vision))/, /fast/, /mini/, /^grok-[\d.]+$/, /^grok/],
  gemini: [/^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash/, /^gemini/],
};
const NOT_CHAT = /(embed|tts|audio|realtime|transcri|whisper|dall|image|vision-preview|moderation|search|sora|video|veo|imagen|aqa|davinci|babbage|instruct$|codex|computer|live|native-audio|robotics|learnlm)/i;

const version = (id) => (id.match(/\d+(\.\d+)?/g) || ['0']).map(Number);
const newer = (a, b) => { const va = version(a), vb = version(b); for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (va[i] || 0) - (vb[i] || 0); if (d) return d > 0; } return a.length < b.length; };

export function pickModel(provider, ids) {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  for (const re of PREFER[provider] || []) {
    const hits = chat.filter((id) => re.test(id) && !/preview|exp|latest|\d{4}-\d{2}-\d{2}|\d{8}/.test(id));
    const pool = hits.length ? hits : chat.filter((id) => re.test(id));
    if (pool.length) return pool.reduce((best, id) => (newer(id, best) ? id : best));
  }
  return chat[0] || null;
}

export const PROVIDERS = {
  edge: { label: 'Cloudflare Edge', vendor: 'Workers AI', needsKey: false },
  anthropic: { label: 'Anthropic', vendor: 'Claude', needsKey: true, fallbackModel: 'claude-haiku-5-5' },
  openai: { label: 'OpenAI', vendor: 'GPT', needsKey: true, baseURL: 'https://api.openai.com/v1' },
  xai: { label: 'xAI', vendor: 'Grok', needsKey: true, baseURL: 'https://api.x.ai/v1' },
  gemini: { label: 'Google', vendor: 'Gemini', needsKey: true, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
};

// --- Listing models (BYOK connect) -----------------------------------------------------------
export async function listModels(provider, key) {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 });
    const ids = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  const p = PROVIDERS[provider];
  const client = new OpenAI({ apiKey: key, baseURL: p.baseURL, maxRetries: 0, timeout: 10_000 });
  const ids = [];
  for await (const m of client.models.list()) ids.push(String(m.id).replace(/^models\//, ''));
  return ids;
}

// --- Streaming ---------------------------------------------------------------------------------
async function* streamEdge({ env, model, messages, signal, maxTokens = 400 }) {
  const body = { messages, stream: true, max_tokens: maxTokens };
  if (/gemma-4|qwen3|glm/.test(model)) body.chat_template_kwargs = { enable_thinking: false };
  const res = await env.AI.run(model, body, { signal });
  const reader = res.getReader();
  const dec = new TextDecoder();
  let buf = '', inTokens = 0, outTokens = 0, neurons = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      const d = j.choices?.[0]?.delta || {};
      if (d.reasoning_content) yield { type: 'reasoning', text: d.reasoning_content };
      const t = d.content ?? j.response;
      if (t) yield { type: 'text', text: t };
      if (j.usage) { inTokens += j.usage.prompt_tokens || 0; outTokens += j.usage.completion_tokens || 0; neurons += j.usage.neurons || 0; }
    }
  }
  return { inTokens, outTokens, neurons };
}

async function* streamAnthropic({ key, model, system, user, maxTokens = 2000 }) {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 30_000 });
  // Cost-effective by design: low effort. Opus/Sonnet 5.5 get the server-side refusal fallback.
  const params = {
    model, max_tokens: maxTokens, system,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: user }],
  };
  const fallback = /^claude-(opus|sonnet)-5-5|^claude-fable/.test(model);
  const stream = fallback
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.messages.stream(params);
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { type: 'text', text: ev.delta.text };
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('The model declined this request.'), { userFacing: true });
  return { inTokens: msg.usage?.input_tokens || 0, outTokens: msg.usage?.output_tokens || 0, neurons: 0 };
}

// No output cap here: a reasoning model's thinking counts against it and could starve the answer.
async function* streamCompatible({ provider, key, model, messages }) {
  const p = PROVIDERS[provider];
  const client = new OpenAI({ apiKey: key, baseURL: p.baseURL, maxRetries: 1, timeout: 30_000 });
  const reasoning = (provider === 'openai' && /^(gpt-5|o\d)/.test(model)) || (provider === 'gemini' && /^gemini-(2\.5|[3-9])/.test(model));
  const base = { model, messages, stream: true };
  if (provider !== 'gemini') base.stream_options = { include_usage: true };
  let stream;
  try {
    stream = await client.chat.completions.create(reasoning ? { ...base, reasoning_effort: 'low' } : base);
  } catch (err) {
    // Some models reject optional parameters; retry once with the bare request.
    if (!(err instanceof OpenAI.BadRequestError)) throw err;
    stream = await client.chat.completions.create({ model, messages, stream: true });
  }
  let inTokens = 0, outTokens = 0;
  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta;
    if (d?.reasoning_content) yield { type: 'reasoning', text: d.reasoning_content };
    if (d?.content) yield { type: 'text', text: d.content };
    if (chunk.usage) { inTokens = chunk.usage.prompt_tokens || inTokens; outTokens = chunk.usage.completion_tokens || outTokens; }
  }
  return { inTokens, outTokens, neurons: 0 };
}

// `maxTokens`: the judges' few lines fit the defaults; the quest designer's JSON needs more.
export function streamJudge({ provider, env, key, model, system, user, signal, maxTokens }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (provider === 'edge') return streamEdge({ env, model, messages, signal, maxTokens });
  if (provider === 'anthropic') return streamAnthropic({ key, model, system, user, maxTokens });
  return streamCompatible({ provider, key, model, messages });
}

// A short, key-free message for the player when a provider call fails.
export function describeError(provider, err) {
  if (err?.userFacing) return err.message;
  const label = PROVIDERS[provider]?.label || provider;
  const status = err?.status;
  if (status === 401 || status === 403) return `${label} rejected the key.`;
  if (status === 404) return `${label} doesn't offer that model to this key.`;
  if (status === 429) return `${label} is rate-limiting this key right now.`;
  if (status === 402) return `${label} says the account is out of credit.`;
  if (err?.name === 'AbortError' || /timed? ?out/i.test(String(err?.message))) return `${label} took too long to answer.`;
  return `${label} couldn't be reached.`;
}
