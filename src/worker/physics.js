// The Worker's way to start the physics engine (src/sim/engine.js): Wrangler bundles Rapier's
// WASM as a precompiled module (workerd may not compile WebAssembly from bytes at run time).
// Imported on the first request that replays a run; tests and Node start the engine themselves.
import wasm from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm';
import { initPhysics } from '../sim/engine.js';

export const startPhysics = () => initPhysics(wasm);
