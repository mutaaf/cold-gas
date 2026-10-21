import { describe, it, expect, beforeEach } from 'vitest';
import { toUS, localize, setUnits, getUnits, fmtSpeed, fmtMass, fmtRoad, fmtLen, k, u, alt } from '../../src/units.js';
import { createDamage, updateDamage, hitCost } from '../../src/sim/damage.js';
import { createImpacts, pushImpact, HIT, SCRAPE, WHEEL, PART } from '../../src/sim/impacts.js';

// Units are display only: the sim is SI. These pin the conversions and the prose rewriter.
describe('units', () => {
  beforeEach(() => setUnits('us', { persist: false }));

  it('leads with US customary and shows metric beside it', () => {
    expect(getUnits()).toBe('us');
    expect(fmtSpeed(38.9)).toBe('87 mph · 140 km/h');
    expect(fmtMass(835)).toBe('1,841 lb · 835 kg');
    expect(fmtRoad(3900)).toBe('2.42 mi · 3.90 km');
    expect(fmtLen(365.8)).toBe('1,200 ft · 365.8 m');
    expect([k('speed'), u('speed'), u('speed', true)]).toEqual([2.2369362920544, 'mph', 'km/h']);
    expect(alt('speed', 10)).toBe('36 km/h');
  });

  it('swaps which system leads', () => {
    setUnits('metric', { persist: false });
    expect(fmtSpeed(38.9)).toBe('140 km/h · 87 mph');
    expect(u('len')).toBe('m');
    expect(localize('27.7 m up the wall')).toBe('27.7 m (91 ft) up the wall');
  });

  it('rewrites SI prose to US units, keeping the precision', () => {
    expect(toUS('27.7 m up the wall')).toBe('91 ft up the wall');
    expect(toUS('a 1.5 m/s touchdown')).toBe('a 4.9 ft/s touchdown');
    expect(toUS('crawl in, about 20 km/h')).toBe('crawl in, about 12 mph');
    expect(toUS('297 kg · 690 bar')).toBe('655 lb · 10,008 psi');
    expect(toUS('46 kN suction')).toBe('10,341 lbf suction');
    expect(toUS('1,000 kW')).toBe('1,341 hp');
    expect(toUS('12.3 km')).toBe('7.6 mi');
    expect(toUS('A 71 cm traffic cone, 3.2 kg.')).toBe('A 28 in traffic cone, 7.1 lb.');
    expect(toUS('ten metres')).toBe('ten metres');
    expect(toUS('a few ms, 3D, T+00:12.4, 0–60 in 2.3 s')).toBe('a few ms, 3D, T+00:12.4, 0–60 in 2.3 s');
  });

  it('puts the secondary in a dimmer span for HTML', () => {
    expect(localize('Hold <kbd>F</kbd> · about 10 m/s', { html: true })).toBe('Hold <kbd>F</kbd> · about 33 ft/s<span class="u2"> 10 m/s</span>');
  });
});

describe('hitCost mirrors updateDamage', () => {
  it('each kind costs its zone what the sensor adds', () => {
    for (const [kind, part, v] of [[HIT, PART.nose, 5], [HIT, PART.roof, 11], [SCRAPE, PART.side, 8], [WHEEL, PART.wheel, 6.5], [WHEEL, PART.wheel, 2]]) {
      const d = createDamage(), m = createImpacts();
      pushImpact(m, 10, kind, part, 0, -1, 0, 0, 0, 0, 1, 0, v, 0);
      updateDamage(d, { impacts: m }, [{ x: 0.5 }]);
      expect(Math.max(...d.zones)).toBeCloseTo(Math.min(100, hitCost(kind, v)), 9);
    }
  });
});
