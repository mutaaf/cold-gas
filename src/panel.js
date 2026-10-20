// Board client and the judges' local lines. The AI call itself lives in src/ai/ (streamed and
// shown in the theatre). Offline, or when a provider fails, the panel speaks from local lines
// picked from the same facts, so the game never waits on the network.
const API = `${import.meta.env.BASE_URL}api`;

export async function postScore(log, assist, initials, course) {
  try {
    const res = await fetch(`${API}/scores`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log, assist, initials, course }),
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
  const f0 = card.facts;
  if (f0.damagePct >= 60) {
    return { headline: 'Wrecked', engineer: `The damage sensor reads ${f0.damagePct}%. That car does not drive home: it goes back on a flatbed.`, coordinator: 'Big, brave, and expensive. Land the next one in one piece.', designer: 'The shape was the point. You bent it.', source: 'local' };
  }
  if (card.facts.course === 'wall') return wallWords(card);
  if (card.facts.course === 'show') return showWords(card);
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

function wallWords(card) {
  const f = card.facts, s = f.height + f.sink + f.padMiss;
  if (f.fellOff) return { headline: 'Off the side of the deck', engineer: 'Lateral drift exceeded the deck width at height. Keep it on the centreline before you add speed.', coordinator: 'The wall doesn’t forgive a wandering line. Straighten up and go again.', designer: 'Symmetry first. Everything else follows.', source: 'local' };
  if (!f.jumped) return { headline: f.progressPct > 50 ? 'Stalled on the wall' : 'No climb', engineer: `${f.progressPct}% of the curl at ${f.entryKmh} km/h entry. The fan holds you; the motors have to lift you.`, coordinator: 'Commit to the climb. Hold GO all the way to the ledge.', designer: 'Hesitation reads from the grandstand.', source: 'local' };
  if (f.landedOnRamp) return { headline: 'Came down on the deck', engineer: 'You released too low; the car fell back onto the curl. Release at the ledge.', coordinator: 'So close. Ride it higher before you let go.', designer: 'The landing belongs on the pad, not the ramp.', source: 'local' };
  if (f.flipped || f.crashed) return { headline: 'Down, not done', engineer: `Touchdown at ${f.sink} m/s with ${f.tiltDeg}° of tilt. Finish the roll before you land.`, coordinator: `${f.height} m up and ${f.invertedS} s inverted. The hard part was right.`, designer: 'Everything before the ground was beautiful.', source: 'local' };
  const engineer = f.sink < 1.5 && f.wheelSpreadMs < 60
    ? pick([`${f.sink} m/s at contact after a ${f.launchHeight} m drop. That is a controlled descent.`, `Four wheels inside ${f.wheelSpreadMs} ms, ${f.maxG} g peak on the curl. Clean.`], s)
    : pick([`Touchdown at ${f.sink} m/s, ${f.tiltDeg}° of tilt. Hold LAND longer and let it level.`, `${f.wheelSpreadMs} ms between first and last wheel. Level before contact.`], s);
  const coordinator = f.invertedS > 0.8
    ? `${f.invertedS} seconds upside down at ${f.height} metres. That is the shot.`
    : pick([`Up the curl, over the ledge, ${Math.max(f.rollDeg, f.pitchDeg)}° to upright. The crowd felt that.`, `Hang it longer under the ledge next time. Make them wait.`], s);
  const designer = f.airPct > 30
    ? `${f.airPct}% of the nitrogen left. Restraint, not panic.`
    : `${f.airPct}% gas left. Effective, but the burn was heavy.`;
  return { headline: card.verdict, engineer, coordinator, designer, source: 'local' };
}

// The Show: the Wall's lines, plus the carry over the row.
function showWords(card) {
  const f = card.facts, words = wallWords(card);
  if (!f.jumped || f.fellOff || f.landedOnRamp) return words;
  if (f.contact) return { ...words, headline: 'Contact with the row', engineer: `Released at ${f.launchHeight} m, but the car came down on a parked vehicle. Boost harder off the ledge.`, coordinator: `${f.invertedS} s inverted, then into the roofs. The carry is the stunt.`, designer: 'The row was the frame. You hit the frame.' };
  if (!f.crossedRow) return { ...words, headline: 'Short of the row', coordinator: 'Let go, then light the rear jets: you have to carry out over all five.' };
  return { ...words, coordinator: pick([`${f.invertedS} seconds upside down at ${f.height} metres, then ${f.clearance} m over the roofs. That is the show.`,
    `Off the ledge and over the semi in one flight. The crowd got all of it.`], f.height + f.sink) };
}
