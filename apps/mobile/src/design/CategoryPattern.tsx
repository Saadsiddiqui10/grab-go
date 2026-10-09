import { memo, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { categoryArt, patternXml } from './assets';

/**
 * The scattered-icon wallpaper behind the page while a category is selected
 * (the redesign's bakery frame: croissants on a golden wash).
 *
 * The category's illustration, small, tilted and faded, offset on alternate
 * rows, drawn as one SVG so it appears instantly when a tab regains focus.
 * It ignores touches and is hidden from VoiceOver.
 */
export const CategoryPattern = memo(function CategoryPattern({
  slug,
  colour,
}: {
  slug: string;
  /** The category's ink, so the icons read as one colour on the wash. */
  colour: string;
}): React.JSX.Element | null {
  const { width, height } = useWindowDimensions();
  const art = categoryArt[slug];
  const tall = Math.round(height * 1.6);

  const xml = useMemo(
    () =>
      art
        ? patternXml({
            name: art.tile,
            tint: colour,
            width,
            height: tall,
            top: 250,
            rowGap: 42,
            colGap: 42,
            size: 14,
            oddOffset: 27,
            rotate: () => -18,
            opacity: 0.35,
          })
        : '',
    [art, colour, width, tall],
  );

  if (!art) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
    >
      <SvgXml xml={xml} width={width} height={tall} />
    </View>
  );
});
