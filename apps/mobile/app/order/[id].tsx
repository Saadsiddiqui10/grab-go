import { useState } from 'react';
import { Alert, Linking, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ORDER_STATUS_LABELS } from '@grabgo/types';
import { useTheme } from '../../src/theme';
import { formatClock, formatRelativeTime } from '../../src/lib/format';
import { useCancelOrder, useOrder } from '../../src/api/hooks';
import { useOrderSubscription } from '../../src/api/realtime';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Card, StatusBadge } from '../../src/components/ui/Surface';
import { Button } from '../../src/components/ui/Button';
import {
  OrderItemsCard,
  OrderTimeline,
  CollectionCard,
  PickupCodeCard,
} from '../../src/components/OrderComponents';
import { ErrorState, LoadingState } from '../../src/components/ui/States';
import { ApiError } from '../../src/api/client';

/**
 * Order tracking.
 *
 * Live: the screen subscribes to the order's realtime room, so a barista tapping
 * "Ready" lights this up without the customer touching anything. Polling backs
 * it up if the socket drops.
 */
export default function OrderScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const order = useOrder(id);
  const cancel = useCancelOrder();
  const [cancelError, setCancelError] = useState<string | null>(null);

  useOrderSubscription(id);

  if (order.isLoading) return <LoadingState label="Loading your order…" />;
  if (order.isError || !order.data) {
    return <ErrorState onRetry={() => void order.refetch()} />;
  }

  const data = order.data;
  const isActive = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'].includes(data.status);

  const confirmCancel = (): void => {
    Alert.alert(
      'Cancel this order?',
      'The cafe will be told. If you have already paid, a refund is issued.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: () => {
            setCancelError(null);
            cancel.mutate(
              { orderId: data.id },
              {
                onError: (error) => {
                  setCancelError(
                    error instanceof ApiError
                      ? error.displayMessage
                      : 'That order could not be cancelled.',
                  );
                },
              },
            );
          },
        },
      ],
    );
  };

  const openDirections = (): void => {
    const query = `${data.businessLatitude},${data.businessLongitude}`;
    const url = Platform.select({
      ios: `maps://?daddr=${query}`,
      android: `geo:${query}?q=${query}(${encodeURIComponent(data.businessName)})`,
      default: `https://maps.google.com/?q=${query}`,
    });
    void Linking.openURL(url);
  };

  return (
    <ScrollScreen contentContainerStyle={{ paddingTop: theme.spacing.base, gap: theme.spacing.base }}>
      {/* --------------------------------------------------------- header */}
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="title3" style={{ flex: 1 }} numberOfLines={1}>
              {data.businessName}
            </Text>
            <StatusBadge status={data.status} />
          </View>

          <Text variant="footnote" color="textMuted">
            {data.orderNumber} · {data.businessAddress}
          </Text>

          {isActive ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginTop: 2,
              }}
            >
              <Ionicons name="time-outline" size={15} color={theme.colors.primary} />
              <Text variant="subhead" color="primary">
                {data.status === 'READY'
                  ? data.pickupMethod === 'CURBSIDE'
                    ? 'Ready now — being brought to your car'
                    : 'Ready now — collect at the counter'
                  : `Pickup ${formatRelativeTime(data.pickupAt)} (${formatClock(new Date(data.pickupAt))})`}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      {/* ----------------------------------------------------- pickup code */}
      {data.pickupCode && isActive ? (
        <PickupCodeCard
          code={data.pickupCode}
          curbside={data.pickupMethod === 'CURBSIDE'}
          qrToken={data.pickupQrToken}
          orderNumber={data.orderNumber}
          status={data.status}
        />
      ) : null}

      {isActive ? <CollectionCard order={data} /> : null}

      {/* -------------------------------------------------------- timeline */}
      <OrderTimeline order={data} />

      {/* ----------------------------------------------------------- items */}
      <OrderItemsCard order={data} />

      {/* ---------------------------------------------------------- points */}
      {data.pointsEarned && data.pointsEarned > 0 ? (
        <Card style={{ backgroundColor: theme.colors.successMuted }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Ionicons name="sparkles" size={20} color={theme.colors.success} />
            <Text variant="subhead" color="success" style={{ flex: 1 }}>
              You earned {data.pointsEarned} points on your {data.businessName} card
            </Text>
          </View>
        </Card>
      ) : null}

      {cancelError ? (
        <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
          <Text variant="footnote" color="danger">
            {cancelError}
          </Text>
        </Card>
      ) : null}

      {/* --------------------------------------------------------- actions */}
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        <Button
          label="Directions to the cafe"
          variant="secondary"
          icon="navigate-outline"
          onPress={openDirections}
          fullWidth
        />

        {data.businessPhone ? (
          <Button
            label="Call the cafe"
            variant="ghost"
            icon="call-outline"
            onPress={() => void Linking.openURL(`tel:${data.businessPhone}`)}
            fullWidth
          />
        ) : null}

        {data.canReview ? (
          <Button
            label="Leave a review"
            variant="ghost"
            icon="star-outline"
            onPress={() => router.push(`/review/${data.id}`)}
            fullWidth
          />
        ) : null}

        {data.canCancel ? (
          <Button
            label="Cancel order"
            variant="danger"
            loading={cancel.isPending}
            onPress={confirmCancel}
            fullWidth
          />
        ) : null}

        {!isActive ? (
          <Button
            label="Order again"
            icon="repeat"
            onPress={() => router.push(`/cafe/${data.businessId}`)}
            fullWidth
          />
        ) : null}
      </View>

      <Text variant="caption" color="textMuted" align="center" style={{ marginTop: theme.spacing.md }}>
        {ORDER_STATUS_LABELS[data.status]} · updated{' '}
        {formatRelativeTime(data.updatedAt)}
      </Text>
    </ScrollScreen>
  );
}
