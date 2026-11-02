// One-thumb AIM on the pad (0121): the DOM half of src/onethumb.js's touchdown slide.
//
//  - Input: the held thumb's slide from where it pressed goes to thumb.move(dx, dy) (CSS px, +y up the
//    glass). onethumb.js turns it into the ordinary pitch / roll channels (the input log replays and the
//    Worker scores it like any run).
//  - Display: in the air, the pad becomes a sight. Its centre is where you'll touch down (the landing
//    predictor, src/sim/predict.js, the same point the HUD's touchdown ring marks); the amber dot is the
//    mark, laid out from there in the car's own frame (up = further along its nose, right = its right),
//    so it reads the same from any camera. Put your thumb on the dot and the touchdown walks onto the mark;
//    the dot comes back to the centre as it does. The small ink dot is your slide.
// Writes the DOM only when a rounded pixel changes (no per-frame strings).
import { up } from './sim/vehicle.js';
import { markOffset, AIM_R } from './onethumb.js';
import './thumb-aim.css';

const R = AIM_R;
const uw = { x: 0, y: 0, z: 0 };

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

  const last = { on: null, wait: null, near: null, mx: NaN, my: NaN, yx: NaN, yy: NaN };
  const off = { x: 0, y: 0, m: 0 };
  const flag = (k, v) => { if (last[k] !== v) { el.toggleAttribute(`data-${k}`, v); last[k] = v; } };
  return {
    // Each frame from main.js syncThumb: the stage, the run and the landing HUD's prediction.
    sync(run, c, pr, stage) {
      up(c, uw);
      const on = stage === 'fly' && run.phase === 'air' && uw.y > 0.94;
      flag('on', on);
      if (!on) return;
      markOffset(c, pr, run.course, off);
      const mx = Math.round(off.x), my = Math.round(off.y);
      if (mx !== last.mx || my !== last.my) {
        mark.style.transform = `translate(${mx}px, ${my}px)`;
        el.dataset.ex = mx; el.dataset.ey = my;   // what a script player reads (scripts/play-human.mjs)
        last.mx = mx; last.my = my;
      }
      const a = thumb.aim;
      const yx = Math.round(a.x * R), yy = Math.round(-a.y * R);
      if (yx !== last.yx || yy !== last.yy) { you.style.transform = `translate(${yx}px, ${yy}px)`; last.yx = yx; last.yy = yy; }
      flag('near', last.near ? off.m < 2.5 : off.m < 2);   // 0126: a 0.5 m band so the dot's size doesn't jitter at the edge
      flag('wait', !thumb.aimLive);
    },
    hide() { flag('on', false); },
  };
}

