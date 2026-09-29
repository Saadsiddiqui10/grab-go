import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import {
  a11y,
  darkTheme,
  elevation,
  lightTheme,
  motion,
  palette,
  radii,
  spacing,
  typography,
  type ThemeColors,
  type TypographyToken,
} from '@grabgo/config';

/**
 * The app's design system.
 *
 * Colour, spacing, type and motion come from `@grabgo/config`, which the
 * merchant and admin dashboards share — so a brand change lands everywhere at
 * once and no screen invents its own orange.
 *
 * The theme follows the OS appearance setting. It is a context rather than a
 * module-level object so a change of system theme re-renders the tree.
 */

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  elevation: typeof elevation;
  motion: typeof motion;
  a11y: typeof a11y;
  palette: typeof palette;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const value = useMemo<Theme>(
    () => ({
      colors: isDark ? darkTheme : lightTheme,
      spacing,
      radii,
      typography,
      elevation,
      motion,
      a11y,
      palette,
      isDark,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}

/**
 * Resolve a typography token into a React Native text style.
 *
 * `fontWeight` is a string in the tokens (they are shared with CSS), so it is
 * cast once here rather than at every call site.
 */
export function textStyle(token: TypographyToken): TextStyle {
  const style = typography[token];
  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    fontWeight: style.fontWeight as TextStyle['fontWeight'],
  };
}

/**
 * Shadow that reads correctly on both platforms.
 *
 * iOS draws the shadow properties; Android only understands `elevation`, and
 * applying iOS shadow props there is a no-op that some versions render as a
 * hard edge.
 */
export function shadow(level: keyof typeof elevation): ViewStyle {
  const preset = elevation[level];

  if (Platform.OS === 'android') {
    return { elevation: preset.elevation };
  }

  return {
    shadowColor: preset.shadowColor,
    shadowOpacity: preset.shadowOpacity,
    shadowRadius: preset.shadowRadius,
    shadowOffset: preset.shadowOffset,
  };
}

/** The smallest acceptable touch target, which differs between the platforms. */
export const minTouchTarget =
  Platform.OS === 'android' ? a11y.minTouchTargetAndroid : a11y.minTouchTarget;

/**
 * Pick a value per platform.
 *
 * Used where the two operating systems genuinely differ — corner radii, control
 * shapes, transition timing — rather than to paper over one design.
 */
export function byPlatform<T>(options: { ios: T; android: T; default?: T }): T {
  if (Platform.OS === 'ios') return options.ios;
  if (Platform.OS === 'android') return options.android;
  return options.default ?? options.ios;
}

export { palette, spacing, radii, typography, motion, a11y };
export type { ThemeColors, TypographyToken };
