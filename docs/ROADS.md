# Free Drive roads: sources, licences, method

Free Drive puts the roadster, with its full physics, on real roads rebuilt from open data. All of
the data is fetched **at build time** by `scripts/roads/build.mjs` and committed as static assets
under `public/roads/`. The game itself only ever fetches `/coldgas/roads/<id>.bin.gz` from its own
origin, and only once a road is picked (invariant 3.3).

## The roads

| id | Road | Stretch | Length | Climb | Top | Asset (gzip) | Terrain source |
|---|---|---|---|---|---|---|---|
| `stelvio` | Stelvio Pass, SS38, Italy | Trafoi → Passo dello Stelvio (east ramp) | 13.3 km | +1,239 m | 2,749 m | 388 KB | EU-DEM (Copernicus) |
| `transfagarasan` | Transfăgărășan, DN7C, Romania | Bâlea valley → Bâlea Lake (north side) | 14.6 km | +961 m | 2,002 m | 365 KB | EU-DEM (Copernicus) |
| `bigsur` | Big Sur, CA-1 (Cabrillo Highway), USA | Garrapata → Point Sur, over Bixby Creek Bridge | 15.4 km | +280 m | 172 m | 472 KB | USGS 3DEP, ETOPO1 |
| `atlantic` | Atlantic Ocean Road, Fv64, Norway | Vevang → Kårvåg, eight bridges incl. Storseisundbrua | 9.0 km | +105 m | 25 m | 182 KB | © Kartverket, ETOPO1 |

Exact lengths, climbs and hairpin counts are generated into `src/drive/manifest.js` (what the road
picker shows) each time the script runs.

## Sources and licences

### OpenStreetMap (road centrelines and tags, barriers, woods, lakes)

- © OpenStreetMap contributors. Licensed under the **Open Database License (ODbL) 1.0**
  (<https://www.openstreetmap.org/copyright>).
- Fetched through the Overpass API (`overpass-api.de` and public mirrors) with an identifying
  user agent, cached in `scripts/roads/.cache/` (git-ignored) so a rebuild doesn't hit them again.
- What we use: ways carrying the road's `ref` (`SS38`, `DN7C`, `CA 1`, `64`) and their `name`,
  `lanes`, `width`, `bridge`, `tunnel` and `seamark:bridge:clearance_height` tags;
  `barrier=guard_rail|wall|retaining_wall|jersey_barrier`; `natural=wood`, `landuse=forest`;
  `natural=water`.
- **Attribution in the game:** "© OpenStreetMap contributors (ODbL)" on the road picker and,
  while driving, in the HUD's fine print (`.fd-fine`). The e2e tests check both.
- **Share-alike:** the baked assets are a *Produced Work* derived from the database (resampled,
  smoothed geometry plus our own derived terrain); the derived road data in `public/roads/*.bin.gz`
  is made available under the ODbL with this attribution, and it can be regenerated from OSM by
  anyone with `node scripts/roads/build.mjs`.

### Terrain: AWS Terrain Tiles (Registry of Open Data on AWS)

- Terrarium PNG tiles from `s3.amazonaws.com/elevation-tiles-prod` (zoom 13 near the road, zoom
  10 for the ±18 km surround, zoom 8 for the skyline). Produced by Mapzen/Tilezen (joerd), now a
  Linux Foundation project. Licence and required attribution:
  <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.
- Required attribution for the sources these roads draw on (shown in the HUD per road, and on the
  picker):
  - Europe terrain data produced using Copernicus data and information funded by the European
    Union, EU-DEM layers (Stelvio, Transfăgărășan, Norway's fill).
  - Norway terrain data © Kartverket (Atlantic Ocean Road).
  - United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the
    U.S. Geological Survey (Big Sur; SRTM/GMTED fill elsewhere).
  - Global ETOPO1 terrain data, U.S. National Oceanic and Atmospheric Administration (sea floor).

## Method (scripts/roads/build.mjs)

1. **Route.** Dijkstra over the OSM ways carrying the road's ref, between the nodes nearest the two
   endpoint coordinates in `scripts/roads/roads.config.mjs`.
2. **Centreline.** Local tangent plane at the route's centre (x east, z south, metres). A centripetal
   Catmull-Rom spline through the OSM nodes, resampled every 3 m, lightly relaxed; single-node
   "kinks" (OSM often draws a hairpin's apex as one sharp node) are eased locally.
3. **Elevation.** The DEM under each sample, then a running median (±30 m) for the slope that bleeds
   in between stacked switchbacks, a Gaussian (σ ≈ 30 m), and a grade limit (forward/backward
   clamping) at each road's design maximum (`maxGrade`, 9–12 %), eased further through tight
   hairpins (inside lanes are much shorter than the centreline). Bridges and tunnels span straight
   between their ends; bridges over navigable water rise to their charted clearance.
4. **Cross-section.** Width from `width`, else `lanes` × 3.0 m (3.5 m in the US) + 0.4 m, widened
   through tight hairpins by n·L²/2R for a 6 m design vehicle. Banking from curvature and the posted
   speed (up to 6 %, inside edge lower).
5. **Barriers.** Tagged OSM rails and walls within 6 m of the edge; parapets on every bridge; walls
   in tunnels; and a rail (steel, or stone on Stelvio) wherever the ground falls more than 5 m within
   8 m of the edge.
6. **Terrain.** A near grid (15 m) around the road and a far grid (120 m, ±18 km), Uint16 decimetres,
   row-delta coded; a 30 m tree-cover mask from OSM woods/forests; lake outlines; a skyline ring from
   zoom 8 between 17 and 90 km with earth curvature and refraction. On coastal roads the fine
   sources stop at the waterline, so the sea floor comes from the coarse bathymetry.

At load (src/sim/roads.js, pure and deterministic like the rest of the sim) the game conforms the
DEM to the road the way a road is built: flat under the shoulders, cut slopes no steeper than 1:1,
fill slopes 1:1.5, precomputed on a 4 m grid around the road.

## Rebuilding

```
node scripts/roads/build.mjs            # every road, and src/drive/manifest.js
node scripts/roads/build.mjs stelvio    # one road
```

Adding a road: an entry in `roads.config.mjs` (ref, bbox, endpoints, marking style, design grade,
DEM credit), a biome in `src/render/roadlook.js`, then rebuild. Keep each asset under 1.5 MB gzip
(`tests/unit/roads.test.js` checks it) and keep the road legally mapped and public.
