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
 * The customer app's palette, from the Figma redesign: warm paper background,
 * espresso-brown headings and cards, a maroon accent. It overrides the shared
 * `@grabgo/config` colours here rather than there, so the merchant and admin
 * dashboards keep their own look.
 *
 * `heading` is titles; `brand` fills the dark cards (cafe cards, points card)
 * with `onBrand`/`onBrandMuted` text; `accent` is the maroon of the save
 * button, reward cards and selected tab, with `accentRaised` for chips and
 * tracks on it; `accentSoft` is the pink tint behind the map button, the
 * "Open now" pill and the avatar; `field` fills search inputs.
 *
 * The dark theme is designed rather than inverted: an espresso-black page,
 * warm brown cards lifted off it, latte text, and a caramel primary that
 * holds dark text, since deep brown would vanish on a dark page.
 */
export interface AppColors extends ThemeColors {
  heading: string;
  brand: string;
  onBrand: string;
  onBrandMuted: string;
  accent: string;
  accentRaised: string;
  accentSoft: string;
  onAccentSoft: string;
  field: string;
  fieldText: string;
}

export const appLightColors: AppColors = {
  ...lightTheme,
  background: '#FAF9F6',
  backgroundElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#EFECE6',
  border: '#E8E1D9',
  borderStrong: '#D8CEC4',
  textPrimary: '#201D1B',
  textSecondary: '#8A7B74',
  textMuted: '#8A7B74',
  primary: '#3D1A07',
  primaryPressed: '#2A1105',
  primaryMuted: '#F5E8E4',
  primarySubtle: '#FAF1EE',
  textOnPrimary: '#FFFFFF',
  success: '#087653',
  successMuted: '#D6F5E8',
  skeleton: '#EFECE6',
  skeletonHighlight: '#FAF9F6',
  heading: '#3D1A07',
  brand: '#3D1A07',
  onBrand: '#FFFFFF',
  onBrandMuted: '#F5E8E4',
  accent: '#540505',
  accentRaised: '#6E2C13',
  accentSoft: '#F5E8E4',
  onAccentSoft: '#540505',
  field: '#EFECE6',
  fieldText: '#8A7B74',
};

export const appDarkColors: AppColors = {
  ...darkTheme,
  background: '#14100E',
  backgroundElevated: '#1E1713',
  surface: '#1E1713',
  surfaceMuted: '#2A211C',
  border: '#3A2C25',
  borderStrong: '#4A3930',
  textPrimary: '#F5EFE9',
  textSecondary: '#B5A69E',
  textMuted: '#9A8B83',
  primary: '#D9A07C',
  primaryPressed: '#E6B595',
  primaryMuted: '#3A2620',
  primarySubtle: '#2A1C17',
  textOnPrimary: '#241510',
  success: '#4FD1A1',
  successMuted: '#123A2D',
  skeleton: '#2A211C',
  skeletonHighlight: '#3A2C25',
  heading: '#F3E3D6',
  brand: '#2E1D14',
  onBrand: '#FFF8F2',
  onBrandMuted: '#D9C4B8',
  accent: '#6B1A1A',
  accentRaised: '#8A3A24',
  accentSoft: '#3A2420',
  onAccentSoft: '#F2B8B0',
  field: '#2A211C',
  fieldText: '#A8988F',
};

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
  colors: AppColors;
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
      colors: isDark ? appDarkColors : appLightColors,
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
export type { AppColors as Colors };
