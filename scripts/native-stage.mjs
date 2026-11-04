#!/usr/bin/env node
// The native app's stages, from the web's own builders (docs/NATIVE.md §4, 0153): one source for the look.
//   node scripts/native-stage.mjs [show|wall|lineup …]   (default: show)
// Builds each course in headless Chromium through Vite (scripts/native-stage-page.js: the real canvas draws the
// procedural textures), then writes ios/ColdGas/Resources/Stages/<course>/:
//   stage.json      materials, submeshes, lights, the look, the parked vehicles' home poses, texture list
//   static.bin      the static stage: float32 pos(3) nrm(3) uv(2) col(3), then uint32 indices
//   parked-<i>.bin  each parked vehicle, in its own frame (same layout)
//   roadster.bin    the hero car (same layout)
//   <texture>.png   every texture the materials use
// GENERATED: never hand-edit. Geometry is deterministic; canvas PNGs are as this Chromium draws them.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const courses = ids.length ? ids : ['show'];
const server = await createServer({ server: { port: 4399, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto('http://localhost:4399/coldgas/?gfx=low');
  for (const id of courses) {
    const out = await page.evaluate(async (id) => {
      const { exportCourse } = await import('/coldgas/scripts/native-stage-page.js');
      return exportCourse(id);
    }, id);
    const dir = `ios/ColdGas/Resources/Stages/${id}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const bin = (name, mesh) => {
      const vb = Buffer.from(mesh.vertices, 'base64'), ib = Buffer.from(mesh.indices, 'base64');
      writeFileSync(`${dir}/${name}.bin`, Buffer.concat([vb, ib]));
      const { vertices, indices, ...rest } = mesh;
      return { ...rest, file: `${name}.bin`, indexOffsetBytes: vb.length };
    };
    const manifest = {
      course: out.course, note: out.generated, look: out.look, lights: out.lights,
      static: bin('static', out.static), roadster: bin('roadster', out.roadster),
      parked: out.parked.map((p, i) => ({ home: p.home, ...bin(`parked-${i}`, p.mesh) })),
      textures: out.textures.map((t) => {
        if (t.url) writeFileSync(`${dir}/${t.id}.png`, Buffer.from(t.url.split(',')[1], 'base64'));
        const { url, ...rest } = t;
        return { ...rest, file: t.url ? `${t.id}.png` : null };
      }),
    };
    writeFileSync(`${dir}/stage.json`, JSON.stringify(manifest, null, 1) + '\n');
    const tris = (m) => m.submeshes.reduce((a, s) => a + s.indexCount / 3, 0);
    console.log(`native-stage: ${id}: static ${tris(manifest.static)} tris / ${manifest.static.submeshes.length} materials, ${manifest.parked.length} parked (${manifest.parked.map((p) => tris(p)).join(', ')} tris), roadster ${tris(manifest.roadster)}, ${manifest.lights.length} lights, ${manifest.textures.length} textures`);
  }
} finally {
  await browser.close();
  await server.close();
}
