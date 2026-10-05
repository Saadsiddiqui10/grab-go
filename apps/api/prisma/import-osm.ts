import { PrismaClient } from '@prisma/client';

/**
 * Import Karachi's cafes from OpenStreetMap as "not on Grab & Go yet" listings.
 *
 *   npm run db:import-osm
 *
 * Every imported cafe is stored PENDING_APPROVAL with ordering off, which
 * keeps it out of discovery, menus and checkout: it can be shown on the map
 * and requested by customers, never ordered from. A listing only becomes
 * orderable after the real cafe is onboarded (an owner attached, a menu
 * added) and an admin approves it.
 *
 * Idempotent: listings are keyed on their OSM id, so re-running refreshes
 * names, positions and tags without duplicating anything, and never touches a
 * listing that has already been claimed.
 *
 * Data © OpenStreetMap contributors, available under the Open Database
 * Licence (ODbL). The app credits OSM wherever these listings are shown.
 */

const prisma = new PrismaClient();

/** Public Overpass servers, tried in order; the main one is often busy. */
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** Karachi, south-west to north-east: [south, west, north, east]. */
const KARACHI_BBOX = [24.74, 66.9, 25.12, 67.4] as const;
/** A partner cafe this close with a similar name is the same place. */
const DUPLICATE_RADIUS_METRES = 120;
/** Further than this from every area centre and the listing has no area. */
const AREA_RADIUS_METRES = 4000;

interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function main(): Promise<void> {
  const city = await prisma.city.findFirst({ where: { slug: 'karachi' } });
  if (!city) throw new Error('Karachi is not in the database. Run `npm run db:seed` first.');

  const areas = await prisma.area.findMany({ where: { cityId: city.id } });
  const partners = await prisma.business.findMany({
    where: { osmId: null, deletedAt: null },
    select: { name: true, latitude: true, longitude: true },
  });

  console.info('Fetching Karachi cafes from OpenStreetMap…');
  const elements = await fetchCafes();
  console.info(`  ${elements.length} named cafes found`);

  let created = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  let skippedClaimed = 0;

  for (const element of elements) {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    const tags = element.tags ?? {};
    const name = (tags['name:en'] ?? tags.name ?? '').trim();
    if (!name || latitude === undefined || longitude === undefined) continue;

    const isDuplicate = partners.some(
      (partner) =>
        distanceMetres(latitude, longitude, partner.latitude, partner.longitude) <=
          DUPLICATE_RADIUS_METRES && similarNames(partner.name, name),
    );
    if (isDuplicate) {
      skippedDuplicates += 1;
      continue;
    }

    const osmId = `${element.type}/${element.id}`;
    const nearest = nearestArea(areas, latitude, longitude);
    const data = {
      name,
      latitude,
      longitude,
      addressLine: addressOf(tags),
      areaId: nearest?.id ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      tags: categoryTags(tags),
    };

    const existing = await prisma.business.findUnique({
      where: { osmId },
      select: { id: true, claimedAt: true },
    });

    if (existing?.claimedAt) {
      // The cafe owns its listing now; OSM no longer gets a say.
      skippedClaimed += 1;
      continue;
    }

    if (existing) {
      await prisma.business.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.business.create({
        data: {
          ...data,
          osmId,
          slug: `osm-${element.type}-${element.id}`,
          type: 'CAFE',
          status: 'PENDING_APPROVAL',
          acceptingOrders: false,
          cityId: city.id,
          timezone: city.timezone,
        },
      });
      created += 1;
    }
  }

  console.info(`\nImport complete.`);
  console.info(`  Created     ${created}`);
  console.info(`  Refreshed   ${updated}`);
  console.info(`  Skipped     ${skippedDuplicates} already on Grab & Go, ${skippedClaimed} claimed`);
  console.info('\n  Data © OpenStreetMap contributors (ODbL).');
}

async function fetchCafes(): Promise<OsmElement[]> {
  const [south, west, north, east] = KARACHI_BBOX;
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:90];
(
  node["amenity"="cafe"]["name"](${bbox});
  way["amenity"="cafe"]["name"](${bbox});
);
out center tags;`;

  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            // Overpass refuses anonymous clients.
            'User-Agent': 'GrabAndGo-listing-import/0.1',
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ data: query }),
        });
        if (response.ok) {
          const json = (await response.json()) as { elements: OsmElement[] };
          return json.elements;
        }
        failures.push(`${new URL(url).host} ${response.status}`);
      } catch (error) {
        failures.push(`${new URL(url).host} ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    // Busy servers usually recover within seconds.
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
  }
  throw new Error(`Overpass is unavailable (${failures.join(', ')}). Try again later.`);
}

/**
 * Discovery tags from what OSM knows about the cafe, so the category tabs can
 * filter listings too. Most cafes carry none of these; they appear only when
 * no category is selected, rather than being guessed into one.
 */
function categoryTags(tags: Record<string, string>): string[] {
  const cuisine = (tags.cuisine ?? '').toLowerCase().split(/[;,]/).map((part) => part.trim());
  const result = new Set<string>();
  if (cuisine.includes('coffee_shop') || tags['drink:coffee'] === 'yes') result.add('coffee');
  if (cuisine.includes('tea') || tags['drink:tea'] === 'yes') result.add('tea');
  if (cuisine.includes('bubble_tea') || tags['drink:bubble_tea'] === 'yes') result.add('bubble-tea');
  if (cuisine.some((part) => ['cake', 'dessert', 'ice_cream'].includes(part))) result.add('desserts');
  if (cuisine.includes('breakfast')) result.add('breakfast');
  if (cuisine.some((part) => ['bakery', 'pastry'].includes(part))) result.add('bakery');
  if (tags['drink:matcha'] === 'yes' || cuisine.includes('matcha')) result.add('matcha');
  return [...result];
}

function addressOf(tags: Record<string, string>): string {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:suburb'] ?? tags['addr:district']].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Karachi';
}

function nearestArea<T extends { latitude: number; longitude: number }>(
  areas: T[],
  latitude: number,
  longitude: number,
): T | null {
  let best: T | null = null;
  let bestDistance = AREA_RADIUS_METRES;
  for (const area of areas) {
    const distance = distanceMetres(latitude, longitude, area.latitude, area.longitude);
    if (distance < bestDistance) {
      best = area;
      bestDistance = distance;
    }
  }
  return best;
}

function similarNames(a: string, b: string): boolean {
  const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = normalise(a);
  const right = normalise(b);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

main()
  .catch((error: unknown) => {
    console.error('Import failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
