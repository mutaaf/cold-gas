// 0188: what the one-thumb pad says, and whether it asks for the thumb (pure; main.js syncThumb draws it).
// In the air, LAND is the computer's as soon as it flies: Assist's auto-land (`c.autoLand`, src/sim/vehicle.js)
// flies exactly what a held LAND would have from there, and a thumb that has held once keeps LAND on to the
// ground (0140). From then on a hold changes one thing, the touchdown slide (0121, 0164, 0165), so the pad
// names that ("Hold · Aim", held "Slide · Aim") and stops asking: an empty pad is calm once LAND flies.
// Before then a press still changes the flight (it starts LAND sooner), so the pad says Land and, while the
// descent leaves green, pulses amber for the thumb, as before.
export const THUMB_WORDS = {
  climb: ['Hold', 'Climb'], climbing: ['Holding', 'Climb'], ledge: ['Tap', 'Let go'], going: ['Letting', 'Go'],
  fly: ['Hold', 'Land'], aim: ['Hold', 'Aim'], aiming: ['Slide', 'Aim'], landed: ['', 'Stopping'],
};
// 0181: the Lineup's run-up is a drive to the line, and the lift-off and the roll are the computer's.
// 0191: held on the run-up, the pad offers the second turn (slide up) while it can still be called and, once called, says so;
// the act stays Drive.
export const THUMB_WORDS_LINEUP = { climb: ['Hold', 'Drive'], climbing: ['Holding', 'Drive'], offer: ['↑ for 720', 'Drive'], twice: ['Two turns', 'Drive'], lifting: ['', 'Lifting'], rolling: ['', 'Rolling'] };

// `stage`: thumbStage(); `held`: the thumb is down; `going`: the ledge tap was taken (driving off or pending);
// `landing`: the thumb has held LAND this flight (thumb.landing); `autoLand`: c.autoLand; `lineup`, `lifting`,
// `rolled`: the Lineup's kickflip (thumb.lifting, thumb.rolled); `airborne`: run.phase is air or drive;
// `rolling`: the Lineup's roll has turned past 0.3 rad; `green`: the descent band reads green; `twice`: the Lineup's second
// turn is called (thumb.twice, 0191); `offer`: it can still be called (thumb.offer).
// Returns the key into THUMB_WORDS(_LINEUP), the pad's stage attribute, and whether it pulses amber.
// `out` is reused (main.js calls this every frame: no allocation).
export function padState({ stage, held = false, going = false, landing = false, autoLand = 0, lineup = false, lifting = false, rolled = false, airborne = false, rolling = false, green = true, twice = false, offer = false }, out = { word: '', stage: '', warn: false }) {
  const landOn = landing || autoLand > 0;
  let word;
  if (going) word = 'going';
  else if (lineup && lifting && !rolled && airborne) word = stage === 'fly' && rolling ? 'rolling' : 'lifting';
  else if (stage === 'climb' && held) word = lineup && twice ? 'twice' : lineup && offer ? 'offer' : 'climbing';
  else if (stage === 'fly') word = held ? 'aiming' : landOn ? 'aim' : 'fly';
  else word = stage;
  // Not holding while the descent leaves green, and a press would still change the flight: the pad asks.
  const warn = stage === 'fly' && !held && !landOn && !green && !(lineup && !rolled);   // 0181: not in the computer's roll
  out.word = word; out.stage = going ? 'going' : stage; out.warn = warn;
  return out;
}

export const padWords = (word, lineup = false) => (lineup && THUMB_WORDS_LINEUP[word]) || THUMB_WORDS[word] || ['', ''];
