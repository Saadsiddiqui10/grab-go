import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { successFeedback } from '../../src/lib/feedback';
import { useReferrals } from '../../src/api/hooks';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text, SectionTitle } from '../../src/components/ui/Text';
import { Badge, Card, Divider } from '../../src/components/ui/Surface';
import { ReferralCard } from '../../src/components/LoyaltyComponents';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';
import { formatShortDate } from '../../src/lib/format';

/**
 * Invite friends.
 *
 * The share sheet is the OS one, so a code goes out through WhatsApp — which is
 * how anything actually spreads in Karachi — rather than through a channel the
 * app picked.
 *
 * The list below is honest about status: a friend who signed up but has not
 * ordered yet shows as pending, because that is what the reward rule cares about.
 */
export default function InviteScreen(): React.JSX.Element {
  const theme = useTheme();
  const referrals = useReferrals();
  const [copied, setCopied] = useState(false);

  const share = async (): Promise<void> => {
    if (!referrals.data) return;

    try {
      await Share.share({
        message: referrals.data.shareMessage,
        // iOS shows the URL separately in the sheet; Android folds it into the
        // message, which is why the message already contains it.
        ...(referrals.data.shareUrl ? { url: referrals.data.shareUrl } : {}),
      });
    } catch {
      // The customer dismissed the sheet.
    }
  };

  const copy = async (): Promise<void> => {
    if (!referrals.data) return;
    await Clipboard.setStringAsync(referrals.data.code);
    successFeedback();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (referrals.isLoading) {
    return (
      <ScrollScreen>
        <ListSkeleton rows={3} />
      </ScrollScreen>
    );
  }

  if (referrals.isError || !referrals.data) {
    return <ErrorState onRetry={() => void referrals.refetch()} />;
  }

  return (
    <ScrollScreen contentContainerStyle={{ paddingTop: theme.spacing.base, gap: theme.spacing.xl }}>
      <ReferralCard
        referrals={referrals.data}
        onShare={() => void share()}
        onCopy={() => void copy()}
      />

      {copied ? (
        <Card style={{ backgroundColor: theme.colors.successMuted }}>
          <Text variant="footnote" color="success">
            Code copied to your clipboard.
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle subtitle="How it works">Earn your reward</SectionTitle>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Step
              number={1}
              title="Share your code"
              body="Send it to a friend who has not used Grab & Go before."
            />
            <Step
              number={2}
              title="They order"
              body="Your friend gets a welcome reward on their first order."
            />
            <Step
              number={3}
              title="You both win"
              body={`Once ${referrals.data.requiredForReward} friends have collected their first order, your free coffee is ready.`}
            />
          </View>
        </Card>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle>Your invites</SectionTitle>

        {referrals.data.referrals.length === 0 ? (
          <EmptyState
            compact
            icon="people-outline"
            title="No invites yet"
            body="Share your code and your friends will show up here."
          />
        ) : (
          <Card padded={false}>
            <View style={{ paddingHorizontal: theme.spacing.base }}>
              {referrals.data.referrals.map((referral, index) => (
                <View key={referral.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: theme.spacing.md,
                      gap: theme.spacing.md,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="body">{referral.refereeName}</Text>
                      <Text variant="caption" color="textMuted">
                        Joined {formatShortDate(new Date(referral.signedUpAt))}
                      </Text>
                    </View>

                    <Badge
                      label={
                        referral.status === 'REWARDED'
                          ? 'Rewarded'
                          : referral.status === 'QUALIFIED'
                            ? 'Ordered'
                            : referral.status === 'REJECTED'
                              ? 'Not eligible'
                              : 'Waiting'
                      }
                      tone={
                        referral.status === 'REWARDED' || referral.status === 'QUALIFIED'
                          ? 'success'
                          : referral.status === 'REJECTED'
                            ? 'danger'
                            : 'neutral'
                      }
                    />
                  </View>
                </View>
              ))}
            </View>
          </Card>
        )}
      </View>
    </ScrollScreen>
  );
}

function Step({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.primaryMuted,
        }}
      >
        <Text variant="caption" color="primary">
          {number}
        </Text>
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subhead">{title}</Text>
        <Text variant="footnote" color="textMuted">
          {body}
        </Text>
      </View>
    </View>
  );
}
