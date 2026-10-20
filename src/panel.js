// Board client and the judges' local lines. The AI call itself lives in src/ai/ (streamed and
// shown in the theatre). Offline, or when a provider fails, the panel speaks from local lines
// picked from the same facts, so the game never waits on the network.
const API = `${import.meta.env.BASE_URL}api`;

export async function postScore(log, assist, initials) {
  try {
    const res = await fetch(`${API}/scores`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log, assist, initials }),
    });
    return { ok: res.ok, status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch { return { ok: false, status: 0 }; }
}

export async function fetchBoard(board = 'today') {
  try {
    const res = await fetch(`${API}/scores?board=${board}`);
    if (!res.ok) return null;
    return (await res.json()).rows;
  } catch { return null; }
}

// --- Local lines -------------------------------------------------------------------------
const pick = (arr, seed) => arr[Math.abs(Math.round(seed * 997)) % arr.length];

export function localWords(card) {
  const f = card.facts, s = f.sink + f.tiltDeg + f.padMiss;
  if (!f.jumped) {
    return { headline: 'No jump recorded', engineer: 'The car never left the ground long enough to measure. Nothing to grade.', coordinator: 'The ramp is right there. Hit it with intent and give me something.', designer: 'Restraint is a virtue. This was too much of it.', source: 'local' };
  }
  if (f.contact) {
    return { headline: 'Contact with the lineup', engineer: `Hull contact with a parked vehicle at ${f.apex} m apex. That ends the evaluation.`, coordinator: 'You had the nerve. You needed another metre of altitude.', designer: 'The line was there. The clearance was not.', source: 'local' };
  }
  if (f.flipped || f.crashed) {
    return { headline: 'Over the bar, off its wheels', engineer: `Touchdown at ${f.sink} m/s with ${f.tiltDeg}° of tilt. The suspension never had a chance.`, coordinator: 'Big air, big rotation, and then gravity collected its fee.', designer: 'Everything before the ground was beautiful.', source: 'local' };
  }
  const engineer = f.sink < 1.5 && f.wheelSpreadMs < 40
    ? pick([`Four wheels inside ${f.wheelSpreadMs} ms at ${f.sink} m/s. That is a production-grade landing.`, `Sink rate ${f.sink} m/s, tilt ${f.tiltDeg}°. I would sign that off.`], s)
    : pick([`Touchdown at ${f.sink} m/s with ${f.wheelSpreadMs} ms between first and last wheel. Tighten the retro burn.`, `${f.tiltDeg}° of tilt at contact. Level earlier and let the computer settle it.`], s);
  const coordinator = f.rotations >= 2
    ? `A ${f.rollDeg}° double over a semi. I have waited my whole career for that.`
    : f.rotations === 1
      ? pick([`${f.apex} metres and a full ${f.rollDeg}° roll. That is the shot.`, `Clean roll, ${f.clearance} m over the roofs. The crowd felt that one.`], s)
      : 'You flew it, but you did not roll it. Give me the rotation.';
  const designer = f.airPct > 40
    ? pick([`${f.airPct}% of the air still in the tanks. Nothing wasted, nothing missing.`, `Quiet, exact, ${f.airPct}% in reserve. That is how it should feel.`], s)
    : pick([`Effective, but ${f.airPct}% left in the tanks tells me it was loud in places.`, `The shape was right. The burn was heavy.`], s);
  return { headline: card.verdict, engineer, coordinator, designer, source: 'local' };
}
