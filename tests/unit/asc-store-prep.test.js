// 0268: `asc.mjs store-prep` prepares the next App Store version beside one in review. A dry run reads only; --yes writes
// only to the version named by its versionString, never to the one in review, and never submits. The store/ copy it sends
// stays inside Apple's limits and keeps the standing correction owed to App Review (ios/store/review-reply.md).
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storePrep, prepPlan, localShots, storeListing } from '../../ios/scripts/asc.mjs';

const IOS = join(import.meta.dirname, '../../ios');
const marketing = readFileSync(join(IOS, 'project.yml'), 'utf8').match(/MARKETING_VERSION:\s*"([^"]+)"/)[1];

/** A PNG header is enough: store-prep reads the size from IHDR and hashes the bytes. */
function png(w, h) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
let shotsDir;
beforeAll(() => {
  shotsDir = mkdtempSync(join(tmpdir(), 'cg-shots-'));
  mkdirSync(join(shotsDir, 'iphone-69'));
  writeFileSync(join(shotsDir, 'iphone-69', '01-jump.png'), png(1320, 2868));
  writeFileSync(join(shotsDir, 'iphone-69', '02-land.png'), png(1320, 2868));
});

const v = (id, versionString, appStoreState) => ({ id, attributes: { versionString, appStoreState } });
const contact = { contactFirstName: 'A', contactLastName: 'B', contactEmail: 'a@example.com', contactPhone: '+10000000000' };
function local() {
  return { ...storeListing(), forVersion: '1.2.0', contact, shots: localShots(shotsDir) };
}

/** App Store Connect in memory: 1.1.0 waiting for review, no 1.2.0 yet (unless given). Records every request. */
function fakeAsc({ versions = [v('v110', '1.1.0', 'WAITING_FOR_REVIEW')], created = '1.2.0' } = {}) {
  const calls = [];
  const puts = [];
  const state = { versions: [...versions], locs: {}, sets: {}, shots: {} };
  let n = 0;
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    let m;
    if (method === 'GET') {
      if (path.startsWith('/v1/apps?filter[bundleId]')) return { data: [{ id: 'app1' }] };
      if (/^\/v1\/apps\/app1\/appStoreVersions/.test(path)) return { data: state.versions };
      if ((m = path.match(/^\/v1\/appStoreVersions\/([^/]+)$/))) return { data: state.versions.find((x) => x.id === m[1]) };
      if ((m = path.match(/^\/v1\/appStoreVersions\/([^/]+)\/appStoreVersionLocalizations$/))) return { data: state.locs[m[1]] ?? [] };
      if (/appStoreReviewDetail$/.test(path)) { const e = new Error('404'); e.status = 404; throw e; }
      if (/\/build$/.test(path)) return { data: null };
      if ((m = path.match(/^\/v1\/appStoreVersionLocalizations\/([^/]+)\/appScreenshotSets/))) return { data: state.sets[m[1]] ?? [] };
      if ((m = path.match(/^\/v1\/appScreenshotSets\/([^/]+)\/appScreenshots/))) return { data: state.shots[m[1]] ?? [] };
      if (path.startsWith('/v1/preReleaseVersions')) return { data: [{ id: 'pre120' }] };
      if (path.startsWith('/v1/builds')) return { data: [{ id: 'b1', attributes: { version: '202611151500', expired: false } }] };
      if (path === '/v1/apps/app1/appInfos') return { data: [{ id: 'info1', attributes: { state: 'WAITING_FOR_REVIEW' } }] };
      if (/appInfoLocalizations$/.test(path)) return { data: [{ id: 'il1', attributes: { locale: 'en-US', name: 'Cold Gas', subtitle: 'Stick the landing.', privacyPolicyUrl: 'https://mutaafaziz.com/coldgas/privacy' } }] };
      throw new Error(`unexpected GET ${path}`);
    }
    if (method === 'POST' && path === '/v1/appStoreVersions') {
      const x = v('v120', created, 'PREPARE_FOR_SUBMISSION');
      state.versions.push(x);
      state.locs.v120 = [{ id: 'loc120', attributes: { locale: 'en-US' } }]; // Apple copies the last version's listing
      return { data: x };
    }
    if (method === 'POST' && path === '/v1/appScreenshotSets') { state.sets.loc120 = [{ id: 'set1', attributes: { screenshotDisplayType: body.data.attributes.screenshotDisplayType } }]; return { data: state.sets.loc120[0] }; }
    if (method === 'POST' && path === '/v1/appScreenshots') {
      const id = `shot${++n}`;
      return { data: { id, attributes: { uploadOperations: [{ url: `https://upload.example/${id}`, method: 'PUT', offset: 0, length: body.data.attributes.fileSize, requestHeaders: [] }] } } };
    }
    return { data: { id: `w${++n}` } };
  };
  const put = async (url) => { puts.push(url); return { ok: true, status: 200 }; };
  return { call, put, calls, puts, state };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('asc.mjs store-prep', () => {
  it('a dry run only reads, and plans to create 1.2.0 beside the 1.1.0 in review', async () => {
    const asc = fakeAsc();
    const { plan } = await storePrep({ call: asc.call, put: asc.put, v: '1.2.0', local: local(), log: () => {} });
    expect(writes(asc.calls)).toEqual([]);
    expect(asc.puts).toEqual([]);
    expect(plan.refuse).toBeNull();
    expect(plan.ops[0].kind).toBe('create');
    expect(plan.ops.map((o) => o.kind)).toEqual(expect.arrayContaining(['version', 'localization', 'review', 'build', 'shots']));
    expect(plan.notes.join('\n')).toMatch(/untouched: 1\.1\.0 WAITING_FOR_REVIEW/);
    // No version is live yet: What's New is held back rather than refused by Apple.
    expect(plan.ops.find((o) => o.kind === 'localization').attrs.whatsNew).toBeUndefined();
  });

  it('--yes writes only to 1.2.0, never to 1.1.0, and never submits', async () => {
    const asc = fakeAsc();
    await storePrep({ call: asc.call, put: asc.put, v: '1.2.0', local: local(), yes: true, log: () => {} });
    const w = writes(asc.calls);
    expect(w[0]).toMatchObject({ method: 'POST', path: '/v1/appStoreVersions' });
    expect(w[0].body.data.attributes).toMatchObject({ versionString: '1.2.0', platform: 'IOS', releaseType: 'MANUAL' });
    expect(asc.calls.some((c) => c.path.includes('v110'))).toBe(false);
    expect(asc.calls.some((c) => /reviewSubmission/.test(c.path))).toBe(false);
    expect(w.some((c) => /\/v1\/apps\/app1$|appPrice|appAvailab|ageRating|appInfos\//.test(c.path))).toBe(false);
    // The app info is locked with 1.1.0's review: nothing written to it.
    expect(w.some((c) => /appInfoLocalizations/.test(c.path))).toBe(false);
    expect(w.some((c) => c.path === '/v1/appStoreVersions/v120' && c.method === 'PATCH')).toBe(true);
    expect(w.some((c) => c.path === '/v1/appStoreVersionLocalizations/loc120' && c.body.data.attributes.description)).toBe(true);
    expect(w.find((c) => c.path === '/v1/appStoreReviewDetails').body.data.attributes.notes).toBe(storeListing().reviewNotes);
    expect(asc.puts.length).toBe(2);
  });

  it('refuses when the version Apple hands back is not 1.2.0', async () => {
    const asc = fakeAsc({ created: '1.1.0' });
    await expect(storePrep({ call: asc.call, put: asc.put, v: '1.2.0', local: local(), yes: true, log: () => {} })).rejects.toThrow(/refusing/);
    expect(writes(asc.calls).length).toBe(1); // the create; nothing after it
  });

  it('leaves a 1.2.0 that is already in review alone', async () => {
    const asc = fakeAsc({ versions: [v('v110', '1.1.0', 'READY_FOR_SALE'), v('v120', '1.2.0', 'WAITING_FOR_REVIEW')] });
    const { plan } = await storePrep({ call: asc.call, put: asc.put, v: '1.2.0', local: local(), yes: true, log: () => {} });
    expect(plan.refuse).toMatch(/WAITING_FOR_REVIEW/);
    expect(writes(asc.calls)).toEqual([]);
  });

  it("sends What's New once a version is live", () => {
    const remote = { app: { id: 'app1' }, versions: [v('v110', '1.1.0', 'READY_FOR_SALE')], sv: null, loc: null, review: null, attached: null, build: null, sets: {}, infos: [] };
    const plan = prepPlan({ v: '1.2.0', local: local(), remote });
    expect(plan.ops.find((o) => o.kind === 'localization').attrs.whatsNew).toBe(storeListing().whatsNew);
  });

  it('plans offline without a key, and flags screenshots of the wrong size', () => {
    const l = local();
    l.shots[0].errors.push('iphone-69/x.png is 10×10');
    const plan = prepPlan({ v: '1.2.0', local: l, remote: null });
    expect(plan.notes.join('\n')).toMatch(/not read/);
    expect(plan.blocks).toContain('iphone-69/x.png is 10×10');
  });
});

describe(`ios/store copy for ${marketing}`, () => {
  const s = storeListing();
  it('is written for the current MARKETING_VERSION', () => expect(s.forVersion).toBe(marketing));
  it("fits Apple's limits", () => {
    for (const [k, max] of [['name', 30], ['subtitle', 30], ['keywords', 100], ['promotionalText', 170], ['description', 4000], ['reviewNotes', 4000], ['whatsNew', 4000]]) {
      expect(s[k]?.length, k).toBeGreaterThan(0);
      expect(s[k].length, k).toBeLessThanOrEqual(max);
    }
    expect(s.keywords).not.toMatch(/,\s/);
  });
  it('keeps the standing correction: the server scores telemetry after plausibility checks and does not re-fly runs', () => {
    expect(s.reviewNotes).toMatch(/our server does not fly posted runs again/);
    expect(s.reviewNotes).toMatch(/scores the run's telemetry .* after plausibility checks against the run's input log/);
  });
  it('names the platform feature factually, no brands of the game world', () => {
    for (const t of [s.description, s.promotionalText, s.reviewNotes, s.whatsNew, s.keywords]) {
      expect(t).not.toMatch(/Tesla|Cybertruck|SpaceX|Roadster|Model [SXY3]\b/);
    }
  });
});
