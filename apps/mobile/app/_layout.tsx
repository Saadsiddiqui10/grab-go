import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { darkTheme, lightTheme } from '@grabgo/config';
import { useColorScheme } from 'react-native';
import { ThemeProvider, useTheme } from '../src/theme';
import { useAuthStore } from '../src/stores/auth';
import { useCartStore } from '../src/stores/cart';
import { useLocationStore } from '../src/stores/location';
import { useRealtime } from '../src/api/realtime';
import { ApiError, NetworkError } from '../src/api/client';
import { registerForPushNotifications, usePushNotificationRouting } from '../src/lib/notifications';
import { loadFonts } from '../src/theme/fonts';

/**
 * Application root.
 *
 * Providers, state hydration and navigation. The splash screen is held until
 * the session has been read from the keychain, so a signed-in customer never
 * sees the sign-in screen flash past on launch.
 */

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile connections drop; one retry absorbs a blip without making a
      // genuinely broken request take ten seconds to report itself.
      retry: (failureCount, error) => {
        if (error instanceof ApiError) return error.isRetryable && failureCount < 2;
        if (error instanceof NetworkError) return failureCount < 2;
        return false;
      },
      staleTime: 30 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      // Mutations are never retried automatically: a retried checkout is a
      // second coffee. The idempotency key covers deliberate retries.
      retry: false,
    },
  },
});

// React Query's default focus detection is a browser concept; wire it to
// AppState so returning from the background refreshes order status.
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active');
});

export default function RootLayout(): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(
      scheme === 'dark' ? darkTheme.background : lightTheme.background,
    );
  }, [scheme]);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      await Promise.all([
        loadFonts(),
        useAuthStore.getState().bootstrap(),
        useCartStore.getState().hydrate(),
        useLocationStore.getState().hydrate(),
      ]);

      setReady(true);
      await SplashScreen.hideAsync();
    };

    void bootstrap();
  }, []);

  if (!ready) return <></>;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const setPendingReferralCode = useAuthStore((state) => state.setPendingReferralCode);

  useRealtime();
  usePushNotificationRouting();

  // Refresh the push token on sign-in, silently: this never shows the system
  // prompt. Asking happens after an order is placed (see order-confirmed),
  // because asking before there is anything to be notified about earns a
  // denial the app cannot recover from.
  useEffect(() => {
    if (!isAuthenticated) return;
    void registerForPushNotifications();
  }, [isAuthenticated]);

  /**
   * Referral deep links (`grabgo://join/SAAD123` or the https equivalent).
   *
   * The code is stored rather than applied immediately: the account it belongs
   * to usually does not exist yet, and it must survive the whole signup flow.
   */
  useEffect(() => {
    const handleUrl = (url: string | null): void => {
      if (!url) return;

      const parsed = Linking.parse(url);
      const segments = parsed.path?.split('/').filter(Boolean) ?? [];

      if (segments[0] === 'join' && segments[1]) {
        void setPendingReferralCode(segments[1].toUpperCase());
        if (!isAuthenticated) router.push('/(auth)/welcome');
      }
    };

    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));

    return () => subscription.remove();
  }, [isAuthenticated, router, setPendingReferralCode]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        // iOS gets its swipe-back gesture; Android relies on the system back
        // gesture and button, which expo-router wires up natively.
        gestureEnabled: Platform.OS === 'ios',
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />

      <Stack.Screen name="cafe/[id]" options={{ headerShown: false }} />

      <Stack.Screen
        name="item/[itemId]"
        options={{
          // A native sheet on iOS, a full screen on Android: Material has no
          // equivalent of the iOS card modal, and faking one feels wrong.
          presentation: Platform.OS === 'ios' ? 'modal' : 'card',
          title: '',
          headerShown: Platform.OS === 'android',
        }}
      />

      <Stack.Screen name="cart" options={{ title: 'Your cart' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />

      <Stack.Screen
        name="order-confirmed/[id]"
        options={{
          headerShown: false,
          // No swipe-back from the confirmation: the order is placed, and the
          // way onward is "View order", not backwards into checkout.
          gestureEnabled: false,
        }}
      />

      <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
      <Stack.Screen name="profile/invite" options={{ title: 'Invite friends' }} />
      <Stack.Screen name="profile/notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="profile/account" options={{ title: 'Account' }} />
      <Stack.Screen name="profile/points" options={{ title: 'Grab Points' }} />
      <Stack.Screen
        name="location"
        options={{
          presentation: Platform.OS === 'ios' ? 'modal' : 'card',
          title: 'Choose your area',
        }}
      />
      {/* A cafe that is not on Grab & Go yet: a native sheet over the map,
          sized to its content, so the map stays in view behind it. */}
      <Stack.Screen
        name="listing/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
    </Stack>
  );
}
