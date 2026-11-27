// 0053: the physics WASM is handed to the browser's streaming compiler the moment the page asks for it, not once the
// engine's JS glue chunk (src/vendor/rapier3d.js) has loaded and run. A body nobody reads fills its pipe and the
// download stalls: on the phone profile the title's first frame holds the main thread ≈ 7 s, so the 1.1 MB took 12.8 s
// at 180 kB/s where 6.5 s would do (docs/backlog/0053). compileStreaming reads and compiles off the main thread.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BYTES = readFileSync(require.resolve('@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'));
const wasmResponse = (type = 'application/wasm') => new Response(BYTES, { headers: { 'content-type': type } });

// A fresh engine module each time (engine.js keeps its one load in module state).
async function freshWeb() {
  vi.resetModules();
  return import('../../src/sim/engine-web.js');
}

describe('the engine streams its WASM from the first ask (0053)', () => {
  let realFetch, calls;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    calls = 0;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('the WASM is compiling while the engine\'s JS glue chunk is still loading', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; return wasmResponse(); });
    const compile = vi.spyOn(WebAssembly, 'compileStreaming');
    let open;
    const gate = new Promise((r) => { open = r; });
    vi.resetModules();
    vi.doMock('../../src/vendor/rapier3d.js', async (importOriginal) => { await gate; return importOriginal(); });
    try {
      const { loadPhysics } = await import('../../src/sim/engine-web.js');
      const p = loadPhysics();
      await new Promise((r) => setTimeout(r, 20));   // the response is in; the glue is not
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(compile).toHaveBeenCalledTimes(1);
      open();
      await p;
      const engine = await import('../../src/sim/engine.js');
      expect(engine.physicsReady()).toBe(true);
      expect(engine.RAPIER.version()).toMatch(/^0\.21\./);
      expect(calls).toBe(1);
    } finally { vi.doUnmock('../../src/vendor/rapier3d.js'); }
  });

  it('one fetch for the page: every later ask shares it', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; return wasmResponse(); });
    const { loadPhysics } = await freshWeb();
    await Promise.all([loadPhysics(), loadPhysics()]);
    await loadPhysics();
    expect(calls).toBe(1);
  });

  it('a server that sends the wrong MIME type still loads the engine, from the bytes', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; return wasmResponse('application/octet-stream'); });
    const { loadPhysics } = await freshWeb();
    await loadPhysics();
    const engine = await import('../../src/sim/engine.js');
    expect(engine.physicsReady()).toBe(true);
    expect(engine.RAPIER.version()).toMatch(/^0\.21\./);
  });

  it('a MIME type with a parameter (the streaming API refuses it) loads from the bytes', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; return wasmResponse('application/wasm; charset=utf-8'); });
    const { loadPhysics } = await freshWeb();
    await loadPhysics();
    expect((await import('../../src/sim/engine.js')).physicsReady()).toBe(true);
    expect(calls).toBe(1);
  });

  it('a browser without compileStreaming compiles the bytes', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; return wasmResponse(); });
    const real = WebAssembly.compileStreaming;
    try {
      WebAssembly.compileStreaming = undefined;
      const { loadPhysics } = await freshWeb();
      await loadPhysics();
      expect((await import('../../src/sim/engine.js')).physicsReady()).toBe(true);
      expect(calls).toBe(1);
    } finally { WebAssembly.compileStreaming = real; }
  });

  it('a failed load is forgotten: the next ask fetches again and loads', async () => {
    globalThis.fetch = vi.fn(async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return wasmResponse(); });
    const { loadPhysics } = await freshWeb();
    await expect(loadPhysics()).rejects.toThrow();
    await loadPhysics();
    expect((await import('../../src/sim/engine.js')).physicsReady()).toBe(true);
    expect(calls).toBe(2);
  });
});
