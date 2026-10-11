import { useState } from 'react';
import { Pressable, View, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSummary } from '@grabgo/types';
import type { CategoryColorSet } from '@grabgo/config';
import type { BreakfastSkin } from '../design/breakfast';
import { hasPour, POUR_GLAZE_DEPTH, POUR_HEADROOM, PourTopper } from '../design/PourTopper';
import { useTheme } from '../theme';
import { formatDistance, formatPrepTime } from '../lib/format';
import { Text } from './ui/Text';
import { Badge, Card } from './ui/Surface';
import { FigmaIcon } from '../design/assets';
import { tapFeedback } from '../lib/feedback';

/**
 * A cafe, as it appears in a list.
 *
 * The card answers the only four questions that decide whether someone taps it:
 * is it open, how far, how long, and is it any good. Everything else is detail
 * for the cafe page.
 */

/**
 * A cafe's photo, or a quiet themed placeholder when it has none. A fixed
 * blurhash used to stand in for every missing photo, but it is light beige, so
 * in dark mode it read as a row of glaring blank cards.
 */
export function CafeImage({
  uri,
  style,
  iconSize = 24,
  background,
  cupTint,
}: {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  iconSize?: number;
  /** Fill behind the placeholder cup. Defaults to the muted surface. */
  background?: string;
  /** Recolour the placeholder cup (a themed category look). */
  cupTint?: string;
}): React.JSX.Element {
  const theme = useTheme();
  const fill = { backgroundColor: background ?? theme.colors.surfaceMuted };

  if (!uri) {
    return (
      <View style={[style as StyleProp<ViewStyle>, fill, styles.placeholder]}>
        <FigmaIcon
          name="cafePreview"
          size={iconSize}
          // The cup is espresso brown; on a dark page it takes the heading
          // colour so it stays visible.
          tint={cupTint ?? (theme.isDark ? theme.colors.heading : undefined)}
        />
      </View>
    );
  }

  return (
    <Image source={{ uri }} contentFit="cover" transition={200} style={[style, fill]} accessible={false} />
  );
}

export interface CafeCardProps {
  cafe: BusinessSummary;
  onPress: () => void;
  onToggleFavourite?: () => void;
  isFavourite?: boolean;
  layout?: 'wide' | 'rail';
  /**
   * A selected category's colours. The card then switches from the espresso
   * card to a light one in that category's ink, matching the themed home.
   */
  tint?: CategoryColorSet | null;
  /** A full category look (Breakfast) that overrides `tint`. */
  skin?: BreakfastSkin | null;
  /** A category slug: that drink pours onto the top of the card. */
  pour?: string | null;
}

/**
 * The cafe card from the redesign: a photo (or a cup on the page colour), a
 * maroon save button, and an espresso details panel with the name, rating,
 * area and pickup time.
 */
export function CafeCard({
  cafe,
  onPress,
  onToggleFavourite,
  isFavourite,
  layout = 'wide',
  tint = null,
  skin = null,
  pour = null,
}: CafeCardProps): React.JSX.Element {
  const theme = useTheme();
  // Start from the expected width (rail cards are fixed; wide cards span the
  // screen less its margins) so the pour draws in the first frame.
  const window = useWindowDimensions();
  const [width, setWidth] = useState(layout === 'rail' ? 264 : Math.round(window.width - 32));
  const isRail = layout === 'rail';

  const closed = !cafe.isOpenNow;
  const paused = cafe.isOpenNow && !cafe.acceptingOrders;

  // Default: espresso card. Tinted: light card in the category's ink.
  const panel = skin?.card ?? (tint ? theme.colors.surface : theme.colors.brand);
  const title = skin?.text ?? (tint ? tint.ink : theme.colors.onBrand);
  const detail = skin?.muted ?? (tint ? theme.colors.textSecondary : theme.colors.onBrandMuted);

  const card = (
    <Card
      onPress={onPress}
      padded={false}
      elevation={tint || skin ? 'sm' : 'none'}
      style={isRail ? { width: 264 } : undefined}
      surfaceStyle={{ backgroundColor: panel, borderRadius: skin ? 20 : 18, borderWidth: 0 }}
      accessibilityLabel={`${cafe.name}${cafe.areaName ? `, ${cafe.areaName}` : ''}. ${
        closed ? 'Closed' : `Open, ready in about ${cafe.prepTimeMinutes} minutes`
      }${cafe.rating ? `, rated ${cafe.rating} out of 5` : ''}`}
    >
      <View>
        <CafeImage
          uri={cafe.coverImageUrl}
          style={[styles.cover, { height: isRail ? 116 : 140 }]}
          background={skin?.media ?? (tint ? tint.soft : theme.colors.background)}
          cupTint={skin?.cup ?? tint?.ink}
        />

        {/* A closed or paused cafe stays browsable: the photo dims, and the
            status row below says why (once, not twice). */}
        {closed || paused ? (
          <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }]} />
        ) : null}

        {onToggleFavourite ? (
          <Pressable
            onPress={() => {
              tapFeedback();
              onToggleFavourite();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isFavourite ? `Remove ${cafe.name} from favourites` : `Save ${cafe.name} to favourites`
            }
            accessibilityState={{ selected: Boolean(isFavourite) }}
            hitSlop={4}
            style={({ pressed }) => [
              styles.favourite,
              // Drop below the poured glaze so the drink never covers it.
              hasPour(pour) ? { top: POUR_GLAZE_DEPTH + 6 } : null,
              {
                // The save button takes the selected category's colour, so a
                // matcha page is not dotted with maroon.
                backgroundColor: skin?.saveButton ?? tint?.solid ?? theme.colors.accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {isFavourite ? (
              <Ionicons name="heart" size={20} color={skin?.saveIcon ?? tint?.onSolid ?? '#FFFFFF'} />
            ) : (
              <FigmaIcon name="heart" size={20} tint={skin?.saveIcon ?? tint?.onSolid ?? '#FFFFFF'} />
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={{ padding: 12, gap: 7 }}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, color: title }}>
            {cafe.name}
          </Text>
          {cafe.rating !== null ? (
            <View style={styles.rating}>
              <Text style={{ color: skin?.accent ?? '#EDA315', fontSize: 15, lineHeight: 18 }} maxScale={1.3}>
                ★
              </Text>
              <Text variant="caption" style={{ color: title, fontWeight: '400' }}>
                {cafe.rating.toFixed(1)}
              </Text>
            </View>
          ) : null}
        </View>

        {cafe.areaName || cafe.distanceMeters !== null ? (
          <Text variant="footnote" numberOfLines={1} style={{ color: detail }}>
            {[cafe.areaName, cafe.distanceMeters !== null ? formatDistance(cafe.distanceMeters) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {paused ? (
            <Badge label="Not taking orders" tone="neutral" dot />
          ) : cafe.isOpenNow ? (
            <Badge
              label={
                cafe.busyUntilMinutes
                  ? `Busy · ${formatPrepTime(cafe.prepTimeMinutes)}`
                  : `Ready in ${formatPrepTime(cafe.prepTimeMinutes)}`
              }
              tone={cafe.busyUntilMinutes ? 'warning' : 'success'}
              dot
            />
          ) : (
            <Badge label="Closed" tone="neutral" dot />
          )}
        </View>

        {cafe.popularItems.length > 0 && !isRail ? (
          <Text style={{ color: detail, fontSize: 11, lineHeight: 14 }} numberOfLines={1}>
            Popular: {cafe.popularItems.join(' · ')}
          </Text>
        ) : null}
      </View>
    </Card>
  );

  if (!hasPour(pour)) return card;

  return (
    <View
      style={[{ paddingTop: POUR_HEADROOM }, isRail ? { width: 264 } : null]}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {card}
      <PourTopper slug={pour} width={width} seed={cafe.id} />
    </View>
  );
}

export function CafeCardCompact({
  cafe,
  onPress,
}: {
  cafe: BusinessSummary;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={cafe.name}>
      <View style={{ flexDirection: 'row', padding: theme.spacing.md, gap: theme.spacing.md }}>
        <CafeImage
          uri={cafe.logoUrl}
          iconSize={20}
          style={{ width: 56, height: 56, borderRadius: theme.radii.md, overflow: 'hidden' }}
        />

        <View style={{ flex: 1, justifyContent: 'center', gap: 3 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {cafe.name}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {[cafe.areaName, formatDistance(cafe.distanceMeters)].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={{ justifyContent: 'center' }}>
          <Badge
            label={cafe.isOpenNow ? formatPrepTime(cafe.prepTimeMinutes) : 'Closed'}
            tone={cafe.isOpenNow ? 'success' : 'neutral'}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cover: {
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favourite: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
