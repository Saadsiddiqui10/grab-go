import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import {
  useMyRewards,
  usePoints,
  useReferrals,
  useRedeemReward,
  useRewards,
} from '../../src/api/hooks';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text, SectionTitle } from '../../src/components/ui/Text';
import type { Reward } from '@grabgo/types';
import {
  CafeLogo,
  CafePointsCard,
  PointsCard,
  RedemptionCard,
  RewardCard,
} from '../../src/components/LoyaltyComponents';
import { formatPoints } from '../../src/lib/format';
import { Card, Divider } from '../../src/components/ui/Surface';
import { Button } from '../../src/components/ui/Button';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { ApiError } from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';
import { withTabTransition } from '../../src/components/ui/TabTransition';

/**
 * Rewards.
 *
 * Every cafe runs its own loyalty card and decides its own rewards. The screen
 * leads with the total, then what can be used now, then one group per cafe the
 * customer has a card at (its balance and its ladder), then the cafes they
 * could start earning at. Redeeming spends that cafe's points and issues a code
 * for an order there.
 */
function RewardsScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  const points = usePoints();
  const rewards = useRewards();
  const myRewards = useMyRewards();
  const referrals = useReferrals();
  const redeem = useRedeemReward();

  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) {
    return (
      <SignInPrompt
        icon="gift-outline"
        title="Earn Grab Points on every order"
        body="Collect points as you order, unlock free coffee, and invite friends to earn more."
      />
    );
  }

  const onRedeem = (reward: Reward): void => {
    setRedeemingId(reward.id);
    setError(null);

    redeem.mutate(
      { rewardId: reward.id, businessId: reward.businessId },
      {
        onSuccess: () => {
          successFeedback();
          setRedeemingId(null);
        },
        onError: (mutationError) => {
          errorFeedback();
          setRedeemingId(null);
          setError(
            mutationError instanceof ApiError
              ? mutationError.displayMessage
              : 'That reward could not be redeemed. Please try again.',
          );
        },
      },
    );
  };

  return (
    <ScrollScreen
      footerSpace={Platform.OS === 'ios' ? 50 : 0}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.sm }}
    >
      <Text
        variant="title1"
        color="heading"
        style={{ fontSize: 27, lineHeight: 33, marginBottom: theme.spacing.base }}
      >
        Rewards
      </Text>

      {points.isLoading ? (
        <ListSkeleton rows={2} />
      ) : points.isError ? (
        <ErrorState compact onRetry={() => void points.refetch()} />
      ) : points.data ? (
        <PointsCard summary={points.data} />
      ) : null}

      {error ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
            <Text variant="footnote" color="danger">
              {error}
            </Text>
          </Card>
        </View>
      ) : null}

      {/* ------------------------------------------------- ready to use */}
      {myRewards.data && myRewards.data.length > 0 ? (
        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
          <SectionTitle subtitle="Apply these at checkout">Ready to use</SectionTitle>
          {myRewards.data.map((redemption) => (
            <RedemptionCard key={redemption.id} redemption={redemption} />
          ))}
        </View>
      ) : null}

      {/* ------------------------------------------- one group per card */}
      {rewards.isLoading || points.isLoading ? (
        <View style={{ marginTop: theme.spacing.base }}>
          <ListSkeleton rows={3} />
        </View>
      ) : rewards.isError ? (
        <View style={{ marginTop: theme.spacing.base }}>
          <ErrorState compact onRetry={() => void rewards.refetch()} />
        </View>
      ) : (
        <>
          {(points.data?.cafes ?? []).map((cafe) => {
            const ladder = (rewards.data ?? []).filter((reward) => reward.businessId === cafe.businessId);

            return (
              <View key={cafe.businessId} style={{ marginTop: theme.spacing.xl, gap: 12 }}>
                <CafePointsCard cafe={cafe} onPress={() => router.push(`/cafe/${cafe.businessId}`)} />
                {ladder.map((reward) => (
                  <RewardCard
                    key={reward.id}
                    reward={reward}
                    balance={cafe.balance}
                    hideCafe
                    redeeming={redeemingId === reward.id}
                    onRedeem={() => onRedeem(reward)}
                  />
                ))}
              </View>
            );
          })}

          <OtherCafes
            rewards={(rewards.data ?? []).filter(
              (reward) => !points.data?.cafes.some((cafe) => cafe.businessId === reward.businessId),
            )}
            hasCards={(points.data?.cafes.length ?? 0) > 0}
            onOpen={(businessId) => router.push(`/cafe/${businessId}`)}
          />
        </>
      )}

      {/* --------------------------------------------------- referrals */}
      <View style={{ marginTop: theme.spacing.xl }}>
        <Card onPress={() => router.push('/profile/invite')} accessibilityLabel="Invite friends">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radii.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.primaryMuted,
              }}
            >
              <Ionicons name="people" size={22} color={theme.colors.primary} />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Invite friends, earn coffee</Text>
              <Text variant="footnote" color="textMuted">
                {referrals.data
                  ? `${referrals.data.qualifiedCount} of ${referrals.data.requiredForReward} friends have ordered`
                  : 'Share your code and you both get a reward.'}
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
        </Card>
      </View>

      <View style={{ marginTop: theme.spacing.lg }}>
        <Button
          label="View points history"
          variant="ghost"
          icon="time-outline"
          onPress={() => router.push('/profile/points')}
        />
      </View>
    </ScrollScreen>
  );
}

/**
 * Cafes the customer has no card at yet: one row each with the cheapest reward,
 * since a full ladder for every cafe would bury the cards they do hold.
 */
function OtherCafes({
  rewards,
  hasCards,
  onOpen,
}: {
  rewards: Reward[];
  hasCards: boolean;
  onOpen: (businessId: string) => void;
}): React.JSX.Element {
  const theme = useTheme();

  const cafes = new Map<string, { name: string; cheapest: Reward; count: number }>();
  for (const reward of rewards) {
    const entry = cafes.get(reward.businessId);
    if (!entry) cafes.set(reward.businessId, { name: reward.businessName, cheapest: reward, count: 1 });
    else {
      entry.count += 1;
      if (reward.pointsRequired < entry.cheapest.pointsRequired) entry.cheapest = reward;
    }
  }

  if (cafes.size === 0) {
    return hasCards ? (
      <View />
    ) : (
      <View style={{ marginTop: theme.spacing.xl }}>
        <EmptyState
          compact
          icon="gift-outline"
          title="No rewards yet"
          body="Cafes set their own rewards. Check back soon."
        />
      </View>
    );
  }

  return (
    <View style={{ marginTop: theme.spacing.xl, gap: 12 }}>
      <SectionTitle subtitle="Every cafe runs its own card. Order to start earning there.">
        {hasCards ? 'Start earning at more cafes' : 'Start earning'}
      </SectionTitle>
      <Card padded={false}>
        {[...cafes.entries()].map(([businessId, cafe], index) => (
          <View key={businessId}>
            {index > 0 ? <Divider inset={68} /> : null}
            <Pressable
              onPress={() => onOpen(businessId)}
              accessibilityRole="button"
              accessibilityLabel={`${cafe.name}, ${cafe.count} rewards`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: theme.spacing.md }}
            >
              <CafeLogo name={cafe.name} uri={null} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {cafe.name}
                </Text>
                <Text variant="footnote" color="textMuted" numberOfLines={1}>
                  {cafe.cheapest.name} at {formatPoints(cafe.cheapest.pointsRequired)} pts
                  {cafe.count > 1 ? ` · ${cafe.count} rewards` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default withTabTransition(RewardsScreen);
