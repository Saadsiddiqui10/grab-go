import { createApiClient } from '@grabgo/ui';
import type {
  AuthSession,
  BusinessDetail,
  CafeStaffMember,
  MenuCategory,
  MenuItem,
  MerchantAnalytics,
  OrderDetail,
  OrderRejectionReason,
  StaffRole,
} from '@grabgo/types';

/**
 * Merchant API surface.
 *
 * Every path is scoped by `businessId`, mirroring the server's authorisation
 * model: a merchant session can only ever reach the cafes it staffs, and the
 * shape of these functions makes that impossible to forget.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

let onSignedOut: (() => void) | null = null;

export const api = createApiClient({
  baseUrl: BASE_URL,
  storagePrefix: 'grabgo.merchant',
  onUnauthenticated: () => onSignedOut?.(),
});

export function setSignedOutHandler(handler: (() => void) | null): void {
  onSignedOut = handler;
}

export interface MerchantBusiness extends BusinessDetail {
  staffRole: StaffRole;
}

/** A reward as the cafe that runs it sees it, with its usage so far. */
export interface CafeReward {
  id: string;
  name: string;
  description: string | null;
  pointsRequired: number;
  type: 'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'FREE_ITEM';
  discountAmount: number | null;
  discountPercentage: number | null;
  maxDiscountAmount: number | null;
  freeItemMenuItemIds: string[];
  expiresAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
}

/** What the dashboard sees of the café's POS connection (never the secret). */
export interface PosStatus {
  provider: 'NONE' | 'WEBHOOK';
  isEnabled: boolean;
  endpointUrl: string | null;
  hasSecret: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  pendingCount: number;
  failedCount: number;
  recentProblems: Array<{
    id: string;
    orderId: string;
    orderNumber: string;
    event: string;
    status: 'PENDING' | 'FAILED';
    attempts: number;
    lastError: string | null;
    lastStatusCode: number | null;
    nextAttemptAt: string | null;
    createdAt: string;
  }>;
}

export const merchantApi = {
  login: (email: string, password: string) =>
    api.post<AuthSession>('/auth/merchant/login', { email, password }),

  logout: () => api.post<{ loggedOut: boolean }>('/auth/logout', {}),

  businesses: () => api.get<MerchantBusiness[]>('/merchant/businesses'),

  /* --------------------------------------------------------------- orders */

  orders: (businessId: string, status: string) =>
    api.paged<OrderDetail>(`/merchant/${businessId}/orders`, { status, limit: 100 }),

  accept: (businessId: string, orderId: string, prepTimeMinutes?: number) =>
    api.post<OrderDetail>(
      `/merchant/${businessId}/orders/${orderId}/accept`,
      prepTimeMinutes ? { prepTimeMinutes } : {},
    ),

  reject: (
    businessId: string,
    orderId: string,
    reason: OrderRejectionReason,
    note?: string,
  ) =>
    api.post<OrderDetail>(`/merchant/${businessId}/orders/${orderId}/reject`, {
      reason,
      ...(note ? { note } : {}),
    }),

  preparing: (businessId: string, orderId: string) =>
    api.post<OrderDetail>(`/merchant/${businessId}/orders/${orderId}/preparing`),

  ready: (businessId: string, orderId: string) =>
    api.post<OrderDetail>(`/merchant/${businessId}/orders/${orderId}/ready`),

  /** Hand the order over. The code is verified server-side, never here. */
  verifyPickup: (businessId: string, orderId: string, code: string) =>
    api.post<OrderDetail>(`/merchant/${businessId}/orders/${orderId}/pickup`, { code }),

  complete: (businessId: string, orderId: string) =>
    api.post<OrderDetail>(`/merchant/${businessId}/orders/${orderId}/complete`),

  updatePrepTime: (businessId: string, orderId: string, prepTimeMinutes: number) =>
    api.patch<{ updated: boolean }>(
      `/merchant/${businessId}/orders/${orderId}/prep-time`,
      { prepTimeMinutes },
    ),

  /* ----------------------------------------------------------------- menu */

  menu: (businessId: string) =>
    api.get<{ businessId: string; categories: MenuCategory[]; updatedAt: string }>(
      `/merchant/${businessId}/menu`,
    ),

  createCategory: (businessId: string, body: { name: string; isActive: boolean }) =>
    api.post<MenuCategory>(`/merchant/${businessId}/categories`, body),

  updateCategory: (
    businessId: string,
    categoryId: string,
    body: { name?: string; isActive?: boolean },
  ) => api.patch<{ updated: boolean }>(`/merchant/${businessId}/categories/${categoryId}`, body),

  deleteCategory: (businessId: string, categoryId: string) =>
    api.delete<{ deleted: boolean }>(`/merchant/${businessId}/categories/${categoryId}`),

  createItem: (businessId: string, body: Record<string, unknown>) =>
    api.post<MenuItem>(`/merchant/${businessId}/items`, body),

  updateItem: (businessId: string, itemId: string, body: Record<string, unknown>) =>
    api.patch<MenuItem>(`/merchant/${businessId}/items/${itemId}`, body),

  /** The mid-rush "we're out of oat milk" control. */
  setAvailability: (
    businessId: string,
    itemId: string,
    body: { isAvailable?: boolean; isSoldOut?: boolean },
  ) =>
    api.patch<{ updated: boolean }>(
      `/merchant/${businessId}/items/${itemId}/availability`,
      body,
    ),

  deleteItem: (businessId: string, itemId: string) =>
    api.delete<{ deleted: boolean }>(`/merchant/${businessId}/items/${itemId}`),

  reorderItems: (businessId: string, ids: string[]) =>
    api.post<{ reordered: boolean }>(`/merchant/${businessId}/items/reorder`, { ids }),

  /* -------------------------------------------------------------- rewards */

  rewards: (businessId: string) => api.get<CafeReward[]>(`/merchant/${businessId}/rewards`),

  createReward: (businessId: string, body: Record<string, unknown>) =>
    api.post<CafeReward>(`/merchant/${businessId}/rewards`, body),

  updateReward: (businessId: string, rewardId: string, body: Record<string, unknown>) =>
    api.patch<CafeReward>(`/merchant/${businessId}/rewards/${rewardId}`, body),

  /* ------------------------------------------------------------------ POS */

  posStatus: (businessId: string) => api.get<PosStatus>(`/merchant/${businessId}/pos`),

  configurePos: (
    businessId: string,
    body: { provider: 'NONE' | 'WEBHOOK'; endpointUrl?: string | null; isEnabled?: boolean },
  ) => api.put<PosStatus & { secret: string | null }>(`/merchant/${businessId}/pos`, body),

  rotatePosSecret: (businessId: string) =>
    api.post<{ secret: string }>(`/merchant/${businessId}/pos/rotate-secret`, {}),

  testPos: (businessId: string) =>
    api.post<{ ok: boolean; message: string }>(`/merchant/${businessId}/pos/test`, {}),

  retryPos: (businessId: string, jobId?: string) =>
    api.post<{ retried: number; status: PosStatus }>(
      `/merchant/${businessId}/pos/retry`,
      jobId ? { jobId } : {},
    ),

  /* ------------------------------------------------------------- settings */

  updateSettings: (businessId: string, body: Record<string, unknown>) =>
    api.patch<{ updated: boolean }>(`/merchant/${businessId}/settings`, body),

  updateProfile: (businessId: string, body: Record<string, unknown>) =>
    api.patch<{ id: string; updated: boolean }>(`/merchant/${businessId}/profile`, body),

  updateHours: (
    businessId: string,
    hours: Array<{
      dayOfWeek: number;
      isClosed: boolean;
      opensAt: number | null;
      closesAt: number | null;
    }>,
  ) =>
    api.put<
      Array<{ dayOfWeek: number; opensAt: number | null; closesAt: number | null; isClosed: boolean }>
    >(`/merchant/${businessId}/hours`, { hours }),

  addHoliday: (
    businessId: string,
    body: { date: string; name?: string; isClosed: boolean },
  ) => api.post<{ id: string }>(`/merchant/${businessId}/holidays`, body),

  deleteHoliday: (businessId: string, holidayId: string) =>
    api.delete<{ deleted: boolean }>(`/merchant/${businessId}/holidays/${holidayId}`),

  /* ---------------------------------------------------------------- staff */

  staff: (businessId: string) =>
    api.get<CafeStaffMember[]>(`/merchant/${businessId}/staff`),

  inviteStaff: (
    businessId: string,
    body: { email: string; fullName: string; staffRole: StaffRole },
  ) =>
    api.post<{ staffId: string; userId: string; temporaryPassword: string | null }>(
      `/merchant/${businessId}/staff`,
      body,
    ),

  updateStaff: (
    businessId: string,
    staffId: string,
    body: { staffRole?: StaffRole; isActive?: boolean },
  ) => api.patch<{ updated: boolean }>(`/merchant/${businessId}/staff/${staffId}`, body),

  /* ------------------------------------------------------------ analytics */

  analytics: (businessId: string, preset: string) =>
    api.get<MerchantAnalytics>(`/merchant/${businessId}/analytics`, { preset }),
};

export const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? window.location.origin;
