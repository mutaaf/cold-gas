// One-thumb AIM on the pad (0121): the DOM half of src/onethumb.js's touchdown slide.
//
//  - Input: the held thumb's slide from where it pressed goes to thumb.move(dx, dy) (CSS px, +y up the
//    glass). onethumb.js turns it into the ordinary pitch / roll channels (the input log replays and the
//    Worker scores it like any run).
//  - Display: in the air, the pad becomes a sight. The amber dot is the mark, laid out in the car's own frame (up =
//    further along its nose, right = its right), so it reads the same from any camera: sideways (0164) from where the
//    slide measures from (`thumb.ref`, where LAND would set the car down), along the run (0165) from `thumb.refA` (the
//    landing predictor's touchdown, src/sim/predict.js) and only while the slide can act along the run (`thumb.canA`:
//    on the Show once the brake has turned the fall, off the roofs), at AIM_PX_PER_M px a metre. Put your thumb on the
//    dot and hold it: the touchdown walks onto the mark and the dot stays put. The small ink dot is your slide.
//  - 0174: along the run the dot is drawn gliding onto its target (`glideStep`) whenever the target moves more than
//    GLIDE_JUMP px in a frame (canA opening: 0 → 13.9 px on a held thumb), so a thumb on it has a motion to follow.
//    `data-ey` stays the target (what the control measures, what scripts/play-human.mjs reads); `data-ey-shown` is drawn.
// Writes the DOM only when a rounded pixel changes (no per-frame strings).
import { up } from './sim/vehicle.js';
import { markOffset, AIM_R } from './onethumb.js';
import './thumb-aim.css';

const R = AIM_R;
const uw = { x: 0, y: 0, z: 0 };

// 0174: the drawn dot's glide (pure). A target that moves ≤ GLIDE_JUMP px a frame is drawn where it is; a bigger move
// starts a critically damped approach (ω = GLIDE_W: 90 % in ≈ 0.16 s, on the pixel within 0.25 s for a 14 px step),
// no faster than GLIDE_VMAX (3 px a 60 Hz frame), every step toward the target and never past it. `g.on` false (the
// sight hidden) draws the next target where it is: the dot appearing is not a jump. Allocation-free.
export const GLIDE_JUMP = 3, GLIDE_W = 24, GLIDE_VMAX = GLIDE_JUMP * 60;
export const newGlide = () => ({ on: false, y: 0, v: 0, t: 0, gliding: false });
export function glideStep(g, target, dt) {
  // Hidden, a target that isn't a number, or a frame over 0.1 s (back from a pause or the background): draw the
  // target where it is, so one bad frame never leaves the dot stuck and a resume doesn't glide 18 px at once.
  if (!(target === target) || Math.abs(target) === Infinity) { g.on = false; return target; }
  if (!g.on || dt > 0.1) { g.on = true; g.y = target; g.v = 0; g.t = target; g.gliding = false; return target; }
  const moved = target - g.t;
  g.t = target;
  if (!g.gliding && Math.abs(moved) > GLIDE_JUMP) g.gliding = true;
  if (!g.gliding) { g.y = target; g.v = 0; return target; }
  const h = Math.max(dt, 0);
  if (h === 0) return g.y;
  // A small move of the target mid-glide carries the dot with it (as it would be drawn outside a glide), so the glide
  // closes only the jump. Carry and glide together stay under GLIDE_VMAX, so a target that creeps fast (over ≈ 1 px a
  // frame) on after a jump is reached a little later than 0.25 s; the Show's creeps ≈ 0.6 px a frame.
  const y0 = Math.abs(moved) <= GLIDE_JUMP && (target - g.y) * moved > 0 ? g.y + moved : g.y;
  // The exact step of x'' = −2ωx' − ω²x over h (stable for any h), x = y − target.
  const x = y0 - target, e = Math.exp(-GLIDE_W * h), k = (g.v + GLIDE_W * x) * h;
  let v = (g.v - GLIDE_W * k) * e, y = target + (x + k) * e;
  const lim = GLIDE_VMAX * h, d = y - g.y;
  if (d > lim) y = g.y + lim; else if (d < -lim) y = g.y - lim;
  if (Math.abs(v) > GLIDE_VMAX) v = Math.sign(v) * GLIDE_VMAX;
  // Toward the target only, never past it: a target that turned back mid-glide is chased, not left behind.
  if ((y - g.y) * (target - g.y) < 0) y = g.y;
  if ((target - y) * (target - g.y) <= 0) y = target;
  if (v * (target - y) < 0) v = 0;
  g.y = y; g.v = v;
  if (Math.abs(target - y) < 0.25) { g.y = target; g.v = 0; g.gliding = false; }
  return g.y;
}

export function mountThumbAim(pad, thumb) {
  if (!pad) return { sync() {}, hide() {} };
  const el = document.createElement('span');
  el.className = 'thumb-aim';
  el.setAttribute('data-thumb-aim', '');
  el.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('i'), you = document.createElement('i');
  mark.className = 'ta-mark'; you.className = 'ta-you';
  el.append(mark, you);
  pad.append(el);

  // The slide: from where the first finger pressed, while that finger is down.
  let track = null, x0 = 0, y0 = 0;
  const ids = new Set();
  pad.addEventListener('pointerdown', (e) => {
    if (!ids.size) { track = e.pointerId; x0 = e.clientX; y0 = e.clientY; }
    ids.add(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === track) thumb.move(e.clientX - x0, y0 - e.clientY);
  });
  const end = (e) => { ids.delete(e.pointerId); if (e.pointerId === track) track = null; };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('lostpointercapture', end);
  addEventListener('blur', () => { ids.clear(); track = null; });

  const last = { on: null, wait: null, near: null, mx: NaN, my: NaN, ty: NaN, yx: NaN, yy: NaN, at: 0 };
  const off = { x: 0, y: 0, m: 0 }, glide = newGlide();
  const flag = (k, v) => { if (last[k] !== v) { el.toggleAttribute(`data-${k}`, v); last[k] = v; } };
  return {
    // Each frame from main.js syncThumb: the stage, the run and the landing HUD's prediction.
    sync(run, c, pr, stage) {
      up(c, uw);
      const on = stage === 'fly' && run.phase === 'air' && uw.y > thumb.aimUy;   // 0164: past 0.94 while a slide steers
      flag('on', on);
      const now = performance.now(), dt = (now - last.at) / 1000;
      last.at = now;
      if (!on) { glide.on = false; return; }
      markOffset(c, pr, run.course, off, thumb.ref, thumb.refA, thumb.canA);
      const mx = Math.round(off.x), ty = Math.round(off.y), my = Math.round(glideStep(glide, off.y, dt));   // 0174
      if (mx !== last.mx || my !== last.my) {
        mark.style.transform = `translate(${mx}px, ${my}px)`;
        el.dataset.ex = mx; el.dataset.eyShown = my;
        last.mx = mx; last.my = my;
      }
      if (ty !== last.ty) { el.dataset.ey = ty; last.ty = ty; }   // the target: what a script player reads (scripts/play-human.mjs)
      // 0164: the ink dot sideways is where the thumb is (the slide's px, as the control reads them), so ink on amber is
      // the touchdown on the mark; along, the shaped command as before.
      const a = thumb.aim;
      const yx = Math.round(Math.max(-R, Math.min(R, thumb.slidePx))), yy = Math.round(-a.y * R);
      if (yx !== last.yx || yy !== last.yy) { you.style.transform = `translate(${yx}px, ${yy}px)`; last.yx = yx; last.yy = yy; }
      flag('near', last.near ? off.m < 2.5 : off.m < 2);   // 0126: a 0.5 m band so the dot's size doesn't jitter at the edge
      flag('wait', !thumb.aimLive);
    },
    hide() { flag('on', false); glide.on = false; },
  };
}

