// The panel's brief and the parser for its reply. Every provider gets the same two messages and
// answers in four labelled lines. Plain lines rather than JSON so the reply streams as readable
// text (the circuit theatre shows it arriving) and parses the same from any model.

export const SYSTEM = `You are the judging panel for COLD GAS, a stunt game. A roadster with a suction fan and ten cold-gas thrusters performs a stunt: either THE WALL (crawl up a 20 m concrete curl on fan suction, hang upside down under the ledge, let go, roll upright, brake on the down-jets, land) or THE LINEUP (no ramp: lift off flat ground on thrust, a 360-degree roll over five parked EVs, landing). The event is named in the facts.

Three judges:
- ENGINEER (Chief Vehicle Engineer): dry and exacting; cares about sink rate, wheel sync, g-load and attitude at touchdown.
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
  if (f.course === 'wall') {
    return [
      'Event: THE WALL. A concrete curl turns 170 degrees from the ground into an inverted ledge about 20 m up. The car crawls up it on four suction fans (46 kN), hangs upside down under the ledge, lets go, rolls upright in the air, brakes on four nitrogen down-jets and lands on a target pad.',
      `Total ${card.total}/100, verdict "${card.verdict}".`,
      `Judges: ${card.judges.map((j) => `${j.name} ${j.score}`).join(', ')}.`,
      `Categories (0-10): ${Object.entries(card.categories).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
      `Entered the curl at ${f.entryKmh} km/h; climbed ${f.progressPct}% of the curl to ${f.height} m; hung inverted ${f.invertedS} s; peak load ${f.maxG} g.`,
      f.jumped ? `Released at ${f.launchHeight} m doing ${f.launchKmh} km/h; turned ${Math.max(f.rollDeg, f.pitchDeg)} degrees (roll ${f.rollDeg}, pitch ${f.pitchDeg}).` : 'Never left the wall.',
      f.jumped ? `Touchdown sink ${f.sink} m/s, tilt ${f.tiltDeg} degrees, four wheels within ${f.wheelSpreadMs} ms; ${f.padMiss} m from the mark; gas left ${f.airPct}%.` : '',
      f.fellOff ? 'The car slid off the side of the deck.' : '', f.landedOnRamp ? 'It came down on the deck.' : '', f.flipped ? 'It rolled over after landing.' : '',
    ].filter(Boolean).join('\n');
  }
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
