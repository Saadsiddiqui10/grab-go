import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';

/**
 * Semantic icons.
 *
 * Screens name what an icon means ("coffee", "map"); this file decides how each
 * platform draws it: an SF Symbol on iOS, an Ionicon elsewhere. Adding a
 * Material mapping for Android later only touches this table.
 */
const icons = {
  coffee: { ios: 'cup.and.saucer.fill', fallback: 'cafe' },
  tea: { ios: 'mug.fill', fallback: 'cafe-outline' },
  matcha: { ios: 'leaf.fill', fallback: 'leaf' },
  breakfast: { ios: 'frying.pan.fill', fallback: 'egg' },
  bakery: { ios: 'basket.fill', fallback: 'basket' },
  desserts: { ios: 'birthday.cake.fill', fallback: 'ice-cream' },
  healthy: { ios: 'carrot.fill', fallback: 'nutrition' },
  'bubble-tea': { ios: 'takeoutbag.and.cup.and.straw.fill', fallback: 'wine' },
  'fast-food': { ios: 'fork.knife', fallback: 'fast-food' },
  pizza: { ios: 'fork.knife', fallback: 'pizza' },
  restaurants: { ios: 'fork.knife', fallback: 'restaurant' },
  map: { ios: 'map', fallback: 'map-outline' },
  person: { ios: 'person.fill', fallback: 'person' },
} as const satisfies Record<string, { ios: SFSymbol; fallback: keyof typeof Ionicons.glyphMap }>;

export type AppIconName = keyof typeof icons;

/**
 * Decorative by default: the control around it carries the accessibility
 * label, so VoiceOver reads "Coffee, button" rather than the symbol name.
 */
export function AppIcon({
  name,
  size = 18,
  color,
}: {
  name: AppIconName;
  size?: number;
  color: string;
}): React.JSX.Element {
  const icon = icons[name];
  const fallback = <Ionicons name={icon.fallback} size={size} color={color} />;

  if (Platform.OS !== 'ios') return fallback;

  return (
    <SymbolView
      name={icon.ios}
      size={size}
      tintColor={color}
      type="monochrome"
      fallback={fallback}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
