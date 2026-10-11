import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { ORDER_PROGRESS_STEPS, formatPickupCodeForDisplay, progressIndex } from '@grabgo/core';
import { ORDER_STATUS_LABELS, type OrderDetail, type OrderStatus } from '@grabgo/types';
import { useTheme } from '../theme';
import { formatClock, formatPKR, formatRelativeTime } from '../lib/format';
import { Text } from './ui/Text';
import { Card, Divider, StatusBadge } from './ui/Surface';

/**
 * Order tracking surfaces.
 *
 * The pickup code is the centrepiece: it is what the whole product builds
 * toward, so it is rendered at display size, high contrast, with a QR beside it
 * for cafes that scan rather than type.
 */

/* ---------------------------------------------------------------- collection */

/**
 * How the order is collected. For curbside it repeats the plate the cafe will
 * look for, so the customer can spot a typo before they park.
 */
export function CollectionCard({
  order,
}: {
  order: Pick<OrderDetail, 'pickupMethod' | 'vehiclePlate' | 'vehicleDetails' | 'status'>;
}): React.JSX.Element {
  const theme = useTheme();
  const curbside = order.pickupMethod === 'CURBSIDE';

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radii.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primarySubtle,
          }}
        >
          <Ionicons name={curbside ? 'car-outline' : 'walk-outline'} size={22} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{curbside ? 'Brought to your car' : 'Walk in and collect'}</Text>
          <Text variant="footnote" color="textMuted">
            {curbside
              ? order.status === 'READY'
                ? 'Park outside — the cafe is bringing it out.'
                : 'Park outside when it’s ready and the cafe will bring it out.'
              : 'Show your pickup code at the counter.'}
          </Text>
        </View>
        {curbside && order.vehiclePlate ? (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <View
              style={{
                borderWidth: 2,
                borderColor: theme.colors.textPrimary,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 2,
                backgroundColor: theme.colors.surface,
              }}
              accessibilityLabel={`Number plate ${order.vehiclePlate.split('').join(' ')}`}
            >
              <Text variant="subhead" style={{ letterSpacing: 1 }} maxScale={1.4}>
                {order.vehiclePlate}
              </Text>
            </View>
            {order.vehicleDetails ? (
              <Text variant="caption" color="textMuted" numberOfLines={1} style={{ maxWidth: 120 }}>
                {order.vehicleDetails}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/* --------------------------------------------------------------- pickup code */

export function PickupCodeCard({
  code,
  qrToken,
  orderNumber,
  status,
  curbside,
}: {
  code: string;
  qrToken: string | null;
  orderNumber: string;
  status: OrderStatus;
  /** Brought to the car: the code is shown to whoever brings it out. */
  curbside?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const isReady = status === 'READY';

  return (
    <Card
      elevation="md"
      style={{
        // Ready orders get the accent treatment: this is the moment the
        // customer walks up to the counter.
        backgroundColor: isReady ? theme.colors.primary : theme.colors.surface,
      }}
    >
      <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Text
          variant="overline"
          style={{ color: isReady ? theme.colors.textOnPrimary : theme.colors.textMuted }}
        >
          GRAB CODE
        </Text>

        <Text
          variant="code"
          accessibilityLabel={`Your pickup code is ${code.split('').join(' ')}`}
          style={{
            color: isReady ? theme.colors.textOnPrimary : theme.colors.textPrimary,
          }}
        >
          {formatPickupCodeForDisplay(code)}
        </Text>

        {qrToken ? (
          <View
            style={{
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: '#FFFFFF',
            }}
            accessible
            accessibilityLabel="QR code for pickup"
          >
            <QRCode value={qrToken} size={132} backgroundColor="#FFFFFF" color="#14100E" />
          </View>
        ) : null}

        <Text
          variant="footnote"
          align="center"
          style={{
            color: isReady ? theme.colors.textOnPrimary : theme.colors.textMuted,
            opacity: isReady ? 0.9 : 1,
          }}
        >
          {curbside ? 'Show this to the staff member who brings out' : 'Show this at the counter for'} order {orderNumber}
        </Text>
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ timeline */

export function OrderTimeline({ order }: { order: OrderDetail }): React.JSX.Element {
  const theme = useTheme();
  const current = progressIndex(order.status);

  // A cancelled order has no progress to show; the reason is what matters.
  if (current === -1) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
          <Ionicons name="close-circle" size={22} color={theme.colors.danger} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="bodyStrong">{ORDER_STATUS_LABELS[order.status]}</Text>
            {order.cancellationNote ? (
              <Text variant="footnote" color="textMuted">
                {order.cancellationNote}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>
    );
  }

  const timestamps = new Map(order.timeline.map((event) => [event.status, event.at]));

  return (
    <Card>
      <View style={{ gap: 0 }}>
        {ORDER_PROGRESS_STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const at = timestamps.get(step);

          const colour = done
            ? theme.colors.success
            : active
              ? theme.colors.primary
              : theme.colors.border;

          return (
            <View key={step} style={styles.step}>
              <View style={styles.rail}>
                <View
                  style={[
                    styles.node,
                    {
                      backgroundColor: done || active ? colour : theme.colors.surfaceMuted,
                      borderColor: colour,
                    },
                  ]}
                >
                  {done ? (
                    <Ionicons name="checkmark" size={12} color={theme.colors.textOnPrimary} />
                  ) : active ? (
                    <View style={styles.pulse} />
                  ) : null}
                </View>

                {index < ORDER_PROGRESS_STEPS.length - 1 ? (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: done ? theme.colors.success : theme.colors.border },
                    ]}
                  />
                ) : null}
              </View>

              <View style={{ flex: 1, paddingBottom: theme.spacing.base }}>
                <Text
                  variant={active ? 'bodyStrong' : 'body'}
                  color={done || active ? 'textPrimary' : 'textMuted'}
                >
                  {ORDER_STATUS_LABELS[step]}
                </Text>
                {at ? (
                  <Text variant="caption" color="textMuted">
                    {formatClock(new Date(at))}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/* --------------------------------------------------------------- order lines */

export function OrderItemsCard({ order }: { order: OrderDetail }): React.JSX.Element {
  const theme = useTheme();

  return (
    <Card>
      <View style={{ gap: theme.spacing.md }}>
        {order.items.map((item) => (
          <View key={item.id} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Text variant="subhead" color="textMuted" style={{ minWidth: 22 }}>
              {item.quantity}×
            </Text>

            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body">{item.name}</Text>
              {item.variantName || item.modifiers.length > 0 ? (
                <Text variant="caption" color="textMuted">
                  {[item.variantName, ...item.modifiers.map((m) => m.optionName)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
              {item.notes ? (
                <Text variant="caption" color="textMuted" style={{ fontStyle: 'italic' }}>
                  “{item.notes}”
                </Text>
              ) : null}
            </View>

            <Text variant="subhead">{formatPKR(item.lineTotal)}</Text>
          </View>
        ))}

        <Divider />

        <TotalsRows totals={order.totals} businessName={order.businessName} />
      </View>
    </Card>
  );
}

export function TotalsRows({
  totals,
  businessName,
}: {
  totals: OrderDetail['totals'];
  /** Points go on this cafe's card, so the earn line names it. */
  businessName?: string | null;
}): React.JSX.Element {
  const theme = useTheme();

  const row = (label: string, value: string, emphasis = false, tone?: 'success'): React.JSX.Element => (
    <View style={styles.totalRow} key={label}>
      <Text variant={emphasis ? 'bodyStrong' : 'footnote'} color={emphasis ? 'textPrimary' : 'textMuted'}>
        {label}
      </Text>
      <Text
        variant={emphasis ? 'bodyStrong' : 'subhead'}
        color={tone === 'success' ? 'success' : 'textPrimary'}
      >
        {value}
      </Text>
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      {row('Subtotal', formatPKR(totals.subtotal))}
      {totals.promoDiscount > 0
        ? row('Promo discount', `-${formatPKR(totals.promoDiscount)}`, false, 'success')
        : null}
      {totals.rewardDiscount > 0
        ? row('Reward', `-${formatPKR(totals.rewardDiscount)}`, false, 'success')
        : null}
      {totals.tax > 0 ? row('Tax', formatPKR(totals.tax)) : null}
      <View style={{ height: theme.spacing.xs }} />
      {row('Total', formatPKR(totals.total), true)}
      {totals.pointsEarnable > 0 ? (
        <Text variant="caption" color="success">
          Earns {totals.pointsEarnable} points{businessName ? ` on your ${businessName} card` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- active tray */

/** The persistent "your order is on" banner shown at the top of Home. */
export function ActiveOrderBanner({
  order,
  onPress,
}: {
  order: { id: string; orderNumber: string; status: OrderStatus; businessName: string; pickupAt: string };
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const isReady = order.status === 'READY';

  return (
    <Card
      onPress={onPress}
      elevation="md"
      style={{
        backgroundColor: isReady ? theme.colors.success : theme.colors.surface,
      }}
      accessibilityLabel={`Order ${order.orderNumber} from ${order.businessName}, ${ORDER_STATUS_LABELS[order.status]}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isReady ? 'rgba(255,255,255,0.22)' : theme.colors.primaryMuted,
          }}
        >
          <Ionicons
            name={isReady ? 'checkmark-circle' : 'cafe'}
            size={20}
            color={isReady ? '#FFFFFF' : theme.colors.primary}
          />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text
            variant="bodyStrong"
            style={isReady ? { color: '#FFFFFF' } : undefined}
            numberOfLines={1}
          >
            {isReady ? 'Ready for pickup' : ORDER_STATUS_LABELS[order.status]}
          </Text>
          <Text
            variant="footnote"
            style={isReady ? { color: 'rgba(255,255,255,0.9)' } : undefined}
            color={isReady ? undefined : 'textMuted'}
            numberOfLines={1}
          >
            {order.businessName} · {order.orderNumber} ·{' '}
            {formatRelativeTime(order.pickupAt)}
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color={isReady ? '#FFFFFF' : theme.colors.textMuted}
        />
      </View>
    </Card>
  );
}

/** A row in order history. */
export function OrderHistoryRow({
  order,
  onPress,
}: {
  order: {
    id: string;
    orderNumber: string;
    businessName: string;
    status: OrderStatus;
    total: number;
    createdAt: string;
    itemCount: number;
  };
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Card onPress={onPress} accessibilityLabel={`Order ${order.orderNumber} from ${order.businessName}`}>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={styles.totalRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {order.businessName}
          </Text>
          <StatusBadge status={order.status} />
        </View>

        <View style={styles.totalRow}>
          <Text variant="footnote" color="textMuted">
            {order.orderNumber} · {order.itemCount}{' '}
            {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
            {new Date(order.createdAt).toLocaleDateString('en-PK', {
              day: 'numeric',
              month: 'short',
            })}
          </Text>
          <Text variant="subhead">{formatPKR(order.total)}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  step: {
    flexDirection: 'row',
    gap: 12,
  },
  rail: {
    alignItems: 'center',
    width: 22,
  },
  node: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 18,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
