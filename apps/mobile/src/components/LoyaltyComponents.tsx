import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PointsAccountSummary, ReferralProgress, Reward, RewardRedemption } from '@grabgo/types';
import { useTheme } from '../theme';
import { formatPKR, formatPoints, formatShortDate } from '../lib/format';
import { Text } from './ui/Text';
import { Badge, Card, Divider, ProgressBar } from './ui/Surface';
import { Button } from './ui/Button';

/**
 * Loyalty and referral surfaces.
 *
 * The points card leads with the number the customer cares about and the gap to
 * the next reward — "52 points until your next reward" is more motivating than a
 * balance on its own.
 */

export function PointsCard({
  summary,
  onViewRewards,
}: {
  summary: PointsAccountSummary;
  onViewRewards?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const hasNext = summary.nextReward !== null;

  return (
    <Card elevation="md" style={{ backgroundColor: theme.colors.surfaceInverse }}>
      <View style={{ gap: theme.spacing.base }}>
        <View style={styles.spread}>
          <Text variant="overline" style={{ color: theme.colors.textInverse, opacity: 0.7 }}>
            YOUR GRAB POINTS
          </Text>
          <Ionicons name="sparkles" size={16} color={theme.palette.ember[400]} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text variant="display" style={{ color: theme.colors.textInverse }}>
            {formatPoints(summary.balance)}
          </Text>
          {hasNext ? (
            <Text variant="title3" style={{ color: theme.colors.textInverse, opacity: 0.5 }}>
              / {formatPoints(summary.nextReward?.pointsRequired ?? 0)}
            </Text>
          ) : null}
        </View>

        {hasNext ? (
          <>
            <ProgressBar
              progress={summary.progressToNextReward}
              label={`${summary.pointsToNextReward ?? 0} points to your next reward`}
            />
            <Text variant="footnote" style={{ color: theme.colors.textInverse, opacity: 0.8 }}>
              {summary.pointsToNextReward} points until {summary.nextReward?.name}
            </Text>
          </>
        ) : (
          <Text variant="footnote" style={{ color: theme.colors.textInverse, opacity: 0.8 }}>
            Every reward unlocked. Keep ordering to earn more.
          </Text>
        )}

        {onViewRewards ? (
          <Button
            label="View rewards"
            variant="primary"
            size="sm"
            icon="gift-outline"
            onPress={onViewRewards}
          />
        ) : null}
      </View>
    </Card>
  );
}

export function RewardCard({
  reward,
  balance,
  onRedeem,
  redeeming,
}: {
  reward: Reward;
  balance: number;
  onRedeem: () => void;
  redeeming?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const shortfall = Math.max(0, reward.pointsRequired - balance);

  return (
    <Card>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: theme.radii.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: reward.isUnlocked
                ? theme.colors.primaryMuted
                : theme.colors.surfaceMuted,
            }}
          >
            <Ionicons
              name={reward.type === 'FREE_ITEM' ? 'cafe' : 'pricetag'}
              size={20}
              color={reward.isUnlocked ? theme.colors.primary : theme.colors.textMuted}
            />
          </View>

          <View style={{ flex: 1, gap: 3 }}>
            <Text variant="bodyStrong">{reward.name}</Text>
            {reward.description ? (
              <Text variant="footnote" color="textMuted">
                {reward.description}
              </Text>
            ) : null}
            {reward.businessName ? (
              <Text variant="caption" color="textMuted">
                Only at {reward.businessName}
              </Text>
            ) : null}
          </View>

          <Badge
            label={`${formatPoints(reward.pointsRequired)} pts`}
            tone={reward.isUnlocked ? 'primary' : 'neutral'}
          />
        </View>

        {reward.isUnlocked ? (
          <Button
            label="Redeem"
            size="sm"
            onPress={onRedeem}
            loading={redeeming}
            icon="gift-outline"
          />
        ) : (
          <View style={{ gap: 6 }}>
            <ProgressBar progress={balance / Math.max(1, reward.pointsRequired)} />
            <Text variant="caption" color="textMuted">
              {formatPoints(shortfall)} more points to unlock
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

/** A reward the customer has already redeemed and can spend at checkout. */
export function RedemptionCard({
  redemption,
}: {
  redemption: RewardRedemption;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Card>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={styles.spread}>
          <Text variant="bodyStrong">{redemption.rewardName}</Text>
          <Badge label="Ready to use" tone="success" dot />
        </View>

        <Text variant="footnote" color="textMuted">
          Apply this at checkout. Code {redemption.code}
          {redemption.expiresAt
            ? ` · expires ${formatShortDate(new Date(redemption.expiresAt))}`
            : ''}
        </Text>
      </View>
    </Card>
  );
}

export function ReferralCard({
  referrals,
  onShare,
  onCopy,
}: {
  referrals: ReferralProgress;
  onShare: () => void;
  onCopy: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  const threshold = Math.max(1, referrals.requiredForReward);
  const within = referrals.qualifiedCount % threshold;
  const remaining = threshold - within;

  return (
    <Card elevation="md">
      <View style={{ gap: theme.spacing.base }}>
        <View style={{ gap: 4 }}>
          <Text variant="title3">Invite friends, earn coffee</Text>
          <Text variant="footnote" color="textMuted">
            When {referrals.requiredForReward} friends order for the first time, your reward is
            ready. They get a welcome reward too.
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: theme.spacing.md,
            borderRadius: theme.radii.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.borderStrong,
            backgroundColor: theme.colors.primarySubtle,
          }}
        >
          <Text
            variant="title2"
            accessibilityLabel={`Your referral code is ${referrals.code.split('').join(' ')}`}
          >
            {referrals.code}
          </Text>
          <Button label="Copy" variant="ghost" size="sm" icon="copy-outline" onPress={onCopy} />
        </View>

        <ProgressBar progress={within / threshold} tone="success" />

        <Text variant="footnote" color="textSecondary">
          {referrals.qualifiedCount > 0 && within === 0
            ? 'Your reward is ready. Invite more friends to earn another.'
            : `${remaining} more ${remaining === 1 ? 'friend' : 'friends'} until your free coffee.`}
        </Text>

        <View style={styles.stats}>
          <Stat label="Invited" value={referrals.pendingCount + referrals.qualifiedCount} />
          <Divider />
          <Stat label="Ordered" value={referrals.qualifiedCount} />
          <Divider />
          <Stat label="Rewards" value={referrals.rewardedCount} />
        </View>

        <Button label="Share your code" icon="share-social-outline" onPress={onShare} fullWidth />
      </View>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text variant="title3">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );
}

/** One row in the points ledger. */
export function PointsRow({
  amount,
  description,
  createdAt,
}: {
  amount: number;
  description: string;
  createdAt: string;
}): React.JSX.Element {
  const theme = useTheme();
  const positive = amount > 0;

  return (
    <View style={[styles.spread, { paddingVertical: theme.spacing.md }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" numberOfLines={1}>
          {description}
        </Text>
        <Text variant="caption" color="textMuted">
          {formatShortDate(new Date(createdAt))}
        </Text>
      </View>

      <Text variant="bodyStrong" color={positive ? 'success' : 'textSecondary'}>
        {positive ? '+' : ''}
        {formatPoints(amount)}
      </Text>
    </View>
  );
}

/** Compact reward selector shown at checkout. */
export function RedemptionPicker({
  redemptions,
  selectedId,
  onSelect,
}: {
  redemptions: RewardRedemption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (redemptions.length === 0) return null;

  return (
    <Card padded={false}>
      {redemptions.map((redemption, index) => {
        const selected = redemption.id === selectedId;

        return (
          <View key={redemption.id}>
            {index > 0 ? <Divider inset={theme.spacing.base} /> : null}
            <View style={{ paddingHorizontal: theme.spacing.base }}>
              <View style={[styles.spread, { paddingVertical: theme.spacing.md }]}>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? theme.colors.primary : theme.colors.textMuted}
                  onPress={() => onSelect(selected ? null : redemption.id)}
                />
                <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                  <Text variant="body">{redemption.rewardName}</Text>
                  <Text variant="caption" color="textMuted">
                    Code {redemption.code}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export function PromoSummary({ code, discount }: { code: string; discount: number }): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.successMuted,
      }}
    >
      <Ionicons name="pricetag" size={16} color={theme.colors.success} />
      <Text variant="subhead" color="success" style={{ flex: 1 }}>
        {code} applied
      </Text>
      <Text variant="subhead" color="success">
        -{formatPKR(discount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
