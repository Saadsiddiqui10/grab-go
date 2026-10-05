import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CafeImage } from '../../src/components/CafeCard';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { formatDistance } from '@grabgo/core';
import { useTheme } from '../../src/theme';
import { formatPrepTime } from '../../src/lib/format';
import { useCafe, useCartQuote, useFavourites, useMenu, useToggleFavourite } from '../../src/api/hooks';
import { useCartStore, useCartCount } from '../../src/stores/cart';
import { Text } from '../../src/components/ui/Text';
import { Badge, Card, Divider } from '../../src/components/ui/Surface';
import { IconButton } from '../../src/components/ui/Button';
import { CartBar, MenuItemRow } from '../../src/components/MenuComponents';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { useReducedMotion } from '../../src/lib/motion';

/**
 * Cafe profile and menu.
 *
 * A collapsing cover image, the four facts that matter (open, distance, prep
 * time, rating), then the menu. A sticky category strip keeps navigation to one
 * tap on a long menu, and the cart bar floats above everything once there is
 * something in it.
 */

const HEADER_HEIGHT = 240;

export default function CafeScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const scrollY = useRef(new Animated.Value(0)).current;
  const listRef = useRef<ScrollView>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryOffsets = useRef(new Map<string, number>()).current;

  const cafe = useCafe(id);
  const menu = useMenu(id);
  const favourites = useFavourites();
  const toggleFavourite = useToggleFavourite();

  const cartCount = useCartCount();
  const cartBusinessId = useCartStore((state) => state.businessId);
  const quote = useCartQuote();

  const isFavourite = useMemo(
    () => new Set(favourites.data ?? []).has(id ?? ''),
    [favourites.data, id],
  );

  // The cover fades and the title bar solidifies as the customer scrolls, so the
  // back button stays legible over both a photo and a plain background.
  const headerOpacity = scrollY.interpolate({
    inputRange: [HEADER_HEIGHT - 120, HEADER_HEIGHT - 60],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Pull-down stretches the cover; with Reduce Motion on it stays put.
  const reduceMotion = useReducedMotion();
  const coverScale = reduceMotion
    ? 1
    : scrollY.interpolate({
        inputRange: [-200, 0],
        outputRange: [1.5, 1],
        extrapolateRight: 'clamp',
      });

  if (cafe.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <ErrorState onRetry={() => void cafe.refetch()} />
      </View>
    );
  }

  const categories = menu.data?.categories ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      {/* --------------------------------------------------- floating header */}
      <Animated.View
        style={[
          styles.floatingHeader,
          {
            paddingTop: insets.top,
            height: insets.top + 52,
            backgroundColor: theme.colors.background,
            opacity: headerOpacity,
            borderBottomColor: theme.colors.border,
          },
        ]}
        pointerEvents="none"
      >
        <Text variant="bodyStrong" numberOfLines={1} style={{ textAlign: 'center' }}>
          {cafe.data?.name ?? ''}
        </Text>
      </Animated.View>

      <View style={[styles.headerControls, { top: insets.top + 4 }]}>
        <IconButton
          icon="chevron-back"
          label="Go back"
          onPress={() => router.back()}
          background="rgba(0,0,0,0.4)"
          tone="textOnPrimary"
        />
        {cafe.data ? (
          <IconButton
            icon={isFavourite ? 'heart' : 'heart-outline'}
            label={isFavourite ? 'Remove from favourites' : 'Save to favourites'}
            onPress={() =>
              toggleFavourite.mutate({ businessId: cafe.data.id, isFavourite })
            }
            background="rgba(0,0,0,0.4)"
            tone={isFavourite ? 'danger' : 'textOnPrimary'}
          />
        ) : null}
      </View>

      <Animated.ScrollView
        ref={listRef as never}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (event) => {
            // Track which category is under the sticky strip.
            const offset = (event.nativeEvent as { contentOffset: { y: number } }).contentOffset.y;
            let current: string | null = null;
            for (const [categoryId, top] of categoryOffsets) {
              if (offset + 200 >= top) current = categoryId;
            }
            if (current !== activeCategory) setActiveCategory(current);
          },
        })}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        {/* ------------------------------------------------------- cover */}
        <Animated.View style={{ transform: [{ scale: coverScale }] }}>
          <CafeImage
            uri={cafe.data?.coverImageUrl}
            iconSize={44}
            style={{ width: '100%', height: HEADER_HEIGHT }}
          />
          <View style={styles.coverScrim} />
        </Animated.View>

        {/* -------------------------------------------------------- facts */}
        <View
          style={{
            paddingHorizontal: theme.spacing.base,
            paddingTop: theme.spacing.base,
            gap: theme.spacing.sm,
          }}
        >
          {cafe.isLoading || !cafe.data ? (
            <ListSkeleton rows={1} />
          ) : (
            <>
              <Text variant="title1">{cafe.data.name}</Text>

              <View style={styles.factRow}>
                {cafe.data.rating !== null ? (
                  <View style={styles.fact}>
                    <Ionicons name="star" size={14} color={theme.colors.warning} />
                    <Text variant="footnote" color="textSecondary">
                      {cafe.data.rating.toFixed(1)} ({cafe.data.reviewCount})
                    </Text>
                  </View>
                ) : null}

                {cafe.data.areaName ? (
                  <View style={styles.fact}>
                    <Ionicons name="location-outline" size={14} color={theme.colors.textMuted} />
                    <Text variant="footnote" color="textSecondary">
                      {cafe.data.areaName}
                      {cafe.data.distanceMeters !== null
                        ? ` · ${formatDistance(cafe.data.distanceMeters)}`
                        : ''}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.factRow}>
                <Badge
                  label={cafe.data.isOpenNow ? 'Open' : 'Closed'}
                  tone={cafe.data.isOpenNow ? 'success' : 'neutral'}
                  dot
                />
                {cafe.data.isOpenNow ? (
                  <Badge
                    label={`Orders ready in ${formatPrepTime(cafe.data.prepTimeMinutes)}`}
                    tone={cafe.data.busyUntilMinutes ? 'warning' : 'neutral'}
                  />
                ) : null}
              </View>

              {cafe.data.description ? (
                <Text variant="footnote" color="textMuted" style={{ marginTop: 2 }}>
                  {cafe.data.description}
                </Text>
              ) : null}

              {/* A closed cafe stays fully browsable; ordering is what waits. */}
              {!cafe.data.isOpenNow ? (
                <Card style={{ backgroundColor: theme.colors.surfaceMuted, marginTop: 4 }}>
                  <Text variant="subhead">This cafe is currently closed</Text>
                  <Text variant="footnote" color="textMuted" style={{ marginTop: 2 }}>
                    Browse the menu now and order when they open.
                  </Text>
                </Card>
              ) : !cafe.data.acceptingOrders ? (
                <Card style={{ backgroundColor: theme.colors.warningMuted, marginTop: 4 }}>
                  <Text variant="subhead">Not taking Grab & Go orders right now</Text>
                  <Text variant="footnote" color="textMuted" style={{ marginTop: 2 }}>
                    They have paused mobile orders. Try again shortly.
                  </Text>
                </Card>
              ) : null}
            </>
          )}
        </View>

        {/* --------------------------------------------- category shortcuts */}
        {categories.length > 1 ? (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={categories}
            keyExtractor={(category) => category.id}
            style={{ marginTop: theme.spacing.lg }}
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.base,
              gap: theme.spacing.sm,
            }}
            renderItem={({ item }) => {
              const selected = activeCategory === item.id;
              return (
                <Pressable
                  onPress={() => {
                    const offset = categoryOffsets.get(item.id);
                    if (offset !== undefined) {
                      (listRef.current as unknown as ScrollView | null)?.scrollTo({
                        y: offset - 100,
                        animated: true,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: 8,
                    borderRadius: theme.radii.pill,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
                  }}
                >
                  <Text
                    variant="subhead"
                    style={{
                      color: selected ? theme.colors.textOnPrimary : theme.colors.textSecondary,
                    }}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              );
            }}
          />
        ) : null}

        {/* --------------------------------------------------------- menu */}
        <View style={{ paddingHorizontal: theme.spacing.base, marginTop: theme.spacing.lg }}>
          {menu.isLoading ? (
            <ListSkeleton rows={5} />
          ) : menu.isError ? (
            <ErrorState onRetry={() => void menu.refetch()} compact />
          ) : categories.length === 0 ? (
            <EmptyState
              icon="restaurant-outline"
              title="No menu yet"
              body="This cafe has not published its menu."
            />
          ) : (
            categories.map((category) => (
              <View
                key={category.id}
                onLayout={(event) => {
                  categoryOffsets.set(category.id, event.nativeEvent.layout.y);
                }}
                style={{ marginBottom: theme.spacing.xl }}
              >
                <Text variant="title2" style={{ marginBottom: theme.spacing.sm }}>
                  {category.name}
                </Text>

                <Card padded={false}>
                  <View style={{ paddingHorizontal: theme.spacing.base }}>
                    {category.items.map((item, index) => (
                      <View key={item.id}>
                        {index > 0 ? <Divider /> : null}
                        <MenuItemRow
                          item={item}
                          onPress={() =>
                            router.push({
                              pathname: '/item/[itemId]',
                              params: { itemId: item.id, cafeId: id ?? '' },
                            })
                          }
                        />
                      </View>
                    ))}
                  </View>
                </Card>
              </View>
            ))
          )}
        </View>
      </Animated.ScrollView>

      {/* ------------------------------------------------------- cart bar */}
      {cartCount > 0 && cartBusinessId === id ? (
        <View
          style={{
            position: 'absolute',
            left: theme.spacing.base,
            right: theme.spacing.base,
            bottom: Math.max(insets.bottom, theme.spacing.base),
          }}
        >
          <CartBar
            itemCount={cartCount}
            total={quote.data?.totals.total ?? null}
            onPress={() => router.push('/cart')}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: 'flex-end',
    paddingBottom: 12,
    paddingHorizontal: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerControls: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  coverScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,16,14,0.25)',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
