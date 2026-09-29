/**
 * Canonical domain enums.
 *
 * These MUST stay in sync with `apps/api/prisma/schema.prisma`. They are declared
 * here (rather than re-exported from the generated Prisma client) so the mobile app
 * and the dashboards can depend on the domain vocabulary without depending on the ORM.
 */

/** Platform-level role. Merchant scoping is expressed through CafeStaff rows. */
export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  MERCHANT: 'MERCHANT',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** Role of a staff member within one business. */
export const StaffRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

/**
 * Merchant vertical. The platform launches with CAFE only, but the schema, pricing,
 * ordering and loyalty engines are vertical-agnostic: adding RESTAURANT or BAKERY is
 * a data change, not a rebuild.
 */
export const BusinessType = {
  CAFE: 'CAFE',
  RESTAURANT: 'RESTAURANT',
  BAKERY: 'BAKERY',
  FAST_FOOD: 'FAST_FOOD',
  DESSERT: 'DESSERT',
  BUBBLE_TEA: 'BUBBLE_TEA',
  OTHER: 'OTHER',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const BusinessStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  TEMPORARILY_CLOSED: 'TEMPORARILY_CLOSED',
} as const;
export type BusinessStatus = (typeof BusinessStatus)[keyof typeof BusinessStatus];

export const OrderStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  PICKED_UP: 'PICKED_UP',
  COMPLETED: 'COMPLETED',
  CANCELLED_BY_CUSTOMER: 'CANCELLED_BY_CUSTOMER',
  CANCELLED_BY_CAFE: 'CANCELLED_BY_CAFE',
  CANCELLED_BY_ADMIN: 'CANCELLED_BY_ADMIN',
  EXPIRED: 'EXPIRED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_CAFE,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.EXPIRED,
];

export const CANCELLED_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_CAFE,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.EXPIRED,
];

/** Statuses that still appear in the customer "active orders" tray. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

/** Who requested a state transition. Consumed by the order state machine guard. */
export const ActorType = {
  CUSTOMER: 'CUSTOMER',
  MERCHANT: 'MERCHANT',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const OrderType = {
  PICKUP: 'PICKUP',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const PickupMode = {
  ASAP: 'ASAP',
  SCHEDULED: 'SCHEDULED',
} as const;
export type PickupMode = (typeof PickupMode)[keyof typeof PickupMode];

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  CARD: 'CARD',
  WALLET: 'WALLET',
  BANK_TRANSFER: 'BANK_TRANSFER',
  APPLE_PAY: 'APPLE_PAY',
  GOOGLE_PAY: 'GOOGLE_PAY',
  CASH_ON_PICKUP: 'CASH_ON_PICKUP',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentTransactionType = {
  AUTHORIZATION: 'AUTHORIZATION',
  CAPTURE: 'CAPTURE',
  CHARGE: 'CHARGE',
  REFUND: 'REFUND',
  VOID: 'VOID',
} as const;
export type PaymentTransactionType =
  (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];

/**
 * Points ledger entry types. A points balance is never stored as a mutable scalar;
 * it is always the sum of its transactions.
 */
export const PointsTransactionType = {
  ORDER_EARNED: 'ORDER_EARNED',
  REFERRAL_BONUS: 'REFERRAL_BONUS',
  PROMOTION: 'PROMOTION',
  REWARD_REDEMPTION: 'REWARD_REDEMPTION',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
  REFUND_REVERSAL: 'REFUND_REVERSAL',
  EXPIRY: 'EXPIRY',
} as const;
export type PointsTransactionType =
  (typeof PointsTransactionType)[keyof typeof PointsTransactionType];

export const RewardType = {
  FIXED_DISCOUNT: 'FIXED_DISCOUNT',
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
  FREE_ITEM: 'FREE_ITEM',
} as const;
export type RewardType = (typeof RewardType)[keyof typeof RewardType];

export const RedemptionStatus = {
  ISSUED: 'ISSUED',
  APPLIED: 'APPLIED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type RedemptionStatus = (typeof RedemptionStatus)[keyof typeof RedemptionStatus];

export const ReferralStatus = {
  PENDING: 'PENDING',
  QUALIFIED: 'QUALIFIED',
  REWARDED: 'REWARDED',
  REJECTED: 'REJECTED',
} as const;
export type ReferralStatus = (typeof ReferralStatus)[keyof typeof ReferralStatus];

export const PromotionType = {
  FIXED_DISCOUNT: 'FIXED_DISCOUNT',
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];

export const PromotionScope = {
  PLATFORM: 'PLATFORM',
  BUSINESS: 'BUSINESS',
  REFERRAL: 'REFERRAL',
} as const;
export type PromotionScope = (typeof PromotionScope)[keyof typeof PromotionScope];

export const ModifierSelectionType = {
  SINGLE: 'SINGLE',
  MULTIPLE: 'MULTIPLE',
} as const;
export type ModifierSelectionType =
  (typeof ModifierSelectionType)[keyof typeof ModifierSelectionType];

export const NotificationChannel = {
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationTopic = {
  ORDER_UPDATES: 'ORDER_UPDATES',
  LOYALTY: 'LOYALTY',
  REFERRALS: 'REFERRALS',
  PROMOTIONS: 'PROMOTIONS',
  PRODUCT_NEWS: 'PRODUCT_NEWS',
} as const;
export type NotificationTopic = (typeof NotificationTopic)[keyof typeof NotificationTopic];

export const DevicePlatform = {
  IOS: 'IOS',
  ANDROID: 'ANDROID',
  WEB: 'WEB',
} as const;
export type DevicePlatform = (typeof DevicePlatform)[keyof typeof DevicePlatform];

export const AuthProvider = {
  PASSWORD: 'PASSWORD',
  PHONE_OTP: 'PHONE_OTP',
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const OrderRejectionReason = {
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  TOO_BUSY: 'TOO_BUSY',
  CLOSING_SOON: 'CLOSING_SOON',
  TECHNICAL_ISSUE: 'TECHNICAL_ISSUE',
  OTHER: 'OTHER',
} as const;
export type OrderRejectionReason =
  (typeof OrderRejectionReason)[keyof typeof OrderRejectionReason];

export const ReviewTargetType = {
  BUSINESS: 'BUSINESS',
  ORDER: 'ORDER',
  MENU_ITEM: 'MENU_ITEM',
} as const;
export type ReviewTargetType = (typeof ReviewTargetType)[keyof typeof ReviewTargetType];

/** Human-facing labels, kept beside the enum so clients never invent their own. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Order received',
  ACCEPTED: 'Cafe accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  COMPLETED: 'Completed',
  CANCELLED_BY_CUSTOMER: 'Cancelled by you',
  CANCELLED_BY_CAFE: 'Cancelled by cafe',
  CANCELLED_BY_ADMIN: 'Cancelled by support',
  EXPIRED: 'Expired',
};

export const REJECTION_REASON_LABELS: Record<OrderRejectionReason, string> = {
  ITEM_UNAVAILABLE: 'Item unavailable',
  TOO_BUSY: 'Cafe too busy',
  CLOSING_SOON: 'Closing soon',
  TECHNICAL_ISSUE: 'Technical issue',
  OTHER: 'Other',
};
