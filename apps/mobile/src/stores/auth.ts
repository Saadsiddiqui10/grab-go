import { create } from 'zustand';
import type { AuthSession, UserProfile } from '@grabgo/types';
import { auth as authApi } from '../api/endpoints';
import {
  clearTokens,
  restoreTokens,
  setTokens,
  setUnauthenticatedHandler,
} from '../api/client';
import { StorageKey, appStorage, secureStorage } from '../lib/storage';

/**
 * Session state.
 *
 * `status` is a three-way state, not a boolean: `loading` is what keeps the
 * splash screen up while the keychain is read, so the app never flashes the
 * sign-in screen at someone who is already signed in.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  /** Referral code captured from a deep link before the account exists. */
  pendingReferralCode: string | null;

  bootstrap: () => Promise<void>;
  applySession: (session: AuthSession) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: (options?: { allDevices?: boolean }) => Promise<void>;
  setPendingReferralCode: (code: string | null) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  pendingReferralCode: null,

  async bootstrap() {
    // The client tells the store when a refresh token stops working, so an
    // expired session logs out cleanly instead of failing every query.
    setUnauthenticatedHandler(() => {
      set({ status: 'guest', user: null });
      void appStorage.remove(StorageKey.user);
    });

    const [hasTokens, storedReferral, cachedUser] = await Promise.all([
      restoreTokens(),
      secureStorage.get(StorageKey.pendingReferral),
      appStorage.getJson<UserProfile>(StorageKey.user),
    ]);

    set({ pendingReferralCode: storedReferral });

    if (!hasTokens) {
      set({ status: 'guest', user: null });
      return;
    }

    // Show the cached profile immediately, then confirm it against the server.
    // The alternative is a spinner on every cold start for a session that is
    // almost certainly still valid.
    if (cachedUser) set({ status: 'authenticated', user: cachedUser });

    try {
      const user = await authApi.me();
      set({ status: 'authenticated', user });
      void appStorage.setJson(StorageKey.user, user);
    } catch {
      if (!cachedUser) {
        await clearTokens();
        set({ status: 'guest', user: null });
      }
      // With a cached profile, stay signed in: this is more likely a flaky
      // connection than a revoked session, and the client will retry.
    }
  },

  async applySession(session) {
    await setTokens(session.tokens);
    set({ status: 'authenticated', user: session.user, pendingReferralCode: null });

    await Promise.all([
      appStorage.setJson(StorageKey.user, session.user),
      secureStorage.remove(StorageKey.pendingReferral),
    ]);
  },

  async refreshProfile() {
    if (get().status !== 'authenticated') return;

    try {
      const user = await authApi.me();
      set({ user });
      void appStorage.setJson(StorageKey.user, user);
    } catch {
      // Keep the profile we have; this is a background refresh.
    }
  },

  async signOut(options) {
    try {
      await authApi.logout({ allDevices: options?.allDevices ?? false });
    } catch {
      // Sign out locally regardless — the customer asked to leave.
    }

    await Promise.all([clearTokens(), appStorage.remove(StorageKey.user)]);
    set({ status: 'guest', user: null });
  },

  async setPendingReferralCode(code) {
    set({ pendingReferralCode: code });
    if (code) {
      await secureStorage.set(StorageKey.pendingReferral, code);
    } else {
      await secureStorage.remove(StorageKey.pendingReferral);
    }
  },
}));

export const useUser = (): UserProfile | null => useAuthStore((state) => state.user);
export const useIsAuthenticated = (): boolean =>
  useAuthStore((state) => state.status === 'authenticated');
