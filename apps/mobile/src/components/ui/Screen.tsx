import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../../theme';

/**
 * Screen shells.
 *
 * Two things every screen needs and neither platform gives for free: correct
 * safe-area handling (the Dynamic Island and home indicator on iOS, gesture
 * navigation and cutouts on Android) and keyboard behaviour that differs
 * meaningfully between the two.
 */

export interface ScreenProps {
  children: React.ReactNode;
  /** Which edges to inset. The top is usually handled by the navigation header. */
  edges?: { top?: boolean; bottom?: boolean };
  padded?: boolean;
  style?: ViewStyle;
  background?: 'background' | 'surface';
}

export function Screen({
  children,
  edges = { top: false, bottom: true },
  padded = true,
  style,
  background = 'background',
}: ScreenProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.flex,
        {
          backgroundColor: theme.colors[background],
          paddingTop: edges.top ? insets.top : 0,
          paddingBottom: edges.bottom ? insets.bottom : 0,
          paddingHorizontal: padded ? theme.spacing.base : 0,
        },
        style,
      ]}
    >
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {children}
    </View>
  );
}

export interface ScrollScreenProps extends Omit<ScrollViewProps, 'style'> {
  children: React.ReactNode;
  padded?: boolean;
  background?: 'background' | 'surface';
  /** Extra bottom space so a floating bar does not cover the last row. */
  footerSpace?: number;
}

export function ScrollScreen({
  children,
  padded = true,
  background = 'background',
  footerSpace = 0,
  contentContainerStyle,
  ...props
}: ScrollScreenProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors[background] }]}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <ScrollView
        {...props}
        style={styles.flex}
        // iOS gets the rubber-band overscroll it expects; Android's stretch
        // effect is the platform default and stays on.
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          {
            paddingHorizontal: padded ? theme.spacing.base : 0,
            paddingBottom: insets.bottom + theme.spacing.xl + footerSpace,
          },
          contentContainerStyle,
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * Wrapper for screens with text input.
 *
 * iOS needs padding pushed by the keyboard height; Android's windowSoftInput
 * already resizes the view, and applying the iOS behaviour there double-shifts
 * the layout.
 */
export function KeyboardScreen({
  children,
  padded = true,
}: {
  children: React.ReactNode;
  padded?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={[styles.flex, { paddingHorizontal: padded ? theme.spacing.base : 0 }]}>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * A bar pinned above the home indicator, used for the primary action on the
 * cart, item and checkout screens.
 */
export function StickyFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.base,
        paddingTop: theme.spacing.md,
        paddingBottom: Math.max(insets.bottom, theme.spacing.md),
        backgroundColor: theme.colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
