import { memo, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { svgSources } from './svgSources';

/**
 * Icons and illustrations exported from the Figma redesign (assets/figma).
 *
 * Drawn with react-native-svg from inlined sources, so they render in the
 * same frame as the screen. (An image loader decodes SVGs asynchronously and
 * re-decodes when a screen regains focus, which made every tab switch look
 * like a reload.)
 *
 * Line icons are single-colour, so they take a `tint` and follow the theme.
 * Category illustrations carry their own colours and are drawn as designed.
 */
export type FigmaAssetName = keyof typeof svgSources;

/** Category slug → tile illustration and map symbol. */
export const categoryArt: Record<string, { tile: FigmaAssetName; craving: FigmaAssetName }> = {
  coffee: { tile: 'categoryCoffee', craving: 'cravingCoffee' },
  tea: { tile: 'categoryTea', craving: 'cravingTea' },
  matcha: { tile: 'categoryMatcha', craving: 'cravingMatcha' },
  breakfast: { tile: 'categoryBreakfast', craving: 'cravingBreakfast' },
  bakery: { tile: 'categoryBakery', craving: 'cravingBakery' },
  desserts: { tile: 'categoryDesserts', craving: 'cravingDesserts' },
  healthy: { tile: 'categoryHealthy', craving: 'cravingHealthy' },
};

/**
 * Replace every painted fill/stroke colour with `tint`, like an image tint:
 * hex and named colours alike, keeping "none". (Clip paths ignore colour, and
 * none of these files use masks, so tinting those too is harmless.)
 */
export function tintedXml(name: FigmaAssetName, tint?: string): string {
  const xml = svgSources[name];
  if (!tint) return xml;
  return xml.replace(/(fill|stroke)="(?!none")[^"]+"/g, `$1="${tint}"`);
}

/**
 * One design asset at its design size. Decorative: the control around it
 * carries the accessibility label.
 */
export const FigmaIcon = memo(function FigmaIcon({
  name,
  size,
  width,
  height,
  tint,
  style,
}: {
  name: FigmaAssetName;
  size?: number;
  width?: number;
  height?: number;
  /** Recolour a single-colour line icon. Leave unset for illustrations. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const xml = useMemo(() => tintedXml(name, tint), [name, tint]);
  const w = width ?? size ?? 24;
  const h = height ?? size ?? 24;

  return (
    <View
      style={[{ width: w, height: h }, style]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <SvgXml xml={xml} width={w} height={h} />
    </View>
  );
});

/** The inner markup and viewBox of an asset, for composing patterns. */
export function svgParts(name: FigmaAssetName, tint?: string): { inner: string; viewBox: string } {
  const xml = tintedXml(name, tint);
  const viewBox =
    /viewBox="([^"]+)"/.exec(xml)?.[1] ??
    `0 0 ${/width="([\d.]+)"/.exec(xml)?.[1] ?? 24} ${/height="([\d.]+)"/.exec(xml)?.[1] ?? 24}`;
  const inner = xml.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return { inner, viewBox };
}

/**
 * A wallpaper of one asset as a single SVG drawing (one native view rather
 * than one per icon), so it costs almost nothing to show again.
 */
export function patternXml({
  name,
  tint,
  width,
  height,
  top,
  rowGap,
  colGap,
  size,
  oddOffset,
  rotate,
  opacity,
}: {
  name: FigmaAssetName;
  tint?: string;
  width: number;
  height: number;
  top: number;
  rowGap: number;
  colGap: number;
  size: number;
  oddOffset: number;
  rotate: (row: number, column: number) => number;
  opacity: number;
}): string {
  const { inner, viewBox } = svgParts(name, tint);
  const [, , vbW = 24, vbH = 24] = viewBox.split(/[\s,]+/).map(Number);
  const scale = size / Math.max(vbW, vbH);
  let uses = '';
  for (let row = 0, y = top; y < height; row += 1, y += rowGap) {
    for (let column = 0, x = row % 2 === 0 ? 6 : oddOffset; x < width; column += 1, x += colGap) {
      const angle = rotate(row, column);
      uses += `<use href="#p" transform="translate(${x} ${y}) rotate(${angle} ${size / 2} ${size / 2}) scale(${scale})"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><g id="p">${inner}</g></defs><g opacity="${opacity}">${uses}</g></svg>`;
}
