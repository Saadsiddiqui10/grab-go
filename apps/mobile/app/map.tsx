import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import { discoveryCategories, LAUNCH_CITY } from '@grabgo/config';
import type { BusinessSummary, ListingSummary } from '@grabgo/types';
import { GrabGoMap } from '../src/map/GrabGoMap';
import { loadMapLibre } from '../src/map/native';
import { useListings, useMapCafes } from '../src/api/hooks';
import { useLocationStore } from '../src/stores/location';
import { Text } from '../src/components/ui/Text';
import { AppIcon } from '../src/components/ui/AppIcon';
import { CategoryTabs, primaryCategory, useCategoryColors } from '../src/components/CategoryTabs';
import { useTheme } from '../src/theme';

/**
 * Every cafe in the city on one map, filterable by the same category tabs as
 * Home. Pins take their cafe's main drink colour (or the selected tab's) and
 * open the cafe's menu when tapped.
 *
 * The camera frames all matching cafes rather than a fixed neighbourhood, so a
 * cafe on the far side of Karachi is never silently off screen.
 */
export default function MapScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const origin = useLocationStore((state) => state.origin());
  const [category, setCategory] = useState<string | null>(null);

  const cafes = useMapCafes({
    ...(origin ? { latitude: origin.latitude, longitude: origin.longitude } : {}),
    ...(category ? { tags: category } : {}),
    sort: origin ? 'NEAREST' : 'RECOMMENDED',
  });

  // Cafes not on Grab & Go yet, filtered by the same tab.
  const listings = useListings(category ?? undefined);

  // Frame every partner cafe and the bulk of the listings. A few OSM cafes
  // sit far out on the highways; letting them set the zoom would shrink the
  // city to a speck, so the outermost few percent of listings are left out of
  // the framing (they are still on the map).
  const bounds = useMemo(
    () => boundsOf([...(cafes.data ?? []), ...trimOutliers(listings.data ?? [])]),
    [cafes.data, listings.data],
  );
  const label = discoveryCategories.find((entry) => entry.slug === category)?.label;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen
        options={{ title: `Cafes in ${LAUNCH_CITY.name}`, headerBackButtonDisplayMode: 'minimal' }}
      />
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />

      <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
        <CategoryTabs
          selected={category}
          onChange={setCategory}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base }}
        />
        <Text
          variant="footnote"
          color="textMuted"
          style={{ paddingHorizontal: theme.spacing.base }}
          accessibilityLiveRegion="polite"
        >
          {summary(cafes.isError, cafes.data?.length, label, listings.data?.length)}
        </Text>
      </View>

      <GrabGoMap
        center={origin ? [origin.longitude, origin.latitude] : undefined}
        fitBounds={bounds}
      >
        {/* Drawn first, so partner pins always sit on top of them. */}
        {listings.data && listings.data.length > 0 ? (
          <ListingDots
            listings={listings.data}
            onPress={(id) => router.push(`/listing/${id}`)}
          />
        ) : null}
        {cafes.data?.map((cafe) => (
          <CafePin
            key={cafe.id}
            cafe={cafe}
            category={category ?? primaryCategory(cafe.tags)}
            onPress={() => router.push(`/cafe/${cafe.id}`)}
          />
        ))}
      </GrabGoMap>
    </View>
  );
}

/** "6 cafes · 677 not on Grab & Go yet", "4 matcha cafes", or why there are none. */
function summary(
  isError: boolean,
  count: number | undefined,
  label: string | undefined,
  notYet: number | undefined,
): string {
  if (isError) return "Couldn't load cafes. Check your connection and try again.";
  if (count === undefined) return 'Finding cafes…';
  const kind = label ? `${label.toLowerCase()} ` : '';
  const partners = count === 0 ? `No ${kind}cafes on Grab & Go yet` : `${count} ${kind}${count === 1 ? 'cafe' : 'cafes'}`;
  return notYet ? `${partners} · ${notYet} not on Grab & Go yet (grey)` : partners;
}

/**
 * Cafes that are not on Grab & Go yet, as small grey dots. One GeoJSON layer
 * rather than a view per cafe: hundreds of native marker views would make the
 * map stutter, a circle layer is drawn by the GPU. Tapping one opens its sheet.
 */
function ListingDots({
  listings,
  onPress,
}: {
  listings: ListingSummary[];
  onPress: (id: string) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  const maplibre = loadMapLibre();
  const shape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: listings.map((listing) => ({
        type: 'Feature' as const,
        id: listing.id,
        properties: { id: listing.id },
        geometry: { type: 'Point' as const, coordinates: [listing.longitude, listing.latitude] },
      })),
    }),
    [listings],
  );
  if (maplibre === null) return null;
  const { GeoJSONSource, Layer } = maplibre;

  return (
    <GeoJSONSource
      id="listings"
      data={shape}
      onPress={(event) => {
        const id = event.nativeEvent.features[0]?.properties?.id;
        if (typeof id === 'string') onPress(id);
      }}
    >
      <Layer
        id="listing-dots"
        type="circle"
        paint={{
          'circle-color': theme.colors.textMuted,
          'circle-opacity': 0.75,
          'circle-stroke-color': theme.colors.surface,
          'circle-stroke-width': 1.5,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5.5, 17, 8],
        }}
      />
    </GeoJSONSource>
  );
}

/** Drop points outside the 3rd–97th percentile in either direction. */
function trimOutliers<T extends { latitude: number; longitude: number }>(points: T[]): T[] {
  if (points.length < 20) return points;
  const cut = (values: number[]): [number, number] => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] as number;
    return [at(0.03), at(0.97)];
  };
  const [minLat, maxLat] = cut(points.map((point) => point.latitude));
  const [minLng, maxLng] = cut(points.map((point) => point.longitude));
  return points.filter(
    (point) =>
      point.latitude >= minLat &&
      point.latitude <= maxLat &&
      point.longitude >= minLng &&
      point.longitude <= maxLng,
  );
}

/**
 * The box around every cafe, widened to a minimum size so a single pin does
 * not zoom the camera to street level.
 */
function boundsOf(
  cafes: Array<{ latitude: number; longitude: number }>,
): LngLatBounds | null {
  if (cafes.length === 0) return null;

  const MIN_SPAN = 0.02;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { longitude, latitude } of cafes) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  const padLng = Math.max(0, (MIN_SPAN - (east - west)) / 2);
  const padLat = Math.max(0, (MIN_SPAN - (north - south)) / 2);
  return [west - padLng, south - padLat, east + padLng, north + padLat];
}

/** A pin in the cafe's drink colour, with its name underneath. */
function CafePin({
  cafe,
  category,
  onPress,
}: {
  cafe: BusinessSummary;
  category: string | null;
  onPress: () => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  const coloursFor = useCategoryColors();
  const maplibre = loadMapLibre();
  if (maplibre === null) return null;

  const { Marker } = maplibre;
  const open = cafe.isOpenNow && cafe.acceptingOrders;
  const colours = coloursFor(category ?? '');
  const icon = discoveryCategories.find((entry) => entry.slug === category)?.icon ?? 'coffee';

  return (
    // The press goes on the Marker: touches inside a native marker view do not
    // reliably reach a React Pressable.
    <Marker id={cafe.id} lngLat={[cafe.longitude, cafe.latitude]} anchor="bottom" onPress={onPress}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${cafe.name}, ${cafe.areaName ?? ''}${open ? '' : ', closed'}. Open menu`}
        style={{ alignItems: 'center', opacity: open ? 1 : 0.55 }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colours.solid,
            borderWidth: 2,
            borderColor: theme.colors.surface,
          }}
        >
          <AppIcon name={icon} size={16} color={colours.onSolid} />
        </View>
        <View
          style={{
            marginTop: 3,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.radii.sm,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Text variant="caption" numberOfLines={1} maxScale={1.2}>
            {cafe.name}
          </Text>
        </View>
      </View>
    </Marker>
  );
}
