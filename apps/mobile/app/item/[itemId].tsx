import { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useTheme } from '../../src/theme';
import { formatPKR } from '../../src/lib/format';
import { successFeedback } from '../../src/lib/feedback';
import { useCafe, useMenu } from '../../src/api/hooks';
import { useCartStore } from '../../src/stores/cart';
import { Text } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Stepper } from '../../src/components/ui/Surface';
import { StickyFooter } from '../../src/components/ui/Screen';
import { ModifierGroup, VariantGroup } from '../../src/components/MenuComponents';
import { ErrorState, LoadingState } from '../../src/components/ui/States';

/**
 * Item customisation.
 *
 * The running price updates with every choice, computed from the same deltas
 * the server will use. It is a preview, not the authority — the cart is priced
 * server-side — but it must agree with the total that follows, or the customer
 * loses trust in both.
 */
export default function ItemScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { itemId, cafeId } = useLocalSearchParams<{ itemId: string; cafeId: string }>();

  const cafe = useCafe(cafeId);
  const menu = useMenu(cafeId);
  const addLine = useCartStore((state) => state.addLine);
  const cartBusinessId = useCartStore((state) => state.businessId);

  const item = useMemo(
    () => menu.data?.categories.flatMap((category) => category.items).find((entry) => entry.id === itemId),
    [menu.data, itemId],
  );

  const [variantId, setVariantId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [initialised, setInitialised] = useState(false);

  // Preselect the cafe's defaults so the cheapest valid configuration is one tap
  // away, matching what the menu row showed as the price.
  if (item && !initialised) {
    setVariantId(item.variants.find((variant) => variant.isDefault)?.id ?? item.variants[0]?.id ?? null);
    setSelectedOptions(
      item.modifiers.flatMap((modifier) =>
        modifier.options.filter((option) => option.isDefault).map((option) => option.id),
      ),
    );
    setInitialised(true);
  }

  if (menu.isLoading) return <LoadingState label="Loading item…" />;
  if (menu.isError) return <ErrorState onRetry={() => void menu.refetch()} />;
  if (!item) {
    return (
      <ErrorState
        title="Item unavailable"
        body="Sorry, this item is no longer available."
        onRetry={() => router.back()}
      />
    );
  }

  const variant = item.variants.find((candidate) => candidate.id === variantId) ?? null;

  const optionDeltas = item.modifiers
    .flatMap((modifier) => modifier.options)
    .filter((option) => selectedOptions.includes(option.id))
    .reduce((total, option) => total + option.priceDelta, 0);

  const unitPrice = item.basePrice + (variant?.priceDelta ?? 0) + optionDeltas;
  const lineTotal = unitPrice * quantity;

  /** Which required groups are still unanswered. */
  const missingRequired = item.modifiers.filter((modifier) => {
    if (!modifier.isRequired) return false;
    const chosen = modifier.options.filter((option) => selectedOptions.includes(option.id)).length;
    return chosen < Math.max(1, modifier.minSelections);
  });

  const canAdd = missingRequired.length === 0 && (item.variants.length === 0 || variant !== null);

  const toggleOption = (modifierId: string, optionId: string): void => {
    const modifier = item.modifiers.find((entry) => entry.id === modifierId);
    if (!modifier) return;

    setSelectedOptions((current) => {
      const optionIds = modifier.options.map((option) => option.id);

      if (modifier.selectionType === 'SINGLE') {
        // Radio behaviour: replace whatever was chosen in this group.
        return [...current.filter((id) => !optionIds.includes(id)), optionId];
      }

      if (current.includes(optionId)) {
        return current.filter((id) => id !== optionId);
      }

      const chosenInGroup = current.filter((id) => optionIds.includes(id)).length;
      if (modifier.maxSelections !== null && chosenInGroup >= modifier.maxSelections) {
        return current;
      }

      return [...current, optionId];
    });
  };

  const commit = (): void => {
    if (!cafe.data) return;

    const { replacedCart } = addLine(cafe.data.id, cafe.data.name, item, {
      variantId,
      modifierOptionIds: selectedOptions,
      quantity,
      notes: notes.trim() || null,
    });

    successFeedback();

    if (replacedCart) {
      Alert.alert(
        'Cart updated',
        `Your cart now has items from ${cafe.data.name}. An order is collected from one cafe.`,
      );
    }

    router.back();
  };

  const add = (): void => {
    // Switching cafes empties the basket, so it is confirmed rather than done.
    if (cartBusinessId && cartBusinessId !== cafe.data?.id) {
      Alert.alert(
        'Start a new cart?',
        'Your cart has items from another cafe. Adding this will replace them, because an order is collected from one counter.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace cart', style: 'destructive', onPress: commit },
        ],
      );
      return;
    }

    commit();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
      >
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            contentFit="cover"
            transition={200}
            style={{ width: '100%', height: 220, backgroundColor: theme.colors.surfaceMuted }}
            accessible={false}
          />
        ) : null}

        <View style={{ padding: theme.spacing.base, gap: theme.spacing.xl }}>
          <View style={{ gap: 6 }}>
            <Text variant="title1">{item.name}</Text>
            {item.description ? (
              <Text variant="body" color="textMuted">
                {item.description}
              </Text>
            ) : null}
            <Text variant="title3" color="primary">
              {formatPKR(item.basePrice)}
            </Text>
            {item.calories !== null ? (
              <Text variant="caption" color="textMuted">
                {item.calories} kcal
              </Text>
            ) : null}
          </View>

          <VariantGroup
            variants={item.variants}
            selectedId={variantId}
            onSelect={setVariantId}
          />

          {item.modifiers.map((modifier) => (
            <ModifierGroup
              key={modifier.id}
              modifier={modifier}
              selectedIds={selectedOptions.filter((id) =>
                modifier.options.some((option) => option.id === id),
              )}
              onToggle={(optionId) => toggleOption(modifier.id, optionId)}
            />
          ))}

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="title3">Anything else?</Text>
            <Input
              placeholder="e.g. extra hot, no sugar"
              value={notes}
              onChangeText={setNotes}
              maxLength={140}
              multiline
              hint="The cafe sees this with your order."
            />
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="title3">Quantity</Text>
            <Stepper value={quantity} onChange={setQuantity} />
          </View>
        </View>
      </ScrollView>

      <StickyFooter>
        {!canAdd ? (
          <Text variant="caption" color="danger" style={{ marginBottom: theme.spacing.sm }}>
            Choose {missingRequired.map((modifier) => modifier.name.toLowerCase()).join(' and ')}{' '}
            to continue.
          </Text>
        ) : null}

        <Button
          label="Add to cart"
          detail={formatPKR(lineTotal)}
          onPress={add}
          disabled={!canAdd || item.isSoldOut}
          fullWidth
          size="lg"
        />
      </StickyFooter>
    </View>
  );
}
