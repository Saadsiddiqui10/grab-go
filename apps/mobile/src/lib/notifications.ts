import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { palette } from '@grabgo/config';
import { auth as authApi } from '../api/endpoints';

/**
 * Push notifications.
 *
 * The permission prompt is never shown at launch or sign-in. It is offered
 * after an order is placed, behind a short explanation, when "tell me when my
 * coffee is ready" is an obvious trade rather than an interruption. A denied
 * prompt is effectively permanent, so it is only worth asking once, then.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Android requires notification channels; without them, importance cannot be
 * set and order updates arrive silently batched.
 */
async function configureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('orders', {
    name: 'Order updates',
    description: 'When your order is accepted, being made, and ready to collect.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: palette.ember[500],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Rewards and offers',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: palette.ember[500],
  });
}

/**
 * Expo Go dropped remote push in SDK 53. Local notification handling still
 * works there, but asking for a push token throws — so it is skipped, and the
 * order screen falls back to its socket and polling, which is what keeps the
 * app correct in Expo Go.
 */
const isExpoGo = Constants.executionEnvironment === 'storeClient';

export type PushPermission = 'undetermined' | 'granted' | 'denied' | 'unavailable';

/**
 * Register this device for order updates.
 *
 * Without `prompt`, it only completes when permission was granted earlier, so
 * it is safe to call on every sign-in. With `prompt`, it shows the system
 * dialog, which callers do only after explaining why (see `usePushPermission`).
 */
export async function registerForPushNotifications({
  prompt = false,
}: { prompt?: boolean } = {}): Promise<string | null> {
  if (isExpoGo) {
    console.info('[push] skipped — Expo Go does not support remote push. Use a dev build.');
    return null;
  }

  try {
    await configureAndroidChannels();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && prompt) {
      ({ status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      }));
    }
    if (status !== 'granted') return null;

    // A simulator can grant permission but has no push token.
    if (!Device.isDevice) return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await authApi.registerDevice({
      token: token.data,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    });

    return token.data;
  } catch (error) {
    // Push is an enhancement. The order screen still updates over the socket
    // and by polling, so a failure here is logged and forgotten.
    console.warn('[push] registration failed', error);
    return null;
  }
}

/**
 * The notification permission, plus a way to ask for it.
 *
 * Screens show their own explanation while this is `undetermined` and call
 * `request` from a button, so the system prompt only ever appears as the
 * answer to something the customer chose.
 */
export function usePushPermission(): {
  status: PushPermission | null;
  request: () => Promise<void>;
} {
  const [status, setStatus] = useState<PushPermission | null>(null);

  useEffect(() => {
    if (isExpoGo) {
      setStatus('unavailable');
      return;
    }
    void Notifications.getPermissionsAsync()
      .then((result) => setStatus(result.status as PushPermission))
      .catch(() => setStatus('unavailable'));
  }, []);

  const request = useCallback(async () => {
    await registerForPushNotifications({ prompt: true });
    const result = await Notifications.getPermissionsAsync().catch(() => null);
    setStatus(result ? (result.status as PushPermission) : 'unavailable');
  }, []);

  return { status, request };
}

/**
 * Open the right screen when a notification is tapped.
 *
 * The payload carries an `orderId`, so "your order is ready" opens that order
 * rather than dumping the customer on the home screen to find it.
 */
export function usePushNotificationRouting(): void {
  const router = useRouter();

  useEffect(() => {
    const navigate = (data: Record<string, unknown> | undefined): void => {
      const orderId = data?.orderId;
      if (typeof orderId === 'string') {
        router.push(`/order/${orderId}`);
        return;
      }

      const url = data?.url;
      if (typeof url === 'string' && url.includes('rewards')) {
        router.push('/(tabs)/rewards');
      }
    };

    // Cold start: the app was launched by tapping a notification.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        navigate(response.notification.request.content.data as Record<string, unknown>);
      }
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      navigate(response.notification.request.content.data as Record<string, unknown>);
    });

    return () => subscription.remove();
  }, [router]);
}

export async function unregisterPushToken(token: string): Promise<void> {
  try {
    await authApi.removeDevice(token);
  } catch {
    // Signing out locally is what matters; a stale token is pruned server-side
    // the first time Expo reports it as unregistered.
  }
}
