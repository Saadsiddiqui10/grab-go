import { StyleSheet, Text as RNText, View, type TextProps as RNTextProps } from 'react-native';
import { fontFor } from '../../theme/fonts';
import { textStyle, useTheme, type AppColors, type TypographyToken } from '../../theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  color?: keyof AppColors;
  align?: 'left' | 'center' | 'right';
  /**
   * Cap how far Dynamic Type / font-size settings can scale this text.
   * Only used where unbounded growth would break a layout (a badge, a tab
   * label); body copy is left unbounded so accessibility settings work.
   */
  maxScale?: number;
}

/**
 * How far each style may grow with Dynamic Type, mirroring iOS: big styles
 * grow less than body text (Apple's Large Title roughly doubles at the largest
 * accessibility size while Body triples), so headings stay on screen and do
 * not split words across lines. Body and smaller are left unbounded.
 */
const defaultMaxScale: Partial<Record<TypographyToken, number>> = {
  display: 1.75,
  title1: 2,
  title2: 2.3,
  title3: 2.6,
  // The pickup code has to stay on one line to be read at the counter.
  code: 1.3,
};

/**
 * Typed text.
 *
 * Every string in the app goes through here, which is what keeps type sizes on
 * the scale and colours on the theme. Font scaling is deliberately left on:
 * a customer with large text turned on should get large text.
 */
export function Text({
  variant = 'body',
  color = 'textPrimary',
  align,
  maxScale,
  style,
  ...props
}: TextProps): React.JSX.Element {
  const theme = useTheme();

  // Resolve the final weight (a caller may override it), then pick the face:
  // headings in Fraunces, everything else in DM Sans. Custom fonts carry
  // their weight in the family, so `fontWeight` is dropped once mapped.
  const merged = StyleSheet.flatten([
    textStyle(variant),
    { color: theme.colors[color] },
    align ? { textAlign: align } : null,
    style,
  ]);
  const family = merged.fontFamily ? undefined : fontFor(merged.fontWeight, headingVariants.has(variant));
  const finalStyle = family ? { ...merged, fontFamily: family, fontWeight: undefined } : merged;

  return (
    <RNText {...props} maxFontSizeMultiplier={maxScale ?? defaultMaxScale[variant]} style={finalStyle} />
  );
}

/** Variants set in the heading face. */
const headingVariants = new Set<TypographyToken>(['display', 'title1', 'title2', 'title3']);

/** Section heading used above every home-screen rail and settings group. */
export function SectionTitle({
  children,
  subtitle,
  action,
  tone,
  subtone,
}: {
  children: React.ReactNode;
  subtitle?: string | null;
  action?: React.ReactNode;
  /** Heading colour override, e.g. a selected category's ink. */
  tone?: string;
  /** Subtitle colour override; defaults to `tone`. */
  subtone?: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="title3" color="heading" style={tone ? { color: tone } : null}>
          {children}
        </Text>
        {subtitle ? (
          <Text
            variant="footnote"
            color="heading"
            style={[{ marginTop: 5, fontWeight: '400' }, (subtone ?? tone) ? { color: subtone ?? tone } : null]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
