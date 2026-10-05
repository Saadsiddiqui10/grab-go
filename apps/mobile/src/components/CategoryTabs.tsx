import { FlatList, type StyleProp, type ViewStyle } from 'react-native';
import {
  categoryColors,
  defaultCategoryColors,
  discoveryCategories,
  type CategoryColorSet,
} from '@grabgo/config';
import { useTheme } from '../theme';
import { Chip } from './ui/Surface';
import { AppIcon } from './ui/AppIcon';

const liveCategories = discoveryCategories.filter((entry) => entry.isLive);

/** The colours a category draws with in the current colour scheme. */
export function useCategoryColors(): (slug: string) => CategoryColorSet {
  const theme = useTheme();
  const mode = theme.isDark ? 'dark' : 'light';
  return (slug) => (categoryColors[slug] ?? defaultCategoryColors)[mode];
}

/** The first live category a cafe is tagged with, which decides its pin colour. */
export function primaryCategory(tags: readonly string[]): string | null {
  return liveCategories.find((entry) => tags.includes(entry.slug))?.slug ?? null;
}

/**
 * The horizontally scrolling category tabs: Coffee, Tea, Matcha and the rest,
 * each tinted with its own drink colour. Tapping the selected tab clears it.
 *
 * `leading` renders before the categories, for screen-specific toggles such
 * as "Open now" on Discover.
 */
export function CategoryTabs({
  selected,
  onChange,
  leading,
  style,
  contentContainerStyle,
}: {
  selected: string | null;
  onChange: (slug: string | null) => void;
  leading?: React.ReactElement;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const theme = useTheme();
  const coloursFor = useCategoryColors();

  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={liveCategories}
      keyExtractor={(entry) => entry.slug}
      style={style}
      contentContainerStyle={[{ gap: theme.spacing.sm }, contentContainerStyle]}
      ListHeaderComponent={leading ?? null}
      ListHeaderComponentStyle={leading ? { marginRight: theme.spacing.sm } : undefined}
      renderItem={({ item }) => (
        <Chip
          label={item.label}
          colors={coloursFor(item.slug)}
          icon={(color) => <AppIcon name={item.icon} size={15} color={color} />}
          selected={selected === item.slug}
          onPress={() => onChange(selected === item.slug ? null : item.slug)}
        />
      )}
    />
  );
}
