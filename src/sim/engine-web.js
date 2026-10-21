// The browser's way to start the physics engine: Vite emits Rapier's WASM as a hashed asset under
// our own origin (invariant 3.3) and the page streams it in (src/main.js asks for it at boot, so it
// compiles off the main thread while the stage builds).
import wasmUrl from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm?url';
import { initPhysics } from './engine.js';

export const loadPhysics = () => initPhysics(fetch(wasmUrl));
export { wasmUrl };
