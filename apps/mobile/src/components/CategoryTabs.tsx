import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  categoryColors,
  defaultCategoryColors,
  discoveryCategories,
  type CategoryColorSet,
} from '@grabgo/config';
import { useTheme } from '../theme';
import { selectionFeedback } from '../lib/feedback';
import { categoryArt, FigmaIcon } from '../design/assets';
import { Text } from './ui/Text';

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
 * The category strip from the redesign: square tiles, each tinted with its
 * drink or food colour and carrying its illustration. The selected tile fills
 * with the category's solid colour and switches to the map symbol drawn for
 * that background. Tapping the selected tile clears it.
 *
 * `leading` renders before the tiles, for screen-specific toggles.
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={[{ gap: 5 }, contentContainerStyle]}
    >
      {leading ?? null}
      {liveCategories.map((item) => {
        const isSelected = selected === item.slug;
        const colours = coloursFor(item.slug);
        const art = categoryArt[item.slug];

        return (
          <Pressable
            key={item.slug}
            onPress={() => {
              selectionFeedback();
              onChange(isSelected ? null : item.slug);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => ({
              width: 52,
              minHeight: 50,
              paddingVertical: 5,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              backgroundColor: isSelected ? colours.solid : colours.soft,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}>
              {art ? (
                <FigmaIcon
                  name={isSelected ? art.craving : art.tile}
                  size={isSelected ? 18 : 21}
                  // On espresso the deep illustrations would disappear into
                  // their tile, so they take the lifted solid instead. The
                  // multi-colour cake keeps its own colours.
                  tint={theme.isDark && !isSelected && item.slug !== 'desserts' ? colours.solid : undefined}
                />
              ) : null}
            </View>
            <Text
              variant="caption"
              maxScale={1.3}
              numberOfLines={1}
              style={[
                { fontSize: 9.5, lineHeight: 12, fontWeight: isSelected ? '600' : '500' },
                isSelected ? { color: colours.onSolid } : null,
              ]}
              color="textPrimary"
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
