import type {
  ListingSummary,
  AuthSession,
  AuthTokens,
  BusinessDetail,
  BusinessSummary,
  CartLineInput,
  City,
  Menu,
  MenuItem,
  NotificationPreferences,
  OrderDetail,
  OrderSummary,
  PickupSlot,
  PointsAccountSummary,
  PointsTransaction,
  PricedCartLine,
  OrderTotals,
  QuoteWarning,
  ReferralProgress,
  Reward,
  RewardRedemption,
  Review,
  UserProfile,
} from '@grabgo/types';
import { api, type PagedResult } from './client';

/**
 * Every endpoint the customer app calls, in one typed surface.
 *
 * Screens never build URLs. Keeping the routes here means a change to the API
 * shows up as a TypeScript error in one file rather than as a runtime 404 on a
 * screen nobody opened during testing.
 */

/* ---------------------------------------------------------------------- auth */

export interface DeviceContext {
  deviceId?: string;
  platform?: 'IOS' | 'ANDROID' | 'WEB';
  appVersion?: string;
}

export const auth = {
  register: (body: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    referralCode?: string;
    device?: DeviceContext;
  }) => api.post<AuthSession>('/auth/register', body, { auth: false }),

  login: (body: { email: string; password: string; device?: DeviceContext }) =>
    api.post<AuthSession>('/auth/login', body, { auth: false }),

  requestOtp: (body: { phone: string; intent?: 'LOGIN' | 'SIGNUP' | 'VERIFY' }) =>
    api.post<{ expiresInSeconds: number; devCode?: string }>('/auth/otp/request', body, {
      auth: false,
    }),

  verifyOtp: (body: {
    phone: string;
    code: string;
    fullName?: string;
    referralCode?: string;
    device?: DeviceContext;
  }) => api.post<AuthSession>('/auth/otp/verify', body, { auth: false }),

  oauth: (body: {
    provider: 'GOOGLE' | 'APPLE';
    idToken: string;
    fullName?: string;
    referralCode?: string;
    device?: DeviceContext;
  }) => api.post<AuthSession>('/auth/oauth', body, { auth: false }),

  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }, { auth: false }),

  logout: (body: { refreshToken?: string; allDevices?: boolean }) =>
    api.post<{ loggedOut: boolean }>('/auth/logout', body),

  me: () => api.get<UserProfile>('/auth/me'),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<{ changed: boolean }>('/auth/password/change', body),

  requestPasswordReset: (email: string) =>
    api.post<{ sent: boolean }>('/auth/password/reset-request', { email }, { auth: false }),

  deleteAccount: (password?: string) =>
    api.delete<{ deleted: boolean }>('/auth/account', {
      confirmation: 'DELETE',
      ...(password ? { password } : {}),
    }),

  registerDevice: (body: { token: string; platform: 'IOS' | 'ANDROID' | 'WEB'; deviceId?: string }) =>
    api.post<{ registered: boolean }>('/auth/devices', body),

  removeDevice: (token: string) =>
    api.delete<{ removed: boolean }>(`/auth/devices/${encodeURIComponent(token)}`),
};

/* ------------------------------------------------------------------- catalog */

export interface DiscoverParams {
  q?: string;
  cityId?: string;
  areaId?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  tags?: string;
  openNow?: boolean;
  favouritesOnly?: boolean;
  minRating?: number;
  maxPrepMinutes?: number;
  sort?: 'RECOMMENDED' | 'NEAREST' | 'FASTEST' | 'RATING' | 'POPULAR';
  cursor?: string | null;
  limit?: number;
}

export interface CityWithAreas extends City {
  areas: Array<{
    id: string;
    cityId: string;
    name: string;
    slug: string;
    latitude: number;
    longitude: number;
    isActive: boolean;
  }>;
}

export const catalog = {
  config: () =>
    api.get<{
      loyalty: { earnRateAmount: number; earnRatePoints: number; pointsMultiplier: number; isEnabled: boolean };
      referral: { referralsRequiredForReward: number; isEnabled: boolean };
      platform: { pickupSlotIntervalMinutes: number; minimumOrderTotal: number };
    }>('/config', { auth: false }),

  cities: () => api.get<CityWithAreas[]>('/cities', { auth: false }),

  discover: (params: DiscoverParams) =>
    api.paged<BusinessSummary>('/cafes', { query: { ...params } }),

  cafe: (idOrSlug: string, origin?: { latitude: number; longitude: number } | null) =>
    api.get<BusinessDetail>(`/cafes/${idOrSlug}`, {
      query: origin ? { latitude: origin.latitude, longitude: origin.longitude } : {},
    }),

  menu: (idOrSlug: string) => api.get<Menu>(`/cafes/${idOrSlug}/menu`),

  pickupSlots: (idOrSlug: string) => api.get<PickupSlot[]>(`/cafes/${idOrSlug}/pickup-slots`),

  reviews: (idOrSlug: string) => api.get<Review[]>(`/cafes/${idOrSlug}/reviews`),

  searchItems: (q: string, cityId?: string) =>
    api.get<Array<{ item: MenuItem; businessId: string; businessName: string }>>(
      '/search/items',
      { query: { q, cityId } },
    ),
};

/* --------------------------------------------------------------- cart/orders */

export interface CartQuoteResponse {
  businessId: string;
  lines: PricedCartLine[];
  totals: OrderTotals;
  appliedPromoCode: string | null;
  appliedRedemptionId: string | null;
  warnings: QuoteWarning[];
  pickupSlots: PickupSlot[];
}

export interface ReorderResponse {
  businessId: string;
  lines: CartLineInput[];
  pricedLines: PricedCartLine[];
  totals: OrderTotals;
  warnings: Array<{ code: string; message: string }>;
}

/** Cafes that are not on Grab & Go yet: shown and requested, never ordered. */
export const listings = {
  list: (tags?: string) =>
    api.get<ListingSummary[]>('/listings', { query: tags ? { tags } : {} }),
  get: (id: string) => api.get<ListingSummary>(`/listings/${id}`),
  request: (id: string) => api.post<ListingSummary>(`/listings/${id}/request`),
};

export const orders = {
  quote: (body: {
    businessId: string;
    lines: CartLineInput[];
    promoCode?: string | null;
    redemptionId?: string | null;
  }) => api.post<CartQuoteResponse>('/cart/quote', body),

  create: (body: {
    businessId: string;
    lines: CartLineInput[];
    pickup: { mode: 'ASAP' | 'SCHEDULED'; pickupAt?: string | null };
    promoCode?: string | null;
    redemptionId?: string | null;
    customerNote?: string | null;
    collection?:
      | { method: 'WALK_IN' }
      | { method: 'CURBSIDE'; vehiclePlate: string; vehicleDetails?: string | null };
    paymentMethod: 'CARD' | 'WALLET' | 'BANK_TRANSFER' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'CASH_ON_PICKUP';
    idempotencyKey: string;
  }) => api.post<OrderDetail>('/orders', body),

  list: (params: { status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL'; cursor?: string | null; limit?: number }) =>
    api.paged<OrderSummary>('/orders', { query: { ...params } }),

  detail: (orderId: string) => api.get<OrderDetail>(`/orders/${orderId}`),

  cancel: (orderId: string, reason?: string) =>
    api.post<OrderDetail>(`/orders/${orderId}/cancel`, reason ? { reason } : {}),

  reorder: (orderId: string) => api.post<ReorderResponse>(`/orders/${orderId}/reorder`),

  review: (body: { orderId: string; rating: number; comment?: string | null }) =>
    api.post<{ id: string }>('/reviews', body),
};

export const payments = {
  initiate: (body: {
    orderId: string;
    method: string;
    providerToken?: string;
    returnUrl?: string;
  }) =>
    api.post<{
      paymentId: string;
      status: string;
      redirectUrl?: string;
      clientToken?: string;
    }>('/payments/initiate', body),

  confirm: (paymentId: string) =>
    api.post<{ status: string }>('/payments/confirm', { paymentId }),
};

/* ---------------------------------------------------------------------- user */

export const user = {
  updateProfile: (body: {
    fullName?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string | null;
    cityId?: string | null;
  }) => api.patch<UserProfile>('/users/me', body),

  favourites: () => api.get<string[]>('/users/me/favourites'),
  addFavourite: (businessId: string) =>
    api.post<{ favourited: boolean }>('/users/me/favourites', { businessId }),
  removeFavourite: (businessId: string) =>
    api.delete<{ favourited: boolean }>(`/users/me/favourites/${businessId}`),

  points: () => api.get<PointsAccountSummary>('/users/me/points'),
  pointsHistory: (cursor?: string | null) =>
    api.paged<PointsTransaction>('/users/me/points/transactions', { query: { cursor } }),

  rewards: (businessId?: string) =>
    api.get<Reward[]>('/rewards', { query: { businessId } }),
  myRewards: () => api.get<RewardRedemption[]>('/users/me/rewards'),
  redeemReward: (rewardId: string, businessId?: string | null) =>
    api.post<RewardRedemption>(`/rewards/${rewardId}/redeem`, { businessId }),

  referrals: () => api.get<ReferralProgress>('/users/me/referrals'),

  notifications: () =>
    api.get<Array<{ id: string; title: string; body: string; readAt: string | null; createdAt: string }>>(
      '/users/me/notifications',
    ),
  markNotificationsRead: () => api.post<{ read: boolean }>('/users/me/notifications/read'),

  notificationPreferences: () =>
    api.get<NotificationPreferences>('/users/me/notification-preferences'),
  updateNotificationPreferences: (body: {
    push?: Record<string, boolean>;
    email?: Record<string, boolean>;
    sms?: Record<string, boolean>;
  }) => api.put<NotificationPreferences>('/users/me/notification-preferences', body),
};

export const analytics = {
  track: (events: Array<{ event: string; properties?: Record<string, string | number | boolean | null>; occurredAt?: string }>) =>
    api.post<{ accepted: number }>('/analytics/events', { events }),
};

export type { PagedResult };
