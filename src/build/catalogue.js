// BUILD: the catalogue. Every piece a player (or a quest, or the AI generator) can put in the
// world, every material it can be made of, and every arcade power-up. Pure data: the colliders
// (src/build/colliders.js), the renderer (src/build/render.js), the encoder, the quest schema and
// the Worker's prompt all read these same numbers, so what you see is what you drive on and what
// the AI is allowed to ask for.
//
// A piece's local frame: origin at the centre of its footprint on the ground, +z forward (the way
// you drive onto it), +y up, +x the driver's LEFT (the sim's frame, src/sim/vehicle.js). Sizes are
// at scale 1, metres. Everything below the ground line is a 0.6 m skirt, so a piece set on a slope
// is buried a little rather than floating.
//
// This is the ARCADE layer: it only ever exists in Free Drive and the Sandbox. The scored events
// (the Show, the Wall, the Lineup) never see a piece or a power-up.

export const SKIRT = 0.6;

// Surface materials. grip multiplies the tyre's μ; slide is bodywork scraping across it (the same
// two numbers src/sim/courses.js MATERIALS carries). ESTIMATES relative to sealed concrete (1.0):
// bare steel plate holds a tyre at μ ≈ 0.6–0.7 of concrete and lets a sill skate (≈0.25); sealed
// plywood ≈ 0.8, and sliding on it is woody (0.45); a rubber landing mat grips harder than
// concrete (≈1.1) and grabs a sliding body (0.9).
export const BUILD_MATERIALS = {
  concrete: { id: 'concrete', name: 'Concrete', grip: 1, slide: 0.5, color: 0xb9bcc0 },
  steel: { id: 'steel', name: 'Steel', grip: 0.65, slide: 0.25, color: 0x8e959d },
  wood: { id: 'wood', name: 'Wood', grip: 0.8, slide: 0.45, color: 0xa47a4f },
  rubber: { id: 'rubber', name: 'Rubber', grip: 1.1, slide: 0.9, color: 0x26282c },
};
export const MATERIAL_IDS = Object.keys(BUILD_MATERIALS);

// The pieces. `shape` names a collider in src/build/colliders.js with its dimensions; `cost` counts
// against a build's budget; `sensor` pieces have no collider (you pass through them); `locked`
// pieces are unlocked by finishing quests (src/build/quests.js). `solid: 'obstacle'` tells the
// crash code it is a wall rather than ground. `body` pieces are loose: a rigid body of their own
// (src/sim/props.js: mass, inertia, colliders, materials) that a car knocks, rolls and slides; their
// `shape` is only their footprint for placing them.
export const PIECES = {
  kicker: { id: 'kicker', name: 'Kicker', key: '1', cost: 1, mat: 'wood', shape: { kind: 'kicker', len: 6, h: 1.6, w: 4 }, blurb: 'A curved launch ramp: 1.6 m, lip at ≈28°.' },
  wedge: { id: 'wedge', name: 'Wedge', key: '2', cost: 1, mat: 'concrete', shape: { kind: 'wedge', len: 8, h: 2, w: 4 }, blurb: 'A straight 14° ramp. Up it, or land down it.' },
  quarter: { id: 'quarter', name: 'Quarter-pipe', key: '3', cost: 2, mat: 'concrete', shape: { kind: 'quarter', r: 5, deck: 1.5, w: 5 }, blurb: 'A 5 m arc to vertical. Go up, come back down.' },
  halfpipe: { id: 'halfpipe', name: 'Half-pipe', key: '4', cost: 3, mat: 'concrete', locked: true, shape: { kind: 'halfpipe', r: 4, flat: 4, deck: 1.2, len: 24 }, blurb: 'Two 4 m walls facing each other, 24 m long.' },
  loop: { id: 'loop', name: 'Loop', key: '5', cost: 4, mat: 'steel', locked: true, shape: { kind: 'loop', r: 9, w: 3.6, t: 0.5, rail: 0.6 }, blurb: 'An 18 m loop with guide rails. Enter on the left lane at 90 km/h or more.' },
  block: { id: 'block', name: 'Wall', key: '6', cost: 1, mat: 'concrete', solid: 'obstacle', shape: { kind: 'box', w: 4, h: 1.5, d: 1 }, blurb: 'A 4 m concrete block. Stack them.' },
  boost: { id: 'boost', name: 'Boost pad', key: '7', cost: 1, mat: 'rubber', sensor: true, shape: { kind: 'pad', w: 3, d: 4 }, blurb: 'Drive over it: +8 m/s the way the arrows point.' },
  pad: { id: 'pad', name: 'Landing pad', key: '8', cost: 1, mat: 'rubber', shape: { kind: 'box', w: 10, h: 0.1, d: 10 }, blurb: 'A 10 m rubber mat that grips the landing.' },
  ring: { id: 'ring', name: 'Ring', key: '9', cost: 1, sensor: true, shape: { kind: 'ring', r: 3.2, tube: 0.14, lift: 3.4 }, blurb: 'Fly through it. Quests count them.' },
  car: { id: 'car', name: 'Parked car', key: '0', cost: 1, mat: 'concrete', solid: 'obstacle', locked: true, body: 'parked', shape: { kind: 'box', w: 1.85, h: 1.44, d: 4.72 }, blurb: 'A parked sedan to clear: 1.7 t on its springs, brake set. Hit it and it moves.' },
  barge: { id: 'barge', name: 'Barge', key: '-', cost: 2, mat: 'steel', shape: { kind: 'box', w: 9, h: 1.4, d: 22 }, blurb: 'A 22 m steel deck. Land on it.' },
  crate: { id: 'crate', name: 'Crate', key: '=', cost: 1, sensor: true, shape: { kind: 'crate', s: 1.1 }, blurb: 'Pick it up by driving into it; deliver it.' },
  cone: { id: 'cone', name: 'Cone', key: '[', cost: 1, mat: 'rubber', body: 'cone', shape: { kind: 'box', w: 0.36, h: 0.71, d: 0.36 }, blurb: 'A 71 cm traffic cone, 3.2 kg. Slalom it, or send it flying.' },
  barrier: { id: 'barrier', name: 'Barrier', key: ']', cost: 1, mat: 'rubber', body: 'barrier', shape: { kind: 'box', w: 1.83, h: 0.81, d: 0.46 }, blurb: 'A 1.8 m plastic road barrier, empty: 34 kg. It gives.' },
};
export const PIECE_IDS = Object.keys(PIECES);
export const PIECE_INDEX = Object.fromEntries(PIECE_IDS.map((id, i) => [id, i]));

// Power-ups: arcade only, opt-in, never in a scored event. `s` is how long it lasts (0: instant).
export const POWERUPS = {
  nitrogen: { id: 'nitrogen', name: 'Nitrogen', s: 0, color: 0xbfe6ff, blurb: 'Tanks refilled to full.' },
  overpressure: { id: 'overpressure', name: 'Overpressure', s: 3, color: 0xff5a4f, blurb: 'The regulator opens up: rear jets lit, gas free, +0.5 g.' },
  fan: { id: 'fan', name: 'Fan overdrive', s: 10, color: 0x9ff0c8, blurb: 'Fan on and doubled: +1 g of suction.' },
  slowmo: { id: 'slowmo', name: 'Slow-mo', s: 6, color: 0xd8c7ff, blurb: 'Time at 0.35×.' },
  magnet: { id: 'magnet', name: 'Magnet landing', s: 8, color: 0xffd27a, blurb: 'In the air: levels the car and pulls it down, gas free.' },
  shield: { id: 'shield', name: 'Shield', s: 8, color: 0x7ad7ff, blurb: 'No damage: hits and dents don’t register.' },
};
export const POWERUP_IDS = Object.keys(POWERUPS);

// Budgets. A player's build, and what a quest (handmade, local or AI) may place.
export const BUDGET = { build: 80, questCost: 30, questPieces: 24, questPickups: 8, objectives: 4 };
export const SCALE = { min: 0.5, max: 3, step: 0.25 };
export const GRID = { move: 0.5, yaw: 15 };

// Unlockables beyond pieces: paints for the roadster (Free Drive only) and titles.
export const PAINTS = {
  silver: { id: 'silver', name: 'Silver', color: 0xc9ccd1, base: true },
  ice: { id: 'ice', name: 'Ice', color: 0xbfe6ff },
  signal: { id: 'signal', name: 'Signal', color: 0xd7262e },
  graphite: { id: 'graphite', name: 'Graphite', color: 0x34373d },
  sand: { id: 'sand', name: 'Sand', color: 0xcdb48a },
  verdant: { id: 'verdant', name: 'Verdant', color: 0x2f6b55 },
};
export const PAINT_IDS = Object.keys(PAINTS);

export const pieceCost = (id) => PIECES[id]?.cost ?? 1;
