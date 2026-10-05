/**
 * Grab & Go design tokens.
 *
 * The identity is built from two ideas: coffee and speed. `espresso` is the warm
 * near-black everything sits on; `ember` is the energetic tangerine that carries
 * every primary action. Status colours are picked so the order timeline reads at a
 * glance — amber is "being made", mint is "yours is ready".
 *
 * Plain objects, not a styling framework, so the same values feed React Native
 * StyleSheet and CSS custom properties without translation.
 */

export const palette = {
  /** Warm neutral ramp. Not grey — coffee has brown in it. */
  espresso: {
    950: '#0D0A08',
    900: '#14100E',
    800: '#221A16',
    700: '#3A2C25',
    600: '#5A473D',
    500: '#7C6659',
    400: '#A08D80',
    300: '#C4B5A9',
    200: '#E2D8CF',
    100: '#F1EBE5',
    50: '#FAF6F2',
  },
  /** Primary. Energetic without tipping into a warning colour. */
  ember: {
    700: '#B8340F',
    600: '#D9411A',
    500: '#F2571F',
    400: '#FF7A3D',
    300: '#FFA173',
    200: '#FFC9AC',
    100: '#FFE6D9',
    50: '#FFF3ED',
  },
  /** Ready / success. */
  mint: {
    700: '#087A53',
    600: '#0E9B6B',
    500: '#12B981',
    200: '#A7EBD1',
    100: '#D6F5E9',
    50: '#ECFBF5',
  },
  /** Preparing / attention. */
  amber: {
    600: '#D08704',
    500: '#F5A524',
    200: '#FBE0A6',
    100: '#FEF0D5',
    50: '#FFF9EC',
  },
  /** Errors and destructive actions. */
  berry: {
    600: '#C62A2F',
    500: '#E5484D',
    200: '#F7BFC1',
    100: '#FDE5E6',
    50: '#FEF2F3',
  },
  /** Informational accents, links, map pins. */
  ocean: {
    600: '#1D4FD7',
    500: '#3B6FF5',
    200: '#BDD0FD',
    100: '#E3EBFE',
    50: '#F2F6FF',
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

/**
 * Semantic colours. Components reference these, never the raw ramp, so a brand
 * refresh is one file and dark mode is a second object with the same keys.
 */
export const lightTheme = {
  background: palette.espresso[50],
  backgroundElevated: palette.white,
  surface: palette.white,
  surfaceMuted: palette.espresso[100],
  surfaceInverse: palette.espresso[900],

  border: palette.espresso[200],
  borderStrong: palette.espresso[300],

  textPrimary: palette.espresso[900],
  textSecondary: palette.espresso[600],
  textMuted: palette.espresso[500],
  textInverse: palette.white,
  textOnPrimary: palette.white,

  primary: palette.ember[500],
  primaryPressed: palette.ember[600],
  primaryMuted: palette.ember[100],
  primarySubtle: palette.ember[50],

  success: palette.mint[600],
  successMuted: palette.mint[100],
  warning: palette.amber[500],
  warningMuted: palette.amber[100],
  danger: palette.berry[500],
  dangerMuted: palette.berry[100],
  info: palette.ocean[500],
  infoMuted: palette.ocean[100],

  overlay: 'rgba(20, 16, 14, 0.55)',
  skeleton: palette.espresso[100],
  skeletonHighlight: palette.espresso[50],
} as const;

/**
 * Both themes expose the same keys, but the values are plain strings rather than
 * the literals `as const` would infer, so a dark value may differ from its light
 * twin.
 */
export type ThemeColors = Record<keyof typeof lightTheme, string>;

export const darkTheme: ThemeColors = {
  background: palette.espresso[950],
  backgroundElevated: palette.espresso[900],
  surface: palette.espresso[900],
  surfaceMuted: palette.espresso[800],
  surfaceInverse: palette.espresso[50],

  border: palette.espresso[800],
  borderStrong: palette.espresso[700],

  textPrimary: palette.espresso[50],
  textSecondary: palette.espresso[300],
  textMuted: palette.espresso[400],
  textInverse: palette.espresso[900],
  textOnPrimary: palette.white,

  primary: palette.ember[400],
  primaryPressed: palette.ember[300],
  primaryMuted: 'rgba(242, 87, 31, 0.18)',
  primarySubtle: 'rgba(242, 87, 31, 0.10)',

  success: palette.mint[500],
  successMuted: 'rgba(18, 185, 129, 0.16)',
  warning: palette.amber[500],
  warningMuted: 'rgba(245, 165, 36, 0.16)',
  danger: palette.berry[500],
  dangerMuted: 'rgba(229, 72, 77, 0.16)',
  info: palette.ocean[500],
  infoMuted: 'rgba(59, 111, 245, 0.16)',

  overlay: 'rgba(0, 0, 0, 0.65)',
  skeleton: palette.espresso[800],
  skeletonHighlight: palette.espresso[700],
};

/** 4pt grid. Named by role rather than size so layouts stay consistent. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radii = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

/**
 * Type scale. Display sizes carry tight negative tracking, which is what gives
 * headings their modern, confident feel at large sizes.
 */
export const typography = {
  display: { fontSize: 34, lineHeight: 40, letterSpacing: -0.8, fontWeight: '800' },
  title1: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.4, fontWeight: '700' },
  title3: { fontSize: 18, lineHeight: 24, letterSpacing: -0.2, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, letterSpacing: 0, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, letterSpacing: 0, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 20, letterSpacing: 0, fontWeight: '500' },
  subhead: { fontSize: 14, lineHeight: 19, letterSpacing: 0, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.1, fontWeight: '500' },
  overline: { fontSize: 11, lineHeight: 14, letterSpacing: 0.8, fontWeight: '700' },
  /** The pickup code on the confirmation screen. Deliberately enormous. */
  code: { fontSize: 44, lineHeight: 50, letterSpacing: 6, fontWeight: '800' },
} as const;

export type TypographyToken = keyof typeof typography;

/**
 * Elevation. iOS gets soft shadows, Android gets the elevation prop; both are
 * expressed here so a component does not have to branch on platform itself.
 */
export const elevation = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  sm: {
    shadowColor: '#1C1210',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#1C1210',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#1C1210',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

/**
 * Motion. Short and purposeful — the product promise is speed, so nothing should
 * make the user wait on an animation. Anything above `slow` is a mistake.
 */
export const motion = {
  instant: 90,
  fast: 160,
  base: 220,
  slow: 320,
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0, 1] as const,
    accelerate: [0.3, 0, 1, 1] as const,
  },
} as const;

/** Accessibility floors. 44pt is the smallest reliable touch target on both OSs. */
export const a11y = {
  minTouchTarget: 44,
  minTouchTargetAndroid: 48,
  focusRingWidth: 2,
} as const;

/** Status colour mapping shared by the app, the merchant board and admin. */
export const orderStatusColors = {
  PENDING: { fg: palette.espresso[600], bg: palette.espresso[100] },
  ACCEPTED: { fg: palette.ocean[600], bg: palette.ocean[100] },
  PREPARING: { fg: palette.amber[600], bg: palette.amber[100] },
  READY: { fg: palette.mint[700], bg: palette.mint[100] },
  PICKED_UP: { fg: palette.mint[700], bg: palette.mint[100] },
  COMPLETED: { fg: palette.espresso[600], bg: palette.espresso[100] },
  CANCELLED_BY_CUSTOMER: { fg: palette.berry[600], bg: palette.berry[100] },
  CANCELLED_BY_CAFE: { fg: palette.berry[600], bg: palette.berry[100] },
  CANCELLED_BY_ADMIN: { fg: palette.berry[600], bg: palette.berry[100] },
  EXPIRED: { fg: palette.espresso[500], bg: palette.espresso[100] },
} as const;

/**
 * Discovery category colours, each taken from its drink or food: espresso
 * brown, karak amber, matcha green and so on.
 *
 * `solid` fills a selected tab and a map pin, with `onSolid` text on top;
 * `soft` tints an unselected tab. Light `solid`s hold white text at 4.5:1 or
 * better. Dark mode flips to lighter `solid`s with dark text, since a deep
 * brown pin disappears on a dark map.
 */
export interface CategoryColorSet {
  solid: string;
  onSolid: string;
  soft: string;
}

export const categoryColors: Record<string, { light: CategoryColorSet; dark: CategoryColorSet }> = {
  coffee: {
    light: { solid: '#6F4E37', onSolid: palette.white, soft: '#F3EAE3' },
    dark: { solid: '#C8A07F', onSolid: palette.espresso[900], soft: '#33261E' },
  },
  tea: {
    light: { solid: '#B45309', onSolid: palette.white, soft: '#FDF0E1' },
    dark: { solid: '#F59E0B', onSolid: palette.espresso[900], soft: '#3A2A12' },
  },
  matcha: {
    light: { solid: '#4D7C0F', onSolid: palette.white, soft: '#EEF5E0' },
    dark: { solid: '#A3C76D', onSolid: palette.espresso[900], soft: '#263319' },
  },
  breakfast: {
    light: { solid: '#A16207', onSolid: palette.white, soft: '#FBF3D9' },
    dark: { solid: '#FACC15', onSolid: palette.espresso[900], soft: '#3A3212' },
  },
  bakery: {
    light: { solid: '#9A3412', onSolid: palette.white, soft: '#FBE9E1' },
    dark: { solid: '#FB923C', onSolid: palette.espresso[900], soft: '#3B2318' },
  },
  desserts: {
    light: { solid: '#BE185D', onSolid: palette.white, soft: '#FCE7F1' },
    dark: { solid: '#F472B6', onSolid: palette.espresso[900], soft: '#3A1F2C' },
  },
  healthy: {
    light: { solid: '#0F766E', onSolid: palette.white, soft: '#DDF4F1' },
    dark: { solid: '#2DD4BF', onSolid: palette.espresso[900], soft: '#15302D' },
  },
};

/** Categories without their own colour fall back to the brand. */
export const defaultCategoryColors = {
  light: { solid: palette.ember[600], onSolid: palette.white, soft: palette.ember[50] },
  dark: { solid: palette.ember[400], onSolid: palette.espresso[900], soft: '#3A2216' },
} as const satisfies { light: CategoryColorSet; dark: CategoryColorSet };

/** Emit the light/dark themes as CSS custom properties for the web dashboards. */
export function themeToCssVariables(theme: ThemeColors): string {
  return Object.entries(theme)
    .map(([key, value]) => `  --color-${kebab(key)}: ${value};`)
    .join('\n');
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
