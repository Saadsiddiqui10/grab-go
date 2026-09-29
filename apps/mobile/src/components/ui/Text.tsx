import { Text as RNText, View, type TextProps as RNTextProps } from 'react-native';
import { textStyle, useTheme, type ThemeColors, type TypographyToken } from '../../theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  color?: keyof ThemeColors;
  align?: 'left' | 'center' | 'right';
  /**
   * Cap how far Dynamic Type / font-size settings can scale this text.
   * Only used where unbounded growth would break a layout (a badge, a tab
   * label); body copy is left unbounded so accessibility settings work.
   */
  maxScale?: number;
}

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

  return (
    <RNText
      {...props}
      maxFontSizeMultiplier={maxScale}
      style={[
        textStyle(variant),
        { color: theme.colors[color] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}

/** Section heading used above every home-screen rail and settings group. */
export function SectionTitle({
  children,
  subtitle,
  action,
}: {
  children: React.ReactNode;
  subtitle?: string | null;
  action?: React.ReactNode;
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
        <Text variant="title3">{children}</Text>
        {subtitle ? (
          <Text variant="footnote" color="textMuted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
