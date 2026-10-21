// SIDE QUESTS: asking the player's AI for one. The free Workers AI model by default, or their own
// key through the existing bring-your-own-key flow (src/ai/config.js: the key stays in this
// browser's localStorage and reaches only our Worker, as the x-cg-key header, for this one call).
// The call runs through the theatre so it's visible and honest (model, tokens, time, cost). What
// comes back is data: the Worker validated it against the schema, and it's validated again here
// before a single piece is placed. If anything fails, the local generator lays out a quest instead.
import { loadAI } from '../ai/config.js';
import { validateQuest } from './quest-schema.js';
import { generateQuest, templateForWish } from './quest-gen.js';

// → { quest, source: 'ai' | 'local', meta }
export async function generateWithAI({ wish = '', arena = 'sandbox', theatreRoot, reduced = false, signal } = {}) {
  const ai = loadAI();
  const seed = `${Date.now() % 1e9}`;
  const clean = String(wish).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 140);
  let out = { quest: null, meta: { provider: ai.provider, model: ai.model } };
  try {
    const mod = await import('../ai/theatre.js');
    out = await mod.runQuestTheatre(theatreRoot, { ai, wish: clean, arena, seed, reduced, abort: signal });
  } catch (err) {
    console.warn('quest theatre', err);
  }
  if (out.aborted) return null;
  if (out.quest) {
    const v = validateQuest(out.quest, { arena });
    if (v.ok) return { quest: { ...v.quest, source: 'ai', model: out.meta?.model || ai.model }, source: 'ai', meta: out.meta };
    out.meta = { ...out.meta, error: `client schema check: ${v.errors[0]}` };
  }
  const quest = generateQuest(seed, { arena, template: templateForWish(clean) || undefined });
  return { quest, source: 'local', meta: out.meta };
}
