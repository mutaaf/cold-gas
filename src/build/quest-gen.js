// SIDE QUESTS: the local generator. Deterministic (a seed in, the same quest out), offline, and
// always schema-valid: it is what runs when no model answers, when a model's JSON fails the
// schema, and behind "Surprise me". Distances come from flights measured on the real physics
// (scripts/build-probe.mjs): a kicker at 22 m/s takes off ≈6 m past its centre, peaks ≈6 m up
// ≈20 m on and lands ≈35 m on; at 25 m/s ≈9 m up and ≈49 m on. A wedge at 22 m/s lands ≈30 m on.
import { validateQuest } from './quest-schema.js';

// mulberry32 over a 32-bit hash of the seed text.
export function rngFrom(seed) {
  let h = 0x9e3779b9;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; }
  let a = h >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}
const q5 = (v) => Math.round(v * 2) / 2;   // the editor's 0.5 m grid

// Each template: (rng, arena) → a raw quest. `wide` is how far sideways it may spread.
const TEMPLATES = {
  rings(r, arena) {
    const wide = arena === 'road' ? 2 : 14, n = r.int(3, 5), pieces = [];
    let z = r.range(30, 45);
    for (let i = 0; i < n; i++) { pieces.push({ t: 'ring', x: q5((i % 2 ? 1 : -1) * r.range(0, wide)), z: q5(z), yaw: 0 }); z += r.range(26, 40); }
    // The last one in the air, off a kicker.
    pieces.push({ t: 'kicker', x: 0, z: q5(z + 10), m: 'wood' });
    pieces.push({ t: 'ring', x: 0, z: q5(z + 32), y: 3, yaw: 0 });
    pieces.push({ t: 'pad', x: 0, z: q5(z + 52), s: 1.5 });
    return {
      title: r.pick(['Thread the Needle', 'Ring Run', 'Through the Hoops', 'Hoop Line']),
      brief: `Drive through ${n} rings on the ground, then fly the last one off the kicker.`,
      pieces, pickups: [{ t: 'nitrogen', x: 0, z: q5(z - 8) }],
      objectives: [{ type: 'rings', count: n + 1 }], timeLimit: 90, reward: 'piece:loop',
    };
  },
  barge(r, arena) {
    const x = arena === 'road' ? 0 : q5(r.range(-10, 10)), k = q5(r.range(40, 70));
    return {
      title: r.pick(['Land on the Barge', 'Deck Landing', 'Barge Drop']),
      brief: 'Hit the kicker at about 90 km/h and put it down on the steel deck.',
      pieces: [{ t: 'kicker', x, z: k, m: 'wood' }, { t: 'barge', x, z: k + 46 }, { t: 'wedge', x, z: k + 46 - 18, yaw: 0, s: 0.75, m: 'steel' }],
      pickups: [{ t: 'magnet', x, z: k - 20 }],
      objectives: [{ type: 'land', target: 1 }], timeLimit: 60, reward: 'paint:ice',
    };
  },
  canyon(r, arena) {
    const k = q5(r.range(45, 70)), n = r.int(3, 5), gap = 6, pieces = [{ t: 'kicker', x: 0, z: k, s: 1.25, m: 'concrete' }];
    for (let i = 0; i < n; i++) pieces.push({ t: 'car', x: arena === 'road' ? 0 : q5((i - (n - 1) / 2) * 2.4), z: q5(k + 14 + (arena === 'road' ? i * gap : 0)), yaw: arena === 'road' ? 90 : 0 });
    pieces.push({ t: 'pad', x: 0, z: k + 50, s: 2 });
    return {
      title: r.pick(['Jump the Canyon', 'Over the Row', 'Clear the Gap']),
      brief: `Clear the parked row: ${n} cars wide. Fly at least 30 m and land it on the mat.`,
      pieces, pickups: [{ t: 'shield', x: 0, z: k - 25 }],
      objectives: [{ type: 'jump', min: 30 }, { type: 'land', target: pieces.length - 1 }], timeLimit: 90, reward: 'piece:halfpipe',
    };
  },
  courier(r, arena) {
    const side = r() < 0.5 ? -1 : 1, wide = arena === 'road' ? 3 : 60;
    const cz = q5(r.range(70, 120)), pz = q5(r.range(200, 280));
    return {
      title: r.pick(['Deliver the Crate', 'Courier Run', 'Special Delivery']),
      brief: 'Grab the crate and get it onto the pad before the clock runs out.',
      pieces: [{ t: 'crate', x: q5(side * r.range(0, wide)), z: cz }, { t: 'pad', x: q5(-side * r.range(0, wide)), z: pz, s: 1.5 }, { t: 'boost', x: 0, z: q5((cz + pz) / 2) }],
      pickups: [{ t: 'overpressure', x: 0, z: q5(cz + 20) }],
      objectives: [{ type: 'deliver', from: 0, to: 1, within: 60 }], timeLimit: 120, reward: 'title:Courier',
    };
  },
  hidden(r, arena) {
    const wide = arena === 'road' ? 4 : 120;
    const x = q5(r.range(-wide, wide)), z = q5(r.range(150, arena === 'road' ? 560 : 300));
    return {
      title: r.pick(['Find the Hidden Ramp', 'Lost Kicker', 'Somewhere Out There']),
      brief: 'A ramp is hidden out there. Follow the pickups, find it, and use it.',
      pieces: [{ t: 'kicker', x, z, hidden: true, yaw: q5(r.range(-45, 45) / 15) * 15, m: 'wood' }],
      pickups: [{ t: 'nitrogen', x: q5(x * 0.3), z: q5(z * 0.3) }, { t: 'fan', x: q5(x * 0.65), z: q5(z * 0.65) }],
      objectives: [{ type: 'find', target: 0 }, { type: 'airtime', min: 1 }], timeLimit: 150, reward: 'paint:sand',
    };
  },
  airshow(r) {
    const k = q5(r.range(50, 80));
    return {
      title: r.pick(['Air Show', 'Full Rotation', 'Roll It']),
      brief: 'Off the big kicker, roll a full 360 on the jets and land it.',
      pieces: [{ t: 'kicker', x: 0, z: k, s: 1.5, m: 'steel' }, { t: 'pad', x: 0, z: k + 55, s: 2 }],
      pickups: [{ t: 'nitrogen', x: 0, z: k - 22 }, { t: 'magnet', x: 0, z: k - 12 }],
      objectives: [{ type: 'flip', count: 1 }, { type: 'airtime', min: 2 }], timeLimit: 75, reward: 'title:Barrel Roller',
    };
  },
  speedtrap(r, arena) {
    const pieces = [], wide = arena === 'road' ? 0 : 3;
    let z = 30;
    for (let i = 0; i < 4; i++) { pieces.push({ t: 'boost', x: q5(r.range(-wide, wide)), z: q5(z) }); z += r.range(35, 55); }
    return {
      title: r.pick(['Speed Trap', 'Boost Line', 'Top End']),
      brief: 'Chain the boost pads and break 200 km/h.',
      pieces, pickups: [{ t: 'overpressure', x: 0, z: q5(z + 10) }],
      objectives: [{ type: 'speed', min: 200 }], timeLimit: 45, reward: 'paint:signal',
    };
  },
  collector(r, arena) {
    const wide = arena === 'road' ? 3 : 90, ids = ['nitrogen', 'fan', 'shield', 'magnet', 'slowmo', 'overpressure'], pickups = [];
    for (let i = 0; i < 5; i++) pickups.push({ t: ids[i % ids.length], x: q5(r.range(-wide, wide)), z: q5(r.range(40, arena === 'road' ? 500 : 280)) });
    return {
      title: r.pick(['Collector', 'Pick Them Up', 'Scavenger']),
      brief: 'Five power-ups are scattered around. Grab them all.',
      pieces: [{ t: 'wedge', x: 0, z: 60 }], pickups,
      objectives: [{ type: 'collect', count: 5 }], timeLimit: 150, reward: 'paint:verdant',
    };
  },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

// A quest from a seed (and optionally a template id), already validated and normalised.
export function generateQuest(seed, { arena = 'sandbox', template } = {}) {
  const r = rngFrom(`${seed}|${arena}`);
  const id = TEMPLATES[template] ? template : r.pick(TEMPLATE_IDS);
  const raw = TEMPLATES[id](r, arena);
  const v = validateQuest(raw, { arena });
  if (!v.ok) throw new Error(`generator template ${id} produced an invalid quest: ${v.errors.join('; ')}`);
  v.quest.source = 'local';
  v.quest.template = id;
  return v.quest;
}

// The handmade board: one of each, fixed seeds, so everyone sees the same opening quests.
export function builtInQuests(arena = 'sandbox') {
  return TEMPLATE_IDS.map((t) => ({ ...generateQuest(`builtin-${t}`, { arena, template: t }), source: 'builtin' }));
}

// Pick a fallback template from a player's wish (so "a canyon jump" offline still gets a canyon).
export function templateForWish(wish = '') {
  const w = String(wish).toLowerCase();
  if (/ring|hoop|thread/.test(w)) return 'rings';
  if (/barge|deck|boat/.test(w)) return 'barge';
  if (/canyon|gap|row|over|clear/.test(w)) return 'canyon';
  if (/crate|deliver|courier/.test(w)) return 'courier';
  if (/hidden|find|secret|lost/.test(w)) return 'hidden';
  if (/roll|flip|spin|air ?show/.test(w)) return 'airshow';
  if (/speed|fast|boost/.test(w)) return 'speedtrap';
  if (/collect|pick|scaveng|power/.test(w)) return 'collector';
  return null;
}
