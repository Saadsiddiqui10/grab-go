import { useState } from 'react';
import { Switch, View } from 'react-native';
import type { NotificationTopic } from '@grabgo/types';
import { useTheme } from '../../src/theme';
import { selectionFeedback } from '../../src/lib/feedback';
import { useNotificationPreferences } from '../../src/api/hooks';
import { user as userApi } from '../../src/api/endpoints';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text, SectionTitle } from '../../src/components/ui/Text';
import { Card, Divider } from '../../src/components/ui/Surface';
import { ErrorState, ListSkeleton } from '../../src/components/ui/States';

/**
 * Notification preferences.
 *
 * Order updates are separated from marketing and described plainly, so someone
 * turning off promotions does not accidentally stop hearing that their coffee is
 * ready. Toggles apply optimistically — a preference switch that lags feels
 * broken.
 */

const TOPICS: Array<{ topic: NotificationTopic; title: string; body: string }> = [
  {
    topic: 'ORDER_UPDATES',
    title: 'Order updates',
    body: 'When your order is accepted, being made, and ready to collect.',
  },
  {
    topic: 'LOYALTY',
    title: 'Grab Points and rewards',
    body: 'When you are close to a reward, or one is ready to use.',
  },
  {
    topic: 'REFERRALS',
    title: 'Referrals',
    body: 'When a friend joins with your code or completes their first order.',
  },
  {
    topic: 'PROMOTIONS',
    title: 'Offers',
    body: 'Occasional promo codes and cafe offers.',
  },
  {
    topic: 'PRODUCT_NEWS',
    title: 'Product news',
    body: 'New cafes and features. Rare.',
  },
];

export default function NotificationsScreen(): React.JSX.Element {
  const theme = useTheme();
  const preferences = useNotificationPreferences();

  const [overrides, setOverrides] = useState<Partial<Record<NotificationTopic, boolean>>>({});

  const toggle = (topic: NotificationTopic, next: boolean): void => {
    selectionFeedback();
    setOverrides((current) => ({ ...current, [topic]: next }));

    void userApi
      .updateNotificationPreferences({ push: { [topic]: next } })
      .catch(() => {
        // Roll the switch back if the server refused it.
        setOverrides((current) => ({ ...current, [topic]: !next }));
      });
  };

  if (preferences.isLoading) {
    return (
      <ScrollScreen>
        <ListSkeleton rows={5} />
      </ScrollScreen>
    );
  }

  if (preferences.isError || !preferences.data) {
    return <ErrorState onRetry={() => void preferences.refetch()} />;
  }

  return (
    <ScrollScreen contentContainerStyle={{ paddingTop: theme.spacing.base, gap: theme.spacing.lg }}>
      <SectionTitle subtitle="Push notifications on this device">Notify me about</SectionTitle>

      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.base }}>
          {TOPICS.map((entry, index) => {
            const enabled = overrides[entry.topic] ?? preferences.data.push[entry.topic] ?? true;

            return (
              <View key={entry.topic}>
                {index > 0 ? <Divider /> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingVertical: theme.spacing.base,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="body">{entry.title}</Text>
                    <Text variant="caption" color="textMuted">
                      {entry.body}
                    </Text>
                  </View>

                  <Switch
                    value={enabled}
                    onValueChange={(next) => toggle(entry.topic, next)}
                    accessibilityLabel={entry.title}
                    // The platforms colour switches differently; both use the
                    // brand colour for the "on" state.
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    thumbColor={theme.colors.surface}
                    ios_backgroundColor={theme.colors.border}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Text variant="caption" color="textMuted">
        You can also control notifications for Grab & Go in your device settings. Turning them
        off there stops all of the above.
      </Text>
    </ScrollScreen>
  );
}
