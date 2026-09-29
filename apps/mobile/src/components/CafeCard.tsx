import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSummary } from '@grabgo/types';
import { useTheme } from '../theme';
import { formatDistance, formatPrepTime } from '../lib/format';
import { Text } from './ui/Text';
import { Badge, Card } from './ui/Surface';
import { IconButton } from './ui/Button';

/**
 * A cafe, as it appears in a list.
 *
 * The card answers the only four questions that decide whether someone taps it:
 * is it open, how far, how long, and is it any good. Everything else is detail
 * for the cafe page.
 */

const BLUR_PLACEHOLDER = 'L6Pj0^i_.AyE_3t7t7R**0o#DgR4';

export interface CafeCardProps {
  cafe: BusinessSummary;
  onPress: () => void;
  onToggleFavourite?: () => void;
  isFavourite?: boolean;
  layout?: 'wide' | 'rail';
}

export function CafeCard({
  cafe,
  onPress,
  onToggleFavourite,
  isFavourite,
  layout = 'wide',
}: CafeCardProps): React.JSX.Element {
  const theme = useTheme();
  const isRail = layout === 'rail';

  const closed = !cafe.isOpenNow;
  const paused = cafe.isOpenNow && !cafe.acceptingOrders;

  return (
    <Card
      onPress={onPress}
      padded={false}
      style={isRail ? { width: 260 } : undefined}
      accessibilityLabel={`${cafe.name}${cafe.areaName ? `, ${cafe.areaName}` : ''}. ${
        closed ? 'Closed' : `Open, ready in about ${cafe.prepTimeMinutes} minutes`
      }${cafe.rating ? `, rated ${cafe.rating} out of 5` : ''}`}
    >
      <View>
        <Image
          source={cafe.coverImageUrl ? { uri: cafe.coverImageUrl } : undefined}
          placeholder={{ blurhash: BLUR_PLACEHOLDER }}
          contentFit="cover"
          transition={200}
          style={[styles.cover, { height: isRail ? 140 : 160 }]}
          accessible={false}
        />

        {/* A closed cafe stays browsable, but the card says so plainly. */}
        {closed || paused ? (
          <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}>
            <Badge
              label={closed ? 'Closed' : 'Not taking orders'}
              tone="neutral"
            />
          </View>
        ) : null}

        {onToggleFavourite ? (
          <View style={styles.favourite}>
            <IconButton
              icon={isFavourite ? 'heart' : 'heart-outline'}
              label={isFavourite ? `Remove ${cafe.name} from favourites` : `Save ${cafe.name} to favourites`}
              onPress={onToggleFavourite}
              tone={isFavourite ? 'danger' : 'textOnPrimary'}
              size={20}
              background="rgba(0,0,0,0.35)"
            />
          </View>
        ) : null}
      </View>

      <View style={{ padding: theme.spacing.md, gap: 6 }}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {cafe.name}
          </Text>
          {cafe.rating !== null ? (
            <View style={styles.rating}>
              <Ionicons name="star" size={13} color={theme.colors.warning} />
              <Text variant="caption" color="textSecondary">
                {cafe.rating.toFixed(1)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          {cafe.areaName ? (
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {cafe.areaName}
            </Text>
          ) : null}
          {cafe.distanceMeters !== null ? (
            <>
              <Dot />
              <Text variant="footnote" color="textMuted">
                {formatDistance(cafe.distanceMeters)}
              </Text>
            </>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          {cafe.isOpenNow ? (
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
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            Popular: {cafe.popularItems.join(' · ')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function Dot(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 3,
        height: 3,
        borderRadius: 2,
        backgroundColor: theme.colors.textMuted,
      }}
    />
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
        <Image
          source={cafe.logoUrl ? { uri: cafe.logoUrl } : undefined}
          placeholder={{ blurhash: BLUR_PLACEHOLDER }}
          contentFit="cover"
          style={{ width: 56, height: 56, borderRadius: theme.radii.md }}
          accessible={false}
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
    backgroundColor: '#E2D8CF',
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
