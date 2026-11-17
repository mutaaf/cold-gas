// A visit that ends on the title (0143). Pure: no DOM; src/main.js tells it what happened and asks it as the page goes.
//
// The funnel counted `visit-new` → `run`, and could not see the visits in between (2026-11-03..17: 8 new visits, 5 runs
// in all). Counts only, once per page load each:
//   jump-tap    the title's Jump was tapped (or pressed by key), before any run: the intent, whatever came after it
//   title-left  the page went while on the title, never having got past it this load; with one reason beside it:
//     left-howto     the how-to card was open
//     left-starting  a start was waiting (Jump tapped, the engine loading: "Starting…", 0154)
//     left-booting   the title had not been drawn yet (its first 3D frame: on a phone over cellular, seconds)
//     left-title     the title was up and nothing was waiting: looked and left
//   title-back  a correction: this load had counted title-left, then came back and got past the title after all
// "Went" is pagehide or hidden: a phone tab is as often hidden, frozen and discarded with no pagehide (src/obs/index.js),
// and a hidden or back-forward-cached page can also come back. So the leave is counted as the page goes, and taken back
// (title-back) if the same load then plays. Read the funnel's leaves as title-left − title-back.
// "Past the title": any other mode (a run, the reference, a drill, Free Drive, the Sandbox). A page that goes from one of
// those counts nothing. The reasons' names are LEAVE_EVENTS in signature.js (shared with the Worker's cleanObs).

export function createTitleLeave(play) {
  let ran = false, past = false, tapped = false, left = false, back = false;
  const pastTitle = () => {
    past = true;
    if (left && !back) { back = true; play('title-back'); }
  };
  return {
    // The title's Jump: counted once per page load, and only before a run.
    jumpTap() { if (ran || tapped) return; tapped = true; play('jump-tap'); },
    // A Jump run started (obs `run`).
    ran() { ran = true; pastTitle(); },
    // The page entered any mode but the title.
    mode(m) { if (m !== 'title') pastTitle(); },
    // The page is going (pagehide or hidden). mode: S.mode; howto: the how-to card is open; starting: a start is
    // waiting; drawn: the title's first frame is up. Returns the reason counted, or null.
    leave({ mode, howto = false, starting = false, drawn = true } = {}) {
      if (past || left || mode !== 'title') return null;
      left = true;
      const why = howto ? 'left-howto' : starting ? 'left-starting' : !drawn ? 'left-booting' : 'left-title';
      play('title-left');
      play(why);
      return why;
    },
  };
}
