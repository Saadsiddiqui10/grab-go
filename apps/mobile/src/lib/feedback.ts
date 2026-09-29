import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic feedback.
 *
 * Used sparingly and only to confirm something real happened: an item joined the
 * cart, an order was placed, a code was rejected. Haptics on every tap becomes
 * noise people turn off.
 *
 * Every call is guarded — haptics are unavailable on web and on some Android
 * hardware, and a missing motor must never throw into a render path.
 */

const safely = (run: () => Promise<void>): void => {
  if (Platform.OS === 'web') return;
  void run().catch(() => {
    // No haptic engine, or the user has disabled system haptics.
  });
};

/** A light tick: selecting an option, toggling a filter. */
export const tapFeedback = (): void =>
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Something was added or committed. */
export const successFeedback = (): void =>
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** A rejected action: wrong code, failed payment. */
export const errorFeedback = (): void =>
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

export const warningFeedback = (): void =>
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** Moving through a set of options, e.g. the pickup-time picker. */
export const selectionFeedback = (): void => safely(() => Haptics.selectionAsync());
