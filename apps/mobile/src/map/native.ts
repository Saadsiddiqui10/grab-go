/**
 * Guarded access to the MapLibre native module.
 *
 * MapLibre for React Native is native code, and Expo Go ships a fixed set of
 * native modules that does not include it. Loading it behind a try/catch keeps
 * that failure local to the map screen instead of taking down whatever
 * imported it.
 *
 * The type-only import is erased at compile time, so this stays fully typed
 * without triggering the module's side effects.
 */
import { TurboModuleRegistry } from 'react-native';
// Type-only: erased at build time, so it does not load the native module.
import type * as MapLibre from '@maplibre/maplibre-react-native';

type MapLibreModule = typeof MapLibre;

export type MapUnavailableReason = 'native-module';

/** `undefined` = not attempted yet, `null` = attempted and unavailable. */
let cached: MapLibreModule | null | undefined;

export function loadMapLibre(): MapLibreModule | null {
  if (cached !== undefined) return cached;

  // Probe before requiring. The package calls `getEnforcing` for its modules
  // at import time; in development that failure is reported to LogBox as an
  // error even though the catch below swallows it, and a half-evaluated import
  // then breaks later lookups. `get` returns null quietly instead.
  if (TurboModuleRegistry.get('MLRNCameraModule') == null) {
    cached = null;
    return cached;
  }

  try {
    // Loaded lazily so a build without the native module degrades to no map
    // instead of crashing at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@maplibre/maplibre-react-native') as MapLibreModule;
  } catch {
    cached = null;
  }

  return cached;
}

/**
 * Why the map cannot render, or `null` when it can.
 *
 * There is no token to check: MapLibre and OpenFreeMap need no credentials, so
 * a missing native module is the only reason the map cannot draw.
 */
export function mapUnavailableReason(): MapUnavailableReason | null {
  return loadMapLibre() === null ? 'native-module' : null;
}
