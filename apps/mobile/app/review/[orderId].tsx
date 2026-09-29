import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme';
import { minTouchTarget } from '../../src/theme';
import { selectionFeedback, successFeedback, errorFeedback } from '../../src/lib/feedback';
import { orders as ordersApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { useOrder, queryKeys } from '../../src/api/hooks';
import { KeyboardScreen, StickyFooter } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Surface';
import { LoadingState } from '../../src/components/ui/States';

/**
 * Leave a review.
 *
 * Reachable only from a collected order, and the API enforces the same rule —
 * a review has to be attached to an order the reviewer actually picked up.
 */
export default function ReviewScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();

  const order = useOrder(orderId);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.isLoading) return <LoadingState />;

  const submit = async (): Promise<void> => {
    if (!orderId || rating === 0) return;

    setBusy(true);
    setError(null);

    try {
      await ordersApi.review({
        orderId,
        rating,
        comment: comment.trim() || null,
      });

      successFeedback();
      await client.invalidateQueries({ queryKey: queryKeys.order(orderId) });
      router.back();
    } catch (caught) {
      errorFeedback();
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'We could not save your review. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const labels = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, gap: theme.spacing.xl, paddingTop: theme.spacing.lg }}>
        <View style={{ gap: 6 }}>
          <Text variant="title1">How was it?</Text>
          <Text variant="body" color="textMuted">
            {order.data ? `Your order from ${order.data.businessName}` : 'Rate your order'}
          </Text>
        </View>

        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            accessibilityRole="radiogroup"
            accessibilityLabel="Rating out of 5"
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  selectionFeedback();
                  setRating(value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: rating === value }}
                accessibilityLabel={`${value} ${value === 1 ? 'star' : 'stars'}`}
                hitSlop={4}
                style={{
                  width: minTouchTarget,
                  height: minTouchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={value <= rating ? 'star' : 'star-outline'}
                  size={34}
                  color={value <= rating ? theme.colors.warning : theme.colors.border}
                />
              </Pressable>
            ))}
          </View>

          {rating > 0 ? (
            <Text variant="subhead" color="textSecondary">
              {labels[rating]}
            </Text>
          ) : null}
        </View>

        <Input
          label="Tell us more (optional)"
          placeholder="What stood out?"
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />

        {error ? (
          <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
            <Text variant="footnote" color="danger">
              {error}
            </Text>
          </Card>
        ) : null}
      </View>

      <StickyFooter>
        <Button
          label="Submit review"
          size="lg"
          fullWidth
          disabled={rating === 0}
          loading={busy}
          onPress={() => void submit()}
        />
      </StickyFooter>
    </KeyboardScreen>
  );
}
