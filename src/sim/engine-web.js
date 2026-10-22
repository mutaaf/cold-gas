// The browser's way to start the physics engine: Vite emits Rapier's WASM as a hashed asset under
// our own origin (invariant 3.3) and the page streams it in (src/main.js asks for it at boot, so it
// compiles off the main thread while the stage builds).
import wasmUrl from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm?url';
import { initPhysics } from './engine.js';

// One fetch for the page's lifetime: every caller (boot, each run, Free Drive, the Sandbox) shares
// it. A failed load is forgotten, so the next press fetches again instead of replaying the failure.
let loading = null;
export function loadPhysics() {
  if (!loading) {
    loading = initPhysics(fetch(wasmUrl));
    loading.catch(() => { loading = null; });
  }
  return loading;
}
export { wasmUrl };
