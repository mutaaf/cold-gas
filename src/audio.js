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
export function thud(strength = 1) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, 0.25 + strength * 0.2), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.45);
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
