import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { useListing, useRequestListing } from '../../src/api/hooks';
import { useAuthStore } from '../../src/stores/auth';
import { Text } from '../../src/components/ui/Text';
import { Button } from '../../src/components/ui/Button';
import { ErrorState, LoadingState } from '../../src/components/ui/States';
import { successFeedback } from '../../src/lib/feedback';

/**
 * A cafe that is not on Grab & Go yet, as a sheet over the map.
 *
 * It says plainly that ordering is not possible, and offers the one useful
 * thing a customer can do: ask for it. Requests rank which cafes the team
 * approaches first. The listing comes from OpenStreetMap, credited here as
 * its licence requires.
 */
export default function ListingSheet(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useAuthStore((state) => state.status === 'authenticated');

  const listing = useListing(id);
  const request = useRequestListing();

  if (listing.isLoading) return <LoadingState label="Loading cafe…" />;
  if (listing.isError || !listing.data) {
    return <ErrorState onRetry={() => void listing.refetch()} />;
  }

  const data = listing.data;
  const others = data.requestedByMe ? data.requestCount - 1 : data.requestCount;

  return (
    <View
      style={{
        padding: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
        gap: theme.spacing.lg,
        backgroundColor: theme.colors.background,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title2">{data.name}</Text>
        <Text variant="subhead" color="textSecondary">
          {[data.addressLine !== 'Karachi' ? data.addressLine : null, data.areaName ?? 'Karachi']
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing.md,
          padding: theme.spacing.base,
          borderRadius: theme.radii.lg,
          backgroundColor: theme.colors.surfaceMuted,
        }}
      >
        <Ionicons name="time-outline" size={20} color={theme.colors.textSecondary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Not on Grab & Go yet</Text>
          <Text variant="footnote" color="textSecondary">
            You can&apos;t order from this cafe in the app. Ask for it and we&apos;ll invite
            them, starting with the cafes people want most.
          </Text>
        </View>
      </View>

      {data.requestedByMe ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
          <Text variant="body" style={{ flex: 1 }}>
            You&apos;ve asked for this cafe
            {others > 0 ? `, along with ${others} ${others === 1 ? 'other' : 'others'}` : ''}.
          </Text>
        </View>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={signedIn ? 'Want to order here?' : 'Sign in to ask for this cafe'}
            size="lg"
            fullWidth
            loading={request.isPending}
            onPress={() => {
              if (!signedIn) {
                router.push('/(auth)/welcome');
                return;
              }
              request.mutate(data.id, { onSuccess: () => successFeedback() });
            }}
          />
          {data.requestCount > 0 ? (
            <Text variant="footnote" color="textMuted" align="center">
              {data.requestCount} {data.requestCount === 1 ? 'person has' : 'people have'} asked
              for this cafe
            </Text>
          ) : null}
          {request.isError ? (
            <Text variant="footnote" color="danger" align="center">
              {"Couldn't send that. Check your connection and try again."}
            </Text>
          ) : null}
        </View>
      )}

      <Text variant="caption" color="textMuted">
        Cafe details © OpenStreetMap contributors
      </Text>
    </View>
  );
}
