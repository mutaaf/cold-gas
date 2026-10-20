// Build-time fetchers with an on-disk cache (scripts/roads/.cache, gitignored): OpenStreetMap
// via the Overpass API, and terrain from the AWS Open Data "Terrain Tiles" (Terrarium PNGs).
// The game itself never fetches any of this: scripts/roads/build.mjs bakes it into public/roads/.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, '.cache');
mkdirSync(CACHE, { recursive: true });

const UA = 'cold-gas-roads/1.0 (build-time asset script; https://github.com/mutaaf/cold-gas)';
// Public Overpass instances, tried in order with backoff (the main one is often at capacity).
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query) {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const file = join(CACHE, `osm-${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  let wait = 2000;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(150_000) });
        if (!res.ok) { console.warn(`  overpass ${new URL(url).host}: ${res.status}`); continue; }
        const json = await res.json();
        writeFileSync(file, JSON.stringify(json));
        return json;
      } catch (err) { console.warn(`  overpass ${new URL(url).host}: ${err.message}`); }
    }
    await sleep(wait); wait *= 2;
  }
  throw new Error('every Overpass endpoint failed');
}

// Terrarium: elevation (m) = R·256 + G + B/256 − 32768. Tiles are 256 px, Web Mercator (XYZ).
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const tiles = new Map();
export async function terrariumTile(z, x, y) {
  const id = `${z}/${x}/${y}`;
  if (tiles.has(id)) return tiles.get(id);
  const file = join(CACHE, `terrarium-${z}-${x}-${y}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(TILE_URL(z, x, y), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(String(res.status));
        buf = Buffer.from(await res.arrayBuffer());
        break;
      } catch (err) {
        if (attempt > 3) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
    writeFileSync(file, buf);
  }
  const png = decodePng(buf);
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  tiles.set(id, h);
  return h;
}

// Web Mercator helpers.
export const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// Bilinear elevation at (lat, lon) from zoom z (tiles fetched on demand).
export async function elevation(lat, lon, z) {
  const fx = lonToTileX(lon, z) * 256 - 0.5, fy = latToTileY(lat, z) * 256 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const px = async (X, Y) => {
    const t = await terrariumTile(z, Math.floor(X / 256), Math.floor(Y / 256));
    return t[(Y & 255) * 256 + (X & 255)];
  };
  const a = await px(x0, y0), b = await px(x0 + 1, y0), c = await px(x0, y0 + 1), d = await px(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
