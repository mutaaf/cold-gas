// The panel's brief and the parser for its reply. Every provider gets the same two messages and
// answers in four labelled lines. Plain lines rather than JSON so the reply streams as readable
// text (the circuit theatre shows it arriving) and parses the same from any model.

export const SYSTEM = `You are the judging panel for COLD GAS, a stunt game. A roadster ran up a kicker ramp, fired ten cold-gas thrusters to jump a row of five parked electric vehicles (the tallest is a semi cab, 3.85 m), tried to roll 360 degrees in the air, and landed on a target pad.

Three judges:
- ENGINEER (Chief Vehicle Engineer): dry and exacting; cares about sink rate, wheel sync and attitude at touchdown.
- COORDINATOR (Stunt Coordinator): warm and theatrical; cares about height, rotation and nerve.
- DESIGNER (Head of Design): minimal and precise; cares about clean lines, restraint and air left in the tanks.

The scores are final and already decided. Never change them or invent numbers that are not in the facts. Each judge writes one remark of at most 22 words, in their own voice, about something specific in the facts. No emoji, hashtags, brand names or real people.

Reply with exactly four lines and nothing else:
HEADLINE: <at most 6 words>
ENGINEER: <remark>
COORDINATOR: <remark>
DESIGNER: <remark>`;

// The user message: the verified scorecard as compact, readable facts.
export function userPrompt(card) {
  const f = card.facts;
  const lines = [
    `Total ${card.total}/100, verdict "${card.verdict}".`,
    `Judges: ${card.judges.map((j) => `${j.name} ${j.score}`).join(', ')}.`,
    `Categories (0-10): ${Object.entries(card.categories).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Launch ${f.launchKmh} km/h; apex ${f.apex} m (${f.apexOverRoof} m over the semi); roll ${f.rollDeg} degrees (${f.rotations} rotation${f.rotations === 1 ? '' : 's'}).`,
    f.contact ? 'The car hit a parked vehicle.' : `Closest clearance over the roofs ${f.clearance} m.`,
    `Touchdown sink ${f.sink} m/s, tilt ${f.tiltDeg} degrees, heading ${f.headingDeg} degrees, four wheels within ${f.wheelSpreadMs} ms; ${f.padMiss} m from the mark.`,
    `Air left ${f.airPct}%.${f.bottomOut ? ' Suspension bottomed out.' : ''}${f.flipped ? ' The car rolled over after landing.' : ''}`,
  ];
  return lines.join('\n');
}

const LABELS = { headline: 'HEADLINE', engineer: 'ENGINEER', coordinator: 'COORDINATOR', designer: 'DESIGNER' };

// Tolerant parse: labels may be bolded, lower-case, or wrapped; missing parts come back empty.
export function parseWords(text) {
  const out = { headline: '', engineer: '', coordinator: '', designer: '' };
  const clean = String(text || '').replace(/\r/g, '').replace(/\*\*/g, '');
  for (const [key, label] of Object.entries(LABELS)) {
    const m = clean.match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*${label}\\s*[:\\-–]\\s*([^\\n]+)`, 'i'));
    if (m) out[key] = m[1].trim().replace(/^["“]|["”]$/g, '').slice(0, key === 'headline' ? 60 : 200);
  }
  return out;
}

export const complete = (w) => !!(w.headline && w.engineer && w.coordinator && w.designer);

// Rough token estimate for display when a provider reports no usage (≈4 chars per token).
export const estimateTokens = (s) => Math.max(1, Math.round(String(s || '').length / 4));
