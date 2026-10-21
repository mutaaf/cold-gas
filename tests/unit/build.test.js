// The build / power-up / quest layer: encoding, the quest schema gate, the local generator, the
// colliders, and the arcade effects. All pure; the physics checks drive the real sim.
import { describe, it, expect } from 'vitest';
import { PIECES, PIECE_IDS, POWERUP_IDS, MATERIAL_IDS, BUDGET } from '../../src/build/catalogue.js';
import { encodeBuild, decodeBuild } from '../../src/build/encode.js';
import { validateQuest, extractJson, BOUNDS, schemaBrief } from '../../src/build/quest-schema.js';
import { generateQuest, builtInQuests, templateForWish, TEMPLATE_IDS, rngFrom } from '../../src/build/quest-gen.js';
import { shapeSdf, shapeMesh, shapeBounds, loopShift } from '../../src/build/colliders.js';
import { createObjectStore, composeCourse, objectSdf } from '../../src/build/objects.js';
import { createArenaCourse } from '../../src/build/arena.js';
import { createPowerups } from '../../src/build/powerups.js';
import { createQuestRun, applyReward } from '../../src/build/quests.js';
import { createVehicle, step, DT, newInput, CAR } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

const D2R = Math.PI / 180;

describe('build encoding', () => {
  const sample = () => {
    const r = rngFrom('enc');
    const items = [];
    for (let i = 0; i < 60; i++) {
      const type = r() < 0.85 ? r.pick(PIECE_IDS) : `pickup:${r.pick(POWERUP_IDS)}`;
      items.push({
        type, material: r.pick(MATERIAL_IDS), hidden: r() < 0.1,
        transform: { x: 1234.5 + Math.round(r.range(-300, 300)) / 2, y: 812.25 + Math.round(r.range(0, 40)) / 4, z: -987 + Math.round(r.range(-300, 300)) / 2, yaw: r.int(0, 23) * 15 * D2R, scale: 0.5 + r.int(0, 10) * 0.25 },
      });
    }
    return items;
  };
  it('round-trips a build exactly (grid positions, 15° yaw, 0.25 scale)', () => {
    const items = sample();
    const code = encodeBuild('stelvio', items);
    expect(code).toMatch(/^[\w-]+$/);
    const back = decodeBuild(code);
    expect(back.arena).toBe('stelvio');
    expect(back.items).toHaveLength(items.length);
    back.items.forEach((b, i) => {
      const a = items[i];
      expect(b.type).toBe(a.type);
      expect(b.hidden).toBe(a.hidden);
      if (!a.type.startsWith('pickup:')) expect(b.material).toBe(a.material);
      expect(b.transform.x).toBeCloseTo(a.transform.x, 5);
      expect(b.transform.y).toBeCloseTo(a.transform.y, 5);
      expect(b.transform.z).toBeCloseTo(a.transform.z, 5);
      expect(b.transform.scale).toBeCloseTo(a.transform.scale, 6);
      expect(Math.abs(((b.transform.yaw - a.transform.yaw) / D2R + 540) % 360 - 180)).toBeLessThan(1e-6);
    });
    expect(encodeBuild(back.arena, back.items)).toBe(code);
  });
  it('is compact: 11 bytes a piece', () => {
    const code = encodeBuild('sandbox', sample().slice(0, 40));
    expect(code.length).toBeLessThan(Math.ceil(((2 + 7 + 14 + 40 * 11) * 4) / 3) + 2);
  });
  it('rejects malformed codes', () => {
    for (const bad of ['', 'not base64!', 'AAAA', '<script>', 'A'.repeat(9000), encodeBuild('sandbox', sample()).slice(0, -3)]) expect(decodeBuild(bad)).toBeNull();
    expect(decodeBuild(null)).toBeNull();
  });
});

describe('quest schema', () => {
  const good = () => ({
    title: 'Three Rings', brief: 'Fly them.',
    pieces: [{ t: 'kicker', x: 0, z: 40 }, { t: 'ring', x: 0, z: 60 }, { t: 'ring', x: 0, z: 90 }, { t: 'ring', x: 4, z: 120, y: 2 }, { t: 'pad', x: 0, z: 150, s: 1.5 }],
    pickups: [{ t: 'nitrogen', x: 0, z: 20 }],
    objectives: [{ type: 'rings', count: 3 }, { type: 'land', target: 4 }], timeLimit: 90, reward: 'piece:loop',
  });
  it('accepts a good quest and fills defaults', () => {
    const v = validateQuest(good());
    expect(v.ok).toBe(true);
    expect(v.quest.pieces[0]).toMatchObject({ t: 'kicker', y: 0, yaw: 0, s: 1, m: 'wood', hidden: false });
    expect(v.quest.id).toMatch(/^q[0-9a-z]+$/);
    expect(validateQuest(JSON.stringify(good())).quest.id).toBe(v.quest.id);
  });
  it('rejects bad JSON and non-objects', () => {
    expect(validateQuest('{"title": "x",').ok).toBe(false);
    expect(validateQuest('[1,2]').ok).toBe(false);
    expect(validateQuest(42).ok).toBe(false);
    expect(validateQuest(null).ok).toBe(false);
  });
  it('rejects unknown keys and anything that looks like code', () => {
    expect(validateQuest({ ...good(), onLoad: 'fetch("x")' }).errors.join()).toMatch(/unknown key "onLoad"/);
    const q = good(); q.pieces[0].script = 'alert(1)';
    expect(validateQuest(q).ok).toBe(false);
    const t = good(); t.title = '<img src=x onerror=alert(1)>';
    expect(validateQuest(t).ok).toBe(false);
    const n = good(); n.pieces[0].x = '12';
    expect(validateQuest(n).ok).toBe(false);
  });
  it('rejects pieces outside the catalogue and out-of-bounds positions', () => {
    const a = good(); a.pieces[0].t = 'rocket';
    expect(validateQuest(a).errors.join()).toMatch(/isn't in the catalogue/);
    const b = good(); b.pieces[1].z = BOUNDS.sandbox.z[1] + 1;
    expect(validateQuest(b).errors.join()).toMatch(/z out of bounds/);
    const c = good(); c.pieces[1].x = 20;
    expect(validateQuest(c, { arena: 'road' }).errors.join()).toMatch(/x out of bounds/);
    const d = good(); d.pieces[0].s = 9;
    expect(validateQuest(d).ok).toBe(false);
    const e = good(); e.pieces[0].y = Infinity;
    expect(validateQuest(e).ok).toBe(false);
  });
  it('rejects quests over budget', () => {
    const many = good();
    many.pieces = Array.from({ length: BUDGET.questPieces + 1 }, (_, i) => ({ t: 'ring', x: 0, z: 10 + i }));
    many.objectives = [{ type: 'rings', count: 3 }];
    expect(validateQuest(many).errors.join()).toMatch(/too many pieces/);
    const costly = good();
    costly.pieces = Array.from({ length: 8 }, (_, i) => ({ t: 'loop', x: 0, z: 10 + i * 30 }));
    costly.objectives = [{ type: 'airtime', min: 1 }];
    expect(validateQuest(costly).errors.join()).toMatch(/over budget/);
    const pick = good();
    pick.pickups = Array.from({ length: BUDGET.questPickups + 1 }, () => ({ t: 'nitrogen', x: 0, z: 10 }));
    expect(validateQuest(pick).errors.join()).toMatch(/too many pickups/);
  });
  it('rejects objectives the quest cannot be won with', () => {
    const a = good(); a.objectives = [{ type: 'rings', count: 5 }];
    expect(validateQuest(a).errors.join()).toMatch(/needs 5 rings/);
    const b = good(); b.objectives = [{ type: 'land', target: 0 }];
    expect(validateQuest(b).errors.join()).toMatch(/can't land on a kicker/);
    const c = good(); c.objectives = [{ type: 'find', target: 0 }];
    expect(validateQuest(c).errors.join()).toMatch(/must be hidden/);
    const d = good(); d.objectives = [{ type: 'land', target: 99 }];
    expect(validateQuest(d).ok).toBe(false);
    const e = good(); e.objectives = [{ type: 'teleport' }];
    expect(validateQuest(e).ok).toBe(false);
    const f = good(); f.objectives = [];
    expect(validateQuest(f).ok).toBe(false);
  });
  it('rejects brand names and bad rewards', () => {
    const a = good(); a.title = 'Ferrari Jump';
    expect(validateQuest(a).errors.join()).toMatch(/brand/);
    const b = good(); b.reward = 'piece:kicker';
    expect(validateQuest(b).ok).toBe(false);
    const c = good(); c.reward = 'gold:100';
    expect(validateQuest(c).ok).toBe(false);
  });
  it('pulls JSON out of a fenced model answer', () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('no json')).toBeNull();
  });
  it('the brief names every piece and the budget', () => {
    const s = schemaBrief('sandbox');
    for (const id of PIECE_IDS) expect(s).toContain(id);
    expect(s).toContain(String(BUDGET.questCost));
  });
});

describe('local quest generator', () => {
  it('is deterministic: the same seed gives the same quest', () => {
    expect(generateQuest('abc')).toEqual(generateQuest('abc'));
    expect(generateQuest('abc', { arena: 'road' })).toEqual(generateQuest('abc', { arena: 'road' }));
    expect(generateQuest('abc').id).not.toBe(generateQuest('abd').id);
  });
  it('every template, many seeds, both arenas: always schema-valid', () => {
    for (const arena of ['sandbox', 'road']) for (const template of TEMPLATE_IDS) for (let s = 0; s < 40; s++) {
      const q = generateQuest(`seed${s}`, { arena, template });
      expect(validateQuest(q, { arena }).ok).toBe(true);
    }
  });
  it('the built-in board is fixed', () => {
    expect(builtInQuests().map((q) => q.id)).toEqual(builtInQuests().map((q) => q.id));
    expect(builtInQuests()).toHaveLength(TEMPLATE_IDS.length);
  });
  it('maps a wish to a template offline', () => {
    expect(templateForWish('a canyon jump')).toBe('canyon');
    expect(templateForWish('find a secret ramp')).toBe('hidden');
    expect(templateForWish('zzz')).toBeNull();
  });
});

describe('colliders', () => {
  const nl = [0, 0, 0];
  it('every solid piece: free above, solid below, normal up on top', () => {
    for (const id of PIECE_IDS) {
      const sh = PIECES[id].shape;
      if (PIECES[id].sensor) { expect(shapeSdf(sh, 0, 1, 0, nl)).toBe(Infinity); continue; }
      const b = shapeBounds(sh);
      // A point well above the bounds is free; the centre just under the top surface is solid.
      expect(shapeSdf(sh, 0, b[4] + 3, 0, nl)).toBeGreaterThan(2.5);
      if (sh.kind !== 'loop' && sh.kind !== 'halfpipe') {
        expect(shapeSdf(sh, 0, -0.2, 0, nl)).toBeLessThan(0);
      }
    }
  });
  it('kicker: the ramp rises along +z and tilts its normal back', () => {
    const sh = PIECES.kicker.shape;
    const d0 = shapeSdf(sh, 0, 0.5, -1, nl);
    expect(nl[1]).toBeGreaterThan(0.8); expect(nl[2]).toBeLessThan(0);
    // The surface height at z: 1.6·t² with t = (z + 3) / 6.
    const t = 2 / 6, h = 1.6 * t * t;
    expect(d0).toBeGreaterThan(0.5 - h - 0.05); expect(d0).toBeLessThan(0.5 - h + 0.01);
    expect(shapeSdf(sh, 0, h - 0.05, -1, nl)).toBeLessThan(0);
    // The back is a vertical face.
    expect(shapeSdf(sh, 0, 0.8, 3.3, nl)).toBeCloseTo(0.3, 2); expect(nl[2]).toBeCloseTo(1, 3);
  });
  it('box: exact distances and face normals', () => {
    const sh = PIECES.block.shape;
    expect(shapeSdf(sh, 0, 2.5, 0, nl)).toBeCloseTo(1, 6); expect(nl).toEqual([0, 1, 0]);
    expect(shapeSdf(sh, 3, 0.5, 0, nl)).toBeCloseTo(1, 6); expect(nl[0]).toBe(1);
    expect(shapeSdf(sh, 0, 0.5, 0, nl)).toBeLessThan(0);
  });
  it('loop: free inside the ring, solid in its deck, the lane slides over', () => {
    const sh = PIECES.loop.shape, s2 = loopShift(sh) / 2;
    // Centre of the ring: free, about r away.
    expect(shapeSdf(sh, 0, sh.r, 0, nl)).toBeGreaterThan(sh.r - 0.8);
    // Top of the inside: just below the deck (inverted riding surface), normal down.
    expect(shapeSdf(sh, 0, 2 * sh.r - 0.3, 0, nl)).toBeCloseTo(0.3, 1); expect(nl[1]).toBeLessThan(-0.9);
    // Front, entry side (φ ≈ 90°): the deck is at the entry-side half of the shift.
    expect(shapeSdf(sh, s2 / 2, sh.r, sh.r + 0.2, nl)).toBeLessThan(0);
    // The entry lane runs past the back of the loop (φ ≈ 270°, over at the exit side).
    expect(shapeSdf(sh, s2, 0.6, -sh.r * 0.7, nl)).toBeGreaterThan(0.3);
  });
  it('meshes: drawn from the collider (vertices on its surface, normals into free space)', () => {
    for (const id of ['kicker', 'wedge', 'quarter', 'halfpipe', 'loop', 'block']) {
      const sh = PIECES[id].shape, m = shapeMesh(sh);
      expect(m.index.length % 3).toBe(0);
      // Sample each triangle's centroid (vertices sit on edges and corners, where 'outward' is moot).
      let onSurface = 0, outward = 0;
      const n = m.index.length / 3;
      for (let t = 0; t < m.index.length; t += 3) {
        const c = [0, 0, 0], nn = [0, 0, 0];
        for (let j = 0; j < 3; j++) { const k = m.index[t + j]; for (let a = 0; a < 3; a++) { c[a] += m.position[3 * k + a] / 3; nn[a] += m.normal[3 * k + a] / 3; } }
        const ln = Math.hypot(...nn) || 1;
        if (Math.abs(shapeSdf(sh, c[0], c[1], c[2], nl)) < 0.05) onSurface++;
        if (shapeSdf(sh, c[0] + (0.04 * nn[0]) / ln, c[1] + (0.04 * nn[1]) / ln, c[2] + (0.04 * nn[2]) / ln, nl) > 0.01) outward++;
      }
      expect(onSurface / n, id).toBeGreaterThan(0.97);
      expect(outward / n, id).toBeGreaterThan(0.9);
    }
  });
  it('objects: a yawed, scaled piece answers in world space', () => {
    const store = createObjectStore();
    const o = store.addObject({ type: 'block', transform: { x: 10, y: 2, z: -5, yaw: Math.PI / 2, scale: 2 } });
    const out = {};
    // Yaw 90°: local +x (2 m half-width ×2) now runs along world −z; local +z along world +x.
    expect(objectSdf(o, 10, 2 + 3 + 1, -5, out)).toBeCloseTo(1, 6);
    expect(objectSdf(o, 10 + 1 + 1, 3, -5, out)).toBeCloseTo(1, 6); expect(out.x).toBeCloseTo(1, 6);
    expect(store.objectsNear(10, -5, 1).length).toBe(1);
    expect(store.objectsNear(100, 100, 5).length).toBe(0);
    store.removeObject(o.id);
    expect(store.size).toBe(0);
  });
});

describe('physics on pieces', () => {
  function drive(spec, speed, secs = 6) {
    const store = createObjectStore();
    store.addObject(spec);
    const car = createVehicle(composeCourse(createArenaCourse(), store));
    car.pos.z = -60; car.pos.y = SPEC.comHeight + 0.02; car.vel.z = speed;
    for (const w of car.wheels) w.omega = speed / 0.36;
    const inp = newInput();
    let maxY = 0, air = 0, maxAir = 0;
    for (let t = 0; t < secs / DT; t++) {
      inp.throttle = Math.hypot(car.vel.x, car.vel.z) < speed ? 1 : 0; inp.assist = 1;
      step(car, inp);
      maxY = Math.max(maxY, car.pos.y);
      if (car.grounded === 0 && !car.hullContact) { air += DT; maxAir = Math.max(maxAir, air); } else air = 0;
    }
    return { car, maxY, maxAir };
  }
  it('up a kicker at 80 km/h: real air, lands upright', () => {
    const r = drive({ type: 'kicker', transform: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 } }, 22);
    expect(r.maxY).toBeGreaterThan(4);
    expect(r.maxAir).toBeGreaterThan(1.2);
    const upY = 1 - 2 * (r.car.quat.x ** 2 + r.car.quat.z ** 2);
    expect(upY).toBeGreaterThan(0.9);
  });
  it('a wall stops the car; it is an obstacle', () => {
    const r = drive({ type: 'block', transform: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 } }, 10, 4);
    expect(r.car.pos.z).toBeLessThan(0);
  });
  it('materials reach the tyres: steel grips less than rubber', () => {
    const store = createObjectStore();
    store.addObject({ type: 'pad', transform: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, material: 'steel' });
    const course = composeCourse(createArenaCourse(), store), out = {};
    course.sdf(0, 1, 0, out);
    expect(out.mat.id).toBe('steel');
    expect(out.mat.grip).toBeLessThan(1);
  });
});

describe('power-ups and quests', () => {
  it('nitrogen refills; slow-mo scales time; shield drops impacts', () => {
    const p = createPowerups();
    const car = createVehicle(createArenaCourse());
    car.air = 10;
    p.grant('nitrogen', car);
    expect(car.air).toBe(CAR.airMass);
    p.grant('slowmo', car);
    expect(p.timeScale).toBeLessThan(1);
    p.grant('shield', car);
    const inp = newInput();
    p.preStep(car, inp);
    car.impacts.count += 3;          // a crash this tick
    car.crush[0] = 0.2;
    p.postStep(car, DT);
    expect(car.impacts.count).toBe(0);
    expect(car.crush[0]).toBe(0);
    for (let i = 0; i < 240 * 9; i++) p.postStep(car, DT);
    expect(p.active()).toEqual([]);
  });
  it('a ring quest completes when its rings are flown', () => {
    const q = generateQuest('r1', { template: 'rings' });
    const run = createQuestRun(q, []);
    const rings = q.pieces.map((p, i) => (p.t === 'ring' ? i : -1)).filter((i) => i >= 0);
    rings.slice(0, -1).forEach((i) => run.ring(i));
    expect(run.done).toBe(false);
    run.ring(rings[rings.length - 1]);
    expect(run.done).toBe(true);
  });
  it('rewards unlock once', () => {
    const p = { done: {}, pieces: [], paints: ['silver'], titles: [], paint: 'silver', title: '' };
    expect(applyReward(p, 'piece:loop')).toMatch(/Loop/);
    expect(applyReward(p, 'piece:loop')).toBeNull();
    expect(applyReward(p, 'title:Courier')).toMatch(/Courier/);
    expect(p.title).toBe('Courier');
  });
});
