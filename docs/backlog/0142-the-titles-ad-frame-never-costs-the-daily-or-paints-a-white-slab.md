---
id: 0142
title: The title's ad frame never paints a white slab, never cuts the Daily to "Clear t…", and an unfilled frame moves nothing
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-04
pr: 239
by: critic
---

## Why
The operator's focus (2026-10-30) puts "reasons to come back" second, and the Daily card is the title's one
reason to come back. Since #235/#236 the title's ad slot is Marquee's frame (0122). The frame works for a run:
no ad request reaches the countdown or the run (critique 2026-11-04 07:00). But on the title it costs the Daily
its words, and on a phone in light mode it paints a white box:

- **The Daily goes to "Clear t…".** The frame reports 90 px, and `fit()` (`src/comeback.js:98-104`) can't fit the
  title, so it steps to `data-extra-fit="1"`. The goal then goes `nowrap` + ellipsis (`src/comeback.css:50`) and the
  streak row is hidden (`:46`). At 390×844 the goal is 420 px of text in 186 px. The card reads
  `DAILY · THE SHOW  Clear t…  [Play today's]`, so the objective and the streak are both gone
  (`docs/critique/2026-11-04-0700/phone-title-ad-90px.jpg`). At 1440×900 it steps to level 2, which hides the
  tagline and the eyebrow, and the wordmark's foot touches the course pills (`desktop-title-ad-90px.jpg`).
- **A white slab on a light-mode phone.** The page is `color-scheme: dark` (`index.html:9`, `src/styles.css:26`,
  and the iframe rule at `src/styles.css:2057`). Marquee's `frame.html` declares `color-scheme: light dark`, so with
  the OS in light mode the frame's used scheme is light. It differs from the embedder's, so Chromium paints the
  frame an opaque canvas. Result: a 342×90 px white rectangle on the blue-hour title for as long as nothing is drawn
  in it (`phone-title-ad-90px.jpg`). The same page with the OS in dark mode shows no slab
  (`phone-title-ad-90px-osdark.jpg`). Light is the default appearance on most phones.
- **An unfilled frame jumps the title twice.** In 3 of 3 production loads at 390×844 (headless, no ad drawn), the
  frame reported 90 px and the title packed (fit 1, Daily card 152 → 60 px). In 2 of 3 the frame went back to 0
  ≈ 7 s later and the title unpacked ≈ 3.5 s after that. That's two layout moves for an ad nobody saw.

The real thing this game is about is restraint. A white box and a truncated goal are what a reviewer
screenshots.

## What
`src/ads.js` (the frame's height and placement), `src/comeback.js` / `src/comeback.css` (how the title makes
room), `src/styles.css` (`.title iframe.ad-banner`). Marquee's `frame.html` is not ours. The fix lives on our side
of the frame. Some options for the Builder to measure:
- The banner's room is never taken from the Daily. Place the frame where the title has room, or let the fit
  remove the banner before it packs the Daily (ads are the first thing to step aside, not the goal).
- The frame is invisible until it holds a drawn ad. Keep it 0 px or `visibility: hidden` until the frame's report
  says it filled, or match the scheme so no opaque canvas is painted.
- No height for a slot that doesn't fill.

## Acceptance criteria
- [ ] With the frame at 90 px (forced, as `docs/critique/2026-11-04-0700` did) at 390×844 touch and 1440×900,
  under both `prefers-color-scheme: light` and `dark`:
  - `.title` has no `data-extra-fit`, or the frame isn't placed.
  - The Daily's `.xc-goal` has `scrollWidth <= clientWidth`.
  - The streak row (`.xc-streak`) is shown.
- [ ] With `prefers-color-scheme: light`, a frame that hasn't drawn an ad paints nothing: in a screenshot, the
  frame's box has the same mean luma (±10) as with the frame removed.
- [ ] An unfilled frame moves no title element: the Daily card's and Jump's `getBoundingClientRect().top` are
  unchanged (±1 px) from first paint to 15 s after the dwell, when the frame never reports fill.
- [ ] 0122's bar still holds: 0 third-party requests after the title is left (production probe, 390×844 and
  1440×900, Jump at 3/5/10/30 s).
- [ ] The title audit (`scripts/title-audit.mjs`) and `tests/e2e/ads.spec.js` stay green. 0139's
  `.title[data-extra-fit]` unset assertion keeps passing at 390×844.

## Test plan
- `tests/e2e/ads.spec.js`: stub `/ads/v1/frame.html` with a same-origin page that posts `{marqueeFrame:'title',
  h:90}` and draws nothing. Assert the three bars above in light and dark `colorScheme` contexts, at 390×844 and
  1440×900.
- `tests/unit/ads.test.js`: the frame's height stays 0 until a fill is reported, if that's the route taken.

## Out of scope
- Marquee's own `frame.html` and its Worker (another service). The Cloudflare Web Analytics beacon the frame carries
  is an operator note in critique 2026-11-04 07:00, not this ticket.
- The postrun and reroll breaks.

## Builder note 2026-11-04
- **Room first.** Before the frame is placed, `src/ads.js` asks the title for room with a cancelable `coldgas:ad-room`
  (90 px plus its 18 px margin). It asks again, with the real height, when the ad first draws. The title (`src/comeback.js`)
  says yes only if the card fits whole at level 0 and the title can rise that far under the top bar. With no room, no
  frame is placed and nothing is requested for that title (`.title[data-ad-room="none"]`). `coldgas:ad-no-room` sends a
  shown banner off later (a rotation, a resize).
- **Undrawn frames are invisible.** Until its own document holds a drawn ad, the frame is out of the flow (absolute) and
  hidden. Drawn means Google's `data-ad-status="filled"`, or a direct sponsor's image or video that has loaded. The frame
  keeps the size it reports, so the ad inside sees a real slot, but no title element moves.
- **No white slab.** The element's `color-scheme` is `light dark`, the same as the frame page's, so a light OS gets no
  opaque canvas. Forced to 90 px and visible under a light OS, the box measured mean luma 5, the same as the night behind it.
- **Where the banner still shows:** upright tablets, measured at 820×1180, 1024×1366, 800×1280, 720×1280 and 600×1200.
  390×844, 430×932, 768×1024, 1280×720, 1440×900 and 1920×1080 get no frame. This is because the title already lacks room
  there, not because of the ad.
- **Not met as written, and out of this ticket's reach:** the 1440×900 bars ("no data-extra-fit", "streak shown"). With no
  ad at all, the desktop title already packs: fit 2 at 1440×900 and 1280×720, fit 1 at 1920×1080. At 1440×900 the
  eyebrow sits 109 px above the viewport at level 0. 430×932 and 414×896 are fit 1 with no ad too. At those sizes the
  frame isn't placed, which meets the ticket's "or the frame isn't placed". The desktop and wide-phone packing is for the
  Scout to ticket.
