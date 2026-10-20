// "The judges' brain": pick who writes the judges' words. Cloudflare Edge (free, default) or
// bring your own Anthropic / OpenAI / xAI / Gemini key. Connecting asks the provider for its live
// model list and suggests the cheapest current fast model.
import { PROVIDER_INFO, EDGE_DEFAULT, loadAI, saveAI, forgetAI, shortModel } from './config.js';
import { listModels } from './stream.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function aiLabel(ai = loadAI()) {
  return ai.provider === 'edge' ? `AI · ${shortModel(ai.model)}` : `AI · ${PROVIDER_INFO[ai.provider].vendor}`;
}

export function openSettings(root, { onChange } = {}) {
  let cur = loadAI();
  let pick = cur.provider;
  let draft = { key: cur.provider === pick ? cur.key || '' : '', models: null, model: cur.model };
  root.hidden = false;

  const render = () => {
    const info = PROVIDER_INFO[pick];
    root.innerHTML = `
      <div class="sheet ai-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <p class="eyebrow">Settings</p>
        <h2 id="ai-title">The judges’ brain</h2>
        <p class="ai-lede">The game’s own rules decide every score. A language model writes the judges’ remarks, and you choose which one. Every call is shown live in the panel theatre.</p>
        <div class="ai-providers" role="radiogroup">
          ${Object.entries(PROVIDER_INFO).map(([id, p]) => `
            <button type="button" role="radio" class="ai-prov${id === pick ? ' on' : ''}" aria-checked="${id === pick}" data-prov="${id}">
              <b>${p.label}</b><span>${p.vendor}</span>${p.free ? '<i>Free</i>' : ''}${cur.provider === id ? '<em>In use</em>' : ''}
            </button>`).join('')}
        </div>
        ${pick === 'edge' ? `
          <p class="ai-note">Runs <code>${shortModel(EDGE_DEFAULT.model)}</code>, an open mixture-of-experts model, on Cloudflare’s network next to you. It costs about a hundredth of a cent per jump and is paid for from COLD GAS’s free daily allowance. Llama 3.1 8B stands in if it’s busy.</p>` : `
          <label class="ai-field"><span>${info.label} API key</span>
            <input type="password" autocomplete="off" spellcheck="false" placeholder="${info.keyHint}" value="${esc(draft.key)}" data-key />
          </label>
          <p class="ai-note">Your key stays in this browser. Each judging sends it once to COLD GAS’s own server, which calls ${info.label} with it and keeps nothing. <a href="${info.keyUrl}" target="_blank" rel="noopener noreferrer">Get a key ↗</a></p>
          <div class="ai-row"><button type="button" class="btn small" data-connect>Connect</button><span class="ai-msg" data-msg></span></div>
          ${draft.models ? `
            <label class="ai-field"><span>Model</span>
              <select data-model>${draft.models.map((m) => `<option value="${esc(m)}"${m === draft.model ? ' selected' : ''}>${esc(m)}${m === draft.suggested ? ' (suggested)' : ''}</option>`).join('')}</select>
            </label>` : ''}`}
        <div class="actions">
          <button type="button" class="btn primary" data-save ${pick !== 'edge' && !draft.models ? 'disabled' : ''}>Use ${pick === 'edge' ? 'Cloudflare Edge' : info.label}</button>
          ${cur.provider !== 'edge' ? '<button type="button" class="btn ghost" data-forget>Forget my key</button>' : ''}
          <button type="button" class="btn link" data-close>Close</button>
        </div>
      </div>`;
  };
  render();

  const close = () => { root.hidden = true; root.innerHTML = ''; root.onclick = null; root.oninput = null; };
  root.onclick = async (e) => {
    const t = e.target.closest('button');
    if (e.target === root) return close();
    if (!t) return;
    if (t.dataset.prov) {
      pick = t.dataset.prov;
      draft = { key: cur.provider === pick ? cur.key || '' : '', models: null, model: cur.provider === pick ? cur.model : null };
      render();
    } else if (t.hasAttribute('data-connect')) {
      const key = root.querySelector('[data-key]').value.trim();
      const msg = root.querySelector('[data-msg]');
      if (key.length < 8) { msg.textContent = 'Paste a key first.'; return; }
      msg.textContent = 'Asking for its models…';
      t.disabled = true;
      const res = await listModels(pick, key);
      t.disabled = false;
      if (res.error) { msg.textContent = res.error; return; }
      draft = { key, models: res.models.length ? res.models : [res.suggested].filter(Boolean), model: draft.model && res.models.includes(draft.model) ? draft.model : res.suggested, suggested: res.suggested };
      render();
      root.querySelector('[data-msg]').textContent = `Connected. ${res.models.length} models available.`;
    } else if (t.hasAttribute('data-save')) {
      if (pick === 'edge') cur = { ...EDGE_DEFAULT };
      else {
        const model = root.querySelector('[data-model]')?.value || draft.model;
        if (!draft.key || !model) return;
        cur = { provider: pick, key: draft.key, model };
      }
      saveAI(cur);
      onChange?.(cur);
      close();
    } else if (t.hasAttribute('data-forget')) {
      forgetAI();
      cur = { ...EDGE_DEFAULT };
      onChange?.(cur);
      pick = 'edge'; draft = { key: '', models: null, model: null };
      render();
    } else if (t.hasAttribute('data-close')) close();
  };
  root.oninput = (e) => { if (e.target.matches('[data-key]')) draft.key = e.target.value.trim(); };
  addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && !root.hidden) { close(); removeEventListener('keydown', esc); } });
}
