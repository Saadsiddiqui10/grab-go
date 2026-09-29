import type { GeoPoint } from '@grabgo/types';

/**
 * Geo helpers.
 *
 * Distances are straight-line: the app promises "how far is this cafe", not
 * turn-by-turn routing. Karachi's grid makes the error small enough for sorting a
 * nearby list, and it costs no external API call on every home-screen load.
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}

/** "450 m" under a kilometre, "2.3 km" above it. */
export function formatDistance(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Bounding box for a radius search.
 *
 * Lets the database narrow candidates with a plain indexed BETWEEN on lat/lng
 * before exact haversine ranking, which keeps "cafes near me" fast without
 * requiring PostGIS on day one.
 */
export function boundingBox(
  center: GeoPoint,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = (radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  // Longitude degrees shrink toward the poles; guard the cosine against 0.
  const cosLat = Math.max(0.01, Math.cos(toRadians(center.latitude)));
  const lngDelta = latDelta / cosLat;

  return {
    minLat: center.latitude - latDelta,
    maxLat: center.latitude + latDelta,
    minLng: center.longitude - lngDelta,
    maxLng: center.longitude + lngDelta,
  };
}

export function isValidCoordinate(point: Partial<GeoPoint> | null | undefined): point is GeoPoint {
  return (
    !!point &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** Rough walking time, used for "8 min walk" hints on the cafe card. */
export function walkingMinutes(meters: number, metersPerMinute = 80): number {
  return Math.max(1, Math.round(meters / metersPerMinute));
}
