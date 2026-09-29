import { createApiClient } from '@grabgo/ui';
import type {
  AdminAnalytics,
  AuthSession,
  BusinessStatus,
  LoyaltyConfig,
  OrderStatus,
  PaymentStatus,
  PlatformConfig,
  ReferralConfig,
  UserRole,
  UserStatus,
} from '@grabgo/types';

/**
 * Admin API surface.
 *
 * Every mutation here is audited server-side; the dashboard's job is to make
 * what is about to happen obvious before it does, and to show the trail
 * afterwards.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

let onSignedOut: (() => void) | null = null;

export const api = createApiClient({
  baseUrl: BASE_URL,
  storagePrefix: 'grabgo.admin',
  onUnauthenticated: () => onSignedOut?.(),
});

export function setSignedOutHandler(handler: (() => void) | null): void {
  onSignedOut = handler;
}

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  referralCode: string;
  pointsBalance: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserDetail extends Omit<AdminUserRow, 'pointsBalance'> {
  points: { balance: number; lifetimeEarned: number; lifetimeRedeemed: number };
  orderCount: number;
  referralCount: number;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: OrderStatus;
    total: number;
    businessName: string;
    createdAt: string;
  }>;
}

export interface AdminBusinessRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: BusinessStatus;
  cityName: string;
  areaName: string | null;
  rating: number | null;
  orderCount: number;
  createdAt: string;
}

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  total: number;
  businessName: string;
  customerName: string;
  pickupAt: string;
  createdAt: string;
}

export interface AdminReward {
  id: string;
  name: string;
  description: string | null;
  pointsRequired: number;
  type: 'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'FREE_ITEM';
  discountAmount: number | null;
  discountPercentage: number | null;
  isActive: boolean;
  usageCount: number;
}

export interface AdminPromotion {
  id: string;
  code: string;
  description: string | null;
  type: 'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT';
  scope: 'PLATFORM' | 'BUSINESS' | 'REFERRAL';
  value: number;
  minimumOrderTotal: number;
  usageLimit: number | null;
  usageCount: number;
  firstOrderOnly: boolean;
  fundedBy: 'PLATFORM' | 'MERCHANT';
  isActive: boolean;
  endsAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export const adminApi = {
  login: (email: string, password: string) =>
    api.post<AuthSession>('/auth/login', { email, password }),

  logout: () => api.post<{ loggedOut: boolean }>('/auth/logout', {}),

  /* ---------------------------------------------------------------- users */

  users: (params: { q?: string; status?: string; role?: string; cursor?: string | null }) =>
    api.paged<AdminUserRow>('/admin/users', { ...params, limit: 50 }),

  user: (userId: string) => api.get<AdminUserDetail>(`/admin/users/${userId}`),

  suspendUser: (userId: string, reason: string) =>
    api.post<{ suspended: boolean }>(`/admin/users/${userId}/suspend`, { reason }),

  restoreUser: (userId: string) =>
    api.post<{ restored: boolean }>(`/admin/users/${userId}/restore`),

  adjustPoints: (userId: string, amount: number, reason: string) =>
    api.post<{ balance: number | null }>('/admin/points/adjust', { userId, amount, reason }),

  /* ----------------------------------------------------------- businesses */

  businesses: (params: { q?: string; status?: string; cursor?: string | null }) =>
    api.paged<AdminBusinessRow>('/admin/businesses', { ...params, limit: 50 }),

  createBusiness: (body: Record<string, unknown>) =>
    api.post<{ businessId: string; ownerId: string; temporaryPassword: string | null }>(
      '/admin/businesses',
      body,
    ),

  approveBusiness: (businessId: string) =>
    api.post<{ approved: boolean }>(`/admin/businesses/${businessId}/approve`),

  rejectBusiness: (businessId: string, note: string) =>
    api.post<{ rejected: boolean }>(`/admin/businesses/${businessId}/reject`, { note }),

  suspendBusiness: (businessId: string, note: string) =>
    api.post<{ suspended: boolean }>(`/admin/businesses/${businessId}/suspend`, { note }),

  reinstateBusiness: (businessId: string) =>
    api.post<{ reinstated: boolean }>(`/admin/businesses/${businessId}/reinstate`),

  /* --------------------------------------------------------------- orders */

  orders: (params: { q?: string; status?: string; businessId?: string; cursor?: string | null }) =>
    api.paged<AdminOrderRow>('/admin/orders', { ...params, limit: 50 }),

  cancelOrder: (orderId: string, reason: string, refund: boolean) =>
    api.post<unknown>(`/admin/orders/${orderId}/cancel`, { reason, refund }),

  refundOrder: (orderId: string, reason: string, amount?: number) =>
    api.post<{ refundedAmount: number; status: PaymentStatus }>(
      `/admin/orders/${orderId}/refund`,
      { reason, ...(amount ? { amount } : {}) },
    ),

  /* --------------------------------------------------------------- config */

  config: () =>
    api.get<{ loyalty: LoyaltyConfig; referral: ReferralConfig; platform: PlatformConfig }>(
      '/admin/config',
    ),

  saveLoyalty: (body: LoyaltyConfig) => api.put<LoyaltyConfig>('/admin/config/loyalty', body),
  saveReferral: (body: ReferralConfig) => api.put<ReferralConfig>('/admin/config/referral', body),
  savePlatform: (body: PlatformConfig) => api.put<PlatformConfig>('/admin/config/platform', body),

  /* -------------------------------------------------------------- rewards */

  rewards: () => api.get<AdminReward[]>('/admin/rewards'),
  createReward: (body: Record<string, unknown>) => api.post<AdminReward>('/admin/rewards', body),
  updateReward: (rewardId: string, body: Record<string, unknown>) =>
    api.patch<AdminReward>(`/admin/rewards/${rewardId}`, body),

  /* ----------------------------------------------------------- promotions */

  promotions: () => api.get<AdminPromotion[]>('/admin/promotions'),
  createPromotion: (body: Record<string, unknown>) =>
    api.post<AdminPromotion>('/admin/promotions', body),
  updatePromotion: (promotionId: string, body: Record<string, unknown>) =>
    api.patch<AdminPromotion>(`/admin/promotions/${promotionId}`, body),

  /* ------------------------------------------------------------ analytics */

  analytics: (preset: string) => api.get<AdminAnalytics>('/admin/analytics', { preset }),

  auditLogs: (params: { targetType?: string; targetId?: string }) =>
    api.get<AuditEntry[]>('/admin/audit-logs', { ...params, limit: 100 }),
};
