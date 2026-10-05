import { Alert, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { BRAND } from '@grabgo/config';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { usePoints } from '../../src/api/hooks';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Card, Divider, ListRow } from '../../src/components/ui/Surface';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { formatPoints } from '../../src/lib/format';
import { AppIcon } from '../../src/components/ui/AppIcon';

/**
 * Profile.
 *
 * Account, loyalty, preferences and the legal links, grouped so the destructive
 * actions sit apart from everything else and cannot be hit by accident.
 */
export default function ProfileScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const signOut = useAuthStore((state) => state.signOut);
  const points = usePoints();

  if (!isAuthenticated || !user) {
    return (
      <SignInPrompt
        title="Your Grab & Go account"
        body="Sign in to track orders, collect Grab Points and invite friends."
      />
    );
  }

  const confirmSignOut = (): void => {
    Alert.alert('Sign out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void signOut(),
      },
    ]);
  };

  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <ScrollScreen
      footerSpace={Platform.OS === 'ios' ? 50 : 0}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.sm }}
    >
      {/* --------------------------------------------------------- header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.base,
          marginBottom: theme.spacing.lg,
        }}
      >
        {user.avatarUrl ? (
          <Image
            source={{ uri: user.avatarUrl }}
            style={{ width: 64, height: 64, borderRadius: 32 }}
            contentFit="cover"
            accessible={false}
          />
        ) : (
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.primaryMuted,
            }}
          >
            {initials ? (
              <Text variant="title2" color="primary">
                {initials}
              </Text>
            ) : (
              <AppIcon name="person" size={28} color={theme.colors.primary} />
            )}
          </View>
        )}

        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3" numberOfLines={1}>
            {user.fullName}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {user.phone ?? user.email ?? 'Grab & Go customer'}
          </Text>
        </View>
      </View>

      {/* --------------------------------------------------------- points */}
      <Card onPress={() => router.push('/profile/points')} accessibilityLabel="Grab Points">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text variant="overline" color="textMuted">
              GRAB POINTS
            </Text>
            <Text variant="title2">{formatPoints(points.data?.balance ?? 0)}</Text>
          </View>
          {points.data?.pointsToNextReward ? (
            <Text variant="footnote" color="textMuted" style={{ maxWidth: 150 }} align="right">
              {points.data.pointsToNextReward} points until your next reward
            </Text>
          ) : null}
        </View>
      </Card>

      {/* -------------------------------------------------------- account */}
      <Group title="Account">
        <ListRow
          icon="person-outline"
          title="Personal details"
          subtitle="Name, phone and email"
          onPress={() => router.push('/profile/account')}
        />
        <Divider inset={44} />
        <ListRow
          icon="receipt-outline"
          title="Order history"
          onPress={() => router.push('/(tabs)/orders')}
        />
        <Divider inset={44} />
        <ListRow
          icon="heart-outline"
          title="Favourite cafes"
          onPress={() => router.push('/(tabs)/discover')}
        />
      </Group>

      {/* -------------------------------------------------------- loyalty */}
      <Group title="Rewards">
        <ListRow
          icon="gift-outline"
          title="Rewards"
          onPress={() => router.push('/(tabs)/rewards')}
        />
        <Divider inset={44} />
        <ListRow
          icon="people-outline"
          title="Invite friends"
          subtitle="Earn a free coffee"
          onPress={() => router.push('/profile/invite')}
        />
        <Divider inset={44} />
        <ListRow
          icon="stats-chart-outline"
          title="Points history"
          onPress={() => router.push('/profile/points')}
        />
      </Group>

      {/* ---------------------------------------------------- preferences */}
      <Group title="Preferences">
        <ListRow
          icon="notifications-outline"
          title="Notifications"
          onPress={() => router.push('/profile/notifications')}
        />
        <Divider inset={44} />
        <ListRow
          icon="location-outline"
          title="Your area"
          onPress={() => router.push('/location')}
        />
      </Group>

      {/* --------------------------------------------------------- support */}
      <Group title="Support">
        <ListRow
          icon="help-circle-outline"
          title="Help"
          onPress={() => void Linking.openURL(`mailto:${BRAND.supportEmail}`)}
        />
        <Divider inset={44} />
        <ListRow
          icon="shield-checkmark-outline"
          title="Privacy"
          onPress={() => void Linking.openURL(`https://${BRAND.webHost}/privacy`)}
        />
        <Divider inset={44} />
        <ListRow
          icon="document-text-outline"
          title="Terms"
          onPress={() => void Linking.openURL(`https://${BRAND.webHost}/terms`)}
        />
      </Group>

      {/* ----------------------------------------------------- danger zone */}
      <View style={{ marginTop: theme.spacing.xl }}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.spacing.base }}>
            <ListRow icon="log-out-outline" title="Sign out" onPress={confirmSignOut} />
          </View>
        </Card>
      </View>

      <Text
        variant="caption"
        color="textMuted"
        align="center"
        style={{ marginTop: theme.spacing.xl }}
      >
        {BRAND.name} · {BRAND.tagline}
      </Text>
    </ScrollScreen>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
      <Text variant="overline" color="textMuted">
        {title.toUpperCase()}
      </Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.base }}>{children}</View>
      </Card>
    </View>
  );
}
