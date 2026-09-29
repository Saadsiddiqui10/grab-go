import { useMemo, useState } from 'react';
import { FlatList, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { discoveryCategories } from '@grabgo/config';
import type { BusinessSummary } from '@grabgo/types';
import { useTheme } from '../../src/theme';
import { useLocationStore } from '../../src/stores/location';
import { useDiscoverCafes, useFavourites, useToggleFavourite } from '../../src/api/hooks';
import { Text } from '../../src/components/ui/Text';
import { SearchInput } from '../../src/components/ui/Input';
import { Chip, SegmentedControl } from '../../src/components/ui/Surface';
import { CafeCard } from '../../src/components/CafeCard';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { StatusBar } from 'expo-status-bar';

/**
 * Discover.
 *
 * Search plus the filters that actually change a decision: what kind of place,
 * whether it is open, and how to rank the results. Everything is optional and
 * the list is never empty of controls, so the screen is usable the moment it
 * opens rather than requiring a query first.
 */

type SortOption = 'RECOMMENDED' | 'NEAREST' | 'FASTEST' | 'RATING';

export default function DiscoverScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const origin = useLocationStore((state) => state.origin());

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />

      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.base,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.md,
          backgroundColor: theme.colors.background,
        }}
      >
        <Text variant="title2">Discover</Text>

        <SearchInput value={search} onChange={setSearch} />

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ slug: 'open', label: 'Open now', emoji: '🟢' }, ...discoveryCategories.filter((entry) => entry.isLive)]}
          keyExtractor={(entry) => entry.slug}
          contentContainerStyle={{ gap: theme.spacing.sm }}
          renderItem={({ item }) =>
            item.slug === 'open' ? (
              <Chip
                label={item.label}
                icon={item.emoji}
                selected={openNow}
                onPress={() => setOpenNow((value) => !value)}
              />
            ) : (
              <Chip
                label={item.label}
                icon={item.emoji}
                selected={category === item.slug}
                onPress={() => setCategory(category === item.slug ? null : item.slug)}
              />
            )
          }
        />

        <SegmentedControl options={sortOptions} value={sort} onChange={setSort} />
      </View>

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
            gap: theme.spacing.base,
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
    </View>
  );
}
