---
id: 0081
title: Installs like a flagship app; one mark, a real manifest, link previews and a share card worth sending
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-23
by: operator
---

## Why
The operator: "the PWA version of this game should be sick: icon and name and share links just mouthwatering",
and then "high quality, sleek, perfection". The bar is craft: exact geometry, crisp at every size, sleek and
minimal, the same identity on every surface. No real company's name, mark, type or imagery (invariant 3.7).

Before this change: no web app manifest, no PNG icons (only a 64-unit `favicon.svg` cartoon of a car), no
apple-touch-icon, so iOS made a home-screen icon from a screenshot of the page, and Android had nothing to
install. A shared link previewed as two lines of text (`og:title` and `og:description` only, no image, no
`og:url`, no Twitter card). The results' Share sent a line of text. The first paint before the inlined
stylesheet landed was the browser's white.

The Worker is frozen and serves `/coldgas/` and `index.html` itself (`run_worker_first`) and everything else
from `dist`, so all of this has to be static files and HTML. Per-run link previews (an OG image per score)
need a server; the share card is drawn on the device instead.

## What
- **The mark** (`brand/icon.svg`, the source of truth): the wordmark's own wide G (Michroma's geometry, a
  rounded-rectangle C open at the upper right) cut from chrome, whose crossbar is a cold-gas jet, white at
  the nozzle and gone to ice by the centre. C and G in one form. The chrome's horizon line runs along the top
  of the jet. Near-black plate (#05070c) with a cool top light and a faint ice bloom behind the jet, a 6/1024
  hairline rim. A circular G with a bar was tried first and dropped: it is too close to a well-known
  company's mark.
- **`scripts/brand.mjs`** renders every icon from that file in Chromium (reproducible): `icons/icon-{192,512}.png`
  (any: rounded plate, transparent corners), `icons/maskable-{192,512}.png` (full-bleed plate, the mark's
  farthest point 0.355 of the size from the centre, inside the 0.4 safe circle), `apple-touch-icon.png`
  (180, opaque), `favicon-{16,32}.png`, and `favicon.svg` (the source, minified). `--check` measures the
  safe zone and transparency on the rendered PNGs. `--shots <url>` captures the manifest's screenshots and
  the link preview from the real game.
- **`public/manifest.webmanifest`**: name and short name COLD GAS, relative `id`/`start_url`/`scope` (the
  base path), `display: fullscreen` with `display_override: [fullscreen, standalone]` (Android hides the
  system bars for a game; iOS and desktop take standalone), `orientation: any`, #05070c background and theme,
  the icons (any + maskable + the SVG), four screenshots (1080×1920 and 1920×1080: the title, and the
  replay as the car leaves the Wall's lip upside down) and four shortcuts to deep links that exist
  (`?play=jump`, `?drive=endless`, `?drive=sandbox`, `?play=reveal`).
- **`index.html`**: the manifest, the icons, `mobile-web-app-capable` + `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-title`, a `black-translucent` status bar (the game already keeps clear of it with
  `--safe-*`), `color-scheme: dark`, and `style="background:#05070c"` on `<html>` so the very first paint,
  in a browser or from the home screen, is the game's black. Link previews: `og:type/site_name/url/title/
  description/image (+type, width, height, alt)`, `twitter:card summary_large_image`, a canonical. The few
  absolute URLs come from `%VITE_CG_SITE%` (vite.config.js, default `https://mutaafaziz.com/coldgas/`).
- **`public/og.png`** (1200×630): the replay's frame of the car leaving the lip upside down, lamps lit, the
  Wall's red edges climbing to it, shot 2000 px wide at 2× so the extra width is open night sky, cropped so
  the car sits on the right quarter; the chrome COLD GAS wordmark, an ice eyebrow (TEN COLD-GAS THRUSTERS),
  a hairline, "One roll. Stick the landing." and the address on the left.
- **The share card** (`src/share-card.js`): Share draws a 1080×1350 PNG on the device (the frame of the
  replay on screen, the wordmark and mark, the event, the verdict in its state colour, the score in chrome
  Michroma, the tier, three numbers in the player's units, the address) and hands it to the share sheet
  with `navigator.share({ files })` where `canShare` takes files (phones, desktop Safari); else text + link;
  else it copies the link and a toast says so. Drawing starts on `pointerdown` so it's ready by the click
  (about 150 ms) and the sheet opens inside the tap's activation; nothing is drawn until Share is pressed.
- **No service worker.** Chrome no longer requires a fetch handler to install, and a cache in front of
  `index.html` is exactly the stale-build risk the self-heal guards against (docs/LESSONS.md, 0040: a reload
  only into a real new build). Installed, the game loads like the website: HTML revalidated every time,
  hashed assets immutable.
- `dist/_headers`: the manifest `application/manifest+json`, revalidated every load; icons, screenshots and
  the preview cached a day.

## Acceptance criteria
- Chromium reports the manifest with no errors and the page with no installability errors under `/coldgas/`.
- Every icon, screenshot and the preview is served 200 under `/coldgas/` with the type and pixel size the
  manifest or the head claims; the Apple icon has no transparency; the maskable mark is inside the safe
  circle; the "any" icon has transparent corners.
- `og:image`/`twitter:image` are absolute on the production origin; the first paint is #05070c.
- Share produces a 1080×1350 PNG file for the share sheet; without one, the link is copied and a toast says so.
- No third-party request, no brand name or mark, every URL relative to the base path except the preview's.

## Test plan
- `tests/e2e/install.spec.js`: the manifest and installability over CDP, every image's status, type and
  size, the Apple icon's opacity, the maskable safe zone and the "any" icon's corners from the served PNGs;
  the head's tags and the first paint; Share's file (stubbed `navigator.share`/`canShare`) is a 1080×1350
  PNG; the copy fallback and its toast.
- `tests/unit/share-card.test.js`: the card's three numbers per event and in both unit systems, the text,
  the manifest's relative URLs and shortcut deep links, the head's links.
- `node scripts/brand.mjs --check`; every rendered asset looked at (icons at 1024/180/60/48/29/16 px, the
  maskable in a circle, on dark and light grounds; the preview; the screenshots; the share card for a
  Perfect 10 on desktop and a phone, and for a failed run).
