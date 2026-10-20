// Studio screenshots of each parked vehicle, one at a time, on a course's stage (the Lineup's
// blue hour or the Show's night), plus the whole row, and a draw-call / triangle budget per
// vehicle. Against a running preview:
//   node scripts/shots-lineup.mjs outdir [url] [lineup|show] [ids]
import { chromium } from '@playwright/test';
const [out = 'shots', url = 'http://localhost:4330/coldgas/', course = 'lineup', only = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(3000);
await page.evaluate(async (course) => {
  const g = window.__coldgas;
  g.director.update = () => {};
  for (const e of document.body.children) if (e.id !== 'stage' && !e.querySelector?.('#stage')) e.style.visibility = 'hidden';
  g.stage.setCourse(course);
  g.carRoot.visible = false;
  g.ghostRoot && (g.ghostRoot.visible = false);
  g.refGhostRoot && (g.refGhostRoot.visible = false);
}, course);
await page.waitForTimeout(1500);
// [name, azimuth (deg; 0 = straight at the nose, 90 = the car's left side), camera height, distance, fov]
const views = [
  ['front34', 38, 1.5, 8, 40], ['side', 90, 0.9, 14, 25], ['rear34', 142, 1.7, 8, 40],
  ['front', 0, 0.9, 14, 14], ['rear', 180, 1.1, 14, 14],
];
const ids = await page.evaluate(() => {
  const rows = [];
  window.__coldgas.stage.scene.traverse((o) => { if (o.userData?.setBodies && o.visible) rows.push(o); });
  // The row on the current course (every ancestor visible).
  const row = rows.find((r) => { for (let q = r; q; q = q.parent) if (!q.visible) return false; return true; }) || rows[0];
  window.__row = row;
  return row.children.map((c, i) => c.name || `car${i}`);
});
console.log('row:', ids.join(','));
const budget = await page.evaluate(() => window.__row.children.map((car) => {
  let meshes = 0, tris = 0;
  car.traverseVisible((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return { id: car.name, meshes, tris: Math.round(tris) };
}));
console.log('budget:', JSON.stringify(budget));
const shoot = async (i, file, az, el, dist, fov) => {
  await page.evaluate(([i, az, el, dist, fov]) => {
    const { camera } = window.__coldgas;
    const row = window.__row;
    row.children.forEach((c, k) => { c.visible = k === i; });
    const car = row.children[i];
    car.updateMatrixWorld(true);
    const box = new camera.position.constructor();
    const p = car.getWorldPosition(box.clone());
    // Car's nose direction in world (local +z).
    const fwd = box.clone().set(0, 0, 1).transformDirection(car.matrixWorld);
    const left = box.clone().set(1, 0, 0).transformDirection(car.matrixWorld);
    const a = (az * Math.PI) / 180;
    camera.position.set(p.x + (fwd.x * Math.cos(a) + left.x * Math.sin(a)) * dist, el, p.z + (fwd.z * Math.cos(a) + left.z * Math.sin(a)) * dist);
    camera.clearViewOffset();
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.lookAt(p.x, Math.min(1.6, el * 0.6 + 0.3), p.z);
  }, [i, az, el, dist, fov]);
  await page.waitForTimeout(350);
  await page.screenshot({ path: file });
};
for (let i = 0; i < ids.length; i++) {
  if (only && !only.split(',').includes(ids[i])) continue;
  const big = ids[i].includes('semi') ? 1.45 : 1;
  for (const [name, az, el, dist, fov] of views) await shoot(i, `${out}/${course}-${ids[i]}-${name}.png`, az, el * big, dist * big, fov);
}
// The whole row from the side (along it) and from the run-up.
await page.evaluate(() => {
  const { camera } = window.__coldgas;
  const row = window.__row;
  row.children.forEach((c) => { c.visible = true; });
  let z0 = Infinity, z1 = -Infinity;
  for (const c of row.children) { const p = c.position; z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  window.__rowZ = (z0 + z1) / 2;
});
const wide = async (file, x, y, dz, fov) => {
  await page.evaluate(([x, y, dz, fov]) => {
    const { camera } = window.__coldgas;
    camera.position.set(x, y, window.__rowZ + dz);
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.lookAt(0, 1.4, window.__rowZ);
  }, [x, y, dz, fov]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });
};
await wide(`${out}/${course}-row-side.png`, 26, 2.2, 0, 34);
await wide(`${out}/${course}-row-34.png`, 15, 4, 16, 45);
await wide(`${out}/${course}-row-end.png`, 0, 2.5, 24, 40);
// renderer.info for one plain render of this view (shadow pass included, no post), with the row
// and without it: the difference is what the five parked vehicles cost.
console.log('renderer.info:', JSON.stringify(await page.evaluate(() => {
  const { stage, camera } = window.__coldgas, r = stage.renderer;
  const once = () => { r.info.autoReset = false; r.info.reset(); r.shadowMap.needsUpdate = true; r.render(stage.scene, camera); const o = { calls: r.info.render.calls, triangles: r.info.render.triangles }; r.info.autoReset = true; return o; };
  const all = once();
  window.__row.visible = false;
  const none = once();
  window.__row.visible = true;
  return { frame: all, withoutRow: none, row: { calls: all.calls - none.calls, triangles: all.triangles - none.triangles } };
})));
console.log('errors:', errors.filter((e) => !/api\//.test(e) && !/404/.test(e)).slice(0, 10).join('\n') || 'none');
await browser.close();
