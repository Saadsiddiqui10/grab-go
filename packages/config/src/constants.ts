/**
 * Cross-client constants.
 *
 * Anything a customer reads that is not owned by the database lives here, so the
 * app, the dashboards and transactional emails cannot drift out of sync.
 */

export const BRAND = {
  name: 'Grab & Go',
  tagline: 'Order ahead. Skip the line.',
  shortName: 'GrabGo',
  supportEmail: 'help@grabandgo.pk',
  /** Deep-link scheme registered by the mobile app. */
  scheme: 'grabgo',
  /** Universal / App Link host used for referral and order links. */
  webHost: 'grabandgo.pk',
} as const;

/** Deep links. Built here so a referral share and a push payload agree. */
export const deepLinks = {
  order: (orderId: string) => `${BRAND.scheme}://orders/${orderId}`,
  business: (businessId: string) => `${BRAND.scheme}://cafe/${businessId}`,
  rewards: () => `${BRAND.scheme}://rewards`,
  referral: (code: string) => `https://${BRAND.webHost}/join/${code}`,
} as const;

export function referralShareMessage(code: string, rewardLabel = 'a free coffee'): string {
  return `Skip the queue at your favourite Karachi cafes with ${BRAND.name}. Use my code ${code} and we both get ${rewardLabel}. ${deepLinks.referral(code)}`;
}

/**
 * Discovery categories.
 *
 * `CAFE` ships first, but the list is already vertical-neutral so restaurants and
 * bakeries appear by flipping `isLive` rather than by a release.
 *
 * `slug` is the business tag the category filters on. `icon` is a semantic
 * name each client maps to its own icon set (SF Symbols on iOS); colours live
 * in `categoryColors` in tokens.ts.
 */
export const discoveryCategories = [
  { slug: 'coffee', label: 'Coffee', icon: 'coffee', isLive: true },
  { slug: 'tea', label: 'Chai', icon: 'tea', isLive: true },
  { slug: 'matcha', label: 'Matcha', icon: 'matcha', isLive: true },
  { slug: 'breakfast', label: 'Breakfast', icon: 'breakfast', isLive: true },
  { slug: 'bakery', label: 'Bakery', icon: 'bakery', isLive: true },
  { slug: 'desserts', label: 'Desserts', icon: 'desserts', isLive: true },
  { slug: 'healthy', label: 'Healthy', icon: 'healthy', isLive: true },
  { slug: 'bubble-tea', label: 'Bubble Tea', icon: 'bubble-tea', isLive: false },
  { slug: 'fast-food', label: 'Fast Food', icon: 'fast-food', isLive: false },
  { slug: 'pizza', label: 'Pizza', icon: 'pizza', isLive: false },
  { slug: 'restaurants', label: 'Restaurants', icon: 'restaurants', isLive: false },
] as const;

export type DiscoveryCategory = (typeof discoveryCategories)[number];

/** Home-screen rails, in the order they appear. */
export const homeSections = [
  { key: 'NEARBY', title: 'Nearby', subtitle: 'Cafes close to you' },
  { key: 'FASTEST', title: 'Fastest pickup', subtitle: 'Ready in minutes' },
  { key: 'POPULAR', title: 'Popular near you', subtitle: null },
  { key: 'FAVOURITES', title: 'Your favourites', subtitle: null },
  { key: 'RECOMMENDED', title: 'Recommended', subtitle: 'Picked for you' },
] as const;

export type HomeSectionKey = (typeof homeSections)[number]['key'];

/** Push notification copy, kept beside the events that send it. */
export const notificationCopy = {
  ORDER_ACCEPTED: {
    title: 'Order accepted',
    body: 'Your order has been accepted.',
  },
  ORDER_PREPARING: {
    title: 'Being prepared',
    body: 'Your coffee is being prepared.',
  },
  ORDER_READY: {
    title: 'Ready for pickup ☕',
    body: 'Your order is ready. Show your Grab & Go code at the counter.',
  },
  ORDER_CANCELLED: {
    title: 'Order cancelled',
    body: 'Your order was cancelled. Tap for details.',
  },
  POINTS_NEAR_REWARD: {
    title: 'Almost there',
    body: (points: number) => `You're ${points} points away from your next reward!`,
  },
  REFERRAL_JOINED: {
    title: 'Your friend joined',
    body: 'Your friend just joined Grab & Go!',
  },
  REWARD_READY: {
    title: 'Reward unlocked 🎉',
    body: 'Your free coffee reward is ready.',
  },
} as const;

/** Empty and error states, so every screen says the same thing. */
export const emptyStates = {
  noCafes: {
    title: 'No cafes found nearby',
    body: 'Try widening your search or picking another area.',
  },
  noResults: {
    title: 'Nothing matched that search',
    body: 'Check the spelling or try a different term.',
  },
  noOrders: {
    title: 'No orders yet',
    body: 'Your first coffee is a couple of taps away.',
  },
  noFavourites: {
    title: 'No favourites yet',
    body: 'Tap the heart on a cafe to keep it here.',
  },
  noRewards: {
    title: 'No rewards yet',
    body: 'Earn Grab Points on every order and unlock rewards.',
  },
  networkError: {
    title: 'Something went wrong',
    body: 'Check your connection and try again.',
  },
  cafeClosed: {
    title: 'This cafe is currently closed',
    body: 'Browse the menu now and order when they open.',
  },
} as const;

/** Karachi launches first; the shape supports the next city without a migration. */
export const LAUNCH_CITY = {
  slug: 'karachi',
  name: 'Karachi',
  countryCode: 'PK',
  timezone: 'Asia/Karachi',
  center: { latitude: 24.8607, longitude: 67.0011 },
} as const;

export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
