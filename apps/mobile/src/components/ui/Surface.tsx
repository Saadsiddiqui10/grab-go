import { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { orderStatusColors } from '@grabgo/config';
import type { OrderStatus } from '@grabgo/types';
import { byPlatform, minTouchTarget, shadow, useTheme } from '../../theme';
import { selectionFeedback, tapFeedback } from '../../lib/feedback';
import { Text } from './Text';

/**
 * Containers and small controls.
 *
 * These are the pieces every screen is assembled from. Each one is theme-driven
 * and platform-aware, so a screen file contains layout and copy rather than
 * colour values and platform checks.
 */

/* ---------------------------------------------------------------------- card */

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  padded?: boolean;
  elevation?: 'none' | 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Card({
  children,
  onPress,
  padded = true,
  elevation = 'sm',
  style,
  accessibilityLabel,
}: CardProps): React.JSX.Element {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const surface: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.colors.border,
    padding: padded ? theme.spacing.base : 0,
    overflow: 'hidden',
    ...shadow(elevation),
  };

  if (!onPress) {
    return <View style={[surface, style]}>{children}</View>;
  }

  const animate = (toValue: number): void => {
    if (Platform.OS !== 'ios') return;
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 50, bounciness: 3 }).start();
  };

  return (
    <Animated.View style={[Platform.OS === 'ios' ? { transform: [{ scale }] } : null, style]}>
      <Pressable
        onPress={() => {
          tapFeedback();
          onPress();
        }}
        onPressIn={() => animate(0.985)}
        onPressOut={() => animate(1)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        android_ripple={{ color: theme.colors.surfaceMuted }}
        style={surface}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* --------------------------------------------------------------------- badge */

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  label,
  tone = 'neutral',
  icon,
  dot = false,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: keyof typeof Ionicons.glyphMap;
  dot?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  const tones: Record<BadgeTone, { fg: string; bg: string }> = {
    neutral: { fg: theme.colors.textSecondary, bg: theme.colors.surfaceMuted },
    primary: { fg: theme.colors.primary, bg: theme.colors.primaryMuted },
    success: { fg: theme.colors.success, bg: theme.colors.successMuted },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningMuted },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerMuted },
    info: { fg: theme.colors.info, bg: theme.colors.infoMuted },
  };

  const colours = tones[tone];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colours.bg, borderRadius: theme.radii.sm },
      ]}
    >
      {dot ? (
        <View style={[styles.dot, { backgroundColor: colours.fg }]} />
      ) : icon ? (
        <Ionicons name={icon} size={12} color={colours.fg} />
      ) : null}
      <Text variant="caption" style={{ color: colours.fg }} maxScale={1.3} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Order status rendered with the colour every surface agrees on. */
export function StatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  const colours = orderStatusColors[status];

  const label = {
    PENDING: 'Sent to cafe',
    ACCEPTED: 'Accepted',
    PREPARING: 'Preparing',
    READY: 'Ready',
    PICKED_UP: 'Collected',
    COMPLETED: 'Completed',
    CANCELLED_BY_CUSTOMER: 'Cancelled',
    CANCELLED_BY_CAFE: 'Cancelled by cafe',
    CANCELLED_BY_ADMIN: 'Cancelled',
    EXPIRED: 'Expired',
  }[status];

  const theme = useTheme();

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colours.bg, borderRadius: theme.radii.sm },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: colours.fg }]} />
      <Text variant="caption" style={{ color: colours.fg }} maxScale={1.3}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------- divider */

export function Divider({ inset = 0 }: { inset?: number }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginLeft: inset,
      }}
    />
  );
}

/* -------------------------------------------------------------- progress bar */

export function ProgressBar({
  progress,
  label,
  tone = 'primary',
}: {
  /** 0..1 */
  progress: number;
  label?: string;
  tone?: 'primary' | 'success';
}): React.JSX.Element {
  const theme = useTheme();
  const width = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, progress));

  // Animate toward the value so points earned mid-session visibly advance the
  // bar rather than jumping. Driven from an effect, never during render.
  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: theme.motion.slow,
      // Width cannot be driven natively; the bar is small and the animation short.
      useNativeDriver: false,
    }).start();
  }, [clamped, width, theme.motion.slow]);

  const colour = tone === 'success' ? theme.colors.success : theme.colors.primary;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      accessibilityLabel={label}
    >
      <View
        style={{
          height: 8,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            height: '100%',
            borderRadius: theme.radii.pill,
            backgroundColor: colour,
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          }}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- stepper */

/** Quantity control used in the cart and on the item screen. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 30,
  label = 'Quantity',
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label?: string;
}): React.JSX.Element {
  const theme = useTheme();

  const step = (delta: number): void => {
    const next = Math.max(min, Math.min(max, value + delta));
    if (next === value) return;
    selectionFeedback();
    onChange(next);
  };

  const button = (
    icon: keyof typeof Ionicons.glyphMap,
    delta: number,
    disabled: boolean,
    accessibilityLabel: string,
  ): React.JSX.Element => (
    <Pressable
      onPress={() => step(delta)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      android_ripple={{ color: theme.colors.surfaceMuted, borderless: true, radius: 20 }}
      style={{
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radii.pill,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.colors.textPrimary} />
    </Pressable>
  );

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radii.pill,
        minHeight: minTouchTarget,
        paddingHorizontal: 2,
      }}
    >
      {button('remove', -1, value <= min, 'Decrease quantity')}
      <Text variant="bodyStrong" style={{ minWidth: 24, textAlign: 'center' }} maxScale={1.3}>
        {value}
      </Text>
      {button('add', 1, value >= max, 'Increase quantity')}
    </View>
  );
}

/* -------------------------------------------------------- segmented control */

/**
 * Tab-like selector.
 *
 * iOS renders it as a segmented control with a sliding selection; Android gets
 * an underlined tab row, which is the Material idiom for the same job.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const isIOS = Platform.OS === 'ios';

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.segmented,
        isIOS
          ? {
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radii.md,
              padding: 3,
            }
          : { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (selected) return;
              selectionFeedback();
              onChange(option.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            android_ripple={isIOS ? undefined : { color: theme.colors.surfaceMuted }}
            style={[
              styles.segment,
              { minHeight: isIOS ? 34 : minTouchTarget },
              isIOS
                ? {
                    borderRadius: theme.radii.sm,
                    backgroundColor: selected ? theme.colors.surface : 'transparent',
                    ...(selected ? shadow('sm') : {}),
                  }
                : {
                    borderBottomWidth: 2,
                    borderBottomColor: selected ? theme.colors.primary : 'transparent',
                  },
            ]}
          >
            <Text
              variant={selected ? 'subhead' : 'footnote'}
              color={selected ? (isIOS ? 'textPrimary' : 'primary') : 'textMuted'}
              maxScale={1.3}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------------------------------------------------------------- chip */

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.base,
        minHeight: 38,
        borderRadius: byPlatform({ ios: theme.radii.md, android: theme.radii.pill }),
        backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
      }}
    >
      {icon ? <Text style={{ fontSize: 14 }}>{icon}</Text> : null}
      <Text
        variant="subhead"
        style={{ color: selected ? theme.colors.textOnPrimary : theme.colors.textPrimary }}
        maxScale={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* --------------------------------------------------------------- list row */

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  tone = 'textPrimary',
  destructive = false,
}: {
  title: string;
  subtitle?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: 'textPrimary' | 'primary';
  destructive?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  const content = (
    <View style={[styles.row, { minHeight: minTouchTarget, gap: theme.spacing.md }]}>
      {icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: theme.radii.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: destructive ? theme.colors.dangerMuted : theme.colors.surfaceMuted,
          }}
        >
          <Ionicons
            name={icon}
            size={17}
            color={destructive ? theme.colors.danger : theme.colors.textSecondary}
          />
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text variant="body" color={destructive ? 'danger' : tone}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textMuted" style={{ marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        ) : null)}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      accessibilityRole="button"
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => ({
        opacity: pressed && Platform.OS === 'ios' ? 0.6 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  segmented: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
