import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import {
  categoryColors,
  defaultCategoryColors,
  discoveryCategories,
  LAUNCH_CITY,
  type CategoryColorSet,
} from '@grabgo/config';
import type { BusinessSummary, ListingSummary } from '@grabgo/types';
import { GrabGoMap } from '../src/map/GrabGoMap';
import { loadMapLibre } from '../src/map/native';
import { useListings, useMapCafes } from '../src/api/hooks';
import { useLocationStore } from '../src/stores/location';
import { Text } from '../src/components/ui/Text';
import { AppIcon } from '../src/components/ui/AppIcon';
import { primaryCategory, useCategoryColors } from '../src/components/CategoryTabs';
import { shadow, useTheme } from '../src/theme';
import { categoryArt, FigmaIcon } from '../src/design/assets';
import { selectionFeedback } from '../src/lib/feedback';

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
  const insets = useSafeAreaInsets();
  const origin = useLocationStore((state) => state.origin());
  const requestAndLocate = useLocationStore((state) => state.requestAndLocate);
  const [category, setCategory] = useState<string | null>(null);
  // The craving panel's height, so the locate button and the map credit sit
  // just above it whatever the text size.
  const [panelHeight, setPanelHeight] = useState(250);
  const aboveTray = insets.bottom + 8 + panelHeight + 12;

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
      {/* The redesign floats its own controls over a full-screen map. */}
      <Stack.Screen options={{ headerShown: false, title: `Cafes in ${LAUNCH_CITY.name}` }} />
      {/* The map style is always light, so the clock and battery stay dark. */}
      <StatusBar style="dark" />

      <GrabGoMap
        center={origin ? [origin.longitude, origin.latitude] : undefined}
        fitBounds={bounds}
        fitPadding={{ top: insets.top + 170, bottom: aboveTray + 20, left: 40, right: 40 }}
        // OpenStreetMap's licence needs the credit visible, so it moves above
        // the tray instead of hiding under it.
        attributionPosition={{ bottom: aboveTray, left: 16 }}
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

      {/* ------------------------------------------------- search panel */}
      <View
        style={[
          styles.panel,
          { top: insets.top + 8, backgroundColor: theme.colors.background, gap: 14 },
          shadow('md'),
        ]}
      >
        <View style={styles.spread}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={10}
              style={{ marginLeft: -4, marginRight: 4 }}
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.heading} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/location')}
              accessibilityRole="button"
              accessibilityLabel={`City: ${LAUNCH_CITY.name}. Change area`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}
            >
              <FigmaIcon name="mapPin" width={15} height={18} tint={theme.colors.heading} />
              <Text variant="title3" color="heading" style={{ fontWeight: '700' }}>
                {LAUNCH_CITY.name}
              </Text>
              <FigmaIcon name="chevronDown" size={16} tint={theme.colors.heading} />
            </Pressable>
          </View>
          <Text variant="caption" color="textSecondary" style={{ fontWeight: '400' }}>
            Café map
          </Text>
        </View>

        {/* Opens Discover, where search lives, as on the home screen. */}
        <Pressable
          onPress={() => router.push('/(tabs)/discover')}
          accessibilityRole="search"
          accessibilityLabel="Search cafés or neighborhoods"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            height: 44,
            paddingHorizontal: 12,
            borderRadius: 14,
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <FigmaIcon name="search" size={18} tint={theme.colors.heading} />
          <Text variant="subhead" color="textSecondary" style={{ fontSize: 14, fontWeight: '400' }}>
            Search cafés or neighborhoods
          </Text>
        </Pressable>

        <Text
          variant="caption"
          color="textSecondary"
          style={{ fontWeight: '400', marginTop: -6 }}
          accessibilityLiveRegion="polite"
        >
          {summary(cafes.isError, cafes.data?.length, label, listings.data?.length)}
        </Text>
      </View>

      {/* ---------------------------------------------------- locate me */}
      <Pressable
        onPress={() => void requestAndLocate()}
        accessibilityRole="button"
        accessibilityLabel="Show cafes near my location"
        style={({ pressed }) => [
          styles.locate,
          { bottom: aboveTray, backgroundColor: theme.colors.background, opacity: pressed ? 0.8 : 1 },
          shadow('md'),
        ]}
      >
        <FigmaIcon name="locateFixed" size={22} tint={theme.colors.heading} />
      </Pressable>

      {/* -------------------------------------------- what are you craving */}
      <View
        onLayout={(event) => setPanelHeight(Math.round(event.nativeEvent.layout.height))}
        style={[
          styles.panel,
          { bottom: insets.bottom + 8, backgroundColor: theme.colors.background, gap: 12 },
          shadow('md'),
        ]}
      >
        <View style={styles.spread}>
          <Text variant="bodyStrong" color="heading">
            What are you craving?
          </Text>
          <FigmaIcon name="slidersHorizontal" size={18} tint={theme.colors.heading} />
        </View>
        <CravingGrid selected={category} onChange={setCategory} />
      </View>
    </View>
  );
}

/**
 * The map's category picker: a grid of coloured circles, three across, each
 * with its symbol and name. Same categories and behaviour as the tabs on Home;
 * tapping the selected one clears it.
 */
function CravingGrid({
  selected,
  onChange,
}: {
  selected: string | null;
  onChange: (slug: string | null) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const coloursFor = useCategoryColors();
  // The design's order: drinks, then food, with Desserts alone and centred
  // on the last row.
  const order = ['coffee', 'tea', 'matcha', 'breakfast', 'bakery', 'healthy', 'desserts'];
  const items = discoveryCategories
    .filter((entry) => entry.isLive && categoryArt[entry.slug])
    .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 8 }}>
      {items.map((item) => {
        const colours = coloursFor(item.slug);
        const isSelected = selected === item.slug;
        const art = categoryArt[item.slug];
        return (
          <Pressable
            key={item.slug}
            onPress={() => {
              selectionFeedback();
              onChange(isSelected ? null : item.slug);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isSelected }}
            style={{ width: '33.33%', alignItems: 'center', gap: 7, paddingVertical: 2 }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colours.solid,
                borderWidth: isSelected ? 2 : 0,
                borderColor: theme.colors.heading,
                transform: [{ scale: isSelected ? 1.12 : 1 }],
              }}
            >
              {art ? (
                <FigmaIcon
                  name={art.craving}
                  size={item.slug === 'desserts' ? 24 : 21}
                  // The line symbols are drawn light; in dark mode the lifted
                  // solids need dark symbols instead.
                  tint={
                    theme.isDark && item.slug !== 'desserts' ? colours.onSolid : undefined
                  }
                />
              ) : null}
            </View>
            <Text
              variant="caption"
              color="textPrimary"
              style={{ fontWeight: isSelected ? '600' : '400' }}
              maxScale={1.3}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Marker colours for the always-light base map. */
const MAP_INK = { paper: '#FFFFFF', text: '#201D1B', dot: '#8A7B74' } as const;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 20,
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locate: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

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
          'circle-color': MAP_INK.dot,
          'circle-opacity': 0.75,
          'circle-stroke-color': MAP_INK.paper,
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

/**
 * A pin with the cafe's logo (or its initials, until it uploads one) ringed in
 * its drink colour, a small drink badge on the corner, and its name underneath.
 */
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
  // The base map is always light, so markers use the light palette even in
  // dark mode; dark-theme colours would sink into the cream map.
  const lightColours = (slug: string): CategoryColorSet =>
    (categoryColors[slug] ?? defaultCategoryColors).light;
  const [logoFailed, setLogoFailed] = useState(false);
  const maplibre = loadMapLibre();
  if (maplibre === null) return null;

  const { Marker } = maplibre;
  const open = cafe.isOpenNow && cafe.acceptingOrders;
  const colours = lightColours(category ?? '');
  const icon = discoveryCategories.find((entry) => entry.slug === category)?.icon ?? 'coffee';
  const showLogo = Boolean(cafe.logoUrl) && !logoFailed;
  const initials = cafe.name
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

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
        <View style={{ width: 46, height: 46 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: showLogo ? MAP_INK.paper : colours.solid,
              borderWidth: 3,
              borderColor: colours.solid,
            }}
          >
            {showLogo ? (
              <Image
                source={{ uri: cafe.logoUrl ?? undefined }}
                style={{ width: 36, height: 36 }}
                contentFit="cover"
                onError={() => setLogoFailed(true)}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text
                maxScale={1}
                style={{ color: colours.onSolid, fontSize: 14, lineHeight: 17, fontWeight: '800' }}
              >
                {initials || '?'}
              </Text>
            )}
          </View>
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colours.solid,
              borderWidth: 1.5,
              borderColor: MAP_INK.paper,
            }}
          >
            <AppIcon name={icon} size={10} color={colours.onSolid} />
          </View>
        </View>
        <View
          style={{
            marginTop: 3,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.radii.sm,
            backgroundColor: MAP_INK.paper,
          }}
        >
          <Text variant="caption" numberOfLines={1} maxScale={1.2} style={{ color: MAP_INK.text }}>
            {cafe.name}
          </Text>
        </View>
      </View>
    </Marker>
  );
}
