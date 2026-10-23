// The share card (0081): a run as an image, drawn on demand in a 2D canvas (no server, no third
// party). The Worker is frozen and static, so a per-run link preview can't exist; instead the
// results' Share hands the phone's share sheet a picture: a frame of the replay, the score, the
// verdict, three numbers and the address. Where files can't be shared it falls back to text + URL,
// and to copying the link with a toast.
import { one } from './units.js';
import { TIERS } from './sim/judge.js';

export const CARD_W = 1080, CARD_H = 1350;   // 4:5, what a phone's share targets show uncropped
const BG = '#05070c', INK = '#f5f6f8', ICE = '#bfe6ff', SIGNAL = '#e8323c';
const COURSE = { show: 'The Show', wall: 'The Wall', lineup: 'The Lineup' };
const LEN = { us: 0, metric: 1 };
// The verdict's colour is its state (judge.js's verdicts): a landing reads in ice, a run without
// a trick in ink, anything that went wrong (a crash, contact, short, no climb...) in the signal red.
const LANDED = new Set(['Perfect 10', 'Stuck it', 'Clean', 'Rough landing', 'Survived']);
const verdictColor = (v) => (LANDED.has(v) ? ICE : v === 'No trick' ? INK : SIGNAL);

// The three numbers a card carries (label, value in the player's primary units). Pure.
export function shareFacts(card) {
  const f = card.facts || {};
  const sink = ['Touchdown', one('rate', f.sink ?? 0, 1)];
  if (f.course === 'show' || f.course === 'wall') {
    const out = [['Up the wall', one('len', f.height ?? 0, LEN)], ['Inverted', `${f.invertedS ?? 0} s`]];
    if (f.course === 'show' && f.jumped && f.crossedRow && !f.contact) out[1] = ['Over the roofs', one('len', f.clearance ?? 0, LEN)];
    out.push(f.jumped ? sink : ['Peak', `${f.maxG ?? 0} g`]);
    return out;
  }
  return [['Roll', `${f.rollDeg ?? 0}°`], ['Apex', one('len', f.apex ?? 0, LEN)], sink];
}

export function shareText(card) {
  const f = card.facts || {};
  return `COLD GAS ${card.total.toFixed(1)}: ${card.verdict} on ${COURSE[f.course] || 'the range'}. ${shareFacts(card).map(([k, v]) => `${k} ${v}`).join(' · ')}.`;
}

const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const fontsReady = () => Promise.race([
  Promise.all(['400 40px Michroma', '500 40px "Geist Variable"', '400 20px "Geist Mono"'].map((f) => document.fonts?.load(f))).catch(() => {}),
  new Promise((r) => setTimeout(r, 600)),
]);

// Draws the card. `frame` is the 3D canvas, copied synchronously before anything awaits (a WebGL
// canvas's buffer is only valid until the browser composites); `render` redraws it first so the
// copy is never a cleared buffer. Resolves to a PNG Blob.
export function drawShareCard({ frame, render, card, url, mark }) {
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext('2d');
  g.fillStyle = BG; g.fillRect(0, 0, CARD_W, CARD_H);
  const FH = 860;
  // The frame covers the top 860 px, centred a little high (the car flies in the upper half), and
  // is clipped there: a portrait phone's canvas is taller than that window and would spill under
  // the score.
  g.save();
  try {
    render?.();
    const fw = frame?.width || 0, fh = frame?.height || 0;
    if (fw && fh) {
      const s = Math.max(CARD_W / fw, FH / fh), w = fw * s, h = fh * s;
      g.beginPath(); g.rect(0, 0, CARD_W, FH); g.clip();
      g.drawImage(frame, (CARD_W - w) / 2, Math.min(0, (FH - h) * 0.4), w, h);
    }
  } catch { /* no frame: the card still reads */ } finally { g.restore(); }
  return (async () => {
    const [img] = await Promise.all([mark ? loadImage(mark) : null, fontsReady()]);
    paint(g, card, url, img, FH);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  })();
}

function paint(g, card, url, mark, FH) {
  const W = CARD_W, H = CARD_H, M = 72;
  g.fillStyle = 'rgba(5,7,12,0.14)'; g.fillRect(0, 0, W, FH);   // the replay's bloom, held down a stop
  let grd = g.createLinearGradient(0, 0, 0, 240);
  grd.addColorStop(0, 'rgba(5,7,12,0.78)'); grd.addColorStop(1, 'rgba(5,7,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, 240);
  grd = g.createLinearGradient(0, FH - 330, 0, FH);
  grd.addColorStop(0, 'rgba(5,7,12,0)'); grd.addColorStop(1, BG);
  g.fillStyle = grd; g.fillRect(0, FH - 330, W, 331);
  grd = g.createRadialGradient(W / 2, FH * 0.45, FH * 0.35, W / 2, FH * 0.45, W * 0.85);
  grd.addColorStop(0, 'rgba(2,3,6,0)'); grd.addColorStop(1, 'rgba(2,3,6,0.6)');
  g.fillStyle = grd; g.fillRect(0, 0, W, FH);

  const text = (s, x, y, font, color, { align = 'left', spacing = 0 } = {}) => {
    g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };

  // header: the mark and the wordmark; the event on the right
  if (mark) g.drawImage(mark, M, 62, 52, 52);
  text('COLD GAS', M + (mark ? 74 : 0), 98, '400 26px Michroma', INK, { spacing: 7 });
  const f = card.facts || {};
  text((COURSE[f.course] || '').toUpperCase(), W - M, 97, '400 20px "Geist Mono"', 'rgba(245,246,248,0.78)', { align: 'right', spacing: 5 });

  // the verdict and the score
  text(String(card.verdict).toUpperCase(), M, 896, '400 24px "Geist Mono"', verdictColor(card.verdict), { spacing: 7 });
  const score = card.total.toFixed(1);
  g.font = '400 210px Michroma';
  // 94.0 sets at 210 px; a wider number (100.0) shrinks to the same width so the row never collides
  const size = Math.min(210, Math.floor(210 * 640 / g.measureText(score).width));
  g.font = `400 ${size}px Michroma`;
  const sw = g.measureText(score).width;
  const chrome = g.createLinearGradient(0, 905, 0, 1085);
  chrome.addColorStop(0, '#ffffff'); chrome.addColorStop(0.45, '#e6ebf1'); chrome.addColorStop(0.52, '#98a2af');
  chrome.addColorStop(0.58, '#d9dfe6'); chrome.addColorStop(1, '#f4f6f8');
  text(score, M - 6, 1085, `400 ${size}px Michroma`, chrome);
  text('/ 100', M + sw + 18, 1085, '400 32px "Geist Variable"', 'rgba(245,246,248,0.6)');
  const tier = TIERS[card.tier] || TIERS.assist;
  text(`${tier.label.toUpperCase()}${tier.factor > 1 ? ` ×${tier.factor.toFixed(2)}` : ''}`, W - M, 1085, '400 20px "Geist Mono"', 'rgba(245,246,248,0.7)', { align: 'right', spacing: 4 });

  // a hairline, then three numbers
  g.fillStyle = 'rgba(245,246,248,0.18)'; g.fillRect(M, 1132, W - 2 * M, 1);
  const facts = shareFacts(card), col = (W - 2 * M) / 3;
  facts.forEach(([k, v], i) => {
    text(k.toUpperCase(), M + i * col, 1186, '400 18px "Geist Mono"', 'rgba(245,246,248,0.6)', { spacing: 3.5 });
    text(v, M + i * col, 1236, '500 40px "Geist Variable"', INK);
  });

  // the address
  text(url.replace(/^https?:\/\//, '').replace(/\/$/, '').toUpperCase(), M, H - 52, '400 18px "Geist Mono"', 'rgba(245,246,248,0.55)', { spacing: 3.5 });
  text('Stick the landing.', W - M, H - 52, '400 20px "Geist Variable"', 'rgba(245,246,248,0.55)', { align: 'right' });
}

// A short message at the bottom of the screen (polite live region), for the copy fallback.
export function toast(msg, ms = 1800) {
  let el = document.querySelector('[data-toast]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('data-toast', ''); el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), ms);
}

// Share a run: the card as a file where the platform takes files (phones, desktop Safari), else
// text + link, else copy the link. `cardPromise` is started on pointerdown so it's usually ready by
// the click (the share sheet must open inside the tap's user activation).
export async function shareRun({ card, url, cardPromise }) {
  const text = shareText(card);
  const data = { title: 'COLD GAS', text, url };
  try {
    const blob = await cardPromise;
    const file = new File([blob], `coldgas-${card.total.toFixed(1)}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) data.files = [file];
  } catch { /* no card: share the words */ }
  if (navigator.share) {
    try { await navigator.share(data); return 'shared'; } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      if (data.files) { delete data.files; try { await navigator.share(data); return 'shared'; } catch (e2) { if (e2?.name === 'AbortError') return 'cancelled'; } }
    }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link copied'); return 'copied'; } catch { toast(url, 4000); return 'shown'; }
}
