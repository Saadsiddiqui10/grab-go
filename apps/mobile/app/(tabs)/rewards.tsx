import { useState } from 'react';
import { Platform, View } from 'react-native';
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
import {
  PointsCard,
  RedemptionCard,
  RewardCard,
} from '../../src/components/LoyaltyComponents';
import { Card } from '../../src/components/ui/Surface';
import { Button } from '../../src/components/ui/Button';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { ApiError } from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';

/**
 * Rewards.
 *
 * Leads with the balance and the distance to the next reward, then what can be
 * redeemed now, then the ladder above it. Redeeming issues a code the customer
 * owns and can spend on any qualifying order.
 */
export default function RewardsScreen(): React.JSX.Element {
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

  const onRedeem = (rewardId: string): void => {
    setRedeemingId(rewardId);
    setError(null);

    redeem.mutate(
      { rewardId },
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
      <Text variant="title2" style={{ marginBottom: theme.spacing.base }}>
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

      {/* ------------------------------------------------------ ladder */}
      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
        <SectionTitle>All rewards</SectionTitle>

        {rewards.isLoading ? (
          <ListSkeleton rows={3} />
        ) : rewards.isError ? (
          <ErrorState compact onRetry={() => void rewards.refetch()} />
        ) : (rewards.data?.length ?? 0) === 0 ? (
          <EmptyState
            compact
            icon="gift-outline"
            title="No rewards yet"
            body="Earn Grab Points on every order and unlock rewards."
          />
        ) : (
          rewards.data?.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              balance={points.data?.balance ?? 0}
              redeeming={redeemingId === reward.id}
              onRedeem={() => onRedeem(reward.id)}
            />
          ))
        )}
      </View>

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
