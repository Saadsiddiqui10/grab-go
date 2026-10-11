import { describe, expect, it } from 'vitest';
import { clusterPoints, project } from './pin-cluster';

// Real Karachi cafés from the seed: two in Clifton a few hundred metres apart,
// one across the city in Gulshan.
const clifton1 = { id: 'espresso-lab', latitude: 24.8138, longitude: 67.0302 };
const clifton2 = { id: 'roastery', latitude: 24.8162, longitude: 67.0335 };
const gulshan = { id: 'chai-wala', latitude: 24.9204, longitude: 67.0932 };

describe('clusterPoints', () => {
  it('groups neighbours at city zoom and keeps distant cafes apart', () => {
    const clusters = clusterPoints([clifton1, clifton2, gulshan], 11);
    expect(clusters).toHaveLength(2);
    const clifton = clusters.find((cluster) => cluster.members.length === 2);
    expect(clifton?.members.map((member) => member.id).sort()).toEqual(['espresso-lab', 'roastery']);
    // Centred between its members.
    expect(clifton?.latitude).toBeCloseTo((clifton1.latitude + clifton2.latitude) / 2, 6);
  });

  it('treats labels as wide: side by side collides sooner than stacked', () => {
    const origin = { id: 'a', latitude: 24.86, longitude: 67.0 };
    // ~90px apart at zoom 14, east-west then north-south.
    const east = { id: 'b', latitude: 24.86, longitude: 67.0 + 90 / (512 * 2 ** 14) * 360 };
    const north = { id: 'c', latitude: 24.86 + 0.0035, longitude: 67.0 };
    expect(clusterPoints([origin, east], 14)).toHaveLength(1);
    expect(clusterPoints([origin, north], 14)).toHaveLength(2);
  });

  it('splits them apart once zoomed in', () => {
    expect(clusterPoints([clifton1, clifton2, gulshan], 16)).toHaveLength(3);
  });

  it('shows every pin before the map reports a zoom', () => {
    expect(clusterPoints([clifton1, clifton2], null)).toHaveLength(2);
  });

  it('keys a cluster by its members, whatever their order', () => {
    expect(clusterPoints([clifton1, clifton2], 11)[0]?.id).toBe(clusterPoints([clifton2, clifton1], 11)[0]?.id);
  });

  it('projects with Web Mercator, doubling distances per zoom level', () => {
    const a = project(clifton1.latitude, clifton1.longitude, 12);
    const b = project(clifton1.latitude, clifton1.longitude, 13);
    expect(b.x / a.x).toBeCloseTo(2, 6);
    expect(project(0, 0, 0)).toEqual({ x: 256, y: 256 });
  });
});
