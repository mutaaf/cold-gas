// The deck look (0187): how much the car is "on the Wall's deck" (0 … 1), from where the car is, for the renderer.
// On the curl the camera is metres from the red LED edge and the car sits in the floodlights' hot spot: at the
// course's bloom the strips' glow filled a phone's narrow frame (36–68 % saturated red) and the white paint's
// highlights bloomed over its own tyres and glass. While the car is on the deck the stage raises the bloom's
// threshold and the strips glow less (scene.js setDeck, wall.js), so the red is an edge again and the car reads.
// Pure and position-only (no clock): the same in a live run and its replay, it fades in up the first metres of the
// curl and out as the car falls clear of it, never a cut. Renderer only: nothing here touches the sim.
// The run-up too (0193): from the start line to the curl's foot the camera is just as close to the ring's near arc, and
// on a phone its glow and the foot's red light filled half the frame (49–62 %) before the car reached the deck. So the
// red is dimmed along the approach as well (the strips, and the foot's light and glow), from the start (6 m back) to the
// foot, while the car is on the ground there. The bloom's threshold stays the course's there (deckOn, not runUp, moves it):
// with the red dimmed the car already reads (run-up box P10 33–38 at 1440×900), and taking the bloom off the white car
// that early only adds edge crawl to the replay (flicker show-replay/car 108.6 → 116.4 ‰, SwiftShader desktop).
import { wallArcLength, wallProfile, WALL } from '../sim/courses.js';

// Up the curl: from 1.5 m of arc (the foot's lip) to 6 m (about 1.9 m up, before the climb's first shot).
export const DECK_IN = [1.5, 6];
// Off the deck: the CoM rides 0.40–0.46 m off it; fully off by 6 m (about 0.9 s after the reference's release).
// The distance is to the deck itself: past the lip it is to the lip (not to the ledge's line carried on), and a car
// beside the deck counts how far it is out past the deck's edge.
export const DECK_OFF = [1.2, 6];

// The run-up: on up to 8 m behind the curl's foot (both starts are 6 m back), off by 14 m (the Show's pad is 30 m back;
// the Wall's, 9 m back under its ledge, keeps the look as the car comes down onto it); on below a CoM 2.5 m up (the
// deck's own fade has the car by then), off by 6 m; within 1.2 m of the deck's width, off 6 m out past it; and not
// past the ring (on 6 m beyond the foot, under the curl, off by 12 m: behind it in Free Drive or after a crash).
export const RUNUP_BACK = [8, 14];
export const RUNUP_FWD = [6, 12];
export const RUNUP_UP = [2.5, 6];
export const RUNUP_SIDE = [1.2, 6];

const P = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 };
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const HALF_W = WALL.width / 2;

// x, y, z: the car's centre (its CoM) in the course frame. Only the Wall and the Show have a deck.
// deckLook: the red's dimming (on the deck or the run-up); deckOn: the car on the deck itself (the bloom's threshold).
export function deckLook(x, y, z) {
  const r = runUp(x, y, z);
  return r >= 1 ? 1 : Math.max(r, deckOn(x, y, z));
}

export function deckOn(x, y, z) {
  const s = wallArcLength(z, y);
  if (s <= DECK_IN[0]) return 0;
  wallProfile(s, P);
  const dz = z - P.z, dy = y - P.y, dx = Math.max(0, Math.abs(x) - HALF_W);
  const d = Math.sqrt(dz * dz + dy * dy + dx * dx);
  return smooth(s, DECK_IN[0], DECK_IN[1]) * (1 - smooth(d, DECK_OFF[0], DECK_OFF[1]));
}

// On the approach in front of the curl, low (0193).
export function runUp(x, y, z) {
  return (1 - smooth(-z, RUNUP_BACK[0], RUNUP_BACK[1])) * (1 - smooth(z, RUNUP_FWD[0], RUNUP_FWD[1])) * (1 - smooth(y, RUNUP_UP[0], RUNUP_UP[1]))
    * (1 - smooth(Math.abs(x) - HALF_W, RUNUP_SIDE[0], RUNUP_SIDE[1]));
}
