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
      markOffset(c, pr, run.course, off, thumb.ref, thumb.refA, thumb.canA);
      const mx = Math.round(off.x), my = Math.round(off.y);
      if (mx !== last.mx || my !== last.my) {
        mark.style.transform = `translate(${mx}px, ${my}px)`;
        el.dataset.ex = mx; el.dataset.ey = my;   // what a script player reads (scripts/play-human.mjs)
        last.mx = mx; last.my = my;
      }
      // 0164: the ink dot sideways is where the thumb is (the slide's px, as the control reads them), so ink on amber is
      // the touchdown on the mark; along, the shaped command as before.
      const a = thumb.aim;
      const yx = Math.round(Math.max(-R, Math.min(R, thumb.slidePx))), yy = Math.round(-a.y * R);
      if (yx !== last.yx || yy !== last.yy) { you.style.transform = `translate(${yx}px, ${yy}px)`; last.yx = yx; last.yy = yy; }
      flag('near', last.near ? off.m < 2.5 : off.m < 2);   // 0126: a 0.5 m band so the dot's size doesn't jitter at the edge
      flag('wait', !thumb.aimLive);
    },
    hide() { flag('on', false); },
  };
}

