// The roads Free Drive ships, and where their data comes from. Each one is a real public road,
// legally mapped in OpenStreetMap; endpoints are picked by coordinate and the route between them
// is the shortest path over the OSM ways that carry the road's ref (scripts/roads/build.mjs).
//
// marking: lane-paint convention (eu: white dashed centre, white edges · us: double yellow centre,
//          white edges · no: yellow dashed centre, white edges)
// rail:    what the road's barriers are mostly made of where OSM doesn't say (steel | stone)
// dem:     which source the Terrain Tiles draw on here (credited in game and in docs/ROADS.md)
// maxGrade: the steepest the road is built (design grade; Stelvio's east ramp peaks near 12 %)
// sun:     azimuth (deg clockwise from north) and elevation for the day look; dusk is derived
export const ROADS = [
  {
    id: 'stelvio',
    name: 'Stelvio Pass',
    local: 'Passo dello Stelvio · SS38',
    country: 'Italy',
    blurb: 'Trafoi to the pass: the east ramp’s stacked hairpins, 2,758 m at the top.',
    ways: 'way["highway"]["ref"="SS38"]',
    bbox: [46.50, 10.40, 46.60, 10.58],
    from: [46.55225, 10.51029], to: [46.52862, 10.45321],
    marking: 'eu', rail: 'stone', speed: 40, dem: 'eu', coast: false, maxGrade: 0.12,
    sun: { az: 145, el: 38 },
  },
  {
    id: 'transfagarasan',
    name: 'Transfăgărășan',
    local: 'DN7C · Făgăraș Mountains',
    country: 'Romania',
    blurb: 'Up the glacial cirque to Bâlea Lake: the switchbacks everyone films from the ridge.',
    ways: 'way["highway"]["ref"="DN7C"]',
    bbox: [45.57, 24.55, 45.72, 24.68],
    from: [45.6560, 24.6040], to: [45.60537, 24.61697],
    marking: 'eu', rail: 'steel', speed: 40, dem: 'eu', coast: false, maxGrade: 0.11,
    sun: { az: 210, el: 34 },
  },
  {
    id: 'bigsur',
    name: 'Big Sur',
    local: 'California State Route 1 · Cabrillo Highway',
    country: 'United States',
    blurb: 'Garrapata to Point Sur over the Bixby Creek arch, cliffs straight into the Pacific.',
    ways: 'way["highway"]["ref"="CA 1"]',
    bbox: [36.28, -121.96, 36.46, -121.86],
    from: [36.4300, -121.9200], to: [36.30667, -121.90297],
    marking: 'us', rail: 'steel', speed: 65, dem: 'us', coast: true, maxGrade: 0.09,
    sun: { az: 250, el: 22 },
  },
  {
    id: 'atlantic',
    name: 'Atlantic Ocean Road',
    local: 'Atlanterhavsvegen · Fv64',
    country: 'Norway',
    blurb: 'Island to island across eight bridges, the Storseisund arch rising out of the sea.',
    ways: 'way["highway"]["ref"="64"]',
    bbox: [62.97, 7.18, 63.06, 7.45],
    from: [63.0049, 7.29566], to: [63.01372, 7.44487],
    marking: 'no', rail: 'steel', speed: 70, dem: 'no', coast: true, maxGrade: 0.1,
    sun: { az: 235, el: 16 },
  },
];

// DEM credit per source (the Terrain Tiles' required attribution, the part that applies).
export const DEM_CREDIT = {
  eu: 'Terrain: AWS Terrain Tiles (Mapzen/Tilezen) · EU-DEM, produced using Copernicus data and information funded by the European Union · SRTM and GMTED2010 courtesy of the U.S. Geological Survey',
  us: 'Terrain: AWS Terrain Tiles (Mapzen/Tilezen) · USGS 3DEP (formerly NED) and SRTM courtesy of the U.S. Geological Survey · ETOPO1 (NOAA)',
  no: 'Terrain: AWS Terrain Tiles (Mapzen/Tilezen) · © Kartverket · EU-DEM, produced using Copernicus data and information funded by the European Union · ETOPO1 (NOAA)',
};
export const OSM_CREDIT = '© OpenStreetMap contributors (ODbL)';
