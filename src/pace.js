// The title is a still screen: the car on its turntable, a breath from the jets every nine seconds. At
// the display's rate (120 Hz on a ProMotion panel) that is heat for nothing, so the title draws at
// about 30 fps (0049). Pure: `due(now)` answers each animation frame whether to draw it.
//
// Each drawn frame sets the next one's deadline a whole period on (not a period after it was drawn, so
// the rate can't creep above FPS on a display whose interval doesn't divide it: 165 Hz still draws 30).
// A frame up to TOL_MS early counts, so rAF's jitter doesn't skip a beat; a display at 30 Hz or slower
// draws every frame; one late by more than a period (a stall, a hidden tab) starts a new schedule.
export const TITLE_FPS = 30;
const TOL_MS = 2;

export function createPacer(fps = TITLE_FPS) {
  const period = 1000 / fps;
  let next = -Infinity;
  return {
    due(now) {
      if (now < next - TOL_MS && next - now <= period) return false;   // further ahead: the clock went back
      next = Math.abs(now - next) > period ? now + period : next + period;
      return true;
    },
    // Draw the next frame whatever the clock says.
    reset() { next = -Infinity; },
  };
}
