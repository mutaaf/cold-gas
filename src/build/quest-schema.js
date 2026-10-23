// SIDE QUESTS: the quest format, and the one gate every quest passes through, wherever it came
// from (handmade, the local generator, or a model on the player's key). Pure, shared with the
// Worker: the server validates what a model wrote before it ever reaches a browser, and the
// browser validates it again before anything is placed. A quest is DATA, never code: a closed set
// of keys, pieces from the catalogue, numbers inside bounds, a budget. Anything else is rejected
// and the local generator (src/build/quest-gen.js) steps in.
//
// The frame: the quest's anchor is where the car starts it, facing +z.
//   x  metres to the driver's RIGHT (+) or left (−)        z  metres ahead
//   y  metres above the ground (0 = on it)                  yaw  degrees, 0 = facing the way the
//                                                                car drives, + = turned right
// On a real road the frame follows the road: z is distance along it, x the offset from the
// centreline, yaw relative to the road's heading there.
import { PIECES, PIECE_IDS, POWERUPS, POWERUP_IDS, MATERIAL_IDS, PAINTS, BUDGET, SCALE } from './catalogue.js';

export const QUEST_VERSION = 1;
export const BOUNDS = {
  sandbox: { x: [-150, 150], z: [0, 320], y: [0, 30] },
  road: { x: [-14, 14], z: [0, 600], y: [0, 30] },
};
export const OBJECTIVES = {
  rings: { count: [1, 12] },
  land: { target: 'index' },
  jump: { min: [5, 120] },
  airtime: { min: [0.5, 12] },
  flip: { count: [1, 4] },
  speed: { min: [30, 400] },
  deliver: { from: 'index', to: 'index', within: [10, 300] },
  find: { target: 'index' },
  collect: { count: [1, 8] },
};
const LANDABLE = new Set(['pad', 'barge', 'block']);
// id, source and template are ours (a stored quest): ignored here and recomputed.
const TOP_KEYS = new Set(['v', 'title', 'brief', 'pieces', 'pickups', 'objectives', 'timeLimit', 'reward', 'id', 'source', 'template']);
const PIECE_KEYS = new Set(['t', 'x', 'y', 'z', 'yaw', 's', 'm', 'hidden']);
const PICKUP_KEYS = new Set(['t', 'x', 'y', 'z']);

// Words a quest may never carry (invariant: no real brands, products or people). Lower case.
const BRANDS = /\b(tesla|spacex|elon|musk|ford|ferrari|porsche|lamborghini|bmw|mercedes|benz|audi|toyota|honda|nissan|chevrolet|chevy|dodge|jeep|hyundai|kia|volkswagen|vw|volvo|mclaren|bugatti|rivian|lucid|cybertruck|red ?bull|monster energy|hot ?wheels|fortnite|minecraft|roblox|nike|adidas|mario|sonic|disney|marvel|pokemon|gta|rocket league|top gear)\b/i;
const TEXT_OK = /^[\p{L}\p{N} .,:;!?'’"()&+\-–—/°%#]*$/u;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const inR = (v, [a, b]) => num(v) && v >= a && v <= b;

// Pull the first JSON object out of a model's text (it may wrap it in a code fence or a sentence).
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

function checkText(v, field, min, max, errs) {
  if (typeof v !== 'string') { errs.push(`${field} must be text`); return ''; }
  const t = v.trim();
  if (t.length < min || t.length > max) errs.push(`${field} must be ${min}–${max} characters`);
  if (!TEXT_OK.test(t)) errs.push(`${field} has characters that aren't allowed`);
  if (BRANDS.test(t)) errs.push(`${field} names a real brand or person`);
  return t;
}

// → { ok: true, quest } (normalised: defaults filled, an id) or { ok: false, errors: [...] }.
// `arena`: 'sandbox' | 'road'.
export function validateQuest(input, { arena = 'sandbox' } = {}) {
  const errs = [];
  let q = input;
  if (typeof q === 'string') { try { q = JSON.parse(q); } catch { return { ok: false, errors: ['not valid JSON'] }; } }
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { ok: false, errors: ['a quest is a JSON object'] };
  const B = BOUNDS[arena] || BOUNDS.sandbox;
  for (const k of Object.keys(q)) if (!TOP_KEYS.has(k)) errs.push(`unknown key "${k}"`);
  if (q.v != null && q.v !== QUEST_VERSION) errs.push('unsupported version');
  const title = checkText(q.title, 'title', 3, 48, errs);
  const brief = q.brief == null ? '' : checkText(q.brief, 'brief', 0, 160, errs);

  // Pieces.
  const pieces = [];
  if (!Array.isArray(q.pieces)) errs.push('pieces must be a list');
  else {
    if (q.pieces.length > BUDGET.questPieces) errs.push(`too many pieces (${q.pieces.length} > ${BUDGET.questPieces})`);
    let cost = 0;
    q.pieces.slice(0, 64).forEach((p, i) => {
      const at = `pieces[${i}]`;
      if (!p || typeof p !== 'object' || Array.isArray(p)) { errs.push(`${at} must be an object`); return; }
      for (const k of Object.keys(p)) if (!PIECE_KEYS.has(k)) errs.push(`${at}: unknown key "${k}"`);
      const def = PIECES[p.t];
      if (!def) { errs.push(`${at}: "${p.t}" isn't in the catalogue`); return; }
      cost += def.cost;
      if (!inR(p.x, B.x)) errs.push(`${at}: x out of bounds`);
      if (!inR(p.z, B.z)) errs.push(`${at}: z out of bounds`);
      if (p.y != null && !inR(p.y, B.y)) errs.push(`${at}: y out of bounds`);
      if (p.yaw != null && !inR(p.yaw, [-360, 360])) errs.push(`${at}: yaw out of range`);
      if (p.s != null && !inR(p.s, [SCALE.min, SCALE.max])) errs.push(`${at}: scale out of range`);
      if (p.m != null && !MATERIAL_IDS.includes(p.m)) errs.push(`${at}: unknown material "${p.m}"`);
      if (p.hidden != null && typeof p.hidden !== 'boolean') errs.push(`${at}: hidden must be true or false`);
      pieces.push({ t: p.t, x: p.x, z: p.z, y: p.y ?? 0, yaw: p.yaw ?? 0, s: p.s ?? 1, m: p.m ?? def.mat ?? 'concrete', hidden: !!p.hidden });
    });
    if (cost > BUDGET.questCost) errs.push(`over budget (${cost} > ${BUDGET.questCost})`);
  }

  // Pick-ups.
  const pickups = [];
  if (q.pickups != null) {
    if (!Array.isArray(q.pickups)) errs.push('pickups must be a list');
    else {
      if (q.pickups.length > BUDGET.questPickups) errs.push(`too many pickups (${q.pickups.length} > ${BUDGET.questPickups})`);
      q.pickups.slice(0, 32).forEach((p, i) => {
        const at = `pickups[${i}]`;
        if (!p || typeof p !== 'object' || Array.isArray(p)) { errs.push(`${at} must be an object`); return; }
        for (const k of Object.keys(p)) if (!PICKUP_KEYS.has(k)) errs.push(`${at}: unknown key "${k}"`);
        if (!POWERUPS[p.t]) { errs.push(`${at}: "${p.t}" isn't a power-up`); return; }
        if (!inR(p.x, B.x)) errs.push(`${at}: x out of bounds`);
        if (!inR(p.z, B.z)) errs.push(`${at}: z out of bounds`);
        if (p.y != null && !inR(p.y, B.y)) errs.push(`${at}: y out of bounds`);
        pickups.push({ t: p.t, x: p.x, z: p.z, y: p.y ?? 0 });
      });
    }
  }

  // Objectives.
  const objectives = [];
  if (!Array.isArray(q.objectives) || q.objectives.length < 1) errs.push('at least one objective');
  else {
    if (q.objectives.length > BUDGET.objectives) errs.push(`too many objectives (${q.objectives.length} > ${BUDGET.objectives})`);
    q.objectives.slice(0, 8).forEach((o, i) => {
      const at = `objectives[${i}]`;
      if (!o || typeof o !== 'object' || Array.isArray(o)) { errs.push(`${at} must be an object`); return; }
      const spec = OBJECTIVES[o.type];
      if (!spec) { errs.push(`${at}: unknown type "${o.type}"`); return; }
      for (const k of Object.keys(o)) if (k !== 'type' && !(k in spec)) errs.push(`${at}: unknown key "${k}"`);
      const out = { type: o.type };
      for (const [k, rule] of Object.entries(spec)) {
        const v = o[k];
        if (rule === 'index') {
          if (!Number.isInteger(v) || v < 0 || v >= pieces.length) { errs.push(`${at}: ${k} must name a piece by its index`); continue; }
        } else if (!inR(v, rule)) { errs.push(`${at}: ${k} must be ${rule[0]}–${rule[1]}`); continue; }
        out[k] = v;
      }
      // Cross-checks: the objective must be completable with what the quest places.
      const tOf = (k) => pieces[out[k]]?.t;
      if (o.type === 'rings' && out.count != null && pieces.filter((p) => p.t === 'ring').length < out.count) errs.push(`${at}: needs ${out.count} rings, has ${pieces.filter((p) => p.t === 'ring').length}`);
      if (o.type === 'land' && out.target != null && !LANDABLE.has(tOf('target'))) errs.push(`${at}: can't land on a ${tOf('target')}`);
      if (o.type === 'deliver' && out.from != null && tOf('from') !== 'crate') errs.push(`${at}: from must be a crate`);
      if (o.type === 'deliver' && out.to != null && !LANDABLE.has(tOf('to'))) errs.push(`${at}: deliver to a pad, barge or block`);
      if (o.type === 'find' && out.target != null && !pieces[out.target]?.hidden) errs.push(`${at}: the piece to find must be hidden`);
      if (o.type === 'collect' && out.count != null && out.count > pickups.length) errs.push(`${at}: collect ${out.count} but only ${pickups.length} pickups`);
      objectives.push(out);
    });
  }

  let timeLimit = null;
  if (q.timeLimit != null) { if (!inR(q.timeLimit, [15, 600])) errs.push('timeLimit must be 15–600 s'); else timeLimit = q.timeLimit; }

  let reward = null;
  if (q.reward != null) {
    const m = typeof q.reward === 'string' ? /^(piece|paint|title):(.+)$/.exec(q.reward) : null;
    if (!m) errs.push('reward must be piece:<id>, paint:<id> or title:<words>');
    else if (m[1] === 'piece' && !PIECES[m[2]]?.locked) errs.push(`reward: "${m[2]}" isn't an unlockable piece`);
    else if (m[1] === 'paint' && (!PAINTS[m[2]] || PAINTS[m[2]].base)) errs.push(`reward: "${m[2]}" isn't an unlockable paint`);
    else if (m[1] === 'title') { const t = checkText(m[2], 'reward title', 2, 24, errs); reward = `title:${t}`; }
    else reward = q.reward;
  }

  if (errs.length) return { ok: false, errors: [...new Set(errs)].slice(0, 12) };
  const quest = { v: QUEST_VERSION, title, brief, pieces, pickups, objectives, timeLimit, reward };
  quest.id = questId(quest);
  return { ok: true, quest };
}

// A stable id from the content (FNV-1a over the canonical JSON): the same quest is the same quest.
export function questId(q) {
  const s = JSON.stringify([q.title, q.pieces, q.pickups, q.objectives, q.timeLimit, q.reward]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `q${h.toString(36)}`;
}

// The schema as the model reads it (the Worker's system prompt and the docs share this text).
export function schemaBrief(arena = 'sandbox') {
  const B = BOUNDS[arena] || BOUNDS.sandbox;
  return [
    'Reply with ONE JSON object and nothing else. Keys:',
    '{"title": 3–48 chars, "brief": ≤160 chars, "pieces": [...], "pickups": [...], "objectives": [...], "timeLimit": seconds (optional, 15–600), "reward": optional}',
    `piece: {"t": one of ${PIECE_IDS.join('|')}, "x": ${B.x[0]}..${B.x[1]} (metres right of the car; left is negative), "z": ${B.z[0]}..${B.z[1]} (metres ahead), "y": 0..30 (metres above ground, optional), "yaw": degrees (0 = facing the car's way), "s": scale ${SCALE.min}..${SCALE.max}, "m": ${MATERIAL_IDS.join('|')}, "hidden": true|false}`,
    `pieces: ${Object.values(PIECES).map((p) => `${p.id} (${p.blurb})`).join('; ')}`,
    `pickup: {"t": one of ${POWERUP_IDS.join('|')}, "x", "z", "y"}`,
    'objectives (1–4): {"type":"rings","count":n} (needs n ring pieces; a ring is centred 3.4 m up so you can drive through it; y raises it) · {"type":"land","target":<piece index of a pad|barge|block>} · {"type":"jump","min":metres} · {"type":"airtime","min":seconds} · {"type":"flip","count":rolls} · {"type":"speed","min":km/h} · {"type":"deliver","from":<crate index>,"to":<pad|barge|block index>,"within":seconds} · {"type":"find","target":<index of a hidden piece>} · {"type":"collect","count":n}',
    `reward: "piece:${PIECE_IDS.filter((id) => PIECES[id].locked).join('|')}" or "paint:${Object.keys(PAINTS).filter((id) => !PAINTS[id].base).join('|')}" or "title:<2–24 chars>"`,
    `Budget: at most ${BUDGET.questPieces} pieces costing ≤ ${BUDGET.questCost} (loop 4, half-pipe 3, quarter-pipe and barge 2, others 1), ≤ ${BUDGET.questPickups} pickups.`,
    'Physics: the car does ~25 m/s; a kicker at that speed flies ≈ 40 m and 6 m high; a wedge ≈ 30 m. Put landing pads or barges where the car comes down. The jets only lift the car near the ground (none from 12 m up), so anything higher than ~10 m must be reached off a ramp. No brand names.',
  ].join('\n');
}
