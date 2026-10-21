// The vehicles: the hero roadster (src/render/roadster.js), its ghost, and the parked fleet
// (src/render/parked/: one procedural model per LINEUP_SPEC entry, at its researched size). All our
// own designs; no badges, no real names.
import * as THREE from 'three';
import { buildParked } from './parked/index.js';

export const lampWhite = new THREE.MeshBasicMaterial({ color: 0xf4f7ff });

// --- The hero roadster ---------------------------------------------------------------------
// The faceted reveal-style wedge lives in its own module (src/render/roadster.js).
export { makeRoadster, wheelCenterY, ANCHOR_Y, REST_LENGTH } from './roadster.js';

// --- The ghost: a translucent silhouette of the hero (your best run, played back alongside) --
// The body panels, glass and tyres, sharing the hero's geometry under one cheap Lambert
// material: eight draw calls, no shadows, nothing inside showing through.
export const ghostMat = new THREE.MeshLambertMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.18, depthWrite: false });
export function makeGhost(hero) {
  const g = new THREE.Group();
  hero.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(hero.group.matrixWorld).invert();
  const parts = hero.ghostParts || [hero.shell, hero.canopy, ...hero.wheels.map((w) => w.spin.children[0])];
  for (const src of parts) {
    const m = new THREE.Mesh(src.geometry, ghostMat);
    m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(inv, src.matrixWorld);
    m.renderOrder = 2;
    g.add(m);
  }
  return g;
}

// --- The parked lineup (built nose → +z, centred on its physics box; the scene turns it crosswise)
export function makeParked(id, color) {
  const car = buildParked(id, color);
  if (!car) throw new Error(`no parked model for '${id}'`);
  return car;
}
