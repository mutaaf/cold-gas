---
id: 0356
title: The page's first words (search snippet, link preview, install card) say what the game is now: a stunt and a crash, scored twice, by the game's own crew
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-21
pr:
by: scout
---

## Why
Players' funnel, 2026-11-07 → 11-21 (`/obs/digest` → `players`, `human` only): **28 people in two weeks**, 16 new visits
(2 returning), 41 runs. The game's biggest gap is not a funnel step but how few people arrive, and the words a stranger
reads *before* the first frame are the page's `<meta description>`, the link preview (`og:` / `twitter:`) and the install
card (`manifest.webmanifest`). They still describe the October game:

- `index.html:7`: "…A minimal 3D stunt game **judged by an AI panel**."
- `public/manifest.webmanifest:5`: "…Stick the landing; **three judges score it**."

Both are now untrue or off-vision. By the operator's call of 2026-11-13 (AGENTS.md §1, §5½) the default voice is the
game's own authored crew, no model is called unless the player asks, and the pitch is **Wreck Club**: the stunt is the
setup and the crash is the punchline, scored twice (Style and Wreck). Nothing a stranger reads says the crash is half
the game, and the AI line is the one claim §5½ forbids us to overstate ("AI usage is always visible and honest").
Link previews are the free distribution the share card (0260) feeds: a shared challenge link renders these exact strings.
Reference: Google's own snippet guidance, a description should summarise the page's content accurately in one or two
sentences (https://developers.google.com/search/docs/appearance/snippet).
Funnel number to move: `visit-new` (click-through from a snippet or preview) and `jump-tap` per new visit.

## What
- `index.html`: rewrite `<meta name="description">`, `og:description` and `twitter:description` (≤ 155 characters,
  one sentence each, the same wording) to name the stunt, the crash and the crew, for example: "Fire ten cold-gas
  thrusters, roll 360° over a row of parked EVs and stick the landing, or wreck it. Scored for Style and for Wreck.
  Free, in your browser." No "AI", no "judged by", no brand or real model name (invariant 3.7), no claim the game
  can't back. Titles stay "COLD GAS".
- `public/manifest.webmanifest` `description`: the same wording, shortened to fit.
- `og:image:alt` / `twitter:image:alt` stay (they describe the picture).
- Do not touch `public/guide`, `public/beta`, `public/privacy` copy or `og.png` (a separate ticket if the guide's lead
  is stale).

## Acceptance criteria
- [ ] `index.html`'s description, og and twitter descriptions are identical, ≤ 155 characters, and contain neither "AI" nor "judged".
- [ ] They mention the stunt (thrusters or roll), the crash ("wreck") and both scores ("Style", "Wreck").
- [ ] `manifest.webmanifest`'s description matches in substance, and the manifest stays valid JSON.
- [ ] The smoke test still boots with zero console errors; no new host, no new request.
- [ ] No brand or real model names appear in the new strings.

## Test plan
New `tests/unit/page-copy.test.js`: read `index.html` and the manifest from disk; assert the three descriptions are equal,
length ≤ 155, match /wreck/i and /style/i, do not match /\bAI\b|judged/i, and that `JSON.parse` of the manifest works.

## Out of scope
New artwork for `og.png`, structured data / sitemap (0201 was dropped), the guide and beta pages, the title's tagline.
