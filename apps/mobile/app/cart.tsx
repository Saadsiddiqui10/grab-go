import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme';
import { formatPKR } from '../src/lib/format';
import { useCartStore } from '../src/stores/cart';
import { useAuthStore } from '../src/stores/auth';
import { useCartQuote } from '../src/api/hooks';
import { Text } from '../src/components/ui/Text';
import { Card, Divider, Stepper } from '../src/components/ui/Surface';
import { Button, IconButton } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { StickyFooter } from '../src/components/ui/Screen';
import { TotalsRows } from '../src/components/OrderComponents';
import { PromoSummary } from '../src/components/LoyaltyComponents';
import { EmptyState, LoadingState } from '../src/components/ui/States';

/**
 * The cart.
 *
 * Every number on this screen comes from `/cart/quote` — the client never adds
 * anything up. That is what makes the total here and the amount charged the same
 * number by construction rather than by luck.
 */
export default function CartScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const lines = useCartStore((state) => state.lines);
  const businessName = useCartStore((state) => state.businessName);
  const businessId = useCartStore((state) => state.businessId);
  const promoCode = useCartStore((state) => state.promoCode);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const removeLine = useCartStore((state) => state.removeLine);
  const setPromoCode = useCartStore((state) => state.setPromoCode);
  const clear = useCartStore((state) => state.clear);

  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const quote = useCartQuote();

  const [promoInput, setPromoInput] = useState('');
  const [showPromo, setShowPromo] = useState(false);

  if (lines.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          body="Find a cafe nearby and order ahead — it will be waiting when you arrive."
          actionLabel="Find a cafe"
          onAction={() => router.replace('/(tabs)/discover')}
        />
      </View>
    );
  }

  const confirmClear = (): void => {
    Alert.alert('Empty your cart?', 'This removes everything in it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty cart',
        style: 'destructive',
        onPress: () => {
          clear();
          router.back();
        },
      },
    ]);
  };

  const applyPromo = (): void => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoCode(code);
    setShowPromo(false);
    setPromoInput('');
  };

  // A warning means the server dropped or adjusted something; it is surfaced
  // rather than silently changing the basket under the customer.
  const warnings = quote.data?.warnings ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.base, gap: theme.spacing.base }}
      >
        {businessName ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            <Ionicons name="cafe" size={16} color={theme.colors.primary} />
            <Text variant="subhead" color="textSecondary" style={{ flex: 1 }}>
              Collecting from {businessName}
            </Text>
            <IconButton icon="trash-outline" label="Empty cart" onPress={confirmClear} size={18} />
          </View>
        ) : null}

        {warnings.length > 0 ? (
          <Card style={{ backgroundColor: theme.colors.warningMuted }}>
            <View style={{ gap: 4 }}>
              {warnings.map((warning, index) => (
                <Text key={index} variant="footnote" color="warning">
                  {warning.message}
                </Text>
              ))}
            </View>
          </Card>
        ) : null}

        {/* -------------------------------------------------------- lines */}
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.spacing.base }}>
            {lines.map((line, index) => {
              const priced = quote.data?.lines.find(
                (candidate) => candidate.menuItemId === line.menuItemId,
              );

              return (
                <View key={line.key}>
                  {index > 0 ? <Divider /> : null}

                  <View style={{ paddingVertical: theme.spacing.base, gap: theme.spacing.sm }}>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text variant="bodyStrong">{line.name}</Text>

                        {line.variantName || line.optionNames.length > 0 ? (
                          <Text variant="caption" color="textMuted">
                            {[line.variantName, ...line.optionNames].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}

                        {line.notes ? (
                          <Text variant="caption" color="textMuted" style={{ fontStyle: 'italic' }}>
                            “{line.notes}”
                          </Text>
                        ) : null}
                      </View>

                      <Text variant="subhead">
                        {priced ? formatPKR(priced.lineTotal) : '—'}
                      </Text>
                    </View>

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Stepper
                        value={line.quantity}
                        onChange={(next) => setQuantity(line.key, next)}
                        min={1}
                      />
                      <IconButton
                        icon="close"
                        label={`Remove ${line.name}`}
                        onPress={() => removeLine(line.key)}
                        size={18}
                        tone="textMuted"
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        {/* -------------------------------------------------------- promo */}
        {quote.data?.appliedPromoCode ? (
          <View style={{ gap: theme.spacing.sm }}>
            <PromoSummary
              code={quote.data.appliedPromoCode}
              discount={quote.data.totals.promoDiscount}
            />
            <Button
              label="Remove promo code"
              variant="ghost"
              size="sm"
              onPress={() => setPromoCode(null)}
            />
          </View>
        ) : showPromo ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Input
              label="Promo code"
              placeholder="WELCOME50"
              autoCapitalize="characters"
              autoCorrect={false}
              value={promoInput}
              onChangeText={setPromoInput}
              onSubmitEditing={applyPromo}
              returnKeyType="done"
            />
            <Button label="Apply" size="sm" onPress={applyPromo} />
          </View>
        ) : (
          <Button
            label={promoCode ? `Promo: ${promoCode}` : 'Add a promo code'}
            variant="ghost"
            size="sm"
            icon="pricetag-outline"
            onPress={() => setShowPromo(true)}
          />
        )}

        {/* ------------------------------------------------------- totals */}
        <Card>
          {quote.isLoading ? (
            <LoadingState label="Pricing your order…" />
          ) : quote.isError ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="subhead" color="danger">
                We could not price your cart
              </Text>
              <Text variant="footnote" color="textMuted">
                Check your connection and try again.
              </Text>
              <Button
                label="Retry"
                size="sm"
                variant="secondary"
                onPress={() => void quote.refetch()}
              />
            </View>
          ) : quote.data ? (
            <TotalsRows totals={quote.data.totals} businessName={businessName} />
          ) : !isAuthenticated ? (
            <Text variant="footnote" color="textMuted">
              Sign in to see your total and check out.
            </Text>
          ) : null}
        </Card>
      </ScrollView>

      <StickyFooter>
        <Button
          label={isAuthenticated ? 'Choose pickup time' : 'Sign in to continue'}
          detail={quote.data ? formatPKR(quote.data.totals.total) : undefined}
          size="lg"
          fullWidth
          icon="arrow-forward"
          iconPosition="right"
          disabled={isAuthenticated && (quote.isLoading || quote.isError || !businessId)}
          onPress={() => {
            if (!isAuthenticated) {
              router.push('/(auth)/welcome');
              return;
            }
            router.push('/checkout');
          }}
        />
      </StickyFooter>
    </View>
  );
}
