import { useCallback, useState } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
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
import { CategoryTabs, useCategoryColors } from '../../src/components/CategoryTabs';
import { LocationRow, MapButton } from '../../src/components/HeaderControls';
import { CategoryPattern } from '../../src/design/CategoryPattern';
import { SunPattern, useBreakfastSkin } from '../../src/design/breakfast';
import { CafeCard } from '../../src/components/CafeCard';
import { ActiveOrderBanner } from '../../src/components/OrderComponents';
import { CafeCardSkeleton, EmptyState, ErrorState } from '../../src/components/ui/States';
import { withTabTransition } from '../../src/components/ui/TabTransition';
import { enterStyle, useBlendedColor, useEnterOnChange } from '../../src/lib/motion';

/**
 * Home.
 *
 * Built around one job: get someone from opening the app to a cafe's menu in as
 * few taps as possible. An order already in progress sits at the very top, then
 * search, then rails ordered by how likely they are to be what the customer
 * wants right now.
 */
function HomeScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((state) => state.user);
  const origin = useLocationStore((state) => state.origin());
  const locationLabel = useLocationStore((state) => state.label());
  const permission = useLocationStore((state) => state.permission);
  const requestAndLocate = useLocationStore((state) => state.requestAndLocate);

  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  const locationParams = origin ? { latitude: origin.latitude, longitude: origin.longitude } : {};
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

  const popular = useCafeRail('popular', {
    ...locationParams,
    ...tagParams,
    sort: 'POPULAR',
  });

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

  // The selected category's colours theme the page and its cards.
  const coloursFor = useCategoryColors();
  // Breakfast has its own full look (its Figma frame); other categories
  // tint the page in their colour.
  const breakfastSkin = useBreakfastSkin();
  const skin = category === 'breakfast' ? breakfastSkin : null;
  const tint = category && !skin ? coloursFor(category) : null;
  const pageColour = useBlendedColor(skin?.page ?? tint?.wash ?? theme.colors.background);
  const categoryEnter = useEnterOnChange(category);

  const railProps = (cafe: BusinessSummary): React.ComponentProps<typeof CafeCard> => ({
    tint,
    skin,
    pour: category,
    cafe,
    layout: 'rail',
    onPress: () => openCafe(cafe),
    isFavourite: favouriteIds.has(cafe.id),
    onToggleFavourite: () =>
      toggleFavourite.mutate({
        businessId: cafe.id,
        isFavourite: favouriteIds.has(cafe.id),
      }),
  });

  return (
    // The page colour blends into the new category's wash rather than snapping.
    <Animated.View style={{ flex: 1, backgroundColor: pageColour }}>
      <ScrollScreen
        padded={false}
        footerSpace={Platform.OS === 'ios' ? 50 : 0}
        backgroundColor="transparent"
        // A selected category washes the page in its colour, with its icon as a
        // faint wallpaper (the redesign's bakery frame), which fades in.
        underlay={
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: categoryEnter }]}
          >
            {skin ? (
              <SunPattern />
            ) : tint && category ? (
              <CategoryPattern slug={category} colour={tint.ink} />
            ) : null}
          </Animated.View>
        }
        // Tabs hide the header, so the screen owns the status-bar inset, as the
        // other tab screens do.
        contentContainerStyle={{ paddingTop: insets.top }}
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
        <View
          style={{
            paddingHorizontal: theme.spacing.base,
            paddingTop: theme.spacing.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <Text
              variant="title1"
              color="heading"
              style={[
                { flex: 1, fontSize: 27, lineHeight: 33 },
                skin ? { color: skin.text } : tint ? { color: tint.ink } : null,
              ]}
            >
              {greeting()}
              {user ? `, ${firstName(user.fullName)}` : ''}
            </Text>
            <MapButton
              onPress={() => router.push('/map')}
              background={skin?.mapButton ?? tint?.soft}
              iconColour={skin?.accent ?? tint?.ink}
            />
          </View>

          <LocationRow
            label={locationLabel}
            onPress={() => router.push('/location')}
            pinColour={skin?.accent ?? tint?.ink}
            textColour={skin?.text}
          />
        </View>

        {/* ------------------------------------------------------------ search */}
        <View
          style={{
            paddingHorizontal: theme.spacing.base,
            marginTop: theme.spacing.md,
          }}
        >
          <Pressable
            onPress={() => router.push('/(tabs)/discover')}
            accessibilityRole="search"
            accessibilityLabel="Search cafes, coffee, breakfast"
          >
            {/* Non-interactive: tapping opens the discover screen, where the
              keyboard and results belong. */}
            <View pointerEvents="none">
              <SearchInput
                value=""
                onChange={() => undefined}
                fill={skin?.field ?? tint?.soft}
                inkColour={skin?.muted}
              />
            </View>
          </Pressable>
        </View>

        {/* ------------------------------------------------------ active order */}
        {activeOrders.data && activeOrders.data.length > 0 ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.base,
              marginTop: theme.spacing.base,
            }}
          >
            {activeOrders.data.map((order) => (
              <View key={order.id} style={{ marginBottom: theme.spacing.sm }}>
                <ActiveOrderBanner
                  order={order}
                  onPress={() => router.push(`/order/${order.id}`)}
                />
              </View>
            ))}
          </View>
        ) : null}

        {/* -------------------------------------------------------- categories */}
        <CategoryTabs
          selected={category}
          onChange={setCategory}
          style={{ marginTop: theme.spacing.base }}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base }}
        />

        {/* ---------------------------------------------- location nudge (once) */}
        {permission !== 'granted' ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.base,
              marginTop: theme.spacing.lg,
            }}
          >
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
        {/* The cafes fade and rise in after a category switch. */}
        <Animated.View style={enterStyle(categoryEnter)}>
          <Rail
            title="Fastest pickup"
            subtitle="Ready in minutes"
            query={fastest}
            renderCard={railProps}
            tone={skin?.text ?? tint?.ink}
            subtone={skin?.muted}
          />

          <Rail
            title={origin ? 'Nearby' : 'Cafes in Karachi'}
            subtitle={origin ? 'Closest to you right now' : 'Popular across the city'}
            query={nearby}
            renderCard={railProps}
            tone={skin?.text ?? tint?.ink}
            subtone={skin?.muted}
          />

          {favourites.data && favourites.data.length > 0 ? (
            <Rail
              title="Your favourites"
              query={favouriteCafes}
              renderCard={railProps}
              tone={skin?.text ?? tint?.ink}
              subtone={skin?.muted}
            />
          ) : null}

          <Rail
            title="Popular near you"
            query={popular}
            renderCard={railProps}
            tone={skin?.text ?? tint?.ink}
            subtone={skin?.muted}
          />
        </Animated.View>

        <View
          style={{
            paddingHorizontal: theme.spacing.base,
            paddingTop: theme.spacing.lg,
          }}
        >
          <Text variant="caption" color="textMuted" align="center">
            Order ahead. Skip the line.
          </Text>
        </View>
      </ScrollScreen>
    </Animated.View>
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
  tone,
  subtone,
}: {
  title: string;
  subtitle?: string;
  tone?: string;
  subtone?: string;
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
      <View
        style={{
          paddingHorizontal: theme.spacing.base,
          marginTop: theme.spacing.xl,
        }}
      >
        <SectionTitle subtitle={subtitle ?? null} tone={tone} subtone={subtone}>
          {title}
        </SectionTitle>
        <ErrorState compact onRetry={query.refetch} />
      </View>
    );
  }

  if (!query.isLoading && (query.data?.length ?? 0) === 0) {
    // A rail with nothing in it is noise; only "Nearby" earns an empty state,
    // because its emptiness is information.
    if (title !== 'Nearby') return null;

    return (
      <View
        style={{
          paddingHorizontal: theme.spacing.base,
          marginTop: theme.spacing.xl,
        }}
      >
        <SectionTitle subtitle={subtitle ?? null} tone={tone} subtone={subtone}>
          {title}
        </SectionTitle>
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
    <View style={{ marginTop: theme.spacing.md }}>
      <View style={{ paddingHorizontal: theme.spacing.base }}>
        <SectionTitle subtitle={subtitle ?? null} tone={tone} subtone={subtone}>
          {title}
        </SectionTitle>
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
          snapToInterval={264 + theme.spacing.md}
          decelerationRate="fast"
          renderItem={({ item }) => <CafeCard {...renderCard(item)} />}
        />
      )}
    </View>
  );
}

export default withTabTransition(HomeScreen);
