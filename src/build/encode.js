// BUILD: a build as a short string, for the URL hash (#b=…) and local saves. No server.
//
// Binary, then base64url (no padding):
//   u8 version (1) · u8 n + n ASCII bytes: the arena ('sandbox', 'stelvio', …)
//   f32 ×3 anchor (the first item's position) · u16 item count
//   per item, 11 bytes: u8 type (0–63 a piece, PIECE_IDS order; 128+ a power-up, POWERUP_IDS order)
//     · u8 flags (bits 0–1 material, MATERIAL_IDS order; bit 2 hidden)
//     · i16 dx (dm) · i16 dy (cm) · i16 dz (dm) from the anchor · u16 yaw (centidegrees) · u8 scale ×20
// The editor snaps to a 0.5 m grid, 15° and 0.25 scale steps, so a round trip is exact.
import { PIECE_IDS, POWERUP_IDS, MATERIAL_IDS, BUDGET } from './catalogue.js';

export const BUILD_VERSION = 1;
const ITEM = 11;
const D2R = Math.PI / 180;

function toB64url(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const b = str.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b + '==='.slice((b.length + 3) % 4));
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

const typeCode = (type) => {
  if (String(type).startsWith('pickup:')) { const i = POWERUP_IDS.indexOf(type.slice(7)); return i < 0 ? -1 : 128 + i; }
  return PIECE_IDS.indexOf(type);
};
const typeOf = (code) => (code >= 128 ? (POWERUP_IDS[code - 128] ? `pickup:${POWERUP_IDS[code - 128]}` : null) : PIECE_IDS[code] || null);
const clampI16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

// items: [{ type, transform: { x, y, z, yaw, scale }, material, hidden }]
export function encodeBuild(arena, items) {
  const name = String(arena || 'sandbox').replace(/[^\w:-]/g, '').slice(0, 32);
  const list = items.filter((o) => typeCode(o.type) >= 0).slice(0, BUDGET.build + 32);
  const buf = new ArrayBuffer(2 + name.length + 12 + 2 + list.length * ITEM);
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let o = 0;
  dv.setUint8(o++, BUILD_VERSION);
  dv.setUint8(o++, name.length);
  for (let i = 0; i < name.length; i++) u8[o++] = name.charCodeAt(i);
  const a = list[0]?.transform || { x: 0, y: 0, z: 0 };
  dv.setFloat32(o, a.x, true); dv.setFloat32(o + 4, a.y, true); dv.setFloat32(o + 8, a.z, true);
  const ax = dv.getFloat32(o, true), ay = dv.getFloat32(o + 4, true), az = dv.getFloat32(o + 8, true);
  o += 12;
  dv.setUint16(o, list.length, true); o += 2;
  for (const it of list) {
    const t = it.transform;
    dv.setUint8(o, typeCode(it.type));
    const m = Math.max(0, MATERIAL_IDS.indexOf(it.material));
    dv.setUint8(o + 1, (m & 3) | (it.hidden ? 4 : 0));
    dv.setInt16(o + 2, clampI16((t.x - ax) * 10), true);
    dv.setInt16(o + 4, clampI16((t.y - ay) * 100), true);
    dv.setInt16(o + 6, clampI16((t.z - az) * 10), true);
    let deg = ((t.yaw || 0) / D2R) % 360; if (deg < 0) deg += 360;
    dv.setUint16(o + 8, Math.round(deg * 100) % 36000, true);
    dv.setUint8(o + 10, Math.max(10, Math.min(60, Math.round((t.scale || 1) * 20))));
    o += ITEM;
  }
  return toB64url(u8);
}

// → { arena, items } or null if it isn't a build this version can read.
export function decodeBuild(str) {
  if (typeof str !== 'string' || str.length > 8192 || !/^[\w-]+$/.test(str)) return null;
  let u8;
  try { u8 = fromB64url(str); } catch { return null; }
  if (u8.length < 16 || u8[0] !== BUILD_VERSION) return null;
  const dv = new DataView(u8.buffer);
  let o = 1;
  const n = u8[o++];
  if (o + n + 14 > u8.length) return null;
  let arena = '';
  for (let i = 0; i < n; i++) arena += String.fromCharCode(u8[o++]);
  if (!/^[\w:-]*$/.test(arena)) return null;
  const ax = dv.getFloat32(o, true), ay = dv.getFloat32(o + 4, true), az = dv.getFloat32(o + 8, true);
  o += 12;
  if (![ax, ay, az].every(Number.isFinite)) return null;
  const count = dv.getUint16(o, true); o += 2;
  if (o + count * ITEM !== u8.length) return null;
  const items = [];
  for (let k = 0; k < count; k++, o += ITEM) {
    const type = typeOf(dv.getUint8(o));
    if (!type) continue;
    const f = dv.getUint8(o + 1);
    items.push({
      type, material: MATERIAL_IDS[f & 3], hidden: !!(f & 4),
      transform: {
        x: ax + dv.getInt16(o + 2, true) / 10, y: ay + dv.getInt16(o + 4, true) / 100, z: az + dv.getInt16(o + 6, true) / 10,
        yaw: (dv.getUint16(o + 8, true) / 100) * D2R, scale: dv.getUint8(o + 10) / 20,
      },
    });
  }
  return { arena, items };
}
