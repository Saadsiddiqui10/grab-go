import type {
  StyleSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';

/**
 * The Grab & Go map style.
 *
 * A hand-written MapLibre style over **OpenFreeMap** tiles (OpenMapTiles
 * schema, OpenStreetMap data). No access token, no API key, no Mapbox.
 *
 * The design intent is unchanged from the original style:
 *
 *   - cream land, so the map sits *under* the product's UI rather than
 *     competing with it
 *   - a warm road hierarchy — cream, beige, caramel, espresso — where
 *     importance is carried by warmth and weight rather than by hue changes
 *   - no POI icons at all. A generic pin salad is what makes a map feel like
 *     someone else's map, and this product places its own cafe markers
 *   - restrained labels: espresso text, cream halo, generous tracking on
 *     neighbourhood names
 *
 * ---------------------------------------------------------------------------
 * Source-layer mapping: Mapbox Streets v8 (before) → OpenMapTiles (now)
 * ---------------------------------------------------------------------------
 *
 *   landcover                    → landcover           class wood, grass
 *   landuse  park/grass          → park                a source-layer of its own
 *   landuse  pitch/cemetery      → landuse             class pitch, cemetery
 *   landuse  hospital/school     → landuse             class hospital, school
 *   landuse  airport             → aeroway             a source-layer of its own
 *   water                        → water               direct
 *   waterway                     → waterway            direct
 *   building                     → building            direct
 *   road                         → transportation      see class notes below
 *   road (names)                 → transportation_name names live apart here
 *   admin                        → boundary            admin_level, direct
 *   natural_label sea/ocean      → water_name
 *   place_label settlement       → place               class city/town/village
 *   place_label settlement_subdivision
 *                                → place               class suburb/quarter/
 *                                                      neighbourhood
 *   place_label region/country   → place               class state/country
 *
 * Road classes differ. `street` / `street_limited` is `minor` here;
 * `major_rail` / `minor_rail` collapse to `rail` / `transit`; and motorway
 * ramps are not a class at all — they are `class: motorway` carrying
 * `ramp: 1`, so the motorway layers below already draw them, exactly as the
 * original's `[motorway, motorway_link]` filter did.
 *
 * Every class named here was checked against a live Karachi tile rather than
 * assumed from documentation.
 *
 * Schema: https://openmaptiles.org/schema/
 */

/* ------------------------------------------------------------------ palette */

/**
 * Map-specific palette.
 *
 * Kept here rather than in `@grabgo/config` because a map needs intermediate
 * tints that mean nothing as UI tokens, and because the map should be tunable
 * without disturbing the shared design system.
 */
export const mapPalette = {
  espresso: '#3B2418',
  cream: '#F7F1E8',
  white: '#FFFFFF',
  caramel: '#B97845',
  mint: '#B8D8C0',
  textPrimary: '#171513',
  textSecondary: '#746C65',
  border: '#E7DED3',

  /** Land, a step warmer than the UI cream so cards lift off it. */
  land: '#F7F1E8',
  /** Water: cool enough to read as water, never "map blue". */
  water: '#DCE6EA',
  waterDeep: '#CCDCE2',
  /** Greenery, derived from Mint but muted so it recedes. */
  park: '#DEEAE0',
  parkDeep: '#D2E3D6',
  /** Buildings sit barely above the land. */
  building: '#EFE7DA',
  buildingOutline: '#E7DED3',

  /** The road ramp, from quiet lanes through to major arteries. */
  roadService: '#F3ECE1',
  roadMinor: '#EFE6D9',
  roadSecondary: '#E3D6C2',
  roadPrimary: '#CBA67E',
  roadMotorway: '#8B5E3C',
  roadMotorwayCasing: '#63412C',
  roadCasing: '#E7DED3',

  /** Labels. */
  labelPrimary: '#171513',
  labelSecondary: '#746C65',
  labelHalo: '#F7F1E8',
  labelWater: '#8FA8B2',
} as const;

/**
 * OpenFreeMap serves Noto Sans. The original asked for Open Sans with an Arial
 * Unicode fallback; Noto fills the same role, and its coverage is what keeps
 * Urdu place names in Karachi from rendering as boxes.
 */
const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_MEDIUM = ['Noto Sans Bold'];

const SOURCE = 'openmaptiles';

/** OpenFreeMap's public endpoints. No key, no account, no billing. */
const TILE_JSON_URL = 'https://tiles.openfreemap.org/planet';
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

type TextField = NonNullable<SymbolLayerSpecification['layout']>['text-field'];

/**
 * Label text: English, then a Latin transliteration, then the local name.
 *
 * Keeps the original's `name_en` intent while falling back the way the
 * OpenFreeMap styles do, so a feature with no English name still labels
 * instead of rendering blank.
 */
const LABEL_TEXT: TextField = [
  'coalesce',
  ['get', 'name_en'],
  ['get', 'name:latin'],
  ['get', 'name'],
];

/* -------------------------------------------------------------------- style */

export const grabGoMapStyle: StyleSpecification = {
  version: 8,
  name: 'Grab & Go',
  metadata: {
    'grabgo:description':
      'Warm, minimal map styled to match the Grab & Go product surface.',
  },

  sources: {
    // The TileJSON carries the OpenFreeMap / OpenMapTiles / OpenStreetMap
    // attribution string, which is what MapLibre's attribution control shows.
    [SOURCE]: { type: 'vector', url: TILE_JSON_URL },
  },

  glyphs: GLYPHS_URL,

  // No sprite: this style draws no icons, by design.

  layers: [
    /* ------------------------------------------------------------- ground */
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': mapPalette.land },
    },

    /* ---------------------------------------------------------- landcover */
    {
      // Broad natural cover. Faint, so the map reads calm rather than patchy.
      id: 'landcover',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]],
      paint: {
        'fill-color': mapPalette.park,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 14, 0.55],
        'fill-antialias': false,
      },
    },

    {
      // Parks and protected areas — their own source-layer in OpenMapTiles.
      id: 'landuse-park',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'park',
      paint: {
        'fill-color': mapPalette.parkDeep,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.85],
      },
    },

    {
      // Pitches and cemeteries: the rest of the original's green group.
      id: 'landuse-green',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['pitch', 'cemetery']]],
      paint: {
        'fill-color': mapPalette.parkDeep,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.85],
      },
    },

    {
      // Hospitals and schools — a whisper of tone, so large campuses do not
      // read as empty land.
      id: 'landuse-institutional',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['hospital', 'school']]],
      paint: { 'fill-color': mapPalette.building, 'fill-opacity': 0.55 },
    },

    {
      // Airport ground. `airport` was a landuse class in Mapbox Streets; here
      // it is the `aeroway` layer, whose polygons are aprons and aerodromes.
      id: 'landuse-airport',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': mapPalette.building, 'fill-opacity': 0.55 },
    },

    /* -------------------------------------------------------------- water */
    {
      id: 'water',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'water',
      paint: { 'fill-color': mapPalette.water },
    },

    {
      id: 'waterway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'waterway',
      minzoom: 8,
      paint: {
        'line-color': mapPalette.waterDeep,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 16, 3],
      },
    },

    /* ---------------------------------------------------------- buildings */
    {
      // Close zoom only, and barely there. Footprints are texture, not
      // information — the cafe markers are the information.
      id: 'building',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-color': mapPalette.building,
        'fill-outline-color': mapPalette.buildingOutline,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 0.9],
      },
    },

    /* -------------------------------------------------------------- roads */
    {
      // Footpaths and pedestrian ways: dashed and quiet.
      id: 'road-path',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian', 'track']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.border,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1.6],
        'line-dasharray': [2, 2],
      },
    },

    {
      id: 'road-service',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['service', 'track']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadService,
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 6],
      },
    },

    {
      // `minor` is OpenMapTiles' residential / unclassified street. The Mapbox
      // names stay in the filter because some extracts still emit them.
      id: 'road-minor',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['minor', 'street', 'street_limited']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadMinor,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          12, 0.8,
          16, 5,
          20, 22,
        ],
      },
    },

    {
      id: 'road-secondary',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadSecondary,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          9, 0.8,
          14, 4,
          20, 26,
        ],
      },
    },

    {
      id: 'road-primary',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadPrimary,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          7, 0.8,
          14, 5,
          20, 30,
        ],
      },
    },

    {
      // Casing under motorways only, so the strongest road reads as one
      // confident stroke rather than a stack of lines.
      //
      // `class: motorway` includes ramps, which carry `ramp: 1` rather than a
      // class of their own — the same set the original's
      // `[motorway, motorway_link]` filter matched.
      id: 'road-motorway-casing',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadMotorwayCasing,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          6, 1.4,
          14, 8,
          20, 36,
        ],
        'line-opacity': 0.35,
      },
    },

    {
      id: 'road-motorway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapPalette.roadMotorway,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          6, 0.8,
          14, 5.5,
          20, 30,
        ],
      },
    },

    {
      // `major_rail` / `minor_rail` collapse to `rail` / `transit` here.
      id: 'road-rail',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: {
        'line-color': mapPalette.border,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 18, 2],
        'line-dasharray': [3, 3],
      },
    },

    /* --------------------------------------------------------- boundaries */
    {
      id: 'admin-boundary',
      type: 'line',
      source: SOURCE,
      'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 2],
      paint: {
        'line-color': mapPalette.border,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4],
        'line-dasharray': [4, 3],
      },
    },

    /* ------------------------------------------------------------- labels */
    /*
     * Deliberately absent: the `poi`, `aerodrome_label` and house-number
     * layers. Every icon the base map draws is one the product's own cafe
     * markers would have to compete with.
     */

    {
      id: 'label-water',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'water_name',
      minzoom: 8,
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': FONT_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14],
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
      },
      paint: {
        'text-color': mapPalette.labelWater,
        'text-halo-color': mapPalette.water,
        'text-halo-width': 1,
      },
    },

    {
      // Road names live in their own source-layer in OpenMapTiles, so this is
      // a symbol layer over `transportation_name` rather than over the road
      // geometry. `street` is `minor` here.
      id: 'label-road',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': LABEL_TEXT,
        'text-font': FONT_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
        'text-max-angle': 30,
        'text-padding': 2,
      },
      paint: {
        'text-color': mapPalette.labelSecondary,
        'text-halo-color': mapPalette.labelHalo,
        'text-halo-width': 1.4,
      },
    },

    {
      // Neighbourhoods — Clifton, Zamzama. Tracked out and uppercase, which is
      // what gives the map its editorial feel.
      id: 'label-neighbourhood',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 11,
      maxzoom: 16,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['suburb', 'quarter', 'neighbourhood']],
      ],
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 15, 12],
        'text-letter-spacing': 0.22,
        'text-max-width': 7,
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': mapPalette.labelSecondary,
        'text-halo-color': mapPalette.labelHalo,
        'text-halo-width': 1.6,
      },
    },

    {
      // Cities and towns.
      id: 'label-settlement',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 4,
      maxzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]],
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 8, 14, 12, 18],
        'text-max-width': 8,
        'text-letter-spacing': 0.02,
      },
      paint: {
        'text-color': mapPalette.labelPrimary,
        'text-halo-color': mapPalette.labelHalo,
        'text-halo-width': 1.8,
      },
    },

    {
      id: 'label-region',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 3,
      maxzoom: 8,
      filter: ['in', ['get', 'class'], ['literal', ['state', 'country']]],
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 13],
        'text-letter-spacing': 0.24,
        'text-max-width': 8,
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': mapPalette.labelSecondary,
        'text-halo-color': mapPalette.labelHalo,
        'text-halo-width': 1.6,
      },
    },
  ],
};
