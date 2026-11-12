---
id: 0201
title: Search engines and link unfurlers can find the game and say what it is
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-12
pr:
by: scout
---

## Why
The funnel (`/obs/digest → players`, 2026-11-01..11-11): 10 human sessions in 11 days, most days 0 to 2, and 8 `visit-new` in
all. Whatever we do inside the game, almost nobody arrives to see it, and the biggest drop is before the first visit. The
game has an og:image and a one-line description, but no `robots.txt`, no `sitemap.xml` and no structured data
(`public/` holds none; `index.html` has one `<meta name="description">`). A search for the game's own words ("stunt game
judged by AI", "cold gas thruster game") has nothing to index but a three-word title. Free, on-device, no new host: a
sitemap listing the title, `/guide/` and `/privacy/`, a robots file that allows everything, a schema.org `VideoGame`
JSON-LD block and a title that says what the page is. Google documents each: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap,
https://developers.google.com/search/docs/appearance/structured-data/software-app, https://schema.org/VideoGame.

## What
- `public/robots.txt`: `User-agent: *`, `Allow: /`, and a `Sitemap:` line with the site's absolute URL.
- `public/sitemap.xml`: the title, `guide/` and `privacy/`, absolute URLs on the same origin as `og:url`.
- `index.html`: `<title>` becomes "COLD GAS: a 3D stunt game, ten thrusters, one roll" (the visible wordmark is unchanged);
  a `<script type="application/ld+json">` `VideoGame` with name, description, `gamePlatform` "Web browser", `genre`, `url`,
  `image` (og.png), `isAccessibleForFree` true, `inLanguage` en. No ratings, no reviews, no offers: nothing we cannot back.
- The site origin comes from the same `VITE_CG_SITE` the canonical link already uses, so previews and forks do not point at production.
No script, host, tracker or runtime change; the Worker is untouched (static assets only).

## Acceptance criteria
- [ ] `dist/coldgas/robots.txt` and `sitemap.xml` exist after `npm run build`, with absolute URLs equal to the built `og:url` origin.
- [ ] Every sitemap URL answers 200 on the preview and appears in the build output.
- [ ] The built page contains one valid JSON-LD `VideoGame` block (parses with `JSON.parse`, `@type` is `VideoGame`, no `aggregateRating`/`offers`).
- [ ] `<title>` is the new text; the title-audit and HUD audit are unchanged and pass at every viewport.
- [ ] The CSP (if any) is unchanged and the console is clean at 390×844 and 1280×720.
- [ ] No new network host (the allowed list in AGENTS.md § Invariants is unchanged).

## Test plan
A unit or build-output test (tests/unit) reads `dist/coldgas/index.html`, `robots.txt` and `sitemap.xml` and asserts the three
bullets above; the existing e2e smoke asserts the document title. After shipping, watch `visit-new` and `human` sessions in
`players` for a month (search lag is weeks, so judge it slowly and say so).

## Out of scope
Ads, backlinks, social posting, analytics, per-run unfurl cards (the run rides in the link's fragment, which a server never sees).
