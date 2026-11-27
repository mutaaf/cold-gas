// The browser's way to start the physics engine: Vite emits Rapier's WASM as a hashed asset under
// our own origin (invariant 3.3) and the page streams it in (src/main.js asks for it at boot).
import wasmUrl from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm?url';
import { initPhysics } from './engine.js';

// 0053: the response goes to the streaming compiler in the same task that asks for it, before the engine's JS glue
// chunk (src/vendor/rapier3d.js) is in. V8 reads and compiles the body off the main thread as it arrives. Before, the
// body sat unread until the glue had loaded and its `.then` had run, and on a phone the title's first frame holds the
// main thread for seconds; a body nobody reads fills its pipe and the download stalls (1.1 MB took 12.8 s on the
// Slow 4G profile, 6.5 s of link). A server with the wrong MIME type, or a browser without compileStreaming,
// compiles the bytes instead (one fetch either way; no clone: a tee'd body is pumped on the main thread). The streaming
// API takes only a bare `application/wasm`: a header with a parameter (`; charset=utf-8`) goes the bytes' way too.
function compileWasm(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`COLD GAS physics: ${r.status} for ${url}`);
    const streams = typeof WebAssembly.compileStreaming === 'function' && /^\s*application\/wasm\s*$/i.test(r.headers.get('content-type') || '');
    return streams ? WebAssembly.compileStreaming(r) : r.arrayBuffer().then((b) => WebAssembly.compile(b));
  });
}

// One fetch for the page's lifetime: every caller (boot, each run, Free Drive, the Sandbox) shares
// it. A failed load is forgotten, so the next press fetches again instead of replaying the failure.
let loading = null;
export function loadPhysics() {
  if (!loading) {
    const wasm = compileWasm(wasmUrl);
    wasm.catch(() => {});   // it may fail before initPhysics awaits it; the failure reaches the caller through `loading`
    loading = initPhysics(wasm);
    loading.catch(() => { loading = null; });
  }
  return loading;
}
export { wasmUrl };
