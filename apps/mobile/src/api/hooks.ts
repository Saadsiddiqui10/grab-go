import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ListingSummary,
  BusinessDetail,
  BusinessSummary,
  Menu,
  OrderDetail,
  OrderSummary,
  PickupSlot,
  PointsAccountSummary,
  ReferralProgress,
  Reward,
  RewardRedemption,
  Review,
  UserProfile,
} from '@grabgo/types';
import {
  catalog,
  listings,
  orders as ordersApi,
  user as userApi,
  type CartQuoteResponse,
  type CityWithAreas,
  type DiscoverParams,
} from './endpoints';
import { useAuthStore } from '../stores/auth';
import { useCartStore } from '../stores/cart';
import { useLocationStore } from '../stores/location';

/**
 * Server state.
 *
 * Query keys are built here rather than inline, so invalidating "this cafe's
 * menu" after a merchant marks something sold out is one call and cannot miss a
 * spelling.
 */

export const queryKeys = {
  config: ['config'] as const,
  cities: ['cities'] as const,
  discover: (params: DiscoverParams) => ['cafes', params] as const,
  cafe: (id: string) => ['cafe', id] as const,
  menu: (id: string) => ['cafe', id, 'menu'] as const,
  pickupSlots: (id: string) => ['cafe', id, 'pickup-slots'] as const,
  reviews: (id: string) => ['cafe', id, 'reviews'] as const,
  orders: (status: string) => ['orders', status] as const,
  order: (id: string) => ['order', id] as const,
  favourites: ['favourites'] as const,
  points: ['points'] as const,
  pointsHistory: ['points', 'history'] as const,
  rewards: (businessId?: string) => ['rewards', businessId ?? 'all'] as const,
  myRewards: ['rewards', 'mine'] as const,
  referrals: ['referrals'] as const,
  notifications: ['notifications'] as const,
  notificationPreferences: ['notifications', 'preferences'] as const,
  profile: ['profile'] as const,
  listings: (tags?: string) => ['listings', tags ?? 'all'] as const,
  listing: (id: string) => ['listing', id] as const,
} as const;

/* ------------------------------------------------------------------ catalogue */

export function useAppConfig(): UseQueryResult<Awaited<ReturnType<typeof catalog.config>>> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: catalog.config,
    // Loyalty rates and slot intervals change rarely; refetching them on every
    // screen focus is wasted bandwidth on a mobile connection.
    staleTime: 30 * 60 * 1000,
  });
}

export function useCities(): UseQueryResult<CityWithAreas[]> {
  return useQuery({
    queryKey: queryKeys.cities,
    queryFn: catalog.cities,
    staleTime: 60 * 60 * 1000,
  });
}

/** Paged cafe discovery, driven by the current filters and location. */
export function useDiscoverCafes(params: DiscoverParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.discover(params),
    queryFn: ({ pageParam }) => catalog.discover({ ...params, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60 * 1000,
  });
}

/** Every cafe the map can pin, in one page (discover caps a page at 50). */
export function useMapCafes(params: DiscoverParams): UseQueryResult<BusinessSummary[]> {
  return useQuery({
    queryKey: ['map', params] as const,
    queryFn: async () => (await catalog.discover({ ...params, limit: 50 })).items,
    staleTime: 60 * 1000,
  });
}

/** Cafes on the map that are not on Grab & Go yet. */
export function useListings(tags?: string): UseQueryResult<ListingSummary[]> {
  return useQuery({
    queryKey: queryKeys.listings(tags),
    queryFn: () => listings.list(tags),
    // Imported data changes rarely; requests are patched in by the mutation.
    staleTime: 5 * 60 * 1000,
  });
}

export function useListing(id: string | undefined): UseQueryResult<ListingSummary> {
  return useQuery({
    queryKey: queryKeys.listing(id ?? ''),
    queryFn: () => listings.get(id as string),
    enabled: Boolean(id),
  });
}

/** "I want to order here", reflected everywhere the listing is cached. */
export function useRequestListing(): UseMutationResult<ListingSummary, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => listings.request(id),
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.listing(updated.id), updated);
      client.setQueriesData<ListingSummary[]>({ queryKey: ['listings'] }, (rows) =>
        rows?.map((row) => (row.id === updated.id ? updated : row)),
      );
    },
  });
}

/** A single rail on the home screen. */
export function useCafeRail(
  key: string,
  params: DiscoverParams,
  enabled = true,
): UseQueryResult<BusinessSummary[]> {
  return useQuery({
    queryKey: ['rail', key, params] as const,
    queryFn: async () => (await catalog.discover({ ...params, limit: 10 })).items,
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useCafe(id: string | undefined): UseQueryResult<BusinessDetail> {
  const origin = useLocationStore((state) => state.origin());

  return useQuery({
    queryKey: queryKeys.cafe(id ?? ''),
    queryFn: () => catalog.cafe(id as string, origin),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
  });
}

export function useMenu(id: string | undefined): UseQueryResult<Menu> {
  return useQuery({
    queryKey: queryKeys.menu(id ?? ''),
    queryFn: () => catalog.menu(id as string),
    enabled: Boolean(id),
    // Availability changes during a rush, so the menu is refetched more eagerly
    // than the cafe profile.
    staleTime: 30 * 1000,
  });
}

export function usePickupSlots(id: string | undefined): UseQueryResult<PickupSlot[]> {
  return useQuery({
    queryKey: queryKeys.pickupSlots(id ?? ''),
    queryFn: () => catalog.pickupSlots(id as string),
    enabled: Boolean(id),
    // Slots move with the clock; anything older than a minute may already be
    // in the past.
    staleTime: 45 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export function useReviews(id: string | undefined): UseQueryResult<Review[]> {
  return useQuery({
    queryKey: queryKeys.reviews(id ?? ''),
    queryFn: () => catalog.reviews(id as string),
    enabled: Boolean(id),
  });
}

/* ----------------------------------------------------------------------- cart */

/**
 * Price the current cart on the server.
 *
 * Re-runs whenever the basket, promo code or redemption changes, because those
 * are exactly the inputs that can change the total.
 */
export function useCartQuote(): UseQueryResult<CartQuoteResponse> {
  const businessId = useCartStore((state) => state.businessId);
  const lines = useCartStore((state) => state.lines);
  const promoCode = useCartStore((state) => state.promoCode);
  const redemptionId = useCartStore((state) => state.redemptionId);
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  const input = lines.map((line) => ({
    menuItemId: line.menuItemId,
    variantId: line.variantId ?? null,
    modifierOptionIds: line.modifierOptionIds ?? [],
    quantity: line.quantity,
    notes: line.notes ?? null,
  }));

  return useQuery({
    queryKey: ['cart-quote', businessId, input, promoCode, redemptionId] as const,
    queryFn: () =>
      ordersApi.quote({
        businessId: businessId as string,
        lines: input,
        promoCode,
        redemptionId,
      }),
    enabled: isAuthenticated && Boolean(businessId) && input.length > 0,
    // Always fetch fresh: a stale total is a wrong total.
    staleTime: 0,
    retry: 1,
  });
}

/* --------------------------------------------------------------------- orders */

export function useOrders(status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL' = 'ALL') {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useInfiniteQuery({
    queryKey: queryKeys.orders(status),
    queryFn: ({ pageParam }) => ordersApi.list({ status, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isAuthenticated,
    staleTime: 15 * 1000,
  });
}

export function useActiveOrders(): UseQueryResult<OrderSummary[]> {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: ['orders', 'active-tray'] as const,
    queryFn: async () => (await ordersApi.list({ status: 'ACTIVE', limit: 5 })).items,
    enabled: isAuthenticated,
    staleTime: 10 * 1000,
  });
}

export function useOrder(id: string | undefined): UseQueryResult<OrderDetail> {
  return useQuery({
    queryKey: queryKeys.order(id ?? ''),
    queryFn: () => ordersApi.detail(id as string),
    enabled: Boolean(id),
    // Realtime pushes updates; this interval is the safety net for a dropped
    // socket, not the primary mechanism.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 30_000;
      const settled = ['PICKED_UP', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CAFE', 'CANCELLED_BY_ADMIN', 'EXPIRED'];
      return settled.includes(status) ? false : 30_000;
    },
  });
}

export function useCancelOrder(): UseMutationResult<OrderDetail, Error, { orderId: string; reason?: string }> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, reason }) => ordersApi.cancel(orderId, reason),
    onSuccess: (order) => {
      client.setQueryData(queryKeys.order(order.id), order);
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/* -------------------------------------------------------------------- loyalty */

export function usePoints(): UseQueryResult<PointsAccountSummary> {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.points,
    queryFn: userApi.points,
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
  });
}

export function usePointsHistory() {
  return useInfiniteQuery({
    queryKey: queryKeys.pointsHistory,
    queryFn: ({ pageParam }) => userApi.pointsHistory(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useRewards(businessId?: string): UseQueryResult<Reward[]> {
  return useQuery({
    queryKey: queryKeys.rewards(businessId),
    queryFn: () => userApi.rewards(businessId),
    staleTime: 60 * 1000,
  });
}

export function useMyRewards(): UseQueryResult<RewardRedemption[]> {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.myRewards,
    queryFn: userApi.myRewards,
    enabled: isAuthenticated,
  });
}

export function useRedeemReward(): UseMutationResult<
  RewardRedemption,
  Error,
  { rewardId: string; businessId?: string | null }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ rewardId, businessId }) => userApi.redeemReward(rewardId, businessId),
    onSuccess: () => {
      // Redeeming spends points and issues a code, so both lists are stale.
      void client.invalidateQueries({ queryKey: queryKeys.points });
      void client.invalidateQueries({ queryKey: ['rewards'] });
    },
  });
}

export function useReferrals(): UseQueryResult<ReferralProgress> {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.referrals,
    queryFn: userApi.referrals,
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });
}

/* ----------------------------------------------------------------- favourites */

export function useFavourites(): UseQueryResult<string[]> {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.favourites,
    queryFn: userApi.favourites,
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });
}

/**
 * Toggle a favourite with an optimistic update.
 *
 * The heart must fill the instant it is tapped; a round trip before the icon
 * changes reads as a broken button.
 */
export function useToggleFavourite(): UseMutationResult<
  void,
  Error,
  { businessId: string; isFavourite: boolean },
  { previous: string[] | undefined }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ businessId, isFavourite }) => {
      if (isFavourite) {
        await userApi.removeFavourite(businessId);
      } else {
        await userApi.addFavourite(businessId);
      }
    },

    onMutate: async ({ businessId, isFavourite }) => {
      await client.cancelQueries({ queryKey: queryKeys.favourites });
      const previous = client.getQueryData<string[]>(queryKeys.favourites);

      client.setQueryData<string[]>(queryKeys.favourites, (current = []) =>
        isFavourite
          ? current.filter((id) => id !== businessId)
          : [...current, businessId],
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.favourites, context.previous);
      }
    },

    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.favourites });
    },
  });
}

/* ------------------------------------------------------------------- profile */

export function useNotifications() {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: userApi.notifications,
    enabled: isAuthenticated,
  });
}

export function useNotificationPreferences() {
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: userApi.notificationPreferences,
    enabled: isAuthenticated,
  });
}

export function useUpdateProfile(): UseMutationResult<
  UserProfile,
  Error,
  Parameters<typeof userApi.updateProfile>[0]
> {
  const client = useQueryClient();
  const refreshProfile = useAuthStore((state) => state.refreshProfile);

  return useMutation({
    mutationFn: userApi.updateProfile,
    onSuccess: () => {
      void refreshProfile();
      void client.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}
