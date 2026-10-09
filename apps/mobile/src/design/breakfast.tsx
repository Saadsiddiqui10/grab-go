import { memo, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../theme';
import { patternXml } from './assets';

/**
 * The Breakfast look, from its own Figma frame: a cool morning page covered
 * in tilted suns, cream cafe cards, and orange accents. Home switches to it
 * while the Breakfast category is selected; nothing else changes.
 *
 * The category strip keeps the app's square tiles. One departure from the
 * frame, for legibility: the save heart is amber rather than pale yellow on
 * grey (~1.2:1, nearly invisible).
 */
export interface BreakfastSkin {
  page: string;
  sun: string;
  sunOpacity: number;
  text: string;
  muted: string;
  accent: string;
  mapButton: string;
  field: string;
  card: string;
  media: string;
  saveButton: string;
  saveIcon: string;
  cup: string;
}

const light: BreakfastSkin = {
  page: '#F2F2F2',
  sun: '#E6E600',
  sunOpacity: 0.42,
  text: '#37342B',
  muted: '#70685C',
  accent: '#F25A16',
  mapButton: '#FFF0DF',
  field: '#F0ECE5',
  card: '#FFFFED',
  media: '#F0ECE5',
  saveButton: '#DBDBDB',
  saveIcon: '#A66600',
  cup: '#857164',
};

/**
 * Before sunrise: a warm charcoal page with the suns turned down to a glow,
 * cards lifted in dark oat, and the orange kept for accents.
 */
const dark: BreakfastSkin = {
  page: '#16140F',
  sun: '#E6D200',
  sunOpacity: 0.16,
  text: '#F4EFDF',
  muted: '#B3AA98',
  accent: '#FF7A3D',
  mapButton: '#3A2A1A',
  field: '#26231B',
  card: '#221F17',
  media: '#2E2A20',
  saveButton: '#3A3529',
  saveIcon: '#F2C14E',
  cup: '#C9B5A5',
};

export function useBreakfastSkin(): BreakfastSkin {
  return useTheme().isDark ? dark : light;
}

/**
 * The tilted-sun wallpaper, drawn as one SVG so it appears instantly when a
 * tab regains focus. Ignores touches and is hidden from VoiceOver.
 */
export const SunPattern = memo(function SunPattern(): React.JSX.Element {
  const skin = useBreakfastSkin();
  const { width, height } = useWindowDimensions();
  const tall = Math.round(height * 1.6);

  const xml = useMemo(
    () =>
      patternXml({
        name: 'breakfastSun',
        tint: skin.sun,
        width,
        height: tall,
        top: 230,
        rowGap: 50,
        colGap: 56,
        size: 28,
        oddOffset: 36,
        rotate: (row, column) => ((row * 7 + column * 13) % 2 === 0 ? 30 : -15),
        opacity: skin.sunOpacity,
      }),
    [skin.sun, skin.sunOpacity, width, tall],
  );

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
