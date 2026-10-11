import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  categoryColors,
  defaultCategoryColors,
  discoveryCategories,
  type CategoryColorSet,
} from '@grabgo/config';
import { useTheme } from '../theme';
import { selectionFeedback } from '../lib/feedback';
import { useReducedMotion } from '../lib/motion';
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={[{ gap: 5 }, contentContainerStyle]}
    >
      {leading ?? null}
      {liveCategories.map((item) => (
        <CategoryTile
          key={item.slug}
          slug={item.slug}
          label={item.label}
          selected={selected === item.slug}
          onPress={() => {
            selectionFeedback();
            onChange(selected === item.slug ? null : item.slug);
          }}
        />
      ))}
    </ScrollView>
  );
}

/**
 * One tile, moving the way iOS controls do: it sinks a little under the finger
 * on a spring and springs back, and selection crossfades between the tinted and
 * the solid state (two stacked layers, the solid one faded in) rather than
 * snapping. Everything runs on the native driver, so it stays smooth while the
 * page behind it re-renders for the new category.
 */
const CategoryTile = memo(function CategoryTile({
  slug,
  label,
  selected,
  onPress,
}: {
  slug: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const colours = useCategoryColors()(slug);
  const art = categoryArt[slug];
  const reduceMotion = useReducedMotion();

  const press = useRef(new Animated.Value(1)).current;
  const chosen = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      chosen.setValue(selected ? 1 : 0);
      return;
    }
    const animation = Animated.timing(chosen, {
      toValue: selected ? 1 : 0,
      duration: 220,
      // UIKit's default ease-in-out.
      easing: Easing.bezier(0.42, 0, 0.58, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, chosen, reduceMotion]);

  const springTo = (toValue: number): void => {
    if (reduceMotion) return;
    // Critically damped and quick, like a UIKit button highlight.
    Animated.spring(press, { toValue, speed: 40, bounciness: toValue === 1 ? 6 : 0, useNativeDriver: true }).start();
  };

  const tile = { width: 52, minHeight: 50, paddingVertical: 5, borderRadius: 11 } as const;
  const content = (state: 'idle' | 'selected'): React.JSX.Element => (
    <>
      <View style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}>
        {art ? (
          <FigmaIcon
            name={state === 'selected' ? art.craving : art.tile}
            size={state === 'selected' ? 18 : 21}
            // On espresso the deep illustrations would disappear into their
            // tile, so they take the lifted solid instead. The multi-colour
            // cake keeps its own colours.
            tint={theme.isDark && state === 'idle' && slug !== 'desserts' ? colours.solid : undefined}
          />
        ) : null}
      </View>
      <Text
        variant="caption"
        maxScale={1.3}
        numberOfLines={1}
        style={[
          { fontSize: 9.5, lineHeight: 12, fontWeight: state === 'selected' ? '600' : '500' },
          state === 'selected' ? { color: colours.onSolid } : null,
        ]}
        color="textPrimary"
      >
        {label}
      </Text>
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => springTo(0.92)}
      onPressOut={() => springTo(1)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Animated.View style={{ transform: [{ scale: press }] }}>
        <View
          style={[
            tile,
            { alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: colours.soft },
          ]}
        >
          {content('idle')}
        </View>
        <Animated.View
          pointerEvents="none"
          style={[
            tile,
            {
              position: 'absolute',
              top: 0,
              left: 0,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              backgroundColor: colours.solid,
              opacity: chosen,
            },
          ]}
        >
          {content('selected')}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});
