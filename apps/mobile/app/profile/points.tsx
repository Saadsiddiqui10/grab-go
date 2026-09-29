import { FlatList, View } from 'react-native';
import { useTheme } from '../../src/theme';
import { usePoints, usePointsHistory } from '../../src/api/hooks';
import { Text } from '../../src/components/ui/Text';
import { Card, Divider } from '../../src/components/ui/Surface';
import { PointsCard, PointsRow } from '../../src/components/LoyaltyComponents';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/components/ui/States';

/**
 * Points history.
 *
 * The full ledger, because "where did my points go" should always be answerable.
 * Every row is a transaction the server wrote, not a number derived on the
 * client.
 */
export default function PointsScreen(): React.JSX.Element {
  const theme = useTheme();
  const points = usePoints();
  const history = usePointsHistory();

  const transactions = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={transactions}
        keyExtractor={(transaction) => transaction.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: theme.spacing.base, gap: theme.spacing.base }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.base }}>
            {points.data ? <PointsCard summary={points.data} /> : <ListSkeleton rows={1} />}

            {points.data ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <Metric label="Earned" value={points.data.lifetimeEarned} />
                <Metric label="Redeemed" value={points.data.lifetimeRedeemed} />
              </View>
            ) : null}

            <Text variant="overline" color="textMuted" style={{ marginTop: theme.spacing.sm }}>
              HISTORY
            </Text>
          </View>
        }
        ListEmptyComponent={
          history.isLoading ? (
            <ListSkeleton rows={4} />
          ) : history.isError ? (
            <ErrorState compact onRetry={() => void history.refetch()} />
          ) : (
            <EmptyState
              compact
              icon="sparkles-outline"
              title="No points yet"
              body="Earn Grab Points on your first order."
            />
          )
        }
        renderItem={({ item, index }) => (
          <Card padded={false}>
            <View style={{ paddingHorizontal: theme.spacing.base }}>
              {index > 0 ? <Divider /> : null}
              <PointsRow
                amount={item.amount}
                description={item.description}
                createdAt={item.createdAt}
              />
            </View>
          </Card>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
      />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <Card style={{ flex: 1 }}>
      <Text variant="overline" color="textMuted">
        {label.toUpperCase()}
      </Text>
      <Text variant="title2">{value.toLocaleString('en-PK')}</Text>
    </Card>
  );
}
