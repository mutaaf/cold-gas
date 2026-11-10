// The deck look (0187): how much the car is "on the Wall's deck" (0 … 1), from where the car is, for the renderer.
// On the curl the camera is metres from the red LED edge and the car sits in the floodlights' hot spot: at the
// course's bloom the strips' glow filled a phone's narrow frame (36–68 % saturated red) and the white paint's
// highlights bloomed over its own tyres and glass. While the car is on the deck the stage raises the bloom's
// threshold and the strips glow less (scene.js setDeck, wall.js), so the red is an edge again and the car reads.
// Pure and position-only (no clock): the same in a live run and its replay, it fades in up the first metres of the
// curl and out as the car falls clear of it, never a cut. Renderer only: nothing here touches the sim.
import { wallArcLength, wallProfile } from '../sim/courses.js';

// Up the curl: from 1.5 m of arc (the foot's lip) to 6 m (about 1.9 m up, before the climb's first shot).
export const DECK_IN = [1.5, 6];
// Off the deck: the CoM rides 0.40–0.46 m off it; fully off by 6 m (0.6 s after the release).
export const DECK_OFF = [1.2, 6];

const P = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 };
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// y, z: the car's centre (its CoM) in the course frame. Only the Wall and the Show have a deck.
export function deckLook(y, z) {
  const s = wallArcLength(z, y);
  if (s <= DECK_IN[0]) return 0;
  wallProfile(s, P);
  const d = Math.abs((z - P.z) * P.nz + (y - P.y) * P.ny);
  return smooth(s, DECK_IN[0], DECK_IN[1]) * (1 - smooth(d, DECK_OFF[0], DECK_OFF[1]));
}
