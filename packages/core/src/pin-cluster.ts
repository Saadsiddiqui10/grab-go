/**
 * Grouping partner pins that would overlap at the current zoom.
 *
 * Partner cafés are drawn as React marker views (logo, name label), which the
 * native clusterer cannot group, so this does it in JS: project each café to
 * screen pixels at the current zoom (Web Mercator, 512px tiles as MapLibre
 * uses) and greedily gather anything whose pin *and name label* would collide
 * with a seed's: a box wider than it is tall, because labels are. There
 * are tens of partner cafés per city, not thousands, so the O(n²) pass is
 * trivial, and it only reruns when a pan or zoom settles.
 */

export interface Point {
  id: string;
  latitude: number;
  longitude: number;
}

export interface PinCluster<T extends Point> {
  /** Stable for a given set of members, for React keys. */
  id: string;
  members: T[];
  latitude: number;
  longitude: number;
}

const TILE_SIZE = 512;

export function project(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** Pixels between pin centres below which two pins (with labels) collide. */
export interface CollisionBox {
  width: number;
  height: number;
}

const PIN_WITH_LABEL: CollisionBox = { width: 110, height: 64 };

export function clusterPoints<T extends Point>(
  points: T[],
  zoom: number | null,
  box: CollisionBox = PIN_WITH_LABEL,
): PinCluster<T>[] {
  // Until the map reports a zoom, show every pin: the first camera fit follows
  // straight after and regroups them.
  if (zoom === null) {
    return points.map((point) => ({ id: point.id, members: [point], latitude: point.latitude, longitude: point.longitude }));
  }

  const projected = points.map((point) => ({ point, ...project(point.latitude, point.longitude, zoom) }));
  const used = new Set<string>();
  const clusters: PinCluster<T>[] = [];

  for (const seed of projected) {
    if (used.has(seed.point.id)) continue;
    used.add(seed.point.id);
    const members = [seed];

    for (const other of projected) {
      if (used.has(other.point.id)) continue;
      if (Math.abs(other.x - seed.x) <= box.width && Math.abs(other.y - seed.y) <= box.height) {
        used.add(other.point.id);
        members.push(other);
      }
    }

    const latitude = members.reduce((sum, member) => sum + member.point.latitude, 0) / members.length;
    const longitude = members.reduce((sum, member) => sum + member.point.longitude, 0) / members.length;
    clusters.push({
      id: members.map((member) => member.point.id).sort().join('+'),
      members: members.map((member) => member.point),
      latitude,
      longitude,
    });
  }

  return clusters;
}
