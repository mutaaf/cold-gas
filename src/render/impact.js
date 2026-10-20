// How hard a touchdown feels, from the one number that says it: the sink rate. The energy the
// suspension has to soak up per kilogram is ½·v², so the felt strength goes with v², normalised
// to a 5 m/s touchdown (where the judges' landing score is already near its floor and a road
// chassis bottoms out: ESTIMATE). The reveal car landed at ≈1 m/s, "softly in a cloud"
// (docs/REVEAL_RESEARCH.md §landing). Pure: no three.js, no DOM, so it is unit-tested.
export const IMPACT = {
  hardSink: 5,       // m/s at which every cue is at full strength
  softSink: 1.5,     // below this a landing reads as soft (ticket 0002)
};

const out = { strength: 0, dip: 0, fovPunch: 0, shake: 0, mist: 0, mistSpeed: 0, thudHz: 0, thudGain: 0, thudDecay: 0, crunch: 0 };

// Writes into (and returns) one shared object: called once per landing, never per frame, but
// there's no reason to allocate.
export function landingImpact(sink, reduced = false) {
  const v = sink > 0 ? sink : 0;
  const r = v / IMPACT.hardSink;
  const s = r >= 1 ? 1 : r * r;
  out.strength = s;
  // Camera: a short vertical dip and a punch-in, both off under prefers-reduced-motion.
  out.dip = reduced ? 0 : 0.03 + 0.45 * s;           // m
  out.fovPunch = reduced ? 0 : 0.6 + 5.4 * s;         // degrees narrower at the hit
  out.shake = reduced ? 0 : s;
  // Ground mist: a ring from each tyre. The jets' cloud is already there; this is the tyre
  // pushing it out, so it scales with how hard the tyres met the pad.
  out.mist = Math.round(6 + 34 * s);                  // particles per wheel
  out.mistSpeed = 1.5 + 6.5 * s;                      // m/s outward
  // Sound: a soft landing is a light, higher tap; a hard one is a deep, long, loud thump with a
  // suspension crunch on top.
  out.thudHz = 150 - 95 * s;
  out.thudGain = 0.12 + 0.78 * s;
  out.thudDecay = 0.18 + 0.42 * s;
  out.crunch = s > 0.3 ? (s - 0.3) / 0.7 : 0;
  return out;
}
