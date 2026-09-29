import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Two stores, chosen by what the value is worth.
 *
 * `secureStorage` is the device keychain (iOS Keychain, Android Keystore) and
 * holds tokens. `appStorage` is plain async storage for preferences and the
 * cart — losing those is an inconvenience, not a breach, and keychain access is
 * comparatively slow.
 *
 * SecureStore has no web implementation, so the web build falls back to async
 * storage. That is acceptable for a development preview and is the reason the
 * shipping product is the native app.
 */

const isWeb = Platform.OS === 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      if (isWeb) return await AsyncStorage.getItem(key);
      return await SecureStore.getItemAsync(key);
    } catch {
      // A corrupt or inaccessible keychain entry should sign the user out, not
      // crash the app on launch.
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    try {
      if (isWeb) {
        await AsyncStorage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // Nothing useful to do; the user simply signs in again next launch.
    }
  },

  async remove(key: string): Promise<void> {
    try {
      if (isWeb) {
        await AsyncStorage.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Already gone.
    }
  },
};

export const appStorage = {
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async setJson(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable; the value is a convenience, not state we
      // cannot rebuild.
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Already gone.
    }
  },
};

export const StorageKey = {
  accessToken: 'grabgo.auth.access',
  refreshToken: 'grabgo.auth.refresh',
  user: 'grabgo.auth.user',
  cart: 'grabgo.cart',
  location: 'grabgo.location',
  deviceId: 'grabgo.device',
  onboarded: 'grabgo.onboarded',
  pendingReferral: 'grabgo.referral',
} as const;
