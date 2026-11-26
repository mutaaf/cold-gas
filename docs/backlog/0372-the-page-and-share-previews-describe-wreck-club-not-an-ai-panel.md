---
id: 0372
title: The page description, share preview and manifest describe the game as it is (stunt and wreck, the crew's own words), not "judged by an AI panel"
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-26
pr:
by: scout
---

## Why
Every person who finds COLD GAS from a search result, a pasted link or an installed icon reads these strings before
they see a pixel. `index.html` line 7 still says "A minimal 3D stunt game judged by an AI panel", and the manifest says
"three judges score it". Since 2026-11-13 the default voice is authored by the game (AGENTS.md §1 pillar 3, §3.5½: no
model call unless the player asks), and the game is Wreck Club: the stunt is the setup and the crash is the punchline.
So the first sentence a stranger reads is the one thing the game is not, and it hides the one thing that makes people
share (a car coming apart over a row of parked EVs). Funnel (14 days, `human` sessions): 31 sessions, 16 `visit-new`,
only 5 `visit-return`; the product needs new visitors to click, and the click is decided by this text.
AGENTS.md §3.5½ also asks that AI usage be shown honestly, so a page that claims an AI judges every run is wrong on
that count too.
Funnel number to move: `visit-new` per share/search impression (not directly measurable; the check is copy accuracy),
and `jump-tap` per `visit-new`.

## What
- `index.html`: `<meta name="description">`, `og:description` and `twitter:description` say what happens: ten cold-gas
  thrusters, a roll over a row of parked EVs, a perfect landing or a spectacular crash, scored twice (Style and Wreck)
  by an invented stunt crew. No claim that a model judges by default; no brand names (invariant 3.7).
- `public/manifest.webmanifest` `description`: the same sentence, shorter, no "three judges score it" unless it stays true.
- One inline `<script type="application/ld+json">` `VideoGame` block in `index.html` (name, description, url from
  `%VITE_CG_SITE%`, `applicationCategory: "Game"`, `operatingSystem: "Any"`, `isAccessibleForFree: true`). Inline only:
  no new host, no analytics. Check the privacy page's third-party statement still holds.
- Keep `og:title` / `twitter:title` as `COLD GAS`; keep the og image.

## Acceptance criteria
- [ ] The three descriptions are one consistent sentence of ≤ 155 characters (search snippets cut there) and contain no
      "AI panel", "AI judge" or brand name.
- [ ] The JSON-LD parses (`JSON.parse`) and its `url` equals the canonical link.
- [ ] `npm run build` output (`dist/coldgas/index.html`) has no un-substituted `%VITE_CG_…%` token.
- [ ] The smoke test still fails on any non-localhost request (no new request), 0 console errors at 390×844 and 1280×720.
- [ ] The portal builds (`build:crazygames`, `build:gamedistribution`) still pass their gates.

## Test plan
Unit test (`tests/unit/`, beside `privacy.test.js`): read `index.html` and the manifest, assert the description length,
the forbidden words, JSON-LD validity and its url; assert the manifest and meta descriptions match.

## Out of scope
A root `robots.txt`/sitemap (the root of mutaafaziz.com is another repo: propose it to the operator in the PR body),
new og art, paid or social posting, any tracker.
