import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Button } from './Button';
import { useReducedMotion } from '../../lib/motion';

/**
 * Loading, empty and error states.
 *
 * Every list and screen in the app is required to have all three. A blank screen
 * during a slow request, or a silent failure on a bad connection, is the fastest
 * way to make a product feel broken — and Karachi mobile data is not always kind.
 */

/* ------------------------------------------------------------------ skeleton */

/**
 * A shimmering placeholder.
 *
 * Preferred over a spinner for content that has a known shape: it communicates
 * "a cafe card is coming" and prevents the layout jumping when it arrives.
 */
export function Skeleton({
  width,
  height,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}): React.JSX.Element {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // With Reduce Motion on, the placeholder stays still at a mid tone.
    if (reduceMotion) {
      pulse.setValue(0.5);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius ?? theme.radii.sm,
          backgroundColor: theme.colors.skeleton,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        },
        style,
      ]}
    />
  );
}

/** Placeholder shaped like a cafe card, used while the home rails load. */
export function CafeCardSkeleton(): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ width: 260, gap: theme.spacing.sm }}>
      <Skeleton height={140} radius={theme.radii.lg} />
      <Skeleton height={18} width="70%" />
      <Skeleton height={14} width="45%" />
    </View>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.base }}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Skeleton width={64} height={64} radius={theme.radii.md} />
          <View style={{ flex: 1, gap: theme.spacing.sm, justifyContent: 'center' }}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={13} width="35%" />
          </View>
        </View>
      ))}
    </View>
  );
}

/* --------------------------------------------------------------------- empty */

export function EmptyState({
  icon = 'cafe-outline',
  title,
  body,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.centred,
        { paddingVertical: compact ? theme.spacing.xl : theme.spacing.huge, gap: theme.spacing.md },
      ]}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          // The redesign's filled espresso circle with a light glyph.
          backgroundColor: theme.colors.primary,
        }}
      >
        <Ionicons name={icon} size={28} color={theme.colors.textOnPrimary} />
      </View>

      <View style={{ gap: 4, alignItems: 'center' }}>
        <Text variant="title3" align="center">
          {title}
        </Text>
        {body ? (
          <Text variant="footnote" color="textMuted" align="center" style={{ maxWidth: 280 }}>
            {body}
          </Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="primary" size="sm" onPress={onAction} />
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------------- error */

export function ErrorState({
  title = 'Something went wrong',
  body = 'Check your connection and try again.',
  onRetry,
  compact = false,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  compact?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.centred,
        { paddingVertical: compact ? theme.spacing.xl : theme.spacing.huge, gap: theme.spacing.md },
      ]}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.dangerMuted,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.danger} />
      </View>

      <View style={{ gap: 4, alignItems: 'center' }}>
        <Text variant="title3" align="center">
          {title}
        </Text>
        <Text variant="footnote" color="textMuted" align="center" style={{ maxWidth: 280 }}>
          {body}
        </Text>
      </View>

      {onRetry ? (
        <Button label="Try again" variant="secondary" size="sm" icon="refresh" onPress={onRetry} />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------- loading */

export function LoadingState({ label }: { label?: string }): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={[styles.centred, { paddingVertical: theme.spacing.huge, gap: theme.spacing.md }]}>
      <ActivityIndicator color={theme.colors.primary} />
      {label ? (
        <Text variant="footnote" color="textMuted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A single place to decide what a screen shows.
 *
 * Screens call this instead of writing the same `isLoading ? … : error ? …`
 * ladder, which is how one of the three states quietly goes missing.
 */
export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loading,
  empty,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty?: boolean;
  onRetry?: () => void;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  if (isLoading) return <>{loading ?? <LoadingState />}</>;
  if (isError) return <ErrorState {...(onRetry ? { onRetry } : {})} />;
  if (isEmpty) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
