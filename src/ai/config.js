// Which brain judges the jumps. Stored on this device only (localStorage). A bring-your-own key
// never leaves the browser except as a header on our own /coldgas/api calls, which use it for one
// request to that provider and keep nothing.
const KEY = 'coldgas_ai_v1';

export const PROVIDER_INFO = {
  edge: { label: 'Cloudflare Edge', vendor: 'Workers AI · open model', free: true, keyHint: '' },
  anthropic: { label: 'Anthropic', vendor: 'Claude', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', vendor: 'GPT', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  xai: { label: 'xAI', vendor: 'Grok', keyHint: 'xai-…', keyUrl: 'https://console.x.ai' },
  gemini: { label: 'Google', vendor: 'Gemini', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
};

export const EDGE_DEFAULT = { provider: 'edge', model: '@cf/google/gemma-4-26b-a4b-it' };

export function loadAI() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && PROVIDER_INFO[v.provider] && (v.provider === 'edge' || (v.key && v.model))) return v;
  } catch { /* storage blocked or corrupt */ }
  return { ...EDGE_DEFAULT };
}

export function saveAI(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
}

export function forgetAI() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export const shortModel = (m) => String(m || '').replace(/^@cf\/[^/]+\//, '').replace(/-instruct.*$|-it$/, '');
