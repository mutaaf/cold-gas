// 0362 (the coach's half): on the Lineup a held LIFT is named, and no sheet teaches what the player already did.
// - Pro: a held LIFT is a throttle; a lift-off that peaks past 12 m leads with "Held LIFT too long" and says to let go
//   sooner (it led with "Never braked · hold Space by the BRAKE line" before).
// - Assist: the lift-off burn stops the climb, but a key still down as the car tops out means LAND came late; when that
//   costs the landing, the hold is named.
// - A player who held LAND to the ground is never told "keep holding Shift"; one who never boosted is never told to
//   boost less.
import { describe, it, expect, beforeAll } from 'vitest';
import { flyNaive, grid } from '../../scripts/lib/naive-lineup.mjs';
import { coach, KEY_WORDS } from '../../src/sim/coach.js';
import { coachWords, pickPointer, pointerText } from '../../src/pointer.js';
import { wreckCause } from '../../src/obs/signature.js';

const ctxOf = (tier, more = {}) => ({ device: 'key', scheme: 'classic', tier, course: 'lineup', ...more });
function sheet(p, tier, ctx = ctxOf(tier)) {
  const r = flyNaive({ ...p, tier });
  r.card.tier = tier;
  const c = coach(r.run.inputLog, 'lineup', r.card, 0, ctx.device === 'key' ? KEY_WORDS : coachWords(ctx));
  const ptr = pickPointer(c.items, ctx, { card: r.card, flight: c.flight, crashed: !!r.card.facts.crashed });
  return { r, c, ptr };
}
const hold = (liftS) => ({ speed: 7.5, pressZ: -4, liftS, rollS: 0.8 });

describe('0362: the Lineup coach names a held LIFT', () => {
  it('Pro: a lift-off past 12 m leads with the held lift, with its hold and its peak', () => {
    for (const s of [0.6, 1.0, 1.5, 3.0]) {
      const { r, c, ptr } = sheet(hold(s), 'pro');
      const top = c.items[0];
      expect(r.apex, `hold ${s}`).toBeGreaterThan(12);
      expect(top.id, `hold ${s}`).toBe('held-lift');
      expect(top.detail).toContain(`You held LIFT (Space) ${s} s at the line`);
      expect(top.detail).toMatch(/climbed to \d+(\.\d)? m, where the kickflip peaks at about 8 m/);
      expect(top.fix).toBe('Let go of LIFT (Space) sooner: about 0.4 s at the line peaks near 8 m. Then roll, and brake by the BRAKE line.');
      expect(ptr.text).toBe('Let go of Space sooner: about 0.4 s at the line');
      expect(wreckCause(c.items)).toBe('wreck-lift');
    }
    // The 0.4 s the fix names peaks near 8 m on Pro (the same player), and is not told it held too long.
    const short = sheet(hold(0.4), 'pro');
    expect(short.r.apex).toBeGreaterThan(7);
    expect(short.r.apex).toBeLessThan(9);
    expect(short.c.items.map((x) => x.id)).not.toContain('held-lift');
  });

  it('Assist: a key held through the top that cost the landing is named; a clean long hold is not', () => {
    const { r, c, ptr } = sheet(hold(3.0), 'assist');
    expect(r.landed).toBe(false);
    expect(c.flight.liftPastApex).toBe(true);
    expect(c.items[0].id).toBe('held-lift');
    expect(c.items[0].detail).toMatch(/^You held LIFT \(Space\) 3 s at the line, still down as the car topped out at [\d.]+ m: LAND \(Shift\) came late\.$/);
    expect(c.items[0].fix).toBe("Let go of LIFT (Space) once you're up (about 0.5 s: the climb stops by itself), then roll and hold LAND (Shift) to the ground.");
    expect(ptr.text).toBe("Let go of Space once you're up, then roll and hold Shift to the ground");
    // Since the burn, a held second sticks it (0362's sim half): nothing to name.
    for (const s of [0.4, 1.0]) {
      const ok = sheet(hold(s), 'assist');
      expect(ok.r.landed, `hold ${s}`).toBe(true);
      expect(ok.c.items.map((x) => x.id), `hold ${s}`).not.toContain('held-lift');
    }
  });

  it('never on one thumb or on Advanced, which have no held LIFT of their own', () => {
    const thumb = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'lineup' };
    expect(pointerText('held-lift', thumb)).toBe('');
    expect(pointerText('held-lift', ctxOf('advanced'))).toBe('');
    const r = flyNaive({ ...hold(1.0), tier: 'pro' });
    r.card.tier = 'pro';
    const asThumb = coach(r.run.inputLog, 'lineup', r.card, 0, coachWords(thumb));
    expect(asThumb.items.map((x) => x.id)).not.toContain('held-lift');
    r.card.tier = 'advanced';
    expect(coach(r.run.inputLog, 'lineup', r.card).items.map((x) => x.id)).not.toContain('held-lift');
  });
});

describe('0362: no sheet teaches what the player already did (the naive Lineup grid, Assist and Pro)', () => {
  let sheets;
  beforeAll(() => {
    sheets = [];
    for (const p of grid({ speeds: [6, 7.5, 9], pressZ: [-4, 0], liftS: [0.3, 0.5, 1, 1.5, 3], rollS: [0, 0.8, 1.4] })) {
      for (const tier of ['assist', 'pro']) sheets.push({ p, tier, ...sheet(p, tier) });
    }
  }, 240000);

  it('LAND held to the ground on Assist is never told to keep holding it', () => {
    let seen = 0;
    for (const { p, tier, c, ptr } of sheets) {
      if (tier !== 'assist' || !c.flight.landToGround) continue;
      seen++;
      const words = [...c.items.map((x) => x.fix), ptr.text].join(' | ');
      expect(words, JSON.stringify(p)).not.toMatch(/keep holding Shift|Stay on the brake/);
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('a player who never boosted is never told to boost less', () => {
    let seen = 0;
    for (const { p, tier, c, ptr } of sheets) {
      if (c.flight.boostTicks > 0) continue;
      seen++;
      const words = [...c.items.map((x) => x.fix), ptr.text].join(' | ');
      expect(words, `${tier} ${JSON.stringify(p)}`).not.toMatch(/[Bb]oost less|[Ss]horter boosts/);
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('a crash whose LIFT was held past the top is never told to fly it the same again', () => {
    for (const { p, c } of sheets) {
      if (!c.flight.liftPastApex || !c.items.some((x) => x.id === 'held-lift')) continue;
      for (const x of c.items) expect(x.fix, JSON.stringify(p)).not.toMatch(/fly it the same again/);
    }
  });
});

describe('0362: the ran-out and gas words', () => {
  const KEYS = ctxOf('assist', { course: 'show' });
  it('ran-out on Assist: LAND on to the ground names the start or what spent the gas, never the hold', () => {
    const base = { landToGround: true, airTicks: 800, levelHeld: 700, boostTicks: 0, liftHeld: -1 };
    expect(pointerText('ran-out', KEYS, { ...base, levelHeld: 100 })).toBe('Brake the whole fall: hold Shift from the moment you let go');
    expect(pointerText('ran-out', { ...KEYS, course: 'lineup' }, { ...base, levelHeld: 100 })).toBe('Brake the whole fall: hold Shift as the roll ends');
    expect(pointerText('ran-out', KEYS, { ...base, boostTicks: 40 })).toBe('Save gas for the brake: shorter boosts');
    expect(pointerText('ran-out', { ...KEYS, course: 'lineup' }, { ...base, liftHeld: 1.5 })).toBe('Save gas for the brake: let go of Space sooner at the line');
    expect(pointerText('ran-out', KEYS, base)).toBe('');
    // Not held to the ground: as before.
    expect(pointerText('ran-out', KEYS, { ...base, landToGround: false })).toBe('Stay on the brake to the ground: keep holding Shift');
  });
  it('gas: shorter boosts only to a player who boosted', () => {
    expect(pointerText('gas', KEYS, { boostTicks: 0 })).toBe('Save gas: one hard, late brake');
    expect(pointerText('gas', KEYS, { boostTicks: 12 })).toBe('Save gas: shorter boosts, one hard late brake');
    expect(pointerText('gas', KEYS)).toBe('Save gas: shorter boosts, one hard late brake');
  });
});
