// "The judges' brain": one box, one action. Paste any AI key and it's done: the provider is
// recognised from the key (src/ai/detect.js), the key is checked against the provider's live
// model list, the cheapest current fast model is chosen, and it's saved. No provider picker, no
// Connect button. The model can still be changed under "Advanced".
import { PROVIDER_INFO, EDGE_DEFAULT, loadAI, saveAI, forgetAI, shortModel } from './config.js';
import { listModels } from './stream.js';
import { detectProvider } from './detect.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// claude-haiku-5-5 → Claude Haiku 5.5 · gpt-5.4-nano → GPT-5.4 Nano · @cf/google/gemma-4-26b-a4b-it → Gemma 4
export function nice(m) {
  const id = shortModel(m);
  if (/^gemma-4/.test(id)) return 'Gemma 4';
  if (/^llama-3\.1-8b/.test(id)) return 'Llama 3.1 8B';
  const words = id.replace(/-(\d+)-(\d+)(?=$|-)/g, ' $1.$2').split(/[-\s]+/).filter(Boolean);
  if (words[0] === 'gpt' && words[1]) return `GPT-${words[1]} ${words.slice(2).map(cap).join(' ')}`.trim();
  return words.map(cap).join(' ');
}
const cap = (w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1));

const KEY_STEPS = {
  anthropic: 'Sign in, then Create Key',
  openai: 'Sign in, then Create new secret key',
  xai: 'Sign in, then API Keys, then Create',
  gemini: 'Sign in, then Create API key',
};

export function aiLabel(ai = loadAI()) {
  return ai.provider === 'edge' ? 'AI · Free' : `AI · ${PROVIDER_INFO[ai.provider].vendor}`;
}

export function openSettings(root, { onChange } = {}) {
  let cur = loadAI();
  let state = { phase: 'idle', msg: '', provider: null, models: null };
  let timer = 0, seq = 0;
  root.hidden = false;

  const statusLine = () => cur.provider === 'edge'
    ? `<span class="ai-dot free"></span>Free judges: <b>${esc(nice(cur.model))}</b> on Cloudflare`
    : `<span class="ai-dot"></span>Your ${esc(PROVIDER_INFO[cur.provider].label)} key: <b>${esc(nice(cur.model))}</b>`;

  root.innerHTML = `
    <div class="sheet ai-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-title">
      <div class="ai-top"><h2 id="ai-title">Use your own AI</h2><button type="button" class="btn link" data-close aria-label="Close">Close</button></div>
      <p class="ai-status" data-status>${statusLine()}</p>
      <label class="ai-paste" for="ai-key">
        <span class="ai-paste-label">Paste any AI key</span>
        <span class="ai-paste-row">
          <input id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"
            placeholder="sk-ant-…  sk-…  xai-…  AIza…" data-key />
          <button type="button" class="ai-eye" data-eye aria-label="Show key">Show</button>
          <button type="button" class="btn small" data-clip>Paste</button>
        </span>
      </label>
      <p class="ai-result" data-result aria-live="polite">Works with Anthropic (Claude), OpenAI (GPT), xAI (Grok) and Google (Gemini). We work out which one it is.</p>
      <div class="ai-get">
        <p class="ai-get-title">No key yet? Get one in a minute:</p>
        <div class="ai-get-grid">
          ${['anthropic', 'openai', 'xai', 'gemini'].map((id) => `
            <a class="ai-get-tile" href="${PROVIDER_INFO[id].keyUrl}" target="_blank" rel="noopener noreferrer">
              <b>${PROVIDER_INFO[id].vendor}</b><span>${PROVIDER_INFO[id].label}</span><i>${KEY_STEPS[id]}, then copy it and paste it here ↗</i>
            </a>`).join('')}
        </div>
      </div>
      <p class="ai-privacy">Your key stays in this browser. For each judging it goes once to COLD GAS’s own server, which uses it for that one call and keeps nothing. Your provider bills you, usually a fraction of a cent per jump.</p>
      <div class="actions ai-foot">
        <button type="button" class="btn primary" data-done>Done</button>
        <button type="button" class="btn ghost" data-free ${cur.provider === 'edge' ? 'hidden' : ''}>Use the free judges</button>
        <details class="ai-adv" data-adv ${state.models ? '' : 'hidden'}><summary>Advanced</summary><label class="ai-field"><span>Model</span><select data-model></select></label></details>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const input = $('[data-key]'), result = $('[data-result]');
  setTimeout(() => input.focus(), 50);

  const say = (html, kind = '') => { result.innerHTML = html; result.className = `ai-result ${kind}`; };
  const refreshStatus = () => { $('[data-status]').innerHTML = statusLine(); $('[data-free]').hidden = cur.provider === 'edge'; };

  async function connect(raw) {
    const d = detectProvider(raw);
    if (!d.key) { say('Works with Anthropic (Claude), OpenAI (GPT), xAI (Grok) and Google (Gemini). We work out which one it is.'); return; }
    if (!d.provider) { say(esc(d.reason), 'bad'); return; }
    const info = PROVIDER_INFO[d.provider];
    say(`<span class="ai-spin"></span>That’s ${/^[AEIOU]/.test(info.label) ? 'an' : 'a'} ${esc(info.label)} key. Checking it…`, 'busy');
    const mine = ++seq;
    const res = await listModels('auto', d.key);
    if (mine !== seq) return;   // a newer paste won
    if (res.error) {
      say(`${esc(res.error)} ${/rejected/.test(res.error) ? 'Check you copied the whole key, and that it hasn’t been revoked.' : ''}`, 'bad');
      return;
    }
    const model = res.suggested || res.models[0];
    cur = { provider: res.provider || d.provider, key: d.key, model };
    saveAI(cur);
    onChange?.(cur);
    refreshStatus();
    say(`✓ Done. Your judges now run on <b>${esc(nice(model))}</b> (${esc(info.label)}). Jump to hear them.`, 'ok');
    state.models = res.models;
    const sel = $('[data-model]');
    sel.innerHTML = res.models.map((m) => `<option value="${esc(m)}"${m === model ? ' selected' : ''}>${esc(m)}${m === res.suggested ? ' (cheapest fast, recommended)' : ''}</option>`).join('');
    $('[data-adv]').hidden = false;
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => connect(input.value), 450); });
  input.addEventListener('paste', () => { clearTimeout(timer); setTimeout(() => connect(input.value), 0); });

  const close = () => { clearTimeout(timer); root.hidden = true; root.innerHTML = ''; removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  root.onclick = (e) => { if (e.target === root) close(); };

  $('[data-close]').onclick = close;
  $('[data-done]').onclick = close;
  $('[data-eye]').onclick = (e) => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Hide' : 'Show'; };
  $('[data-clip]').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      input.value = t;
      connect(t);
    } catch {
      say('Your browser blocked reading the clipboard. Tap the box and paste instead.', 'bad');
      input.focus();
    }
  };
  $('[data-free]').onclick = () => {
    forgetAI();
    cur = { ...EDGE_DEFAULT };
    onChange?.(cur);
    refreshStatus();
    input.value = '';
    say('Back on the free judges. Your key has been removed from this browser.', 'ok');
  };
  $('[data-model]').onchange = (e) => {
    cur = { ...cur, model: e.target.value };
    saveAI(cur);
    onChange?.(cur);
    refreshStatus();
  };
}
