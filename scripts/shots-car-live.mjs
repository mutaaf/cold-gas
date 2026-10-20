// The hero's animated states during the reference Show, from the game's own cameras: lights waking
// on the start line, skirts and fan on the wall, nozzles firing, brake lamps as it stops. Logs the
// lamp levels it sees. node scripts/shots-car-live.mjs outdir [url]
import { chromium } from '@playwright/test';
const [out = 'shots', url = 'http://localhost:4330/coldgas/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/live-0-asleep.png` });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/live-1-waking.png` });
// Lamp levels: the red channel of the tail and brake materials, the DRL's white.
const lamps = () => page.evaluate(() => {
  const want = { 'roadster-tail': 0, 'roadster-brake': 0, 'roadster-drl': 0, 'roadster-head': 0 }, seen = {};
  window.__coldgas.hero.group.traverse((o) => { const n = o.material?.name; if (n in want && !(n in seen)) seen[n] = +o.material.color.r.toFixed(2); });
  return JSON.stringify(seen);
});
console.log('title lamps', await lamps());
await page.evaluate(() => window.__coldgas.startRun('reveal'));
const at = async (name, pred, ms = 60000) => {
  await page.waitForFunction(`(${pred.toString()})(window.__coldgas.S)`, null, { timeout: ms }).catch(() => console.log('missed', name));
  await page.screenshot({ path: `${out}/live-${name}.png` });
  console.log(name, await lamps());
};
await at('2-start', (S) => S.mode === 'live');
await at('3-wall-fan', (S) => S.run.phase === 'ramp' && S.run.car.pos.y > 3);
await at('4-lift', (S) => S.run.phase === 'air' && S.run.car.throttles.some((t) => t > 0.3));
await at('5-landed', (S) => S.run.phase === 'landed');
await at('6-braking', (S) => S.run.phase === 'landed' && Math.hypot(S.run.car.vel.x, S.run.car.vel.z) < 3);
console.log('errors:', errors.slice(0, 10).join('\n') || 'none');
await browser.close();
