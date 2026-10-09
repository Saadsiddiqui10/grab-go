import { useState } from 'react';
import { FlatList, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { useCartStore, useCartCount } from '../../src/stores/cart';
import { useOrders } from '../../src/api/hooks';
import { Text } from '../../src/components/ui/Text';
import { SegmentedControl, Card, Badge } from '../../src/components/ui/Surface';
import { Button } from '../../src/components/ui/Button';
import { OrderHistoryRow } from '../../src/components/OrderComponents';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { withTabTransition } from '../../src/components/ui/TabTransition';

/**
 * Orders.
 *
 * Active orders first — the one being made right now is what someone opens this
 * tab to check — then history, with a cart shortcut pinned at the top when one
 * is waiting.
 */

type Filter = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

function OrdersScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const [filter, setFilter] = useState<Filter>('ACTIVE');

  const cartCount = useCartCount();
  const cartBusinessName = useCartStore((state) => state.businessName);

  const query = useOrders(filter);
  const orders = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (!isAuthenticated) {
    return (
      <SignInPrompt
        title="Sign in to see your orders"
        body="Your order history, pickup codes and Grab Points live in your account."
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />

      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.base,
          gap: theme.spacing.md,
        }}
      >
        <Text variant="title1" color="heading" style={{ fontSize: 27, lineHeight: 33 }}>
          Orders
        </Text>

        {cartCount > 0 ? (
          <Card onPress={() => router.push('/cart')} accessibilityLabel="Open your cart">
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">Finish your order</Text>
                <Text variant="footnote" color="textMuted" numberOfLines={1}>
                  {cartCount} {cartCount === 1 ? 'item' : 'items'}
                  {cartBusinessName ? ` from ${cartBusinessName}` : ''}
                </Text>
              </View>
              <Badge label="In cart" tone="primary" />
            </View>
          </Card>
        ) : null}

        <SegmentedControl
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'COMPLETED', label: 'Past' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      {query.isLoading ? (
        <View style={{ padding: theme.spacing.base }}>
          <ListSkeleton rows={4} />
        </View>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title={
            filter === 'ACTIVE'
              ? 'No orders in progress'
              : filter === 'CANCELLED'
                ? 'No cancelled orders'
                : 'No orders yet'
          }
          body={
            filter === 'ACTIVE'
              ? 'Your first coffee is a couple of taps away.'
              : 'Orders you collect will appear here.'
          }
          actionLabel="Find a cafe"
          onAction={() => router.push('/(tabs)/discover')}
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(order) => order.id}
          contentContainerStyle={{
            padding: theme.spacing.base,
            paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 70 : 24),
            gap: theme.spacing.md,
          }}
          showsVerticalScrollIndicator={false}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <OrderHistoryRow order={item} onPress={() => router.push(`/order/${item.id}`)} />
          )}
          ListFooterComponent={
            filter === 'COMPLETED' && orders.length > 0 ? (
              <View style={{ paddingTop: theme.spacing.base }}>
                <Button
                  label="Browse cafes"
                  variant="ghost"
                  onPress={() => router.push('/(tabs)/discover')}
                />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

export default withTabTransition(OrdersScreen);
