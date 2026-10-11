import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
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
import { clusterPoints, formatDistance, type PinCluster } from '@grabgo/core';
import type { GeoJSONSourceRef } from '@maplibre/maplibre-react-native';
import { GrabGoMap, type GrabGoMapHandle } from '../src/map/GrabGoMap';
import { loadMapLibre } from '../src/map/native';
import { useListings, useMapCafes } from '../src/api/hooks';
import { useLocationStore } from '../src/stores/location';
import { Text } from '../src/components/ui/Text';
import { AppIcon } from '../src/components/ui/AppIcon';
import { primaryCategory, useCategoryColors } from '../src/components/CategoryTabs';
import { shadow, useTheme } from '../src/theme';
import { categoryArt, FigmaIcon } from '../src/design/assets';
import { selectionFeedback } from '../src/lib/feedback';
import { formatPrepTime } from '../src/lib/format';
import { CafeLogo } from '../src/components/LoyaltyComponents';

/**
 * Every cafe in the city on one map, filterable by the same category tabs as
 * Home. Pins take their cafe's main drink colour (or the selected tab's).
 * Tapping one previews it in the bottom card; pins that would overlap gather
 * into a numbered pin that zooms in when tapped. The same cafes can be read as
 * a list, nearest first, for anyone who would rather not pan a map.
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
  const [topHeight, setTopHeight] = useState(150);
  const aboveTray = insets.bottom + 8 + panelHeight + 12;
  const mapRef = useRef<GrabGoMapHandle>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A tap on a native marker is also delivered to the map underneath; without
  // this, selecting a pin would be undone by the same tap a moment later.
  const lastPinTap = useRef(0);
  const selectPin = (id: string | null): void => {
    lastPinTap.current = Date.now();
    setSelectedId(id);
  };
  const [view, setView] = useState<'map' | 'list'>('map');

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

  // Regrouped only when a pan or zoom settles, never per animation frame.
  const clusters = useMemo(() => clusterPoints(cafes.data ?? [], zoom), [cafes.data, zoom]);
  // A filter can hide the cafe being previewed; the preview goes with it.
  const selected = cafes.data?.find((cafe) => cafe.id === selectedId) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* The redesign floats its own controls over a full-screen map. */}
      <Stack.Screen options={{ headerShown: false, title: `Cafes in ${LAUNCH_CITY.name}` }} />
      {/* The map style is always light, so the clock and battery stay dark. */}
      <StatusBar style="dark" />

      <GrabGoMap
        ref={mapRef}
        onRegionDidChange={(region) => setZoom(Math.round(region.zoom * 2) / 2)}
        onPress={() => {
          if (Date.now() - lastPinTap.current > 400) setSelectedId(null);
        }}
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
            onZoomInto={(center, toZoom) => mapRef.current?.easeTo(center, toZoom)}
          />
        ) : null}
        {clusters.map((cluster) =>
          cluster.members.length === 1 && cluster.members[0] ? (
            <CafePin
              key={cluster.id}
              cafe={cluster.members[0]}
              category={category ?? primaryCategory(cluster.members[0].tags)}
              selected={cluster.members[0].id === selectedId}
              onPress={() => {
                selectionFeedback();
                selectPin(cluster.members[0]?.id ?? null);
              }}
            />
          ) : (
            <ClusterPin
              key={cluster.id}
              cluster={cluster}
              category={category}
              onPress={() => {
                selectionFeedback();
                selectPin(null);
                // Two levels in is usually enough to part a cluster; it
                // regroups (smaller) if not, and the user can tap again.
                mapRef.current?.easeTo([cluster.longitude, cluster.latitude], Math.min(18, (zoom ?? 11) + 2));
              }}
            />
          ),
        )}
      </GrabGoMap>

      {/* ------------------------------------------------- search panel */}
      <View
        onLayout={(event) => setTopHeight(Math.round(event.nativeEvent.layout.height))}
        style={[
          styles.panel,
          { top: insets.top + 8, backgroundColor: theme.colors.background, gap: 14, zIndex: 2 },
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
          <ViewToggle value={view} onChange={(next) => {
            selectionFeedback();
            setSelectedId(null);
            setView(next);
          }} />
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

      {/* ------------------------------------------------------- list */}
      {view === 'list' ? (
        <CafeList
          cafes={cafes.data ?? []}
          isLoading={cafes.isLoading}
          top={insets.top + 8 + topHeight}
          bottom={aboveTray - 12}
          category={category}
          onOpen={(id) => router.push(`/cafe/${id}`)}
        />
      ) : null}

      {/* ---------------------------------------------------- locate me */}
      {view === 'map' ? (
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
      ) : null}

      {/* ------------------------------------------- preview, or cravings */}
      {selected && view === 'map' ? (
        <View
          onLayout={(event) => setPanelHeight(Math.round(event.nativeEvent.layout.height))}
          style={[styles.panel, { bottom: insets.bottom + 8, backgroundColor: theme.colors.background }, shadow('md')]}
        >
          <CafePreview
            cafe={selected}
            category={category ?? primaryCategory(selected.tags)}
            onOpen={() => router.push(`/cafe/${selected.id}`)}
            onClose={() => setSelectedId(null)}
          />
        </View>
      ) : (
      <View
        onLayout={(event) => setPanelHeight(Math.round(event.nativeEvent.layout.height))}
        style={[
          styles.panel,
          // Above the list too: the cravings filter both views.
          { bottom: insets.bottom + 8, backgroundColor: theme.colors.background, gap: 12, zIndex: 2 },
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
      )}
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
  onZoomInto,
}: {
  listings: ListingSummary[];
  onPress: (id: string) => void;
  onZoomInto: (center: [number, number], zoom: number) => void;
}): React.JSX.Element | null {
  const maplibre = loadMapLibre();
  const sourceRef = useRef<GeoJSONSourceRef>(null);
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
    // Hundreds of cafes are not on Grab & Go yet; at city zoom they gather into
    // counted grey circles (clustered natively, on the GPU) that open up as
    // you zoom or tap, and never compete with the partner pins.
    <GeoJSONSource
      id="listings"
      ref={sourceRef}
      data={shape}
      cluster
      clusterRadius={44}
      clusterMaxZoom={14}
      onPress={(event) => {
        const feature = event.nativeEvent.features[0];
        const properties = feature?.properties ?? {};
        if (properties.cluster && typeof properties.cluster_id === 'number') {
          const coordinates = (feature?.geometry as { coordinates?: [number, number] } | undefined)?.coordinates;
          void sourceRef.current
            ?.getClusterExpansionZoom(properties.cluster_id)
            .then((zoom) => {
              if (coordinates) onZoomInto(coordinates, zoom + 0.5);
            })
            .catch(() => undefined);
          return;
        }
        if (typeof properties.id === 'string') onPress(properties.id);
      }}
    >
      <Layer
        id="listing-clusters"
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': MAP_INK.dot,
          'circle-opacity': 0.32,
          'circle-stroke-color': MAP_INK.paper,
          'circle-stroke-width': 1.5,
          'circle-radius': ['step', ['get', 'point_count'], 11, 10, 13, 50, 16, 150, 19],
        }}
      />
      <Layer
        id="listing-cluster-count"
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-allow-overlap': true,
        }}
        paint={{ 'text-color': MAP_INK.text, 'text-opacity': 0.7 }}
      />
      <Layer
        id="listing-dots"
        type="circle"
        filter={['!', ['has', 'point_count']]}
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
  selected = false,
  onPress,
}: {
  cafe: BusinessSummary;
  category: string | null;
  selected?: boolean;
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
        accessibilityLabel={`${cafe.name}, ${cafe.areaName ?? ''}${open ? '' : ', closed'}. Show details`}
        accessibilityState={{ selected }}
        style={{
          alignItems: 'center',
          // Dimmed a little when closed, but solid enough to stand out from
          // the grey cafes that are not on Grab & Go yet.
          opacity: open || selected ? 1 : 0.82,
          transform: [{ scale: selected ? 1.18 : 1 }],
        }}
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
            backgroundColor: selected ? MAP_INK.text : MAP_INK.paper,
          }}
        >
          <Text
            variant="caption"
            numberOfLines={1}
            maxScale={1.2}
            style={{ color: selected ? MAP_INK.paper : MAP_INK.text, fontWeight: selected ? '700' : '400' }}
          >
            {cafe.name}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

/** Partner cafes that would overlap: a stack with the count, in the tab colour. */
function ClusterPin({
  cluster,
  category,
  onPress,
}: {
  cluster: PinCluster<BusinessSummary>;
  category: string | null;
  onPress: () => void;
}): React.JSX.Element | null {
  const maplibre = loadMapLibre();
  if (maplibre === null) return null;
  const { Marker } = maplibre;
  const colours = ((category ? categoryColors[category] : undefined) ?? defaultCategoryColors).light;
  const count = cluster.members.length;
  const names = cluster.members.map((member) => member.name);

  return (
    <Marker id={`cluster:${cluster.id}`} lngLat={[cluster.longitude, cluster.latitude]} anchor="center" onPress={onPress}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${count} cafes here: ${names.join(', ')}. Zoom in`}
        style={{ alignItems: 'center' }}
      >
        {/* Two offset rings behind read as "more than one". */}
        <View style={{ width: 54, height: 50 }}>
          {[8, 4].map((offset) => (
            <View
              key={offset}
              style={{
                position: 'absolute',
                left: offset,
                top: 8 - offset,
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: colours.solid,
                opacity: 0.35 + (8 - offset) * 0.08,
                borderWidth: 2,
                borderColor: MAP_INK.paper,
              }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 8,
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colours.solid,
              borderWidth: 3,
              borderColor: MAP_INK.paper,
            }}
          >
            <Text maxScale={1} style={{ color: colours.onSolid, fontSize: 16, lineHeight: 19, fontWeight: '800' }}>
              {count}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: MAP_INK.paper }}>
          <Text variant="caption" numberOfLines={1} maxScale={1.2} style={{ color: MAP_INK.text, maxWidth: 150 }}>
            {names[0]} +{count - 1}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

/** Map or list: the same cafes, two ways of reading them. */
function ViewToggle({
  value,
  onChange,
}: {
  value: 'map' | 'list';
  onChange: (next: 'map' | 'list') => void;
}): React.JSX.Element {
  const theme = useTheme();
  const options = [
    { key: 'map' as const, icon: 'map-outline' as const, label: 'Map' },
    { key: 'list' as const, icon: 'list-outline' as const, label: 'List' },
  ];

  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: theme.colors.accentSoft }}
    >
      {options.map((option) => {
        const active = value === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show cafes as a ${option.label.toLowerCase()}`}
            hitSlop={4}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 9,
              backgroundColor: active ? theme.colors.background : 'transparent',
            }}
          >
            <Ionicons name={option.icon} size={15} color={active ? theme.colors.heading : theme.colors.textSecondary} />
            <Text
              variant="caption"
              maxScale={1.3}
              style={{ color: active ? theme.colors.heading : theme.colors.textSecondary, fontWeight: active ? '700' : '400' }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One line of facts a customer decides on: open, distance, how fast, rating. */
function facts(cafe: BusinessSummary, { withArea = true } = {}): string {
  const parts = [
    cafe.isOpenNow ? (cafe.acceptingOrders ? `Ready in ${formatPrepTime(cafe.prepTimeMinutes)}` : 'Paused orders') : 'Closed',
    cafe.distanceMeters !== null ? formatDistance(cafe.distanceMeters) : withArea ? cafe.areaName : null,
    cafe.rating !== null ? `★ ${cafe.rating.toFixed(1)}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** The bottom card for a tapped pin: enough to decide, one tap to the menu. */
function CafePreview({
  cafe,
  category,
  onOpen,
  onClose,
}: {
  cafe: BusinessSummary;
  category: string | null;
  onOpen: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const colours = (categoryColors[category ?? ''] ?? defaultCategoryColors).light;
  const open = cafe.isOpenNow && cafe.acceptingOrders;

  return (
    <View style={{ gap: 14 }} accessibilityViewIsModal={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ borderRadius: 14, borderWidth: 2, borderColor: colours.solid }}>
          <CafeLogo name={cafe.name} uri={cafe.logoUrl} size={48} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="bodyStrong" color="heading" numberOfLines={1}>
            {cafe.name}
          </Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {cafe.areaName ?? cafe.cityName ?? ''}
          </Text>
          <Text variant="footnote" color={open ? 'success' : 'textMuted'} numberOfLines={1}>
            {facts(cafe, { withArea: false })}
          </Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close preview" hitSlop={10}>
          <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`View ${cafe.name} menu`}
        style={({ pressed }) => ({
          height: 48,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.accent,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="bodyStrong" style={{ color: '#FFFFFF' }}>
          {open ? 'View menu and order' : 'View menu'}
        </Text>
      </Pressable>
    </View>
  );
}

/** The list view: the same filtered cafes, nearest (or best) first. */
function CafeList({
  cafes,
  isLoading,
  top,
  bottom,
  category,
  onOpen,
}: {
  cafes: BusinessSummary[];
  isLoading: boolean;
  top: number;
  bottom: number;
  category: string | null;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: theme.colors.background,
        zIndex: 1,
      }}
    >
      <FlatList
        data={cafes}
        keyExtractor={(cafe) => cafe.id}
        contentContainerStyle={{ paddingTop: top + 12, paddingBottom: bottom + 12, paddingHorizontal: 16, gap: 10 }}
        ListEmptyComponent={
          <Text variant="body" color="textSecondary" align="center" style={{ marginTop: 24 }}>
            {isLoading ? 'Finding cafes…' : 'No cafes match. Try another craving.'}
          </Text>
        }
        renderItem={({ item }) => {
          const colours = (categoryColors[category ?? primaryCategory(item.tags) ?? ''] ?? defaultCategoryColors).light;
          const open = item.isOpenNow && item.acceptingOrders;
          return (
            <Pressable
              onPress={() => onOpen(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}. ${facts(item)}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 16,
                backgroundColor: theme.colors.surface,
                opacity: pressed ? 0.85 : open ? 1 : 0.7,
                borderLeftWidth: 4,
                borderLeftColor: colours.solid,
              })}
            >
              <CafeLogo name={item.name} uri={item.logoUrl} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" color="heading" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="footnote" color={open ? 'textSecondary' : 'textMuted'} numberOfLines={1}>
                  {facts(item)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}
