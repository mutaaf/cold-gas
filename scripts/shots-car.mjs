// Studio screenshots of the hero car from fixed angles on the title stage, then the same car with
// its active states forced on (wing, fan + skirts, brake lamps, nozzles). Against a running
// preview: node scripts/shots-car.mjs outdir [url]
import { chromium } from '@playwright/test';
const [out = 'shots', url = 'http://localhost:4330/coldgas/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/title.png` });
// Freeze the director and hide the UI so the car fills the frame.
await page.evaluate(() => {
  window.__coldgas.director.update = () => {};
  for (const e of document.body.children) if (e.id !== 'stage' && !e.querySelector?.('#stage')) e.style.visibility = 'hidden';
});
// [name, azimuth (deg; 0 = behind the car), camera height (m), distance (m), fov]
const views = [
  ['front34', 215, 1.1, 6.2, 40], ['front', 180, 0.6, 16, 15], ['side', 90, 0.6, 18, 17],
  ['rear34', 35, 1.2, 6.2, 40], ['rear', 0, 0.6, 16, 15], ['top', 120, 6.5, 4.5, 45], ['low', 160, 0.25, 6.5, 42],
];
const shoot = async (name, az, el, dist, fov) => {
  await page.evaluate(([az, el, dist, fov]) => {
    const { camera, carRoot, hero } = window.__coldgas;
    // Centre on the wheels (the car's footprint), whatever the root's offset.
    const p = camera.position.clone().set(0, 0, 0), v = camera.position.clone();
    for (const w of hero.wheels) p.add(w.pivot.getWorldPosition(v));
    p.multiplyScalar(0.25);
    const a = (az * Math.PI) / 180;
    const off = camera.position.clone().set(Math.sin(a) * dist, 0, -Math.cos(a) * dist).applyQuaternion(carRoot.quaternion);
    camera.position.set(p.x + off.x, el, p.z + off.z);
    camera.clearViewOffset();   // the title framing shifts the view for the menu
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.lookAt(p.x, 0.5, p.z);
  }, [az, el, dist, fov]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/car-${name}.png` });
};
for (const v of views) await shoot(...v);
console.log('hero api:', (await page.evaluate(() => Object.keys(window.__coldgas.hero))).join(','));
// Budget: draw calls ≈ visible meshes in the hero; triangles from their geometry.
console.log('hero budget:', JSON.stringify(await page.evaluate(() => {
  let meshes = 0, tris = 0;
  window.__coldgas.hero.group.traverseVisible((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return { meshes, tris: Math.round(tris) };
})));
// Active: wing up, fan on (skirts down), brake lamps, all lift + rear jets open.
await page.evaluate(() => {
  const h = window.__coldgas.hero;
  h.debugHold = true;   // the model's own inference stops overriding the forced states
  h.setWing?.(1); h.setFan?.(1); h.setBrake?.(1); h.setThrust?.([0.9, 0.9, 0.9, 0.9, 1, 1, 1, 1, 0, 0]);
});
await page.waitForTimeout(1200);
for (const v of [views[3], views[4], views[2], views[6]]) await shoot(`${v[0]}-active`, ...v.slice(1));
console.log('errors:', errors.slice(0, 10).join('\n') || 'none');
await browser.close();
