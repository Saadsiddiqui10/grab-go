import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { formatClock } from '../../src/lib/format';
import { useOrder } from '../../src/api/hooks';
import { ScrollScreen, StickyFooter } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Surface';
import { PickupCodeCard } from '../../src/components/OrderComponents';
import { LoadingState, ErrorState } from '../../src/components/ui/States';
import { useReducedMotion } from '../../src/lib/motion';
import { usePushPermission } from '../../src/lib/notifications';

/**
 * Order confirmation.
 *
 * The payoff screen. It answers the two questions someone has the moment they
 * pay — when can I collect it, and what do I show at the counter — and nothing
 * else. The pickup code is the largest thing on screen.
 */
export default function OrderConfirmedScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const order = useOrder(id);

  const entrance = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // With Reduce Motion on, the confirmation simply appears.
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    // A single, brief entrance. The product promise is speed; a long celebration
    // animation would contradict it.
    Animated.spring(entrance, {
      toValue: 1,
      useNativeDriver: true,
      speed: 12,
      bounciness: 6,
    }).start();
  }, [entrance, reduceMotion]);

  if (order.isLoading) return <LoadingState label="Confirming your order…" />;
  if (order.isError || !order.data) {
    return <ErrorState onRetry={() => void order.refetch()} />;
  }

  const data = order.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollScreen contentContainerStyle={{ paddingTop: theme.spacing.huge }}>
        <Animated.View
          style={{
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: entrance,
            transform: [
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
            ],
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: theme.radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.successMuted,
            }}
          >
            <Ionicons name="checkmark" size={38} color={theme.colors.success} />
          </View>

          <View style={{ gap: 4, alignItems: 'center' }}>
            <Text variant="title1" align="center">
              Order confirmed
            </Text>
            <Text variant="title3" color="textMuted">
              {data.orderNumber}
            </Text>
          </View>
        </Animated.View>

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.base }}>
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <Row label="Cafe" value={data.businessName} />
              <Row
                label="Pickup"
                value={formatClock(new Date(data.pickupAt))}
                emphasis
              />
              {data.estimatedReadyAt ? (
                <Row
                  label="Estimated ready"
                  value={formatClock(new Date(data.estimatedReadyAt))}
                />
              ) : null}
              <Row label="Items" value={`${data.itemCount}`} />
            </View>
          </Card>

          {data.pickupCode ? (
            <PickupCodeCard
              code={data.pickupCode}
              qrToken={data.pickupQrToken}
              orderNumber={data.orderNumber}
              status={data.status}
            />
          ) : null}

          <ReadyNotificationCard />
        </View>
      </ScrollScreen>

      <StickyFooter>
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="View order"
            size="lg"
            fullWidth
            onPress={() => router.replace(`/order/${data.id}`)}
          />
          <Button
            label="Back to home"
            variant="ghost"
            fullWidth
            onPress={() => router.replace('/(tabs)')}
          />
        </View>
      </StickyFooter>
    </View>
  );
}

/**
 * The moment to ask for notifications: an order exists, so "tell me when it's
 * ready" is an obvious trade. The system prompt only appears after the
 * customer taps the button, and the card never promises a notification the
 * app is not allowed to send.
 */
function ReadyNotificationCard(): React.JSX.Element | null {
  const theme = useTheme();
  const { status, request } = usePushPermission();
  const [asking, setAsking] = useState(false);

  if (status === null || status === 'unavailable') return null;

  const body =
    status === 'granted'
      ? "We'll notify you the moment it's ready. Skip the line and grab your order when it is."
      : status === 'denied'
        ? 'Notifications are off, so watch the order screen, which updates live. You can turn them on in Settings.'
        : "Get a notification the moment it's ready, so you can walk in and collect it.";

  return (
    <Card style={{ backgroundColor: theme.colors.primarySubtle }}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
          <Ionicons
            name={status === 'denied' ? 'notifications-off-outline' : 'notifications-outline'}
            size={20}
            color={theme.colors.primary}
          />
          <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
            {body}
          </Text>
        </View>
        {status === 'undetermined' ? (
          <Button
            label="Notify me when it's ready"
            variant="secondary"
            size="sm"
            loading={asking}
            onPress={() => {
              setAsking(true);
              void request().finally(() => setAsking(false));
            }}
          />
        ) : status === 'denied' ? (
          <Button
            label="Open Settings"
            variant="ghost"
            size="sm"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
      </View>
    </Card>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text variant="footnote" color="textMuted">
        {label}
      </Text>
      <Text variant={emphasis ? 'title3' : 'subhead'} style={{ flexShrink: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
