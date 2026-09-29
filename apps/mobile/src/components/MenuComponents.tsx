import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { MenuItem, MenuModifier, MenuVariant } from '@grabgo/types';
import { minTouchTarget, useTheme } from '../theme';
import { tapFeedback } from '../lib/feedback';
import { formatPKR } from '../lib/format';
import { Text } from './ui/Text';
import { Badge, Card, Divider } from './ui/Surface';

/**
 * Menu surfaces.
 *
 * A sold-out item is shown, not hidden: a customer looking for the mocha should
 * learn it is unavailable today rather than assume the cafe stopped making it.
 */

export function MenuItemRow({
  item,
  onPress,
}: {
  item: MenuItem;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const unavailable = item.isSoldOut || !item.isAvailable;

  return (
    <Pressable
      onPress={() => {
        if (unavailable) return;
        tapFeedback();
        onPress();
      }}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatPKR(item.basePrice)}${
        unavailable ? ', sold out' : ''
      }`}
      accessibilityState={{ disabled: unavailable }}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => [
        styles.itemRow,
        {
          minHeight: minTouchTarget + 24,
          opacity: unavailable ? 0.5 : pressed && Platform.OS === 'ios' ? 0.7 : 1,
          gap: theme.spacing.md,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.name}
          </Text>
          {item.isPopular && !unavailable ? <Badge label="Popular" tone="primary" /> : null}
        </View>

        {item.description ? (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="subhead">{formatPKR(item.basePrice)}</Text>
          {item.isSoldOut ? <Badge label="Sold out" tone="danger" /> : null}
        </View>
      </View>

      {item.imageUrl ? (
        <Image
          source={{ uri: item.imageUrl }}
          contentFit="cover"
          transition={150}
          style={{ width: 84, height: 84, borderRadius: theme.radii.md }}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}

/** A single choice inside a variant or modifier group. */
export function OptionRow({
  label,
  priceDelta,
  selected,
  disabled,
  multi,
  onPress,
}: {
  label: string;
  priceDelta: number;
  selected: boolean;
  disabled?: boolean;
  multi?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        tapFeedback();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={
        priceDelta > 0 ? `${label}, plus ${formatPKR(priceDelta)}` : label
      }
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => [
        styles.optionRow,
        {
          minHeight: minTouchTarget,
          opacity: disabled ? 0.4 : pressed && Platform.OS === 'ios' ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons
        name={
          multi
            ? selected
              ? 'checkbox'
              : 'square-outline'
            : selected
              ? 'radio-button-on'
              : 'radio-button-off'
        }
        size={20}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
      />

      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Text>

      {priceDelta !== 0 ? (
        <Text variant="subhead" color="textSecondary">
          {priceDelta > 0 ? `+ ${formatPKR(priceDelta)}` : `- ${formatPKR(-priceDelta)}`}
        </Text>
      ) : null}

      {disabled ? <Badge label="Unavailable" tone="neutral" /> : null}
    </Pressable>
  );
}

export function VariantGroup({
  variants,
  selectedId,
  onSelect,
}: {
  variants: MenuVariant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (variants.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.groupHeader}>
        <Text variant="title3">Size</Text>
        <Badge label="Required" tone="neutral" />
      </View>

      <Card padded={false}>
        {variants.map((variant, index) => (
          <View key={variant.id}>
            {index > 0 ? <Divider inset={theme.spacing.base} /> : null}
            <View style={{ paddingHorizontal: theme.spacing.base }}>
              <OptionRow
                label={variant.name}
                priceDelta={variant.priceDelta}
                selected={selectedId === variant.id}
                disabled={!variant.isAvailable}
                onPress={() => onSelect(variant.id)}
              />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export function ModifierGroup({
  modifier,
  selectedIds,
  onToggle,
}: {
  modifier: MenuModifier;
  selectedIds: string[];
  onToggle: (optionId: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const multi = modifier.selectionType === 'MULTIPLE';
  const atMax =
    multi && modifier.maxSelections !== null && selectedIds.length >= modifier.maxSelections;

  const rule = modifier.isRequired
    ? 'Required'
    : multi && modifier.maxSelections
      ? `Up to ${modifier.maxSelections}`
      : 'Optional';

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.groupHeader}>
        <Text variant="title3">{modifier.name}</Text>
        <Badge label={rule} tone={modifier.isRequired ? 'primary' : 'neutral'} />
      </View>

      <Card padded={false}>
        {modifier.options.map((option, index) => {
          const selected = selectedIds.includes(option.id);

          return (
            <View key={option.id}>
              {index > 0 ? <Divider inset={theme.spacing.base} /> : null}
              <View style={{ paddingHorizontal: theme.spacing.base }}>
                <OptionRow
                  label={option.name}
                  priceDelta={option.priceDelta}
                  selected={selected}
                  multi={multi}
                  // At the cap, unselected options grey out rather than
                  // silently rejecting the tap.
                  disabled={!option.isAvailable || (atMax && !selected)}
                  onPress={() => onToggle(option.id)}
                />
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

/** The floating "view cart" bar that follows the customer around a cafe. */
export function CartBar({
  itemCount,
  total,
  onPress,
}: {
  itemCount: number;
  total: number | null;
  onPress: () => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (itemCount === 0) return null;

  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`View cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}${
        total !== null ? `, ${formatPKR(total)}` : ''
      }`}
      android_ripple={{ color: 'rgba(0,0,0,0.12)' }}
      style={({ pressed }) => [
        styles.cartBar,
        {
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.lg,
          opacity: pressed && Platform.OS === 'ios' ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.cartCount}>
        <Text variant="subhead" style={{ color: theme.colors.primary }}>
          {itemCount}
        </Text>
      </View>

      <Text variant="bodyStrong" style={{ color: theme.colors.textOnPrimary, flex: 1 }}>
        View cart
      </Text>

      {total !== null ? (
        <Text variant="bodyStrong" style={{ color: theme.colors.textOnPrimary }}>
          {formatPKR(total)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  cartCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});
