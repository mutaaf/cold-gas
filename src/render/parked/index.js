// The parked fleet: one procedural model per LINEUP_SPEC entry (src/sim/courses.js), built to that
// entry's researched size (docs/VEHICLES.md). All our own designs: no badges, no wordmarks.
import { LINEUP_SPEC } from '../../sim/courses.js';
import { sedan } from './sedan.js';
import { pickup } from './pickup.js';
import { crossover } from './crossover.js';
import { cab } from './cab.js';
import { semi } from './semi.js';

const BUILDERS = { sedan, suv: crossover, semi, pickup, cab };

// null when there's no new model for this id yet (cars.js falls back).
export function buildParked(id, color) {
  const spec = LINEUP_SPEC.find((s) => s.id === id);
  const make = BUILDERS[id];
  if (!spec || !make) return null;
  const g = make(spec, color ?? spec.paint);
  g.name = `parked:${id}`;
  g.userData.spec = spec;
  return g;
}
