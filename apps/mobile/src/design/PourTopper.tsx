import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Ellipse, G, Path } from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * A drink pouring onto a cafe card while its category is selected: a small
 * tilted cup above the card pours a stream onto the top edge, where the
 * liquid spreads into a glaze with a few drips (espresso for Coffee, green
 * matcha, chai, orange juice for Breakfast, honey for Bakery, strawberry
 * sauce for Desserts, smoothie for Healthy).
 *
 * Purely decorative: it ignores touches and is hidden from VoiceOver. The
 * drips stay clear of the save button in the top-right corner.
 */

/** Space reserved above the card for the cup and stream. */
export const POUR_HEADROOM = 34;

const RADIUS = 18;
const BAND = 7;

/** How far the glaze band reaches into the card (drips excluded). */
export const POUR_GLAZE_DEPTH = BAND + 2;

interface Liquid {
  liquid: string;
  shine: string;
  cup: string;
  cupDark: string;
}

const liquids: Record<string, Liquid> = {
  coffee: { liquid: '#4B2615', shine: '#8A5233', cup: '#4D2112', cupDark: '#C89A7E' },
  tea: { liquid: '#B9773A', shine: '#E3AE76', cup: '#733708', cupDark: '#E0A066' },
  matcha: { liquid: '#7FA64A', shine: '#B9D88A', cup: '#326B0D', cupDark: '#9CCB6E' },
  breakfast: { liquid: '#F6A21A', shine: '#FFD27D', cup: '#A66600', cupDark: '#E8DE6A' },
  bakery: { liquid: '#D99A1E', shine: '#F6CC6A', cup: '#BB8716', cupDark: '#E2B04E' },
  desserts: { liquid: '#D9467A', shine: '#F497B7', cup: '#9A3A62', cupDark: '#F0A9C4' },
  healthy: { liquid: '#E8875A', shine: '#F7B994', cup: '#9A4E1E', cupDark: '#EBAA7C' },
};

export function hasPour(slug: string | null | undefined): slug is string {
  return Boolean(slug && liquids[slug]);
}

/** A small number in [0, 1) from a string, so each card drips differently. */
function seeded(seed: string, index: number): number {
  let hash = 2166136261;
  for (const char of `${seed}:${index}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

export const PourTopper = memo(function PourTopper({
  slug,
  width,
  seed,
}: {
  slug: string;
  width: number;
  /** Varies the drips between cards. */
  seed: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  const colours = liquids[slug];

  const glaze = useMemo(() => {
    if (width <= 0) return '';
    const T = POUR_HEADROOM;
    const W = width;
    const bottom = T + BAND;
    // Drips along the left two thirds, away from the save button.
    const drips = [0.12, 0.3, 0.5, 0.64].map((at, i) => ({
      x: W * at + (seeded(seed, i) - 0.5) * 18,
      length: 8 + seeded(seed, i + 10) * 16,
      half: 4 + seeded(seed, i + 20) * 3,
    }));

    // Follow the card's rounded corners exactly: the band's lower edge meets
    // each corner arc where that arc crosses `bottom`.
    const inset = RADIUS - Math.sqrt(RADIUS * RADIUS - (RADIUS - BAND) * (RADIUS - BAND));
    let path = `M${inset},${bottom} A${RADIUS},${RADIUS} 0 0 1 ${RADIUS},${T} `;
    path += `L${W - RADIUS},${T} A${RADIUS},${RADIUS} 0 0 1 ${W - inset},${bottom} `;
    // Walk back right-to-left along the band's lower edge, dipping into drips.
    for (const drip of [...drips].sort((a, b) => b.x - a.x)) {
      const left = drip.x - drip.half;
      const right = drip.x + drip.half;
      path += `L${right + 4},${bottom} `;
      path += `Q${right},${bottom} ${right},${bottom + 4} `;
      path += `L${right},${bottom + drip.length - drip.half} `;
      path += `A${drip.half},${drip.half} 0 0 1 ${left},${bottom + drip.length - drip.half} `;
      path += `L${left},${bottom + 4} `;
      path += `Q${left},${bottom} ${left - 4},${bottom} `;
    }
    path += `L${inset},${bottom} Z`;
    return path;
  }, [width, seed]);

  if (!colours || width <= 0) return null;

  const T = POUR_HEADROOM;
  const cupStroke = theme.isDark ? colours.cupDark : colours.cup;
  const cupFill = theme.isDark ? theme.colors.surfaceMuted : '#FFFDF8';
  // The stream lands about a quarter of the way in.
  const landX = width * 0.26;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { bottom: undefined, height: T + 40, zIndex: 2 }]}
    >
      <Svg width={width} height={T + 40}>
        {/* Glaze over the card's top edge, with a highlight along it. */}
        <Path d={glaze} fill={colours.liquid} />
        <Path
          d={`M${RADIUS - 4},${T + 2.5} L${width - RADIUS - 70},${T + 2.5}`}
          stroke={colours.shine}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.7}
        />

        {/* The stream, from the cup's lip down to the card. */}
        <Path
          // From the cup's lowest rim lip (handle on the far side) to the card.
          d={`M${landX - 18.4},${16.7} Q${landX - 4},${18} ${landX},${T + 1}`}
          stroke={colours.liquid}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
        <Ellipse cx={landX} cy={T + 1} rx={8} ry={2.6} fill={colours.shine} opacity={0.8} />

        {/* Mirrored so the handle is on the left, then tipped 35° towards the
            card: the rim's right lip is the lowest point and the stream
            leaves from there. */}
        <G transform={`translate(${landX - 50}, 2) rotate(35 16 16) translate(32 0) scale(-1 1)`}>
          <Path
            d="M4,6 L28,6 L25,24 Q24.5,27 21.5,27 L10.5,27 Q7.5,27 7,24 Z"
            fill={cupFill}
            stroke={cupStroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <Path
            d="M27,10 Q34,10 33,16 Q32,21 25.5,20"
            stroke={cupStroke}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
          <Path d="M5.5,9 L26.5,9 L26,12 L6,12 Z" fill={colours.liquid} />
        </G>
      </Svg>
    </View>
  );
});
