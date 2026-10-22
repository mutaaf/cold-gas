// No shader can make a NaN pixel (0038). pow(x, y) is undefined for x < 0 (NaN on most GPUs), and
// the bloom smears one NaN pixel over the frame (LESSONS: "One NaN pixel is a flicker storm").
// Interpolation carries a varying a hair out of the range it had at the vertices, so every pow()
// base in src/render must be visibly non-negative: clamp(x, ≥0, …), max(x, ≥0), abs(), exp(),
// smoothstep(), a positive literal, 1 - clamp(…)/1 - <an identifier clamped to ≤ 1>, or an
// identifier assigned from one of those in the same file.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createPlumes } from '../../src/render/plumes.js';
import * as THREE from 'three';

const ROOT = join(import.meta.dirname, '../../src/render');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });

// Top-level comma-separated arguments of the call whose '(' is at `open`.
function args(src, open) {
  const out = []; let depth = 0, start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { out.push(src.slice(start, i).trim()); return out; } }
    else if (c === ',' && depth === 1) { out.push(src.slice(start, i).trim()); start = i + 1; }
  }
  return out;
}
const LIT = /^\+?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const nonNegLit = (s) => LIT.test(s.trim());
// Index of the ')' matching the '(' at `open`.
function close(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) return i; }
  return -1;
}
// Is `s` exactly one call to `name`, e.g. clamp(…)?
const call = (s, name) => new RegExp(`^${name}\\s*\\(`).test(s) && close(s, s.indexOf('(')) === s.length - 1;

// Is `e` (a GLSL expression) ≥ 0 by construction? `src` is the whole file, for identifiers.
function nonNeg(e, src, depth = 0) {
  e = e.trim();
  while (e.startsWith('(') && close(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  if (nonNegLit(e)) return true;
  for (const f of ['abs', 'exp', 'smoothstep', 'length']) if (call(e, f)) return true;
  if (call(e, 'clamp')) { const a = args(e, e.indexOf('(')); return a.length === 3 && nonNegLit(a[1]); }
  if (call(e, 'max')) { const a = args(e, e.indexOf('(')); return a.length === 2 && (nonNegLit(a[0]) || nonNegLit(a[1])); }
  // 1 - x with x in [?, 1]: clamp(…, …, ≤1) or an identifier assigned that way.
  const m = /^1(\.0*)?\s*-\s*(.+)$/.exec(e);
  if (m) return atMostOne(m[2], src, depth);
  if (/^[A-Za-z_]\w*$/.test(e) && depth < 3) return assigned(e, src).some((rhs) => nonNeg(rhs, src, depth + 1));
  return false;
}
function atMostOne(e, src, depth) {
  e = e.trim();
  if (call(e, 'clamp')) { const a = args(e, e.indexOf('(')); return a.length === 3 && nonNegLit(a[2]) && Number(a[2]) <= 1; }
  if (call(e, 'smoothstep')) return true;
  if (/^[A-Za-z_]\w*$/.test(e) && depth < 3) return assigned(e, src).some((rhs) => atMostOne(rhs, src, depth + 1));
  return false;
}
// Right-hand sides of `ident = …;` in the file (declarations and plain assignments).
function assigned(id, src) {
  const out = [], re = new RegExp(`(?:float\\s+|,\\s*)${id}\\s*=\\s*`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, j = i;
    for (; j < src.length; j++) { const c = src[j]; if (c === '(') depth++; else if (c === ')') depth--; if (depth === 0 && (c === ';' || c === ',')) break; if (depth < 0) break; }
    out.push(src.slice(i, j));
  }
  return out;
}

// Every GLSL pow() in a source file: skips Math.pow and the word in prose (no arguments).
export function unsafePows(src) {
  const bad = [];
  const re = /(?<![\w.])pow\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const a = args(src, m.index + m[0].length - 1);
    if (a.length !== 2 || !a[0]) continue;
    if (!nonNeg(a[0], src)) bad.push(`pow(${a[0]}, ${a[1]})`);
  }
  return bad;
}

describe('shader pow() bases (src/render)', () => {
  it('has no pow() whose base interpolation could push negative', () => {
    const bad = [];
    for (const f of files(ROOT)) for (const b of unsafePows(readFileSync(f, 'utf8'))) bad.push(`${f.slice(ROOT.length + 1)}: ${b}`);
    expect(bad).toEqual([]);
  });
  it('catches a planted unclamped base', () => {
    expect(unsafePows('float a = pow(1.-vUv.y, 2.);')).toHaveLength(1);
    expect(unsafePows('float a = pow(vUv.x, 4.0);')).toHaveLength(1);
    expect(unsafePows('float r = pow(1. - abs(dot(vN, vView)), 1.6);')).toHaveLength(1);
    expect(unsafePows('float t = pow(1.0 - max(dot(n, v), 0.0), 5.0);')).toHaveLength(1);
    expect(unsafePows('float t = exp(-pow((au - lane) / 0.35, 2.0));')).toHaveLength(1);
    expect(unsafePows('float a = pow(clamp(x, -1., 1.), 2.);')).toHaveLength(1);
  });
  it('accepts bases that are non-negative by construction', () => {
    expect(unsafePows('float a = pow(clamp(1. - vUv.y, 0., 1.), 2.);')).toEqual([]);
    expect(unsafePows('float a = pow(max(dot(r, s), 0.0), 320.0);')).toEqual([]);
    expect(unsafePows('float along = clamp(vUv.y, 0., 1.); float f = pow(1. - along, 1.4);')).toEqual([]);
    expect(unsafePows('float mu = max(dot(d, s), 0.0); c += pow(mu, 12.0);')).toEqual([]);
    expect(unsafePows('const k = Math.pow(1 - x, 2); // pow() of a negative base')).toEqual([]);
  });
});

describe('mist pool (0045)', () => {
  it('reports 0 live after decay, hides the cloud and stops uploading', () => {
    const scene = new THREE.Scene(), hero = new THREE.Group();
    scene.add(hero);
    const p = createPlumes(scene, hero, { maxMist: 64 });
    const thr = new Float64Array(10), vel = new THREE.Vector3();
    expect(p.live()).toBe(0);
    expect(p.points.visible).toBe(false);
    p.burst([0, 0.1, 0, 1, 0.1, 1], 8, 3);
    p.update(1 / 60, 0, thr, vel);
    expect(p.live()).toBe(16);
    expect(p.points.visible).toBe(true);
    for (let i = 0; i < 200; i++) p.update(1 / 60, i / 60, thr, vel);   // life decays at 0.55/s
    expect(p.live()).toBe(0);
    expect(p.points.visible).toBe(false);
    const u = p.uploads();
    for (let i = 0; i < 30; i++) p.update(1 / 60, i / 60, thr, vel);
    expect(p.uploads()).toBe(u);
  });
});
