import { create } from 'zustand';
import type { UserProfile } from '@grabgo/types';
import { api, merchantApi, setSignedOutHandler, type MerchantBusiness } from './api';

/**
 * Dashboard session and cafe selection.
 *
 * A staff account can belong to more than one cafe (a small chain, or an owner
 * with two branches), so the selected business is part of the session rather
 * than a route parameter that could drift out of sync with what the user picked.
 */

interface DashboardState {
  status: 'loading' | 'authenticated' | 'guest';
  user: UserProfile | null;
  businesses: MerchantBusiness[];
  businessId: string | null;

  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectBusiness: (businessId: string) => void;
  currentBusiness: () => MerchantBusiness | null;
  /** Manager or owner. Gates staff management and destructive settings. */
  isManager: () => boolean;
}

const BUSINESS_KEY = 'grabgo.merchant.business';

export const useDashboard = create<DashboardState>((set, get) => ({
  status: 'loading',
  user: null,
  businesses: [],
  businessId: null,

  async bootstrap() {
    setSignedOutHandler(() => set({ status: 'guest', user: null, businesses: [] }));

    if (!api.hasSession()) {
      set({ status: 'guest' });
      return;
    }

    try {
      const [user, businesses] = await Promise.all([
        api.get<UserProfile>('/auth/me'),
        merchantApi.businesses(),
      ]);

      // Prefer the cafe last worked on; fall back to the first one they staff.
      const remembered = sessionStorage.getItem(BUSINESS_KEY);
      const businessId =
        businesses.find((business) => business.id === remembered)?.id ??
        businesses[0]?.id ??
        null;

      set({ status: 'authenticated', user, businesses, businessId });
    } catch {
      api.clearTokens();
      set({ status: 'guest', user: null, businesses: [] });
    }
  },

  async signIn(email, password) {
    const session = await merchantApi.login(email, password);
    api.setTokens(session.tokens);

    const businesses = await merchantApi.businesses();

    set({
      status: 'authenticated',
      user: session.user,
      businesses,
      businessId: businesses[0]?.id ?? null,
    });
  },

  async signOut() {
    try {
      await merchantApi.logout();
    } catch {
      // Sign out locally regardless.
    }

    api.clearTokens();
    sessionStorage.removeItem(BUSINESS_KEY);
    set({ status: 'guest', user: null, businesses: [], businessId: null });
  },

  selectBusiness(businessId) {
    sessionStorage.setItem(BUSINESS_KEY, businessId);
    set({ businessId });
  },

  currentBusiness() {
    const { businesses, businessId } = get();
    return businesses.find((business) => business.id === businessId) ?? null;
  },

  isManager() {
    const business = get().currentBusiness();
    return business?.staffRole === 'OWNER' || business?.staffRole === 'MANAGER';
  },
}));
