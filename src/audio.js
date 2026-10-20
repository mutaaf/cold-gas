// Near-silence, on purpose: an electric whine that climbs with speed, tyre roar, wind, and the
// hiss of each nozzle bank. One soft pad under the title. All procedural, no files.
let ctx = null, master = null, nodes = null;
let muted = false;
try { muted = localStorage.getItem('coldgas_muted') === '1'; } catch { /* storage blocked */ }

function noiseBuffer(c, seconds = 2) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  let s = 1;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  return b;
}

function loopNoise(c, freq, q, type = 'bandpass') {
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  return { src, f, g };
}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  const motor = ctx.createOscillator(); motor.type = 'sawtooth';
  const motor2 = ctx.createOscillator(); motor2.type = 'sine';
  const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 900; mf.Q.value = 3;
  const mg = ctx.createGain(); mg.gain.value = 0;
  motor.connect(mf); motor2.connect(mf); mf.connect(mg).connect(master);
  motor.start(); motor2.start();

  const pad = ctx.createGain(); pad.gain.value = 0;
  const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700;
  for (const fr of [55, 82.4, 110, 164.8]) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 8;
    o.connect(pf); o.start();
  }
  pf.connect(pad).connect(master);

  nodes = {
    motor, motor2, mg, pad,
    tyres: loopNoise(ctx, 300, 0.7, 'lowpass'),
    wind: loopNoise(ctx, 900, 0.5),
    hissLift: loopNoise(ctx, 3800, 0.9),
    hissSide: loopNoise(ctx, 5600, 1.4),
    // Crashes: bodywork grinding along concrete (a resonant band of noise, gain from the slide),
    // and one shared noise buffer for the one-shot crunches.
    grind: loopNoise(ctx, 2300, 3.5),
    grindLo: loopNoise(ctx, 520, 1.2),
    burst: noiseBuffer(ctx, 1),
  };
}

const ramp = (param, v, t = 0.06) => { if (ctx) param.setTargetAtTime(v, ctx.currentTime, t); };

// Per frame (cheap: setTargetAtTime only).
export function updateAudio({ speed = 0, grounded = true, throttles = null, title = false }) {
  if (!ctx || !nodes) return;
  const s = Math.min(1, speed / 45);
  ramp(nodes.motor.frequency, 60 + s * 520);
  ramp(nodes.motor2.frequency, 120 + s * 1040);
  ramp(nodes.mg.gain, title ? 0 : 0.03 + s * 0.08);
  ramp(nodes.tyres.g.gain, grounded ? s * 0.22 : 0, 0.03);
  ramp(nodes.wind.g.gain, s * s * 0.18);
  ramp(nodes.wind.f.frequency, 500 + s * 1400);
  let lift = 0, side = 0;
  if (throttles) {
    for (let i = 0; i < 4; i++) lift += throttles[i];
    for (let i = 4; i < throttles.length; i++) side += throttles[i];
  }
  ramp(nodes.hissLift.g.gain, Math.min(0.55, lift * 0.15), 0.02);
  ramp(nodes.hissSide.g.gain, Math.min(0.35, side * 0.12), 0.02);
  ramp(nodes.pad.gain, title ? 0.05 : 0, 0.8);
}

// One-shots.
export function thud({ thudHz = 110, thudGain = 0.45, thudDecay = 0.4, crunch = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(thudHz, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, thudHz * 0.33), t + thudDecay * 0.6);
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, thudGain), t); g.gain.exponentialRampToValueAtTime(0.001, t + thudDecay);
  o.connect(g).connect(master); o.start(t); o.stop(t + thudDecay + 0.05);
  // A hard landing: the suspension and the tyres' short crunch on top of the thump.
  if (crunch > 0) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.25);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5 * crunch, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(f).connect(ng).connect(master); n.start(t); n.stop(t + 0.25);
  }
}

// A crash, layered by severity (0–1): the body's thump, a crack of noise, folding sheet metal
// (inharmonic partials that die fast) and, when glass goes, a shower of high pings. `seed` makes
// the same impact sound the same in the replay.
export function crunch(severity = 0.5, { glass = false, seed = 1 } = {}) {
  if (!ctx || muted || !nodes) return;
  const t = ctx.currentTime, k = Math.min(1, Math.max(0, severity));
  let sd = (seed * 16807) % 2147483647 || 1;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const out = ctx.createGain(); out.gain.value = 0.35 + 0.65 * k; out.connect(master);
  // Thump: the mass of the car stopping.
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(95 + 40 * k, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.3);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45 + 0.3 * k);
  o.connect(og).connect(out); o.start(t); o.stop(t + 0.8);
  // Crack: a burst of noise, low-passed less the harder the hit.
  const n = ctx.createBufferSource(); n.buffer = nodes.burst; n.playbackRate.value = 0.7 + rnd() * 0.5;
  const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900 + 5200 * k; nf.Q.value = 0.8;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.75, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + 0.35 * k);
  n.connect(nf).connect(ng).connect(out); n.start(t, rnd() * 0.5); n.stop(t + 0.7);
  // Metal folding: a few inharmonic partials, each its own short decay.
  const parts = 3 + Math.round(3 * k);
  for (let i = 0; i < parts; i++) {
    const m = ctx.createOscillator(); m.type = i % 2 ? 'triangle' : 'square';
    const f = 140 + rnd() * 900 * (0.6 + k);
    m.frequency.setValueAtTime(f, t); m.frequency.exponentialRampToValueAtTime(f * (0.55 + rnd() * 0.3), t + 0.4);
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = f * 1.5; mf.Q.value = 6;
    const mg = ctx.createGain(); const d = 0.06 + rnd() * 0.3 * (0.4 + k);
    mg.gain.setValueAtTime(0.0001, t); mg.gain.exponentialRampToValueAtTime(0.5, t + 0.004 + rnd() * 0.03); mg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    m.connect(mf).connect(mg).connect(out); m.start(t); m.stop(t + d + 0.1);
  }
  if (glass) {
    // Glass: a bright crack, then a scatter of pings as the pieces land.
    const g = ctx.createBufferSource(); g.buffer = nodes.burst;
    const gf = ctx.createBiquadFilter(); gf.type = 'highpass'; gf.frequency.value = 3500;
    const gg = ctx.createGain(); gg.gain.setValueAtTime(0.6, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    g.connect(gf).connect(gg).connect(out); g.start(t, rnd() * 0.5); g.stop(t + 0.15);
    for (let i = 0; i < 10 + 8 * k; i++) {
      const p = ctx.createOscillator(); p.type = 'sine'; p.frequency.value = 2800 + rnd() * 5200;
      const pg = ctx.createGain(); const at = t + 0.03 + rnd() * (0.35 + 0.4 * k);
      pg.gain.setValueAtTime(0.0001, t); pg.gain.setValueAtTime(0.0001, at); pg.gain.exponentialRampToValueAtTime(0.07 + rnd() * 0.08, at + 0.003); pg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + rnd() * 0.12);
      p.connect(pg).connect(out); p.start(t); p.stop(at + 0.2);
    }
  }
}

// Bodywork grinding along a surface, 0 (none) to 1 (a hard slide). Call per frame.
export function setGrind(level = 0) {
  if (!ctx || !nodes) return;
  const k = Math.min(1, Math.max(0, level));
  ramp(nodes.grind.g.gain, k * 0.32, 0.03);
  ramp(nodes.grind.f.frequency, 1600 + k * 2200, 0.05);
  ramp(nodes.grindLo.g.gain, k * 0.28, 0.03);
}

export function chime(i = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const notes = [659.25, 783.99, 987.77, 1318.5];
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = notes[i % notes.length];
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(g).connect(master); o.start(t); o.stop(t + 1.2);
}

export function tick() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.05);
}

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('coldgas_muted', m ? '1' : '0'); } catch { /* storage blocked */ }
  if (master) master.gain.value = m ? 0 : 0.8;
}
export const isMuted = () => muted;
