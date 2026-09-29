import { create } from 'zustand';
import type { UserProfile } from '@grabgo/types';
import { adminApi, api, setSignedOutHandler } from './api';

/**
 * Admin session.
 *
 * The role check happens on every request server-side; this store only decides
 * what the browser renders. A customer who somehow reaches this build still
 * cannot read a single admin endpoint.
 */

interface AdminState {
  status: 'loading' | 'authenticated' | 'guest';
  user: UserProfile | null;

  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAdmin = create<AdminState>((set) => ({
  status: 'loading',
  user: null,

  async bootstrap() {
    setSignedOutHandler(() => set({ status: 'guest', user: null }));

    if (!api.hasSession()) {
      set({ status: 'guest' });
      return;
    }

    try {
      const user = await api.get<UserProfile>('/auth/me');

      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        api.clearTokens();
        set({ status: 'guest', user: null });
        return;
      }

      set({ status: 'authenticated', user });
    } catch {
      api.clearTokens();
      set({ status: 'guest', user: null });
    }
  },

  async signIn(email, password) {
    const session = await adminApi.login(email, password);

    if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') {
      // Sign the session straight back out: a valid customer login must not
      // leave a usable token sitting in this app's storage.
      api.setTokens(session.tokens);
      await adminApi.logout().catch(() => undefined);
      api.clearTokens();
      throw new Error('That account does not have admin access.');
    }

    api.setTokens(session.tokens);
    set({ status: 'authenticated', user: session.user });
  },

  async signOut() {
    try {
      await adminApi.logout();
    } catch {
      // Leave regardless.
    }
    api.clearTokens();
    set({ status: 'guest', user: null });
  },
}));
