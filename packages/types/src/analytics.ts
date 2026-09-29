/**
 * Product analytics vocabulary.
 *
 * One name per event, defined once and shared by every client, so the mobile app,
 * the dashboards and the warehouse never disagree about what "checkout started"
 * means. Payloads deliberately carry ids and counts — never names, emails, phone
 * numbers or free text the customer typed.
 */

export const AnalyticsEvent = {
  APP_OPENED: 'APP_OPENED',
  SIGNUP_STARTED: 'SIGNUP_STARTED',
  SIGNUP_COMPLETED: 'SIGNUP_COMPLETED',
  LOGIN_COMPLETED: 'LOGIN_COMPLETED',
  LOCATION_PERMISSION_RESULT: 'LOCATION_PERMISSION_RESULT',
  SEARCH_PERFORMED: 'SEARCH_PERFORMED',
  CAFE_VIEWED: 'CAFE_VIEWED',
  MENU_VIEWED: 'MENU_VIEWED',
  ITEM_VIEWED: 'ITEM_VIEWED',
  ITEM_ADDED_TO_CART: 'ITEM_ADDED_TO_CART',
  ITEM_REMOVED_FROM_CART: 'ITEM_REMOVED_FROM_CART',
  CART_VIEWED: 'CART_VIEWED',
  CHECKOUT_STARTED: 'CHECKOUT_STARTED',
  PICKUP_TIME_SELECTED: 'PICKUP_TIME_SELECTED',
  PROMO_APPLIED: 'PROMO_APPLIED',
  PAYMENT_STARTED: 'PAYMENT_STARTED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_READY: 'ORDER_READY',
  ORDER_PICKED_UP: 'ORDER_PICKED_UP',
  REORDER_STARTED: 'REORDER_STARTED',
  REWARD_VIEWED: 'REWARD_VIEWED',
  REWARD_REDEEMED: 'REWARD_REDEEMED',
  REFERRAL_SHARED: 'REFERRAL_SHARED',
  REFERRAL_COMPLETED: 'REFERRAL_COMPLETED',
  FAVORITE_ADDED: 'FAVORITE_ADDED',
  FAVORITE_REMOVED: 'FAVORITE_REMOVED',
  NOTIFICATION_OPENED: 'NOTIFICATION_OPENED',
} as const;
export type AnalyticsEvent = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/** Only ids, enums and numbers. No PII. */
export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface AnalyticsPayload {
  event: AnalyticsEvent;
  properties?: AnalyticsProperties;
  occurredAt?: string;
}
