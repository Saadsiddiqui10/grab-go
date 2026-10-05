import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { byPlatform, minTouchTarget, useTheme } from '../../theme';
import { tapFeedback } from '../../lib/feedback';
import { useReducedMotion } from '../../lib/motion';
import { Text } from './Text';

/**
 * The primary action control.
 *
 * Platform behaviour differs the way each OS expects: iOS dims and springs
 * slightly under a press, Android draws a Material ripple from the touch point.
 * The result feels native on both without either design being forced onto the
 * other, while the shape, colour and type stay unmistakably Grab & Go.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  /** Secondary line inside the button, e.g. the cart total on "Go to cart". */
  detail?: string;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  detail,
  disabled,
  onPress,
  style,
  haptic = true,
  ...props
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  const isDisabled = disabled === true || loading;

  const palette = {
    primary: {
      background: theme.colors.primary,
      pressed: theme.colors.primaryPressed,
      foreground: theme.colors.textOnPrimary,
      border: 'transparent',
    },
    secondary: {
      background: theme.colors.surfaceMuted,
      pressed: theme.colors.border,
      foreground: theme.colors.textPrimary,
      border: theme.colors.border,
    },
    ghost: {
      background: 'transparent',
      pressed: theme.colors.surfaceMuted,
      foreground: theme.colors.primary,
      border: 'transparent',
    },
    danger: {
      background: theme.colors.dangerMuted,
      pressed: theme.colors.danger,
      foreground: theme.colors.danger,
      border: 'transparent',
    },
  }[variant];

  const dimensions = {
    sm: { height: 38, paddingHorizontal: theme.spacing.base, variant: 'subhead' as const },
    md: { height: 48, paddingHorizontal: theme.spacing.lg, variant: 'bodyStrong' as const },
    lg: { height: 56, paddingHorizontal: theme.spacing.xl, variant: 'bodyStrong' as const },
  }[size];

  // iOS presses feel right with a subtle scale; Android's ripple already
  // communicates the press, so it stays flat.
  const animatePress = (toValue: number): void => {
    if (Platform.OS !== 'ios' || reduceMotion) return;
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  return (
    <Animated.View
      style={[
        fullWidth ? styles.fullWidth : null,
        Platform.OS === 'ios' ? { transform: [{ scale }] } : null,
        style,
      ]}
    >
      <Pressable
        {...props}
        disabled={isDisabled}
        onPressIn={() => animatePress(0.97)}
        onPressOut={() => animatePress(1)}
        onPress={(event) => {
          if (haptic) tapFeedback();
          onPress?.(event);
        }}
        android_ripple={
          variant === 'ghost'
            ? { color: theme.colors.primaryMuted, borderless: false }
            : { color: 'rgba(0,0,0,0.12)', borderless: false }
        }
        accessibilityRole="button"
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: Math.max(dimensions.height, minTouchTarget),
            paddingHorizontal: dimensions.paddingHorizontal,
            borderRadius: byPlatform({
              // Android's Material shapes read fully rounded on filled buttons;
              // iOS convention is a softer rounded rectangle.
              ios: theme.radii.lg,
              android: theme.radii.pill,
            }),
            backgroundColor:
              pressed && Platform.OS === 'ios' ? palette.pressed : palette.background,
            borderColor: palette.border,
            borderWidth: variant === 'secondary' ? 1 : 0,
            opacity: isDisabled ? 0.5 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.foreground} />
        ) : (
          <View style={styles.content}>
            {icon && iconPosition === 'left' ? (
              <Ionicons name={icon} size={18} color={palette.foreground} />
            ) : null}

            <View style={styles.labels}>
              <Text
                variant={dimensions.variant}
                style={{ color: palette.foreground }}
                maxScale={1.4}
                numberOfLines={1}
              >
                {label}
              </Text>
              {detail ? (
                <Text
                  variant="caption"
                  style={{ color: palette.foreground, opacity: 0.85 }}
                  maxScale={1.3}
                >
                  {detail}
                </Text>
              ) : null}
            </View>

            {icon && iconPosition === 'right' ? (
              <Ionicons name={icon} size={18} color={palette.foreground} />
            ) : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Icon-only control. Always given an accessible label by the caller. */
export function IconButton({
  icon,
  onPress,
  label,
  size = 22,
  tone = 'textPrimary',
  background,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  size?: number;
  tone?: 'textPrimary' | 'textMuted' | 'primary' | 'danger' | 'textOnPrimary';
  background?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      android_ripple={{ color: theme.colors.surfaceMuted, borderless: true, radius: 22 }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          minWidth: minTouchTarget,
          minHeight: minTouchTarget,
          borderRadius: theme.radii.pill,
          backgroundColor: background ?? 'transparent',
          opacity: disabled ? 0.4 : pressed && Platform.OS === 'ios' ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={size} color={theme.colors[tone]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  labels: {
    alignItems: 'center',
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
