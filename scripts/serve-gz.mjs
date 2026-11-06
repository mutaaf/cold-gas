// Serves a built dist at /coldgas/ with gzip, like production, for first-load probes (scripts/perf.mjs, 0053).
// `vite preview` sends uncompressed bytes, so a throttled (Slow 4G) probe against it times the wrong downloads.
//
//   node scripts/serve-gz.mjs dist/coldgas 4701
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname, resolve, sep } from 'node:path';

const [dirArg = 'dist/coldgas', portArg = '4701'] = process.argv.slice(2);
const dir = resolve(dirArg);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ZIP = new Set(['.html', '.js', '.css', '.wasm', '.json', '.svg', '.webmanifest']);
const zipped = new Map();

http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (!path.startsWith('/coldgas/')) { res.writeHead(404); return res.end(); }
  let file = resolve(dir, path.slice('/coldgas/'.length) || 'index.html');
  if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403); return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  const ext = extname(file);
  const head = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' };
  let body = readFileSync(file);
  if (ZIP.has(ext)) {
    if (!zipped.has(file)) zipped.set(file, gzipSync(body, { level: 6 }));
    body = zipped.get(file);
    head['content-encoding'] = 'gzip';
  }
  res.writeHead(200, head);
  res.end(body);
}).listen(Number(portArg), () => console.log(`serve-gz: ${dir} at http://localhost:${portArg}/coldgas/`));
