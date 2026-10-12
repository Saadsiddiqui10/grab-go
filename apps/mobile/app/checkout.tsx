import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import type { PaymentMethod, PickupMethod, PickupSlot } from '@grabgo/types';
import { useTheme } from '../src/theme';
import { formatClock, formatPKR } from '../src/lib/format';
import { errorFeedback, selectionFeedback, successFeedback } from '../src/lib/feedback';
import { useCartStore } from '../src/stores/cart';
import { useCartQuote, useMyRewards, usePickupSlots } from '../src/api/hooks';
import { orders as ordersApi, payments as paymentsApi } from '../src/api/endpoints';
import { ApiError } from '../src/api/client';
import { Text, SectionTitle } from '../src/components/ui/Text';
import { Card, Divider } from '../src/components/ui/Surface';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { StickyFooter } from '../src/components/ui/Screen';
import { TotalsRows } from '../src/components/OrderComponents';
import { RedemptionPicker } from '../src/components/LoyaltyComponents';
import { ErrorState, LoadingState } from '../src/components/ui/States';

/**
 * Checkout.
 *
 * Four decisions, in the order they matter: when to collect, how (walk in, or
 * have it brought out to the car), how to pay, and whether to spend a reward.
 * Then one button.
 *
 * The idempotency key is generated once per checkout attempt and reused across
 * retries, so a customer who taps "Pay" on a bad connection gets one coffee and
 * one charge no matter how many times the request is replayed.
 */
export default function CheckoutScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const businessId = useCartStore((state) => state.businessId);
  const businessName = useCartStore((state) => state.businessName);
  const toInput = useCartStore((state) => state.toInput);
  const promoCode = useCartStore((state) => state.promoCode);
  const redemptionId = useCartStore((state) => state.redemptionId);
  const setRedemptionId = useCartStore((state) => state.setRedemptionId);
  const clearCart = useCartStore((state) => state.clear);

  const quote = useCartQuote();
  const slots = usePickupSlots(businessId ?? undefined);
  const myRewards = useMyRewards();

  const [selectedSlot, setSelectedSlot] = useState<PickupSlot | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CARD');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PickupMethod>('WALK_IN');
  const [plate, setPlate] = useState('');
  const [carDetails, setCarDetails] = useState('');
  const [plateError, setPlateError] = useState<string | undefined>();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per checkout session. Regenerated only after a successful order.
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());

  const availableSlots = useMemo(
    () => (slots.data ?? []).filter((slot) => slot.available),
    [slots.data],
  );

  const effectiveSlot = selectedSlot ?? availableSlots[0] ?? null;

  // A redeemed reward is only good at the cafe that issued it.
  const usableRedemptions = useMemo(
    () => (myRewards.data ?? []).filter((redemption) => redemption.businessId === businessId),
    [myRewards.data, businessId],
  );

  // Mirrors the server's rule (letters, digits, spaces and dashes; 2–16
  // characters) so the customer hears about a typo before paying.
  const normalisedPlate = plate.trim().toUpperCase().replace(/\s+/g, ' ');
  const plateValid = /^[A-Z0-9][A-Z0-9 -]*[A-Z0-9]$/.test(normalisedPlate) && normalisedPlate.length <= 16;

  const paymentOptions: Array<{
    method: PaymentMethod;
    label: string;
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
    available: boolean;
  }> = [
    { method: 'CARD', label: 'Card', detail: 'Debit or credit', icon: 'card-outline', available: true },
    {
      method: 'APPLE_PAY',
      label: 'Apple Pay',
      detail: 'Pay with Face ID',
      icon: 'logo-apple',
      // Only offered where the platform can actually service it.
      available: Platform.OS === 'ios',
    },
    {
      method: 'GOOGLE_PAY',
      label: 'Google Pay',
      detail: 'Pay with your Google account',
      icon: 'logo-google',
      available: Platform.OS === 'android',
    },
    {
      method: 'CASH_ON_PICKUP',
      label: 'Pay at the counter',
      detail: 'Cash when you collect',
      icon: 'cash-outline',
      available: true,
    },
  ];

  const placeOrder = async (): Promise<void> => {
    if (!businessId || !effectiveSlot) return;
    if (method === 'CURBSIDE' && !plateValid) {
      errorFeedback();
      setPlateError(
        normalisedPlate
          ? 'Use letters, numbers, spaces or dashes, like KHI-4521.'
          : 'Add your number plate so the cafe can find your car.',
      );
      return;
    }

    setPlacing(true);
    setError(null);

    try {
      const order = await ordersApi.create({
        businessId,
        lines: toInput(),
        pickup: effectiveSlot.isAsap
          ? { mode: 'ASAP' }
          : { mode: 'SCHEDULED', pickupAt: effectiveSlot.time },
        promoCode,
        redemptionId,
        customerNote: note.trim() || null,
        collection:
          method === 'CURBSIDE'
            ? { method, vehiclePlate: normalisedPlate, vehicleDetails: carDetails.trim() || null }
            : { method },
        paymentMethod,
        idempotencyKey,
      });

      // Cash orders owe at the counter; everything else settles now. The server
      // verifies with the provider — this only asks it to.
      if (paymentMethod !== 'CASH_ON_PICKUP') {
        const initiated = await paymentsApi.initiate({
          orderId: order.id,
          method: paymentMethod,
        });

        const confirmed = await paymentsApi.confirm(initiated.paymentId);

        if (confirmed.status !== 'PAID') {
          throw new ApiError(
            'PAYMENT_FAILED',
            "Payment couldn't be completed. Try another payment method.",
            402,
          );
        }
      }

      successFeedback();
      clearCart();
      setIdempotencyKey(Crypto.randomUUID());
      router.replace(`/order-confirmed/${order.id}`);
    } catch (caught) {
      errorFeedback();
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'Something went wrong. Check your connection and try again.',
      );
    } finally {
      setPlacing(false);
    }
  };

  if (!businessId) {
    return (
      <ErrorState
        title="Your cart is empty"
        body="Add something to your cart to check out."
        onRetry={() => router.replace('/(tabs)/discover')}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.base, gap: theme.spacing.xl }}
      >
        {/* --------------------------------------------------- pickup time */}
        <View style={{ gap: theme.spacing.md }}>
          <SectionTitle subtitle={businessName ? `Collect from ${businessName}` : null}>
            Pickup time
          </SectionTitle>

          {slots.isLoading ? (
            <LoadingState label="Checking available times…" />
          ) : availableSlots.length === 0 ? (
            <Card style={{ backgroundColor: theme.colors.warningMuted }}>
              <Text variant="subhead">No pickup times available</Text>
              <Text variant="footnote" color="textMuted" style={{ marginTop: 2 }}>
                This cafe is closed or fully booked right now. Try again later.
              </Text>
            </Card>
          ) : (
            <View style={styles_slotGrid}>
              {availableSlots.slice(0, 12).map((slot) => {
                const selected = effectiveSlot?.time === slot.time;

                return (
                  <Pressable
                    key={slot.time}
                    onPress={() => {
                      selectionFeedback();
                      setSelectedSlot(slot);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      slot.isAsap ? slot.label : `Pickup at ${formatClock(new Date(slot.time))}`
                    }
                    style={{
                      paddingHorizontal: theme.spacing.base,
                      paddingVertical: 10,
                      borderRadius: theme.radii.md,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected
                        ? theme.colors.primarySubtle
                        : theme.colors.surface,
                      minWidth: 96,
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      variant={selected ? 'subhead' : 'footnote'}
                      color={selected ? 'primary' : 'textSecondary'}
                    >
                      {slot.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* ---------------------------------------------------- collection */}
        <View style={{ gap: theme.spacing.md }}>
          <SectionTitle>How you'll collect</SectionTitle>

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {(
              [
                { value: 'WALK_IN', label: 'Walk in', detail: 'Collect at the counter', icon: 'walk-outline' },
                { value: 'CURBSIDE', label: 'Bring to my car', detail: 'Brought out to you', icon: 'car-outline' },
              ] as const
            ).map((option) => {
              const selected = method === option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    selectionFeedback();
                    setMethod(option.value);
                    setPlateError(undefined);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label}, ${option.detail}`}
                  style={{
                    flex: 1,
                    gap: 6,
                    padding: theme.spacing.md,
                    borderRadius: theme.radii.md,
                    borderWidth: 2,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surface,
                  }}
                >
                  <View style={{ height: 24, justifyContent: 'center' }}>
                    <Ionicons
                      name={option.icon}
                      size={22}
                      color={selected ? theme.colors.primary : theme.colors.textSecondary}
                    />
                  </View>
                  <Text variant="subhead" color={selected ? 'primary' : 'textPrimary'}>
                    {option.label}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {option.detail}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {method === 'CURBSIDE' ? (
            <View style={{ gap: theme.spacing.md }}>
              <Input
                label="Number plate"
                testID="vehicle-plate"
                placeholder="e.g. KHI-4521"
                value={plate}
                onChangeText={(text) => {
                  setPlate(text.toUpperCase());
                  setPlateError(undefined);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                icon="car-outline"
                error={plateError}
                hint="The cafe uses this to find your car."
              />
              <Input
                label="Car (optional)"
                placeholder="Colour and model, e.g. white Corolla"
                value={carDetails}
                onChangeText={setCarDetails}
                maxLength={60}
              />
              <Text variant="footnote" color="textMuted">
                Park near {businessName ?? 'the cafe'} when your order is ready and they&apos;ll bring it out.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ------------------------------------------------------- payment */}
        <View style={{ gap: theme.spacing.md }}>
          <SectionTitle>Payment</SectionTitle>

          <Card padded={false}>
            <View style={{ paddingHorizontal: theme.spacing.base }}>
              {paymentOptions
                .filter((option) => option.available)
                .map((option, index) => {
                  const selected = paymentMethod === option.method;

                  return (
                    <View key={option.method}>
                      {index > 0 ? <Divider /> : null}
                      <Pressable
                        onPress={() => {
                          selectionFeedback();
                          setPaymentMethod(option.method);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${option.label}, ${option.detail}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.md,
                          paddingVertical: 14,
                        }}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={selected ? theme.colors.primary : theme.colors.textMuted}
                        />
                        <Ionicons
                          name={option.icon}
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                        <View style={{ flex: 1 }}>
                          <Text variant="body">{option.label}</Text>
                          <Text variant="caption" color="textMuted">
                            {option.detail}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
            </View>
          </Card>
        </View>

        {/* -------------------------------------------------------- reward */}
        {usableRedemptions.length > 0 ? (
          <View style={{ gap: theme.spacing.md }}>
            <SectionTitle subtitle="Spend a reward on this order">Rewards</SectionTitle>
            <RedemptionPicker
              redemptions={usableRedemptions}
              selectedId={redemptionId}
              onSelect={setRedemptionId}
            />
          </View>
        ) : null}

        {/* ---------------------------------------------------------- note */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionTitle>Note for the cafe</SectionTitle>
          <Input
            placeholder="Anything they should know?"
            value={note}
            onChangeText={setNote}
            maxLength={140}
          />
        </View>

        {/* -------------------------------------------------------- totals */}
        <View style={{ gap: theme.spacing.md }}>
          <SectionTitle>Summary</SectionTitle>
          <Card>
            {quote.data ? (
              <TotalsRows totals={quote.data.totals} businessName={businessName} />
            ) : (
              <LoadingState label="Pricing…" />
            )}
          </Card>
        </View>

        {error ? (
          <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
            <Text variant="subhead" color="danger">
              {error}
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      <StickyFooter>
        <Button
          label={paymentMethod === 'CASH_ON_PICKUP' ? 'Place order' : 'Pay and place order'}
          detail={quote.data ? formatPKR(quote.data.totals.total) : undefined}
          size="lg"
          fullWidth
          loading={placing}
          disabled={!effectiveSlot || !quote.data || quote.isLoading}
          onPress={() => void placeOrder()}
        />
        <Text variant="caption" color="textMuted" align="center" style={{ marginTop: 8 }}>
          Skip the line and grab your order when it&apos;s ready.
        </Text>
      </StickyFooter>
    </View>
  );
}

const styles_slotGrid = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: 8,
};
