import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Animated, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BusinessSummary } from '@grabgo/types';
import { useTheme } from '../../src/theme';
import { useLocationStore } from '../../src/stores/location';
import { useDiscoverCafes, useFavourites, useToggleFavourite } from '../../src/api/hooks';
import { Text } from '../../src/components/ui/Text';
import { SearchInput } from '../../src/components/ui/Input';
import { LocationRow, MapButton } from '../../src/components/HeaderControls';
import { FigmaIcon, type FigmaAssetName } from '../../src/design/assets';
import { selectionFeedback } from '../../src/lib/feedback';
import { CafeCard } from '../../src/components/CafeCard';
import { CategoryTabs, useCategoryColors } from '../../src/components/CategoryTabs';
import { CategoryPattern } from '../../src/design/CategoryPattern';
import { SunPattern, useBreakfastSkin } from '../../src/design/breakfast';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { StatusBar } from 'expo-status-bar';
import { withTabTransition } from '../../src/components/ui/TabTransition';
import { enterStyle, useBlendedColor, useEnterOnChange } from '../../src/lib/motion';

/**
 * Discover.
 *
 * Search plus the filters that actually change a decision: what kind of place,
 * whether it is open, and how to rank the results. Everything is optional and
 * the list is never empty of controls, so the screen is usable the moment it
 * opens rather than requiring a query first.
 */

type SortOption = 'RECOMMENDED' | 'NEAREST' | 'FASTEST' | 'RATING';

function DiscoverScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const origin = useLocationStore((state) => state.origin());
  const locationLabel = useLocationStore((state) => state.label());

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [openNow, setOpenNow] = useState(false);
  const [sort, setSort] = useState<SortOption>('RECOMMENDED');

  const favourites = useFavourites();
  const toggleFavourite = useToggleFavourite();
  const favouriteIds = useMemo(() => new Set(favourites.data ?? []), [favourites.data]);

  const params = useMemo(
    () => ({
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(category ? { tags: category } : {}),
      ...(openNow ? { openNow: true } : {}),
      ...(origin ? { latitude: origin.latitude, longitude: origin.longitude } : {}),
      // Sorting by distance is meaningless without a location to sort from.
      sort: sort === 'NEAREST' && !origin ? ('RECOMMENDED' as const) : sort,
      limit: 20,
    }),
    [search, category, openNow, origin, sort],
  );

  const query = useDiscoverCafes(params);
  const cafes = query.data?.pages.flatMap((page) => page.items) ?? [];

  const sortOptions: Array<{ value: SortOption; label: string }> = [
    { value: 'RECOMMENDED', label: 'Best' },
    ...(origin ? [{ value: 'NEAREST' as const, label: 'Nearest' }] : []),
    { value: 'FASTEST', label: 'Fastest' },
    { value: 'RATING', label: 'Top rated' },
  ];
  const currentSortLabel = sortOptions.find((option) => option.value === sort)?.label ?? 'Best';

  // The same choices as before, offered from the "Sort by" pill: a native
  // action sheet on iOS, an alert list on Android.
  const chooseSort = (): void => {
    const labels = sortOptions.map((option) =>
      option.value === sort ? `${option.label} ✓` : option.label,
    );
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Sort cafes by', options: [...labels, 'Cancel'], cancelButtonIndex: labels.length },
        (index) => {
          const picked = sortOptions[index];
          if (picked) setSort(picked.value);
        },
      );
      return;
    }
    Alert.alert('Sort cafes by', undefined, [
      ...sortOptions.map((option) => ({ text: option.label, onPress: () => setSort(option.value) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // The same category theming as Home: Breakfast's full look, otherwise the
  // category's wash, wallpaper and colours.
  const coloursFor = useCategoryColors();
  const breakfastSkin = useBreakfastSkin();
  const skin = category === 'breakfast' ? breakfastSkin : null;
  const tint = category && !skin ? coloursFor(category) : null;
  const page = skin?.page ?? tint?.wash ?? theme.colors.background;
  const pageColour = useBlendedColor(page);
  const categoryEnter = useEnterOnChange(category);
  const pillColours = skin
    ? { fill: skin.mapButton, ink: skin.text, selected: skin.accent }
    : tint
      ? { fill: tint.soft, ink: tint.ink, selected: tint.solid }
      : undefined;

  return (
    // The page colour blends into the new category's wash rather than snapping.
    <Animated.View style={{ flex: 1, backgroundColor: pageColour }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />

      {/* Wallpaper behind everything; stays put while the list scrolls. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: categoryEnter }]}>
        {skin ? (
          <SunPattern />
        ) : tint && category ? (
          <CategoryPattern slug={category} colour={tint.ink} />
        ) : null}
      </Animated.View>

      <View style={{ paddingTop: insets.top + theme.spacing.sm }}>
        <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.base, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              variant="title1"
              color="heading"
              style={[
                { fontSize: 27, lineHeight: 33 },
                skin ? { color: skin.text } : tint ? { color: tint.ink } : null,
              ]}
            >
              Discover
            </Text>
            <MapButton
              onPress={() => router.push('/map')}
              background={skin?.mapButton ?? tint?.soft}
              iconColour={skin?.accent ?? tint?.ink}
            />
          </View>
          <View style={{ marginTop: -12 }}>
            <LocationRow
              label={locationLabel}
              onPress={() => router.push('/location')}
              pinColour={skin?.accent ?? tint?.ink}
              textColour={skin?.text}
            />
          </View>
          <SearchInput
            value={search}
            onChange={setSearch}
            fill={skin?.field ?? tint?.soft}
            inkColour={skin?.muted}
          />
        </View>

        <CategoryTabs
          selected={category}
          onChange={setCategory}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.base,
            paddingTop: 12,
            paddingBottom: theme.spacing.xs,
          }}
        >
          <FilterPill
            label="Open now"
            icon="clock"
            selected={openNow}
            onPress={() => setOpenNow((value) => !value)}
            colours={pillColours}
          />
          <FilterPill
            label={sort === 'RECOMMENDED' ? 'Sort by' : `Sort: ${currentSortLabel}`}
            icon="arrowUpDown"
            trailing="chevronDown"
            muted
            onPress={chooseSort}
            colours={pillColours}
          />
        </View>
      </View>

      {/* Results fade and rise in after a category switch. */}
      <Animated.View style={[{ flex: 1 }, enterStyle(categoryEnter)]}>
      {query.isLoading ? (
        <View style={{ padding: theme.spacing.base }}>
          <ListSkeleton rows={5} />
        </View>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : cafes.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={search ? 'Nothing matched that search' : 'No cafes found nearby'}
          body={
            search
              ? 'Check the spelling or try a different term.'
              : 'Try widening your search or picking another area.'
          }
          {...(category || openNow || search
            ? {
                actionLabel: 'Clear filters',
                onAction: () => {
                  setSearch('');
                  setCategory(null);
                  setOpenNow(false);
                },
              }
            : {})}
        />
      ) : (
        <FlatList
          data={cafes}
          keyExtractor={(cafe) => cafe.id}
          contentContainerStyle={{
            padding: theme.spacing.base,
            paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 70 : 24),
            gap: 12,
          }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={{ paddingVertical: theme.spacing.base }}>
                <ListSkeleton rows={1} />
              </View>
            ) : null
          }
          renderItem={({ item }: { item: BusinessSummary }) => (
            <CafeCard
              cafe={item}
              onPress={() => router.push(`/cafe/${item.id}`)}
              pour={category}
              tint={tint}
              skin={skin}
              isFavourite={favouriteIds.has(item.id)}
              onToggleFavourite={() =>
                toggleFavourite.mutate({
                  businessId: item.id,
                  isFavourite: favouriteIds.has(item.id),
                })
              }
            />
          )}
        />
      )}
      </Animated.View>
    </Animated.View>
  );
}

/** A rounded filter control from the redesign: "Open now", "Sort by". */
function FilterPill({
  label,
  icon,
  trailing,
  selected = false,
  muted = false,
  onPress,
  colours,
}: {
  label: string;
  icon: FigmaAssetName;
  trailing?: FigmaAssetName;
  selected?: boolean;
  /** The neutral field fill (Sort) rather than the pink tint (Open now). */
  muted?: boolean;
  onPress: () => void;
  /** A selected category's colours, matching the themed page. */
  colours?: { fill: string; ink: string; selected: string };
}): React.JSX.Element {
  const theme = useTheme();
  // White on the filled maroon in both modes; the accent ink otherwise.
  const foreground = selected ? '#FFFFFF' : (colours?.ink ?? theme.colors.onAccentSoft);

  return (
    <Pressable
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={muted ? undefined : { selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 100,
        backgroundColor: selected
          ? (colours?.selected ?? theme.colors.accent)
          : (colours?.fill ?? (muted ? theme.colors.field : theme.colors.accentSoft)),
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <FigmaIcon name={icon} size={16} tint={foreground} />
      <Text variant="footnote" style={{ color: foreground, fontWeight: '500' }} maxScale={1.4}>
        {label}
      </Text>
      {trailing ? <FigmaIcon name={trailing} size={13} tint={foreground} /> : null}
    </Pressable>
  );
}

export default withTabTransition(DiscoverScreen);
