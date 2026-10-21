// The quest designer's prompt (POST /coldgas/api/quest). The model writes ONE JSON object in the
// schema of src/build/quest-schema.js; the Worker validates it before it goes anywhere, and the
// browser validates it again. It's data, never code: a closed set of keys, catalogue pieces,
// numbers inside bounds, a budget.
import { schemaBrief } from '../../build/quest-schema.js';

export const QUEST_MAX_TOKENS = 1400;

export function questSystem(arena) {
  return [
    'You design one short side quest for a driving game. The car is a fast electric roadster with a suction fan and ten cold-gas thrusters: it can hop, fly a little and roll in the air, then land.',
    arena === 'road'
      ? 'The arena is a real mountain or coast road: z runs along the road ahead, x is the offset from its centreline (the road is ~7 m wide), so keep x small.'
      : 'The arena is a flat 400 m concrete apron (the Sandbox): lots of room to spread out.',
    schemaBrief(arena),
    'Make it specific, fun and winnable in under two minutes. Name it like a magazine headline, no real brands, vehicles, places or people. Output only the JSON object.',
  ].join('\n\n');
}

// The player's wish is untrusted text: it only ever shapes what the model is asked for, and the
// schema decides what comes back.
export function questUser({ arena, wish, seed }) {
  const w = String(wish || '').replace(/[\u0000-\u001f"<>`]/g, ' ').trim().slice(0, 140);
  return `Arena: ${arena}. Variation seed: ${seed}.\n${w ? `The player asks for: "${w}"` : 'The player asked for a surprise.'}\nReply with the quest JSON only.`;
}
