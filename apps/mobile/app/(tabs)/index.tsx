import { useCallback, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { discoveryCategories } from '@grabgo/config';
import type { BusinessSummary } from '@grabgo/types';
import { useTheme } from '../../src/theme';
import { greeting, firstName } from '../../src/lib/format';
import { useAuthStore } from '../../src/stores/auth';
import { useLocationStore } from '../../src/stores/location';
import {
  useActiveOrders,
  useCafeRail,
  useFavourites,
  useToggleFavourite,
} from '../../src/api/hooks';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text, SectionTitle } from '../../src/components/ui/Text';
import { SearchInput } from '../../src/components/ui/Input';
import { Chip } from '../../src/components/ui/Surface';
import { CafeCard } from '../../src/components/CafeCard';
import { ActiveOrderBanner } from '../../src/components/OrderComponents';
import { CafeCardSkeleton, EmptyState, ErrorState } from '../../src/components/ui/States';

/**
 * Home.
 *
 * Built around one job: get someone from opening the app to a cafe's menu in as
 * few taps as possible. An order already in progress sits at the very top, then
 * search, then rails ordered by how likely they are to be what the customer
 * wants right now.
 */
export default function HomeScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();

  const user = useAuthStore((state) => state.user);
  const origin = useLocationStore((state) => state.origin());
  const locationLabel = useLocationStore((state) => state.label());
  const permission = useLocationStore((state) => state.permission);
  const requestAndLocate = useLocationStore((state) => state.requestAndLocate);

  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  const locationParams = origin
    ? { latitude: origin.latitude, longitude: origin.longitude }
    : {};
  const tagParams = category ? { tags: category } : {};

  const activeOrders = useActiveOrders();
  const favourites = useFavourites();
  const toggleFavourite = useToggleFavourite();

  const nearby = useCafeRail('nearby', {
    ...locationParams,
    ...tagParams,
    sort: origin ? 'NEAREST' : 'RECOMMENDED',
  });

  const fastest = useCafeRail('fastest', {
    ...locationParams,
    ...tagParams,
    sort: 'FASTEST',
    openNow: true,
  });

  const popular = useCafeRail('popular', { ...locationParams, ...tagParams, sort: 'POPULAR' });

  const favouriteCafes = useCafeRail(
    'favourites',
    { ...locationParams, favouritesOnly: true },
    (favourites.data?.length ?? 0) > 0,
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await client.invalidateQueries();
    setRefreshing(false);
  }, [client]);

  const favouriteIds = new Set(favourites.data ?? []);

  const openCafe = (cafe: BusinessSummary): void => {
    router.push(`/cafe/${cafe.id}`);
  };

  const railProps = (cafe: BusinessSummary): React.ComponentProps<typeof CafeCard> => ({
    cafe,
    layout: 'rail',
    onPress: () => openCafe(cafe),
    isFavourite: favouriteIds.has(cafe.id),
    onToggleFavourite: () =>
      toggleFavourite.mutate({ businessId: cafe.id, isFavourite: favouriteIds.has(cafe.id) }),
  });

  return (
    <ScrollScreen
      padded={false}
      footerSpace={Platform.OS === 'ios' ? 50 : 0}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      {/* ------------------------------------------------------------ header */}
      <View style={{ paddingHorizontal: theme.spacing.base, paddingTop: theme.spacing.xxl }}>
        <Text variant="title1">
          {greeting()}
          {user ? `, ${firstName(user.fullName)}` : ''} 👋
        </Text>

        <Pressable
          onPress={() => router.push('/location')}
          accessibilityRole="button"
          accessibilityLabel={`Location: ${locationLabel}. Change area`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            paddingVertical: 6,
            alignSelf: 'flex-start',
          }}
        >
          <Ionicons name="location" size={15} color={theme.colors.primary} />
          <Text variant="subhead" color="textSecondary">
            {locationLabel}
          </Text>
          <Ionicons name="chevron-down" size={14} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      {/* ------------------------------------------------------------ search */}
      <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.md }}>
        <Pressable
          onPress={() => router.push('/(tabs)/discover')}
          accessibilityRole="search"
          accessibilityLabel="Search cafes, coffee, breakfast"
        >
          {/* Non-interactive: tapping opens the discover screen, where the
              keyboard and results belong. */}
          <View pointerEvents="none">
            <SearchInput value="" onChange={() => undefined} />
          </View>
        </Pressable>
      </View>

      {/* ------------------------------------------------------ active order */}
      {activeOrders.data && activeOrders.data.length > 0 ? (
        <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.base }}>
          {activeOrders.data.map((order) => (
            <View key={order.id} style={{ marginBottom: theme.spacing.sm }}>
              <ActiveOrderBanner order={order} onPress={() => router.push(`/order/${order.id}`)} />
            </View>
          ))}
        </View>
      ) : null}

      {/* -------------------------------------------------------- categories */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={discoveryCategories.filter((entry) => entry.isLive)}
        keyExtractor={(entry) => entry.slug}
        style={{ marginTop: theme.spacing.lg }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.base,
          gap: theme.spacing.sm,
        }}
        renderItem={({ item }) => (
          <Chip
            label={item.label}
            icon={item.emoji}
            selected={category === item.slug}
            onPress={() => setCategory(category === item.slug ? null : item.slug)}
          />
        )}
      />

      {/* ---------------------------------------------- location nudge (once) */}
      {permission !== 'granted' ? (
        <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.lg }}>
          <Pressable
            onPress={() => void requestAndLocate()}
            accessibilityRole="button"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.primarySubtle,
              borderWidth: 1,
              borderColor: theme.colors.primaryMuted,
            }}
          >
            <Ionicons name="navigate-circle" size={22} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="subhead">See cafes closest to you</Text>
              <Text variant="caption" color="textMuted">
                Optional — you can pick an area instead.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {/* -------------------------------------------------------------- rails */}
      <Rail
        title={origin ? 'Nearby' : 'Cafes in Karachi'}
        subtitle={origin ? 'Closest to you right now' : 'Popular across the city'}
        query={nearby}
        renderCard={railProps}
      />

      <Rail
        title="Fastest pickup"
        subtitle="Ready in minutes"
        query={fastest}
        renderCard={railProps}
      />

      {favourites.data && favourites.data.length > 0 ? (
        <Rail title="Your favourites" query={favouriteCafes} renderCard={railProps} />
      ) : null}

      <Rail title="Popular near you" query={popular} renderCard={railProps} />

      <View style={{ paddingHorizontal: theme.spacing.base, paddingTop: theme.spacing.lg }}>
        <Text variant="caption" color="textMuted" align="center">
          Order ahead. Skip the line.
        </Text>
      </View>
    </ScrollScreen>
  );
}

/**
 * One horizontal rail.
 *
 * Owns its own loading, error and empty states so a single failing rail does not
 * take the whole home screen down with it.
 */
function Rail({
  title,
  subtitle,
  query,
  renderCard,
}: {
  title: string;
  subtitle?: string;
  query: {
    data: BusinessSummary[] | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  };
  renderCard: (cafe: BusinessSummary) => React.ComponentProps<typeof CafeCard>;
}): React.JSX.Element | null {
  const theme = useTheme();

  if (query.isError) {
    return (
      <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.xl }}>
        <SectionTitle subtitle={subtitle ?? null}>{title}</SectionTitle>
        <ErrorState compact onRetry={query.refetch} />
      </View>
    );
  }

  if (!query.isLoading && (query.data?.length ?? 0) === 0) {
    // A rail with nothing in it is noise; only "Nearby" earns an empty state,
    // because its emptiness is information.
    if (title !== 'Nearby') return null;

    return (
      <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.xl }}>
        <SectionTitle subtitle={subtitle ?? null}>{title}</SectionTitle>
        <EmptyState
          compact
          icon="cafe-outline"
          title="No cafes found nearby"
          body="Try widening your search or picking another area."
        />
      </View>
    );
  }

  return (
    <View style={{ marginTop: theme.spacing.xl }}>
      <View style={{ paddingHorizontal: theme.spacing.base }}>
        <SectionTitle subtitle={subtitle ?? null}>{title}</SectionTitle>
      </View>

      {query.isLoading ? (
        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.base,
          }}
        >
          <CafeCardSkeleton />
          <CafeCardSkeleton />
        </View>
      ) : (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={query.data ?? []}
          keyExtractor={(cafe) => cafe.id}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.base,
            gap: theme.spacing.md,
          }}
          // Cards are a fixed width, so Metro can skip measuring them.
          snapToInterval={260 + theme.spacing.md}
          decelerationRate="fast"
          renderItem={({ item }) => <CafeCard {...renderCard(item)} />}
        />
      )}
    </View>
  );
}
