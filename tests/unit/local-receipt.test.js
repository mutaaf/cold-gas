import { describe, it, expect } from 'vitest';
import { localMeta, LOCAL_WHY } from '../../src/panel.js';

// 0083: whenever the panel speaks local lines, the receipt says so, and why (invariant 5½).
describe('localMeta (the receipt for local lines)', () => {
  it('is never a judged call, and names its reason', () => {
    for (const reason of ['stale', 'chunk', 'breaker']) {
      const m = localMeta(reason);
      expect(m.ok).toBe(false);
      expect(m.local).toBe(reason);
      expect(m.error).toBe(LOCAL_WHY[reason]);
      expect(m.events).toBeUndefined();   // nothing to replay
    }
  });
  it('says a new version is live when a deploy took the judges', () => {
    expect(localMeta('stale').error).toMatch(/new version is live/i);
    expect(localMeta('breaker').error).toMatch(/resting/);
  });
  it('an unknown reason still reads as unavailable', () => {
    expect(localMeta('?').error).toBe(LOCAL_WHY.chunk);
  });
});
