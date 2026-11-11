// The deck look (0187): how much the car is "on the Wall's deck" (0 … 1), from where the car is, for the renderer.
// On the curl the camera is metres from the red LED edge and the car sits in the floodlights' hot spot: at the
// course's bloom the strips' glow filled a phone's narrow frame (36–68 % saturated red) and the white paint's
// highlights bloomed over its own tyres and glass. While the car is on the deck the stage raises the bloom's
// threshold and the strips glow less (scene.js setDeck, wall.js), so the red is an edge again and the car reads.
// Pure and position-only (no clock): the same in a live run and its replay, it fades in up the first metres of the
// curl and out as the car falls clear of it, never a cut. Renderer only: nothing here touches the sim.
// The run-up (0193): the car parked at the curl's foot for the countdown and driving up to it is the same camera metres
// from the ring's near arc (49–62 % saturated red on a phone), so the look holds from the start line too: by position,
// on the floor from RUNUP_Z to the foot and below RUNUP_Y (the curl's look is 1 from 1.7 m up, so the two overlap),
// until the car has flown. The Wall's pad (z −9, its reference sets down at −7.2) lies on the run-up itself, so position
// alone can't tell the run-up from the touchdown; `flown` (0 … 1: FLOWN_TICKS of sim time after the run's launch tick,
// live or on the replay's clock: main.js) does, and once it is 1 the look is 0187's exactly. The release is 20 m up,
// past RUNUP_Y, so the fade changes nothing there; a car that leaves the curl low fades over a second, not a frame.
import { wallArcLength, wallProfile, WALL } from '../sim/courses.js';

// Up the curl: from 1.5 m of arc (the foot's lip) to 6 m (about 1.9 m up, before the climb's first shot).
export const DECK_IN = [1.5, 6];
// Off the deck: the CoM rides 0.40–0.46 m off it; fully off by 6 m (about 0.9 s after the reference's release).
// The distance is to the deck itself: past the lip it is to the lip (not to the ledge's line carried on), and a car
// beside the deck counts how far it is out past the deck's edge.
export const DECK_OFF = [1.2, 6];

// The run-up: fully on from z −9 (both courses park at −6) to the foot, off behind −12; fully on below 2.5 m (the
// curl's look is 1 from 1.7 m up), off from 4 m.
export const RUNUP_Z = [-12, -9];
export const RUNUP_Y = [2.5, 4];
// The run-up's look fades out over this many 240 Hz ticks after the launch (1 s).
export const FLOWN_TICKS = 240;

const P = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 };
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const HALF_W = WALL.width / 2;

// x, y, z: the car's centre (its CoM) in the course frame. flown: 0 before the launch, rising to 1 FLOWN_TICKS after it
// (flownFor below; true counts as 1). Only the Wall and the Show have a deck.
export function deckLook(x, y, z, flown = 0) {
  const f = flown === true ? 1 : flown || 0;
  const run = f >= 1 ? 0 : (1 - f) * smooth(z, RUNUP_Z[0], RUNUP_Z[1]) * (1 - smooth(y, RUNUP_Y[0], RUNUP_Y[1]));
  if (run >= 1) return 1;
  const s = wallArcLength(z, y);
  if (s <= DECK_IN[0]) return run;
  wallProfile(s, P);
  const dz = z - P.z, dy = y - P.y, dx = Math.max(0, Math.abs(x) - HALF_W);
  const d = Math.sqrt(dz * dz + dy * dy + dx * dx);
  return Math.max(run, smooth(s, DECK_IN[0], DECK_IN[1]) * (1 - smooth(d, DECK_OFF[0], DECK_OFF[1])));
}

// How far past its launch the run on screen is (0 … 1), from the tick on screen and the run's launch tick (−1: not yet).
export function flownFor(tick, launchTick) {
  if (launchTick < 0 || tick < launchTick) return 0;
  return Math.min(1, (tick - launchTick) / FLOWN_TICKS);
}
