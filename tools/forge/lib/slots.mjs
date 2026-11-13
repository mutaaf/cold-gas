// The forge's slots (0211): every place in the game a forged asset can fill, with the physics box it must fit (from
// the sim itself, so a model can never disagree with its collider), its budgets and its default archetype.
// A slot's model replaces only the PIXELS: the collider stays the sim's (docs/OBJECTS.md).
import { LINEUP_SPEC } from '../../../src/sim/courses.js';
import { CONE, BARRIER } from '../../../src/sim/props.js';

// sRGB hex → linear rgb (three keeps material colours linear; Blender's base colour is linear too)
export function hexLinear(hex) {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}

const vehicle = (s, budgets) => ({
  id: s.id, kind: 'vehicle', archetype: s.id, paint: s.paint, budgets,
  spec: {
    id: s.id, name: s.name, l: s.l, w: s.w, h: s.h, wMirrors: s.wMirrors, clearance: s.clearance, wheelbase: s.wheelbase,
    rimR: s.rimR, axles: s.axles.map((a) => ({ ...a, rimR: a.rimR ?? s.rimR })),
    // the wheels' zones, for the glyph check (lug nuts and vanes are rings of small parts, not lettering)
    wheelZones: s.axles.map((a) => ({ y: a.at, z: a.r, r: a.r })),
  },
  // the box it must fill: length and height within a few per cent, width up to the mirrors. The semi's rear tyres
  // stand 6 cm past its box in the sim's own numbers (drive axle at −2.71 m, r 0.507 m, half-length 3.16 m), so its
  // length may run to the tyres the sim simulates.
  fit: { l: [0.97, s.id === 'semi' ? 1.025 : 1.012], h: [0.95, 1.02], w: [0.95, s.wMirrors / s.w + 0.01] },
  aoReach: s.id === 'semi' ? 1.1 : 0.7,
});

// Free Drive's world (0226): the land's trees, shrubs and rocks and the roadside's fences, signs and rails. Their boxes are
// the world's own sizes (ColdGasWorld's prop scatter scales each instance; the colliders are the world's trunks and
// boulders, ColdGasPhysics Drive.swift), `native` the kind the app draws them as (ios/ColdGas/Resources/Props/<kind>/), and
// `ends` how far each LOD is drawn (m). Geometry and palette only: no lettering on a sign, no brand on anything.
const world = (id, native, spec, budgets, ends, fit = {}) => ({
  id, kind: 'prop', archetype: id, paint: 0x808080, budgets, aoReach: Math.max(0.3, Math.min(2.5, spec.h * 0.2)), native, ends,
  spec: { id, ...spec, wheelZones: [] },
  fit: { l: [0.8, 1.15], w: [0.8, 1.15], h: [0.96, 1.04], ...fit },
});
export const WORLD_SLOTS = {
  spruce: world('spruce', 'tree.spruce', { l: 5.2, w: 5.2, h: 12.4 }, [460, 140], [150, 320]),
  broadleaf: world('broadleaf', 'tree.broadleaf', { l: 6.6, w: 6.6, h: 9.8 }, [640, 200], [150, 320]),
  shrub: world('shrub', 'shrub', { l: 2.0, w: 2.0, h: 1.1 }, [340, 60], [100, 300]),
  rock: world('rock', 'rock', { l: 2.6, w: 2.1, h: 1.3 }, [280, 160], [130, 400]),
  fence: world('fence', 'fence', { l: 3.0, w: 0.14, h: 1.15 }, [60, 60], [130, 450], { w: [0.7, 1.3] }),
  signpost: world('signpost', 'signpost', { l: 0.9, w: 0.12, h: 2.3 }, [160, 100], [130, 450], { w: [0.6, 1.4] }),
  guardrail: world('guardrail', 'guardrail', { l: 4.0, w: 0.36, h: 0.8 }, [220, 100], [130, 450]),
};

export const SLOTS = {
  ...WORLD_SLOTS,
  sedan: vehicle(LINEUP_SPEC[0], [16000, 5200]),
  suv: vehicle(LINEUP_SPEC[1], [16000, 5200]),
  semi: vehicle(LINEUP_SPEC[2], [22000, 7000]),
  pickup: vehicle(LINEUP_SPEC[3], [16000, 5200]),
  cab: vehicle(LINEUP_SPEC[4], [16000, 5200]),
  cone: {
    id: 'cone', kind: 'prop', archetype: 'cone', paint: 0xd8501e, budgets: [1400, 500], aoReach: 0.25,
    spec: { id: 'cone', l: CONE.half * 2, w: CONE.half * 2, h: CONE.h, base: CONE.base, cone: CONE.cone, wheelZones: [] },
    fit: { l: [0.95, 1.03], h: [0.97, 1.03], w: [0.95, 1.03] },
  },
  barrier: {
    id: 'barrier', kind: 'prop', archetype: 'barrier', paint: 0xd8d9da, budgets: [2400, 800], aoReach: 0.4,
    // its length runs along x in the sim (props.js propPoints): the forge builds it along its own y and the loader turns it
    spec: { id: 'barrier', l: BARRIER.l, w: BARRIER.d, h: BARRIER.h, top: BARRIER.top, wheelZones: [] },
    fit: { l: [0.97, 1.02], h: [0.97, 1.03], w: [0.95, 1.05] },
  },
};
