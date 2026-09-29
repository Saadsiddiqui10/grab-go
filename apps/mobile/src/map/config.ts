import Constants from 'expo-constants';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { grabGoMapStyle } from './grabgo-style';

/**
 * Map configuration.
 *
 * MapLibre GL is open source and OpenFreeMap serves its tiles free of charge,
 * so there is **no access token and no API key anywhere in this app**.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as {
  mapStyleUrl?: string;
};

/**
 * OpenFreeMap's "Liberty" style — OpenStreetMap data, no key required.
 *
 * Not what the app renders; kept as the documented, known-good URL to fall
 * back to if the branded style ever needs to be bypassed.
 *
 * https://openfreemap.org/
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * An override, for pointing the map at some other MapLibre style without
 * touching application code: `EXPO_PUBLIC_MAP_STYLE_URL`, or `extra.mapStyleUrl`
 * in `app.json` to bake a per-build default into CI.
 */
const styleUrlOverride = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? extra.mapStyleUrl ?? '';

export const MAP_STYLE_URL: string | null = styleUrlOverride.startsWith('http')
  ? styleUrlOverride
  : null;

/**
 * What the map renders: the Grab & Go style, unless a URL override is set.
 *
 * MapLibre accepts either a style URL or a style document, so the branded
 * style is passed inline — it is authored in this repo rather than hosted, so
 * there is nothing to fetch and nothing to keep in sync.
 */
export const MAP_STYLE: StyleSpecification | string = MAP_STYLE_URL ?? grabGoMapStyle;

/** For logging — a style document has no URL of its own. */
export const MAP_STYLE_DESCRIPTION = MAP_STYLE_URL ?? 'the bundled Grab & Go style';

/**
 * Where the map opens during development.
 *
 * Clifton, Karachi — where the seeded demo cafes are, so the default view is
 * useful while building. This is **not** a stand-in for the user's location.
 */
export const DEV_DEFAULT_CENTER: [number, number] = [67.0301, 24.8138];
export const DEV_DEFAULT_ZOOM = 13.5;

/**
 * The map palette, re-exported so callers that only need a colour do not have
 * to pull in the whole style document.
 */
export { mapPalette } from './grabgo-style';
