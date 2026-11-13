#!/usr/bin/env node
// App Store Connect API helper for COLD GAS, copied from moon-club's scripts/asc.mjs (docs/NATIVE.md §8, §9).
// No dependencies: Node's crypto signs the ES256 JWT. Never prints the key.
//
// The key's config is the owner's existing one and is never committed: ios/.env.testflight (gitignored), the same
// file moon-club and kin keep (TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH=$HOME/.appstoreconnect/private_keys/
// AuthKey_<id>.p8, BETA_CONTACT_*), or ASC_ENV=<path to such a file>. Same Apple team and key as moon-club, so
// `cp ../moon-club/.env.testflight ios/.env.testflight` is the whole setup.
//
// Read-only:
//   node scripts/asc.mjs whoami            check the key works and list the apps it can see
//   node scripts/asc.mjs status            bundle id registered? app record? builds? (changes nothing)
//   node scripts/asc.mjs notes [version]   print the TestFlight notes that would be sent (lint)
//   node scripts/asc.mjs store-lint        the store/ texts against Apple's limits, offline (check-rules.sh runs it)
//   node scripts/asc.mjs store-check       readiness report: every blocker and how to fix it (exit 1 if blocked)
// Developer portal (idempotent):
//   node scripts/asc.mjs bundle            register com.mutaafaziz.coldgas
//   node scripts/asc.mjs applinks          turn on Associated Domains for the App ID (0253: universal links); then
//                                          `signing` re-creates the App Store profile so it carries the capability
//   node scripts/asc.mjs signing           the Apple Distribution cert (shared with moon-club: ~/.appstoreconnect/signing)
//                                          + the "Cold Gas App Store" profile, installed locally. No cloud signing:
//                                          App Manager keys can't use it (moon-club).
// TestFlight (scripts/testflight.sh runs it after an upload):
//   node scripts/asc.mjs ship <build>      wait for processing, set What to Test, make sure the internal group has testers
// App Store draft (edits the draft version only; nothing goes public):
//   node scripts/asc.mjs store-meta        version, the listing from store/, categories, content rights, usesIdfa,
//                                          review contact + notes, free in all territories, attach the newest build
//   node scripts/asc.mjs store-rating      the age rating questionnaire from store/age-rating.json
//   node scripts/asc.mjs store-shots [dir] upload build/store-shots/{iphone-69,ipad-13,iphone-duo}/*.png
//   node scripts/asc.mjs submit --yes      send the version to App Review: only on a fresh yes from the owner (§9)
//   node scripts/asc.mjs cancel --yes      withdraw the submission waiting for review (the version goes back to editable,
//                                          DEVELOPER_REJECTED): also only on the owner's yes
//
// Testers: internal group "Cold Gas Crew" (access to all builds). BETA_EXTERNAL=1 also adds the build to the external
// group "Cold Gas Beta" and submits it for Beta App Review: also only on a fresh yes from the owner (§9).
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // ios/
const BUNDLE = "com.mutaafaziz.coldgas";
/** Everything we sign: the app alone (no extensions yet), with its own App Store profile. */
const TARGETS = [{ id: BUNDLE, name: "Cold Gas", profile: "Cold Gas App Store" }];
const INTERNAL = "Cold Gas Crew";
const EXTERNAL = "Cold Gas Beta";
const API = "https://api.appstoreconnect.apple.com";
const STORE_DIR = join(ROOT, "store");

export function envFile() {
  return [join(ROOT, ".env.testflight"), process.env.ASC_ENV].find((f) => f && existsSync(f));
}
function env() {
  const f = envFile();
  const out = { ...process.env };
  if (f) for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/^\$HOME|^~/, process.env.HOME);
  }
  for (const k of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"]) if (!out[k]) throw new Error(`Missing ${k}: put it in ios/.env.testflight (gitignored; copy moon-club's) or point ASC_ENV at such a file`);
  return out;
}

const b64u = (b) => Buffer.from(b).toString("base64url");
let cached;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.jwt;
  const e = env();
  const head = b64u(JSON.stringify({ alg: "ES256", kid: e.ASC_KEY_ID, typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: e.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: createPrivateKey(readFileSync(e.ASC_KEY_PATH)), dsaEncoding: "ieee-p1363" });
  cached = { jwt: `${head}.${body}.${b64u(sig)}`, exp: now + 1200 };
  return cached.jwt;
}

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const why = (json.errors ?? []).map((x) => `${x.title}: ${x.detail}`).join("; ") || text;
    const err = new Error(`${method} ${path} → ${r.status} ${why}`);
    err.status = r.status; err.body = json;
    throw err;
  }
  return json;
}

async function findApp() {
  return (await api("GET", `/v1/apps?filter[bundleId]=${BUNDLE}&limit=1`)).data[0] ?? null;
}
async function app() {
  const a = await findApp();
  if (!a) throw new Error(`No App Store Connect app for ${BUNDLE} yet. Create it once in the browser: App Store Connect → Apps → + → New App, iOS, name "Cold Gas", bundle id ${BUNDLE}, SKU coldgas.`);
  return a;
}

function version() {
  return readFileSync(join(ROOT, "project.yml"), "utf8").match(/MARKETING_VERSION:\s*"([^"]+)"/)[1];
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/u;

/** release-notes/<version>.md → TestFlight "What to Test": markdown stripped, ≤ 4000 characters, and no emoji
 *  (TestFlight's whatsNew refuses them as "invalid characters", §9). Style: release-notes/README.md. */
export function notesFor(v = version()) {
  const f = join(ROOT, "release-notes", `${v}.md`);
  if (!existsSync(f)) throw new Error(`No release notes for ${v}. Write release-notes/${v}.md first (style: release-notes/README.md).`);
  const raw = readFileSync(f, "utf8");
  if (EMOJI.test(raw)) throw new Error(`release-notes/${v}.md has an emoji; TestFlight refuses them.`);
  const text = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > 4000) throw new Error(`release-notes/${v}.md is ${text.length} characters; TestFlight allows 4000.`);
  return text;
}

// ── The listing, from ios/store/ (plain files, edited by hand) ────────────────────────────────────────────
const txt = (f) => readFileSync(join(STORE_DIR, f), "utf8").trim();
const json = (f) => JSON.parse(readFileSync(join(STORE_DIR, f), "utf8"));
export function storeListing() {
  const l = json("listing.json");
  return {
    ...l,
    subtitle: txt("subtitle.txt"),
    keywords: txt("keywords.txt"),
    promotionalText: txt("promotional-text.txt"),
    description: txt("description.txt"),
    reviewNotes: txt("review-notes.txt"),
    copyright: `${new Date().getUTCFullYear()} ${l.copyrightHolder}`,
  };
}
/** Apple's limits, checked offline so a listing never fails at upload time. */
async function storeLint() {
  const s = storeListing();
  const bad = [];
  for (const [k, max] of [["name", 30], ["subtitle", 30], ["keywords", 100], ["promotionalText", 170], ["description", 4000], ["reviewNotes", 4000]]) {
    if (!s[k]) bad.push(`${k} is empty`);
    else if (s[k].length > max) bad.push(`${k} is ${s[k].length} characters (max ${max})`);
  }
  for (const k of ["name", "subtitle", "keywords", "promotionalText", "description", "reviewNotes"]) if (EMOJI.test(s[k] ?? "")) bad.push(`${k} has an emoji`);
  if (/,\s/.test(s.keywords)) bad.push("keywords: no spaces after commas (they count against the 100)");
  for (const k of ["supportUrl", "privacyPolicyUrl"]) if (!/^https:\/\//.test(s[k] ?? "")) bad.push(`${k} must be an https URL`);
  const r = json("age-rating.json");
  if (!r.answers || typeof r.answers !== "object") bad.push("age-rating.json has no answers");
  if (bad.length) { for (const b of bad) console.log(`✗ store/: ${b}`); process.exitCode = 1; return; }
  console.log(`✓ store/ listing within Apple's limits (subtitle ${s.subtitle.length}/30, keywords ${s.keywords.length}/100, promo ${s.promotionalText.length}/170, description ${s.description.length}/4000)`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function group(appId, name, internal) {
  const r = await api("GET", `/v1/betaGroups?filter[app]=${appId}&filter[name]=${encodeURIComponent(name)}`);
  if (r.data.length) return r.data[0];
  const attributes = internal ? { name, isInternalGroup: true, hasAccessToAllBuilds: true } : { name, publicLinkEnabled: true, publicLinkLimitEnabled: true, publicLinkLimit: 25, feedbackEnabled: true };
  const c = await api("POST", "/v1/betaGroups", { data: { type: "betaGroups", attributes, relationships: { app: { data: { type: "apps", id: appId } } } } });
  console.log(`✓ created ${internal ? "internal" : "external"} group “${name}”`);
  return c.data;
}

async function ship(buildNumber) {
  if (!buildNumber) throw new Error("usage: asc.mjs ship <build number>");
  const notes = notesFor();
  const a = await app();
  let b;
  for (let i = 0; i < 60; i++) { // up to ~30 minutes: uploads take a while to appear and process
    const r = await api("GET", `/v1/builds?filter[app]=${a.id}&filter[version]=${buildNumber}&limit=1`);
    b = r.data[0];
    const state = b?.attributes.processingState;
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID") throw new Error(`Build ${buildNumber} processing ${state}`);
    process.stdout.write(i ? "." : `… waiting for build ${buildNumber} to finish processing `);
    await sleep(30000);
  }
  if (b?.attributes.processingState !== "VALID") throw new Error(`Build ${buildNumber} still processing; rerun: node scripts/asc.mjs ship ${buildNumber}`);
  console.log(`\n✓ build ${buildNumber} processed`);

  const locs = await api("GET", `/v1/builds/${b.id}/betaBuildLocalizations`);
  const en = locs.data.find((l) => l.attributes.locale === "en-US");
  if (en) await api("PATCH", `/v1/betaBuildLocalizations/${en.id}`, { data: { type: "betaBuildLocalizations", id: en.id, attributes: { whatsNew: notes } } });
  else await api("POST", "/v1/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew: notes }, relationships: { build: { data: { type: "builds", id: b.id } } } } });
  console.log("✓ release notes set (What to Test)");

  await group(a.id, INTERNAL, true);
  await crew();

  if (process.env.BETA_EXTERNAL === "1") {
    const g = await group(a.id, EXTERNAL, false);
    await api("POST", `/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: "builds", id: b.id }] });
    try {
      await api("POST", "/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: b.id } } } } });
      console.log(`✓ submitted for Beta App Review; “${EXTERNAL}” gets it once approved`);
    } catch (e) {
      if (e.status === 409) console.log(`• Beta App Review: ${e.message.split("→")[1].trim()}`);
      else throw e;
    }
  }
}

async function bundle() {
  for (const t of TARGETS) await bundleId(t);
}
/** Find or register one bundle id (idempotent). */
async function bundleId(t) {
  const r = await api("GET", `/v1/bundleIds?filter[identifier]=${t.id}`);
  const hit = r.data.find((x) => x.attributes.identifier === t.id);
  if (hit) { console.log(`✓ bundle id ${t.id} already registered`); return hit; }
  const c = (await api("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: t.id, name: t.name, platform: "IOS" } } })).data;
  console.log(`✓ registered bundle id ${t.id}`);
  return c;
}

async function whoami() {
  const r = await api("GET", "/v1/apps?limit=50&fields[apps]=name,bundleId");
  console.log(`✓ key works — ${r.data.length} app(s) visible`);
  for (const x of r.data) console.log(`  ${x.attributes.bundleId}  ${x.attributes.name}`);
}

/** What exists for COLD GAS, read-only: the bundle id, its profiles, the app record, versions and builds. */
async function status() {
  const ids = (await api("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE}`)).data.filter((x) => x.attributes.identifier === BUNDLE);
  if (!ids.length) console.log(`• bundle id ${BUNDLE}: not registered (node scripts/asc.mjs bundle, or scripts/provision.sh)`);
  for (const b of ids) {
    console.log(`✓ bundle id ${BUNDLE}: registered as “${b.attributes.name}” (${b.attributes.platform}, seed ${b.attributes.seedId})`);
    const profs = (await api("GET", `/v1/bundleIds/${b.id}/profiles?limit=50`).catch(() => ({ data: [] }))).data;
    for (const p of profs) console.log(`  profile “${p.attributes.name}” ${p.attributes.profileType} ${p.attributes.profileState} (expires ${p.attributes.expirationDate?.slice(0, 10)})`);
    const caps = (await api("GET", `/v1/bundleIds/${b.id}/bundleIdCapabilities`).catch(() => ({ data: [] }))).data.map((c) => c.attributes.capabilityType);
    if (caps.length) console.log(`  capabilities: ${caps.join(", ")}`);
  }
  const a = await findApp();
  if (!a) { console.log(`• App Store Connect app record for ${BUNDLE}: none (create it in the browser: Apps → + → New App)`); return; }
  console.log(`✓ app record: “${a.attributes.name}” (id ${a.id}, SKU ${a.attributes.sku}, primary locale ${a.attributes.primaryLocale})`);
  const vs = (await api("GET", `/v1/apps/${a.id}/appStoreVersions?limit=10`)).data;
  for (const v of vs) console.log(`  App Store version ${v.attributes.versionString} ${v.attributes.platform} ${v.attributes.appStoreState}`);
  const bs = (await api("GET", `/v1/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=10`)).data;
  console.log(`  builds: ${bs.length ? bs.map((x) => `${x.attributes.version} (${x.attributes.processingState})`).join(", ") : "none uploaded"}`);
  const gs = (await api("GET", `/v1/betaGroups?filter[app]=${a.id}&limit=20`)).data;
  console.log(`  TestFlight groups: ${gs.length ? gs.map((g) => `${g.attributes.name}${g.attributes.isInternalGroup ? " (internal)" : ""}`).join(", ") : "none"}`);
}

/** Distribution signing without Xcode cloud signing (App Manager keys can't use it):
 *  an Apple Distribution certificate from our own CSR, plus an App Store profile, both installed locally.
 *  The certificate is the team's one moon-club already made (~/.appstoreconnect/signing/dist.cer.id): reused, not
 *  re-minted, so the team never runs out of distribution certificates. */
async function signing() {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdirSync, readdirSync, unlinkSync } = await import("node:fs");
  const dir = join(process.env.HOME, ".appstoreconnect", "signing");
  const certs = await api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=50");
  const keyPath = join(dir, "dist.key");
  const mine = existsSync(join(dir, "dist.cer.id")) && certs.data.find((c) => c.id === readFileSync(join(dir, "dist.cer.id"), "utf8").trim());
  let cert = mine;
  if (!cert) {
    if (!existsSync(join(dir, "dist.csr"))) throw new Error(`No distribution CSR in ${dir} (moon-club's scripts made it). Run moon-club's \`node scripts/asc.mjs signing\` once, or make dist.key + dist.csr with openssl.`);
    const csr = readFileSync(join(dir, "dist.csr"), "utf8");
    cert = (await api("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } } })).data;
    writeFileSync(join(dir, "dist.cer.id"), cert.id);
    console.log("✓ created Apple Distribution certificate");
  } else console.log(`✓ Apple Distribution certificate ${cert.attributes.name ?? ""} (expires ${cert.attributes.expirationDate?.slice(0, 10)}), shared with moon-club`);
  const der = Buffer.from(cert.attributes.certificateContent, "base64");
  writeFileSync(join(dir, "dist.cer"), der);
  // The .p12 password only carries the identity into the login keychain on this Mac; it matches moon-club's.
  execFileSync("sh", ["-c", `openssl x509 -inform der -in "${dir}/dist.cer" -out "${dir}/dist.pem" && openssl pkcs12 -export -legacy -inkey "${keyPath}" -in "${dir}/dist.pem" -out "${dir}/dist.p12" -passout pass:moonclub 2>/dev/null || openssl pkcs12 -export -inkey "${keyPath}" -in "${dir}/dist.pem" -out "${dir}/dist.p12" -passout pass:moonclub; security import "${dir}/dist.p12" -k ~/Library/Keychains/login.keychain-db -P moonclub -T /usr/bin/codesign >/dev/null 2>&1 || true`]);
  console.log("✓ distribution identity in the login keychain");
  const pdir = join(process.env.HOME, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles");
  mkdirSync(pdir, { recursive: true });
  for (const t of TARGETS) {
    const bid = await bundleId(t);
    const profs = await api("GET", `/v1/profiles?filter[name]=${encodeURIComponent(t.profile)}&limit=10`);
    for (const p of profs.data) await api("DELETE", `/v1/profiles/${p.id}`); // re-create so it always holds the current cert
    // Drop stale local copies of this profile name, so the export can only pick the fresh one.
    for (const f of readdirSync(pdir).filter((f) => f.endsWith(".mobileprovision"))) {
      try {
        const xml = execFileSync("security", ["cms", "-D", "-i", join(pdir, f)], { stdio: ["ignore", "pipe", "ignore"] }).toString();
        if (xml.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/)?.[1] === t.profile) unlinkSync(join(pdir, f));
      } catch {}
    }
    const prof = (await api("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name: t.profile, profileType: "IOS_APP_STORE" }, relationships: {
      bundleId: { data: { type: "bundleIds", id: bid.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } } } })).data;
    writeFileSync(join(pdir, `${prof.attributes.uuid}.mobileprovision`), Buffer.from(prof.attributes.profileContent, "base64"));
    console.log(`✓ installed profile “${t.profile}” (${prof.attributes.uuid})`);
  }
}

/** Put every App Store Connect team member into the internal group (internal testers must be team users). */
async function crew() {
  const a = await app();
  const g = await group(a.id, INTERNAL, true);
  const users = (await api("GET", "/v1/users?limit=100")).data;
  const have = new Set((await api("GET", `/v1/betaGroups/${g.id}/betaTesters?limit=200`)).data.map((t) => (t.attributes.email || "").toLowerCase()));
  let added = 0;
  for (const u of users) {
    const email = (u.attributes.username || "").toLowerCase();
    if (!email || have.has(email)) continue;
    try {
      await api("POST", "/v1/betaTesters", { data: { type: "betaTesters", attributes: { email, firstName: u.attributes.firstName, lastName: u.attributes.lastName },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: g.id }] } } } });
      added++;
    } catch (e) { if (e.status !== 409) throw e; }
  }
  console.log(`✓ “${INTERNAL}”: ${have.size + added} tester(s) (${added} added); each gets a TestFlight invite email`);
}

/** Debug passthrough: node scripts/asc.mjs call GET "/v1/bundleIds?limit=5" ['<json body>'] (prints JSON; never the key). */
async function call(method, path, body) { console.log(JSON.stringify(await api(method, path, body ? JSON.parse(body) : undefined), null, 2)); }

// ── App Store submission (docs/NATIVE.md §9) ──────────────────────────────────────────────────────────────
// Everything below only edits the draft App Store version (reversible, nothing public) except `submit`,
// which sends the version to App Review and needs `--yes`.

/** Required screenshot sets: display type → [width, height] (portrait) and the folder they come from.
 *  There is no APP_IPHONE_69: 6.9" (1320×2868) goes in APP_IPHONE_67. APP_IPHONE_DUO earns the "Made for iPhone Duo"
 *  badge with a 27.1+ SDK build (moon-club). The app is universal since 1.1.0 (TARGETED_DEVICE_FAMILY 1,2: 0210), so the
 *  13" iPad set is required too: APP_IPAD_PRO_3GEN_129 takes 2064×2752 (the M4/M5 13") or 2048×2732, either way up. */
const SHOT_SETS = [
  { types: ["APP_IPHONE_67"], sizes: [[1320, 2868], [2868, 1320]], dir: "iphone-69", label: '6.9" iPhone', required: true },
  { types: ["APP_IPAD_PRO_3GEN_129"], sizes: [[2064, 2752], [2752, 2064], [2048, 2732], [2732, 2048]], dir: "ipad-13", label: '13" iPad', required: true },
  { types: ["APP_IPHONE_DUO"], sizes: [[1398, 2034], [2007, 2853]], dir: "iphone-duo", label: "iPhone Duo (outer/inner)", required: false },
];
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);

async function appInfo(appId) {
  const r = await api("GET", `/v1/apps/${appId}/appInfos`);
  return r.data.find((i) => i.attributes.appStoreState !== "READY_FOR_SALE" && i.attributes.state !== "READY_FOR_DISTRIBUTION") ?? r.data[0];
}
/** The editable App Store version (created from MARKETING_VERSION if there is none). */
async function storeVersion(appId, create = false) {
  const v = version();
  const all = (await api("GET", `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
  let sv = all.find((x) => EDITABLE.has(x.attributes.appStoreState));
  if (!sv && create) {
    sv = (await api("POST", "/v1/appStoreVersions", { data: { type: "appStoreVersions", attributes: { platform: "IOS", versionString: v }, relationships: { app: { data: { type: "apps", id: appId } } } } })).data;
    console.log(`✓ created App Store version ${v}`);
  }
  return { sv, shipped: all.some((x) => x.attributes.appStoreState === "READY_FOR_SALE") };
}
async function upsert(listPath, type, createRel, match, attributes) {
  const hit = (await api("GET", listPath)).data.find(match);
  if (hit) { const { locale, ...rest } = attributes; return (await api("PATCH", `/v1/${type}/${hit.id}`, { data: { type, id: hit.id, attributes: rest } })).data; }
  return (await api("POST", `/v1/${type}`, { data: { type, attributes, relationships: createRel } })).data;
}
/** Newest processed build for this version. */
async function storeBuild(appId, v = version()) {
  const pre = (await api("GET", `/v1/preReleaseVersions?filter[app]=${appId}&filter[version]=${v}&filter[platform]=IOS`)).data[0];
  if (!pre) return null;
  const builds = (await api("GET", `/v1/builds?filter[preReleaseVersion]=${pre.id}&filter[processingState]=VALID&sort=-uploadedDate&limit=50`)).data.filter((b) => !b.attributes.expired);
  return builds[0] ?? null;
}

async function storeMeta() {
  const e = env();
  const STORE = storeListing();
  // The store/ texts describe one version (listing.json forVersion). Never push one version's copy onto another: the
  // 1.1.0 copy promotes on-device judging, which a 1.0.0 build doesn't have (0219). For a 1.0.x resubmission, check out
  // store/ from before 0219 instead.
  if (STORE.forVersion && STORE.forVersion !== version()) {
    throw new Error(`store/ is written for ${STORE.forVersion}, MARKETING_VERSION is ${version()}: bump the version, or use the store/ copy for ${version()} from git.`);
  }
  const a = await app();
  const { sv, shipped } = await storeVersion(a.id, true);
  const v = version();
  if (sv.attributes.versionString !== v) {
    await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { versionString: v } } });
    console.log(`✓ App Store version ${sv.attributes.versionString} → ${v} (matches MARKETING_VERSION)`);
  }
  await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { copyright: STORE.copyright, releaseType: "MANUAL" } } });
  // usesIdfa is null until answered, even with no ads, and blocks review with no reason given (18-0).
  try {
    await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { usesIdfa: false } } });
    console.log("✓ copyright, manual release, usesIdfa = no");
  } catch (err) { console.log(`• usesIdfa not set (${err.message.split("→")[1]?.trim()}): answer "No" under the version's Advertising Identifier in the browser`); }

  // Version localization (description, keywords, URLs; What's New only exists after the first release, 18-0).
  const loc = { description: STORE.description, keywords: STORE.keywords, promotionalText: STORE.promotionalText, supportUrl: STORE.supportUrl, marketingUrl: STORE.marketingUrl };
  if (shipped) loc.whatsNew = notesFor(v);
  await upsert(`/v1/appStoreVersions/${sv.id}/appStoreVersionLocalizations`, "appStoreVersionLocalizations",
    { appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } }, (l) => l.attributes.locale === "en-US", { locale: "en-US", ...loc });
  console.log(`✓ en-US listing: description, keywords, promotional text, support + marketing URLs${shipped ? ", What's New" : " (What's New starts with the 2nd release)"}`);

  // App info: name, subtitle, privacy policy, categories.
  const info = await appInfo(a.id);
  try {
    await upsert(`/v1/appInfos/${info.id}/appInfoLocalizations`, "appInfoLocalizations", { appInfo: { data: { type: "appInfos", id: info.id } } },
      (l) => l.attributes.locale === "en-US", { locale: "en-US", name: STORE.name, subtitle: STORE.subtitle, privacyPolicyUrl: STORE.privacyPolicyUrl });
    console.log(`✓ name “${STORE.name}”, subtitle, privacy policy URL`);
  } catch (err) {
    if (/name/i.test(err.message) && err.status === 409) console.log(`✗ the name “${STORE.name}” is not available: ${err.message}`);
    else throw err;
  }
  const rel = (id, type = "appCategories") => ({ data: id ? { type, id } : null });
  const c = STORE.categories;
  await api("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: {
    primaryCategory: rel(c.primary), primarySubcategoryOne: rel(c.primarySubcategories[0]), primarySubcategoryTwo: rel(c.primarySubcategories[1]),
    secondaryCategory: rel(c.secondary) } } });
  console.log(`✓ categories: ${c.primary} › ${c.primarySubcategories.join(", ")}${c.secondary ? `; ${c.secondary}` : ""}`);

  await api("PATCH", `/v1/apps/${a.id}`, { data: { type: "apps", id: a.id, attributes: { contentRightsDeclaration: STORE.contentRights } } });
  console.log(`✓ content rights: ${STORE.contentRights}`);

  // App Review contact + notes (contact from .env.testflight; never printed).
  for (const k of ["BETA_CONTACT_FIRST", "BETA_CONTACT_LAST", "BETA_CONTACT_EMAIL", "BETA_CONTACT_PHONE"]) if (!e[k]) throw new Error(`Missing ${k} in .env.testflight`);
  const review = { contactFirstName: e.BETA_CONTACT_FIRST, contactLastName: e.BETA_CONTACT_LAST, contactEmail: e.BETA_CONTACT_EMAIL, contactPhone: e.BETA_CONTACT_PHONE,
    demoAccountRequired: false, notes: STORE.reviewNotes };
  const rd = await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreReviewDetail`).catch((err) => (err.status === 404 ? { data: null } : Promise.reject(err)));
  if (rd.data) await api("PATCH", `/v1/appStoreReviewDetails/${rd.data.id}`, { data: { type: "appStoreReviewDetails", id: rd.data.id, attributes: review } });
  else await api("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: review, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } } } });
  console.log("✓ App Review contact and notes");

  await storePricing(a.id);
  await storeAttach(a.id, sv);
}

/** Free in every territory, including new ones. A new app has no price schedule at all, and a free app still needs
 *  one (18-0). */
async function storePricing(appId) {
  const have = await api("GET", `/v1/apps/${appId}/appPriceSchedule?include=manualPrices`).catch(() => null);
  const prices = have?.included?.filter((x) => x.type === "appPrices") ?? [];
  let free = false;
  if (prices.length) {
    const pp = await api("GET", `/v1/appPriceSchedules/${have.data.id}/manualPrices?include=appPricePoint&limit=5`).catch(() => null);
    free = (pp?.included ?? []).every((p) => Number(p.attributes.customerPrice) === 0) && (pp?.included ?? []).length > 0;
  }
  if (!free) {
    const points = await api("GET", `/v1/apps/${appId}/appPricePoints?filter[territory]=USA&limit=200`);
    const zero = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
    if (!zero) throw new Error("No free price point for USA");
    await api("POST", "/v1/appPriceSchedules", {
      data: { type: "appPriceSchedules", relationships: { app: { data: { type: "apps", id: appId } }, baseTerritory: { data: { type: "territories", id: "USA" } },
        manualPrices: { data: [{ type: "appPrices", id: "${free}" }] } } },
      included: [{ type: "appPrices", id: "${free}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: zero.id } } } }],
    });
  }
  console.log("✓ price: free");
  const avail = await api("GET", `/v1/apps/${appId}/appAvailabilityV2`).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
  const territories = [];
  for (let next = "/v1/territories?limit=200"; next; ) {
    const r = await api("GET", next.replace(API, ""));
    territories.push(...r.data.map((t) => t.id));
    next = r.links?.next;
  }
  if (avail?.data) {
    const ta = [];
    for (let next = `/v2/appAvailabilities/${avail.data.id}/territoryAvailabilities?limit=200&include=territory`; next; ) {
      const r = await api("GET", next.replace(API, ""));
      ta.push(...r.data);
      next = r.links?.next;
    }
    const off = ta.filter((t) => !t.attributes.available);
    for (const t of off) await api("PATCH", `/v1/territoryAvailabilities/${t.id}`, { data: { type: "territoryAvailabilities", id: t.id, attributes: { available: true } } }).catch((err) => console.log(`• ${t.id}: ${err.message.split("→")[1]?.trim()}`));
    console.log(`✓ available in ${ta.length} territories${off.length ? ` (${off.length} switched on)` : ""}`);
    return;
  }
  await api("POST", "/v2/appAvailabilities", {
    data: { type: "appAvailabilities", attributes: { availableInNewTerritories: true }, relationships: { app: { data: { type: "apps", id: appId } },
      territoryAvailabilities: { data: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}` })) } } },
    included: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}`, attributes: { available: true, releaseDate: null, preOrderEnabled: false }, relationships: { territory: { data: { type: "territories", id: t } } } })),
  });
  console.log(`✓ available in all ${territories.length} territories (and new ones)`);
}

/** Attach the newest processed build of this version, if one has processed. */
async function storeAttach(appId, sv) {
  const build = await storeBuild(appId);
  if (!build) { console.log(`• no processed build for ${version()} yet: make testflight, then node scripts/asc.mjs store-meta again`); return; }
  await api("PATCH", `/v1/appStoreVersions/${sv.id}/relationships/build`, { data: { type: "builds", id: build.id } });
  console.log(`✓ build ${build.attributes.version} attached`);
}

/** Age rating, answered truthfully from store/age-rating.json (each answer's reason is in that file). */
async function storeRating() {
  const RATING = json("age-rating.json").answers;
  const a = await app();
  const info = await appInfo(a.id);
  const d = await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const known = new Set(Object.keys(d.data.attributes));
  const attrs = Object.fromEntries(Object.entries(RATING).filter(([k]) => known.has(k)));
  const skipped = Object.keys(RATING).filter((k) => !known.has(k));
  try {
    await api("PATCH", `/v1/ageRatingDeclarations/${d.data.id}`, { data: { type: "ageRatingDeclarations", id: d.data.id, attributes: attrs } });
  } catch (err) {
    // An attribute this API version rejects: drop it and say so, rather than guessing.
    const bad = Object.keys(attrs).filter((k) => err.message.includes(k));
    if (!bad.length) throw err;
    for (const k of bad) delete attrs[k];
    skipped.push(...bad);
    await api("PATCH", `/v1/ageRatingDeclarations/${d.data.id}`, { data: { type: "ageRatingDeclarations", id: d.data.id, attributes: attrs } });
  }
  const after = (await api("GET", `/v1/appInfos/${info.id}`)).data.attributes;
  const unanswered = Object.entries((await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes).filter(([k, v]) => v === null && !/kidsAgeBand|Url|Number|brazil|korea/i.test(k)).map(([k]) => k);
  console.log(`✓ age rating questionnaire: ${Object.keys(attrs).length} answers → ${after.appStoreAgeRating ?? "(rating computed on submit)"}`);
  if (skipped.length) console.log(`• not set (not in this API version): ${skipped.join(", ")}`);
  if (unanswered.length) console.log(`• still unanswered: ${unanswered.join(", ")} — answer in App Store Connect → App Information → Age Rating`);
}

/** Upload build/store-shots/<set>/*.png to the en-US screenshot sets. Idempotent: an identical set is left alone. */
async function storeShots(dir = join(ROOT, "build", "store-shots")) {
  const { createHash } = await import("node:crypto");
  const { readdirSync } = await import("node:fs");
  const a = await app();
  const { sv } = await storeVersion(a.id, true);
  const loc = (await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreVersionLocalizations`)).data.find((l) => l.attributes.locale === "en-US");
  if (!loc) throw new Error("No en-US listing yet: run node scripts/asc.mjs store-meta first");
  const sets = (await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;
  for (const s of SHOT_SETS) {
    const folder = join(dir, s.dir);
    const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".png")).sort() : [];
    if (!files.length) { console.log(`${s.required ? "✗" : "•"} ${s.label}: no PNGs in ${folder}`); continue; }
    if (files.length > 10) throw new Error(`${s.label}: ${files.length} screenshots (max 10)`);
    const local = files.map((f) => {
      const buf = readFileSync(join(folder, f));
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      if (!s.sizes.some(([sw, sh]) => sw === w && sh === h)) throw new Error(`${f} is ${w}×${h}; ${s.label} needs ${s.sizes.map((x) => x.join("×")).join(" or ")}`);
      return { f, buf, md5: createHash("md5").update(buf).digest("hex") };
    });
    let set = sets.find((x) => s.types.includes(x.attributes.screenshotDisplayType));
    for (const t of s.types) {
      if (set) break;
      try {
        set = (await api("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: t },
          relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } })).data;
      } catch (err) { if (t === s.types.at(-1)) throw err; }
    }
    const remote = (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data;
    // Apple fills sourceFileChecksum only after processing, so a just-uploaded set matches on name + size until then.
    const same = (r, l) => r.attributes.fileName === l.f && r.attributes.fileSize === l.buf.length && r.attributes.assetDeliveryState?.state !== "FAILED"
      && (r.attributes.sourceFileChecksum == null || r.attributes.sourceFileChecksum === l.md5);
    if (remote.length === local.length && remote.every((r, i) => same(r, local[i]))) {
      console.log(`✓ ${s.label} (${set.attributes.screenshotDisplayType}): ${local.length} screenshots already up to date`);
      continue;
    }
    for (const r of remote) await api("DELETE", `/v1/appScreenshots/${r.id}`);
    const ids = [];
    for (const l of local) {
      const shot = (await api("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: l.f, fileSize: l.buf.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } })).data;
      for (const op of shot.attributes.uploadOperations) {
        const r = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: l.buf.subarray(op.offset, op.offset + op.length) });
        if (!r.ok) throw new Error(`upload ${l.f} part @${op.offset} → ${r.status}`);
      }
      await api("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: l.md5 } } });
      ids.push(shot.id);
    }
    await api("PATCH", `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: "appScreenshots", id })) });
    let st = [];
    for (let i = 0; i < 100; i++) { // up to ~5 minutes
      st = (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data.map((x) => x.attributes.assetDeliveryState?.state);
      if (st.every((x) => x === "COMPLETE")) break;
      const failed = st.filter((x) => x === "FAILED").length;
      if (failed) throw new Error(`${s.label}: ${failed} screenshot(s) failed processing`);
      await sleep(3000);
    }
    const pending = st.filter((x) => x !== "COMPLETE").length;
    console.log(`✓ ${s.label} (${set.attributes.screenshotDisplayType}): uploaded ${ids.length} screenshots${pending ? ` (${pending} still processing at Apple)` : ""}`);
  }
}

/** Readiness report: every blocker, with how to fix it. Exit code 1 if anything blocks submission. Read-only. */
async function storeCheck() {
  const out = [];
  const ok = (m) => out.push(["ok", m]);
  const bad = (m, fix) => out.push(["block", m, fix]);
  const warn = (m, fix) => out.push(["warn", m, fix]);
  const a = await findApp();
  if (!a) {
    bad(`No App Store Connect app record for ${BUNDLE}`, "App Store Connect → Apps → + → New App (iOS, \"Cold Gas\", SKU coldgas)");
  } else {
    const v = version();
    const { sv, shipped } = await storeVersion(a.id);
    if (!sv) bad("No editable App Store version", "node scripts/asc.mjs store-meta");
    else if (sv.attributes.versionString !== v) bad(`App Store version is ${sv.attributes.versionString}, MARKETING_VERSION is ${v}`, "node scripts/asc.mjs store-meta");
    else ok(`App Store version ${v} (${sv.attributes.appStoreState})`);

    if (sv) {
      if (sv.attributes.usesIdfa == null) bad("Advertising identifier (usesIdfa) unanswered", "node scripts/asc.mjs store-meta"); else ok(`usesIdfa = ${sv.attributes.usesIdfa}`);
      const b = (await api("GET", `/v1/appStoreVersions/${sv.id}/build`).catch(() => ({ data: null }))).data;
      if (!b) bad("No build attached", "make testflight, then node scripts/asc.mjs store-meta");
      else ok(`Build ${b.attributes.version} attached${b.attributes.usesNonExemptEncryption === false ? " (no non-exempt encryption)" : ""}`);

      const loc = (await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreVersionLocalizations`)).data.find((l) => l.attributes.locale === "en-US");
      const missing = loc ? ["description", "keywords", "supportUrl"].filter((k) => !loc.attributes[k]) : ["en-US listing"];
      if (shipped && loc && !loc.attributes.whatsNew) missing.push("whatsNew");
      if (missing.length) bad(`Listing incomplete: ${missing.join(", ")}`, "node scripts/asc.mjs store-meta");
      else ok("Listing: description, keywords, promotional text, support/marketing URLs");
      if (!sv.attributes.copyright) bad("No copyright", "node scripts/asc.mjs store-meta"); else ok(`Copyright: ${sv.attributes.copyright}`);

      if (loc) {
        const sets = await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`);
        for (const s of SHOT_SETS) {
          const set = sets.data.find((x) => s.types.includes(x.attributes.screenshotDisplayType));
          const n = set ? (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data.filter((x) => x.attributes.assetDeliveryState?.state === "COMPLETE").length : 0;
          if (!n && s.required) bad(`No ${s.label} screenshots`, "node scripts/asc.mjs store-shots");
          else if (!n) warn(`No ${s.label} screenshots (optional: they earn the Made for iPhone Duo badge)`, "node scripts/asc.mjs store-shots");
          else ok(`${s.label} screenshots: ${n}`);
        }
      }
      const rd = await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
      const r = rd.data?.attributes;
      if (!r?.contactEmail || !r?.contactPhone || !r?.contactFirstName) bad("App Review contact missing", "node scripts/asc.mjs store-meta (BETA_CONTACT_* in .env.testflight)");
      else if (!r.notes) bad("App Review notes missing", "node scripts/asc.mjs store-meta");
      else ok("App Review contact and notes");
    }

    const info = await appInfo(a.id);
    const il = (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data.find((l) => l.attributes.locale === "en-US")?.attributes;
    if (!il?.name) bad("No app name", "node scripts/asc.mjs store-meta"); else ok(`Name: ${il.name}${il.subtitle ? ` — ${il.subtitle}` : ""}`);
    if (!il?.privacyPolicyUrl) bad("No privacy policy URL", "node scripts/asc.mjs store-meta");
    const cat = (await api("GET", `/v1/appInfos/${info.id}/primaryCategory`).catch(() => ({ data: null }))).data;
    if (!cat) bad("No primary category", "node scripts/asc.mjs store-meta"); else ok(`Primary category: ${cat.id}`);

    const ard = (await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes;
    const nulls = Object.entries(ard).filter(([k, x]) => x === null && !/kidsAgeBand|Url|Number|brazil|korea/i.test(k)).map(([k]) => k);
    if (nulls.length) bad(`Age rating unanswered: ${nulls.join(", ")}`, "node scripts/asc.mjs store-rating");
    else ok(`Age rating answered${info.attributes.appStoreAgeRating ? ` (${info.attributes.appStoreAgeRating})` : ""}`);

    const attrs = (await api("GET", `/v1/apps/${a.id}`)).data.attributes;
    if (!attrs.contentRightsDeclaration) bad("Content rights not declared", "node scripts/asc.mjs store-meta"); else ok(`Content rights: ${attrs.contentRightsDeclaration}`);
    const ps = await api("GET", `/v1/apps/${a.id}/appPriceSchedule?include=manualPrices`).catch(() => null);
    if (!ps?.included?.some((x) => x.type === "appPrices")) bad("No price set (a new app has none, and a free app still needs one)", "node scripts/asc.mjs store-meta"); else ok("Price schedule set");
    const av = await api("GET", `/v1/apps/${a.id}/appAvailabilityV2`).catch(() => null);
    if (!av?.data) bad("Availability not set", "node scripts/asc.mjs store-meta"); else ok(`Availability set${av.data.attributes.availableInNewTerritories ? " (incl. new territories)" : ""}`);
  }

  // The privacy policy must load and be a privacy page: the site serves a 404 or the game for an unknown path.
  const policy = storeListing().privacyPolicyUrl;
  const page = await fetch(policy).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (!page) bad(`Privacy policy URL doesn't load: ${policy}`, "publish the page (see store/app-privacy.md)");
  else if (!/privacy/i.test(page.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "")) bad(`Privacy policy URL loads, but it isn't a privacy page: ${policy}`, "publish the page (see store/app-privacy.md)");
  else ok(`Privacy policy: ${policy}`);

  // Things the API can't see: say so every time, so nobody assumes they're done (18-0).
  warn("App Privacy (the nutrition label) has no API", "App Store Connect → App Privacy: the answers in store/app-privacy.md, then Publish");
  warn("Agreements, tax and banking aren't visible to an App Manager key (a free app needs only the Free Apps agreement)", "App Store Connect → Business");
  const plist = readFileSync(join(ROOT, "ColdGas", "Info.plist"), "utf8");
  if (/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist)) ok("Export compliance: ITSAppUsesNonExemptEncryption = false in Info.plist");
  else bad("Export compliance key missing from ColdGas/Info.plist", "add ITSAppUsesNonExemptEncryption = false");

  const icon = { ok: "✓", warn: "•", block: "✗" };
  for (const [k, m, fix] of out) console.log(`${icon[k]} ${m}${fix ? `\n    → ${fix}` : ""}`);
  const blockers = out.filter((x) => x[0] === "block").length;
  console.log(blockers ? `\n${blockers} blocker(s) before \`node scripts/asc.mjs submit --yes\`.` : "\nReady: once the App Privacy label is published and the owner says yes, `node scripts/asc.mjs submit --yes` sends it to App Review.");
  if (blockers) process.exitCode = 1;
}

/** Send the draft version to App Review. Needs --yes: the one public step, and only on a fresh yes from the owner. */
async function submit() {
  if (!process.argv.includes("--yes")) {
    console.log("This sends Cold Gas to App Review. Check first: node scripts/asc.mjs store-check\nThen, on the owner's yes: node scripts/asc.mjs submit --yes");
    process.exitCode = 2; return;
  }
  const a = await app();
  const { sv } = await storeVersion(a.id);
  if (!sv) throw new Error("No editable App Store version");
  // A rejected version's submission stays open as UNRESOLVED_ISSUES and is the one to send again.
  const open = (await api("GET", `/v1/reviewSubmissions?filter[app]=${a.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=5`)).data[0];
  const subm = open ?? (await api("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: a.id } } } } })).data;
  const items = (await api("GET", `/v1/reviewSubmissions/${subm.id}/items?include=appStoreVersion`)).data;
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === sv.id))
    await api("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: subm.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } } } });
  await api("PATCH", `/v1/reviewSubmissions/${subm.id}`, { data: { type: "reviewSubmissions", id: subm.id, attributes: { submitted: true } } });
  console.log(`✓ Cold Gas ${sv.attributes.versionString} submitted for App Review (submission ${subm.id}). It waits for a manual release once approved.`);
}

/** Withdraw the submission that is waiting for (or in) review, so the version can be edited and sent again. Needs --yes:
 *  it changes what Apple is reviewing, so only on the owner's yes (§9). Waits until Apple has let the version go. */
async function cancel() {
  if (!process.argv.includes("--yes")) {
    console.log("This withdraws Cold Gas from App Review. On the owner's yes: node scripts/asc.mjs cancel --yes");
    process.exitCode = 2; return;
  }
  const a = await app();
  const live = (await api("GET", `/v1/reviewSubmissions?filter[app]=${a.id}&filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,READY_FOR_REVIEW&limit=5`)).data;
  if (!live.length) { console.log("• no submission waiting for review"); return; }
  for (const x of live) {
    await api("PATCH", `/v1/reviewSubmissions/${x.id}`, { data: { type: "reviewSubmissions", id: x.id, attributes: { canceled: true } } });
    console.log(`✓ submission ${x.id} (${x.attributes.state}) cancelled`);
  }
  for (let i = 0; i < 40; i++) { // Apple takes a moment to move the version back to editable
    const vs = (await api("GET", `/v1/apps/${a.id}/appStoreVersions?filter[platform]=IOS&limit=5`)).data;
    if (!vs.some((v) => ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(v.attributes.appStoreState))) {
      for (const v of vs) console.log(`  App Store version ${v.attributes.versionString} ${v.attributes.appStoreState}`);
      return;
    }
    await sleep(3000);
  }
  console.log("• Apple is still releasing the version; check: node scripts/asc.mjs status");
}

/** Associated Domains on the App ID (0253): the entitlement applinks:mutaafaziz.com needs it. Idempotent. */
async function applinks() {
  const b = (await api("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE}`)).data.find((x) => x.attributes.identifier === BUNDLE);
  if (!b) throw new Error(`${BUNDLE} isn't registered: node scripts/asc.mjs bundle`);
  const caps = (await api("GET", `/v1/bundleIds/${b.id}/bundleIdCapabilities`)).data.map((c) => c.attributes.capabilityType);
  if (caps.includes("ASSOCIATED_DOMAINS")) { console.log(`✓ Associated Domains already on for ${BUNDLE}`); return; }
  await api("POST", "/v1/bundleIdCapabilities", { data: { type: "bundleIdCapabilities", attributes: { capabilityType: "ASSOCIATED_DOMAINS" },
    relationships: { bundleId: { data: { type: "bundleIds", id: b.id } } } } });
  console.log(`✓ Associated Domains turned on for ${BUNDLE}; run \`node scripts/asc.mjs signing\` before the next archive`);
}

const [cmd, arg] = process.argv.slice(2);
const run = { whoami, status, bundle, applinks, signing, crew, call: () => call(arg, process.argv[4], process.argv[5]),
  "store-lint": storeLint, "store-check": storeCheck, "store-meta": storeMeta, "store-rating": storeRating, "store-shots": () => storeShots(arg),
  submit, cancel, ship: () => ship(arg), notes: () => console.log(notesFor(arg)) }[cmd];
if (!run) { console.log("usage: asc.mjs whoami | status | bundle | applinks | signing | ship <build> | notes [version] | store-lint | store-check | store-meta | store-rating | store-shots [dir] | submit --yes | cancel --yes"); process.exit(2); }
Promise.resolve().then(run).catch((e) => { console.error("✗ " + e.message); process.exit(1); });
