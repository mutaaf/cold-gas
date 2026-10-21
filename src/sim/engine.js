// The rigid-body engine under the sim: Rapier (https://rapier.rs, Apache-2.0), the
// cross-platform-deterministic build (@dimforge/rapier3d-deterministic). Why Rapier, and the
// determinism evidence: docs/PHYSICS_ENGINE.md.
//
// Rapier owns every body's dynamics, collisions, contacts and friction. The sim keeps what no
// engine ships: the roadster's tyres, suspension, suction fan, cold-gas thrusters and flight
// computer (src/sim/vehicle.js), and the parked vehicles' suspension and parked tyres
// (src/sim/world.js), all as forces on Rapier's bodies.
//
// The WASM has to be instantiated once per process before any run is created:
//   browser   await initPhysics(fetch(url))      (src/sim/engine-web.js: the asset URL from Vite)
//   Worker    await initPhysics(wasmModule)      (a precompiled module: workerd can't compile bytes)
//   Node      await initPhysics()                (reads the file from node_modules)
// The engine's JS API, loaded with its WASM (its own chunk in the browser, loaded with the WASM).
// A live binding: modules that import it see it once initPhysics has run.
export let RAPIER = null;

let ready = false, pending = null;
const IMPORTS = () => ({ './rapier_wasm3d_bg.js': RAPIER.__bg });

async function nodeBytes() {
  // Variable specifiers keep bundlers from pulling Node built-ins into the web and Worker builds.
  const fsName = 'node:fs', modName = 'node:module';
  const { readFileSync } = await import(/* @vite-ignore */ fsName);
  const { createRequire } = await import(/* @vite-ignore */ modName);
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve('@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'));
}

async function instantiate(source) {
  if (source === undefined) source = await nodeBytes();
  source = await source;
  if (typeof Response === 'function' && source instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try { return (await WebAssembly.instantiateStreaming(source.clone(), IMPORTS())).instance; } catch { /* wrong MIME type: fall back to bytes */ }
    }
    source = await source.arrayBuffer();
  }
  if (source instanceof WebAssembly.Module) return WebAssembly.instantiate(source, IMPORTS());
  return (await WebAssembly.instantiate(source, IMPORTS())).instance;
}

/**
 * Instantiate Rapier's WASM (once; later calls return the same promise).
 * @param {WebAssembly.Module|ArrayBuffer|Uint8Array|Response|Promise<Response>} [source]
 *   Omit it in Node. The browser passes `fetch(url)`, the Worker its imported module.
 * @returns {Promise<void>}
 */
export function initPhysics(source) {
  if (!pending) {
    pending = import('../vendor/rapier3d.js').then((mod) => { RAPIER = mod; return instantiate(source); }).then((instance) => {
      RAPIER.__bg.__wbg_set_wasm(instance.exports);
      ready = true;
    });
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** True once initPhysics has finished: runs can be created. */
export const physicsReady = () => ready;

export function requirePhysics() {
  if (!ready) throw new Error('COLD GAS sim: call `await initPhysics()` (src/sim/engine.js) before creating a run');
}

