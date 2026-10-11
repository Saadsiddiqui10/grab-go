/**
 * API-facing entity shapes (DTOs).
 *
 * These are the contract between the API and every client. They are deliberately
 * *not* the Prisma row types: the API maps rows to these, which lets the storage
 * layer change without breaking the mobile app, and keeps sensitive columns
 * (password hashes, raw payment payloads, internal notes) from ever leaking.
 *
 * Dates are ISO-8601 strings so they survive JSON transport unambiguously.
 */
import type {
  PickupMethod,
  AuthProvider,
  BusinessStatus,
  BusinessType,
  DevicePlatform,
  ModifierSelectionType,
  NotificationTopic,
  OrderRejectionReason,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PickupMode,
  PointsTransactionType,
  PromotionType,
  RedemptionStatus,
  ReferralStatus,
  RewardType,
  StaffRole,
  UserRole,
  UserStatus,
} from './enums';
import type { CurrencyCode, Paisa } from './money';

export type ISODateString = string;
/** Minutes since midnight, local to the business. 08:30 is `510`. */
export type MinutesOfDay = number;
/** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/* ------------------------------------------------------------------ geography */

export interface City {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
  isActive: boolean;
}

export interface Area {
  id: string;
  cityId: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/* ---------------------------------------------------------------------- users */

export interface UserProfile {
  id: string;
  role: UserRole;
  status: UserStatus;
  fullName: string;
  email: string | null;
  emailVerified: boolean;
  /** False for phone, Google and Apple accounts: there is no password to change. */
  hasPassword: boolean;
  phone: string | null;
  phoneVerified: boolean;
  avatarUrl: string | null;
  referralCode: string;
  cityId: string | null;
  createdAt: ISODateString;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
}

export interface AuthSession {
  user: UserProfile;
  tokens: AuthTokens;
  /** True when this request created the account, so clients can route to onboarding. */
  isNewUser: boolean;
  provider: AuthProvider;
}

export interface SavedAddress {
  id: string;
  label: string;
  addressLine: string;
  areaId: string | null;
  cityId: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
}

export interface NotificationPreferences {
  /** Topic -> enabled. Absent topics default to enabled. */
  push: Record<NotificationTopic, boolean>;
  email: Record<NotificationTopic, boolean>;
  sms: Record<NotificationTopic, boolean>;
}

export interface DeviceToken {
  id: string;
  platform: DevicePlatform;
  createdAt: ISODateString;
}

/* ----------------------------------------------------------------- businesses */

export interface OpeningHour {
  dayOfWeek: DayOfWeek;
  /** Null on a closed day. */
  opensAt: MinutesOfDay | null;
  closesAt: MinutesOfDay | null;
  isClosed: boolean;
}

export interface BusinessHoliday {
  id: string;
  date: string;
  name: string | null;
  isClosed: boolean;
  opensAt: MinutesOfDay | null;
  closesAt: MinutesOfDay | null;
}

/** Compact business shape used in lists, search results and cards. */
export interface BusinessSummary {
  id: string;
  slug: string;
  name: string;
  type: BusinessType;
  status: BusinessStatus;
  logoUrl: string | null;
  coverImageUrl: string | null;
  areaName: string | null;
  cityName: string | null;
  /** Pin position, so lists can be shown on a map without a detail fetch each. */
  latitude: number;
  longitude: number;
  rating: number | null;
  reviewCount: number;
  /** Median minutes from ACCEPTED to READY, used for "Ready in ~10 min". */
  prepTimeMinutes: number;
  /** Computed against the request's location; null when location is unknown. */
  distanceMeters: number | null;
  isOpenNow: boolean;
  acceptingOrders: boolean;
  /** Set when the cafe is open but at its concurrent-order ceiling. */
  busyUntilMinutes: number | null;
  tags: string[];
  priceTier: 1 | 2 | 3 | 4;
  isFavorite: boolean;
  popularItems: string[];
}

export interface BusinessDetail extends BusinessSummary {
  description: string | null;
  addressLine: string;
  phone: string | null;
  openingHours: OpeningHour[];
  holidays: BusinessHoliday[];
  /** Minutes of lead time the cafe needs before the earliest pickup slot. */
  minLeadTimeMinutes: number;
  maxScheduleAheadMinutes: number;
  loyaltyEnabled: boolean;
}

export interface CafeStaffMember {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  staffRole: StaffRole;
  isActive: boolean;
  createdAt: ISODateString;
}

/* ----------------------------------------------------------------------- menu */

export interface MenuModifierOption {
  id: string;
  name: string;
  priceDelta: Paisa;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuModifier {
  id: string;
  name: string;
  selectionType: ModifierSelectionType;
  isRequired: boolean;
  minSelections: number;
  /** Null means unlimited (only meaningful for MULTIPLE). */
  maxSelections: number | null;
  sortOrder: number;
  options: MenuModifierOption[];
}

export interface MenuVariant {
  id: string;
  name: string;
  priceDelta: Paisa;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  businessId: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: Paisa;
  currency: CurrencyCode;
  isAvailable: boolean;
  isSoldOut: boolean;
  isPopular: boolean;
  calories: number | null;
  prepTimeMinutes: number | null;
  sortOrder: number;
  tags: string[];
  variants: MenuVariant[];
  modifiers: MenuModifier[];
}

export interface MenuCategory {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  items: MenuItem[];
}

export interface Menu {
  businessId: string;
  categories: MenuCategory[];
  updatedAt: ISODateString;
}

/* ----------------------------------------------------------------------- cart */

/** What the client sends. Note it carries no prices — the server owns pricing. */
export interface CartLineInput {
  menuItemId: string;
  variantId?: string | null;
  modifierOptionIds?: string[];
  quantity: number;
  notes?: string | null;
}

export interface PricedModifierOption {
  optionId: string;
  modifierId: string;
  modifierName: string;
  optionName: string;
  priceDelta: Paisa;
}

/** What the server returns: the same line, priced authoritatively. */
export interface PricedCartLine {
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  basePrice: Paisa;
  variant: { id: string; name: string; priceDelta: Paisa } | null;
  modifiers: PricedModifierOption[];
  /** Unit price including variant and modifier deltas. */
  unitPrice: Paisa;
  lineTotal: Paisa;
  notes: string | null;
}

export interface OrderTotals {
  subtotal: Paisa;
  promoDiscount: Paisa;
  rewardDiscount: Paisa;
  discountTotal: Paisa;
  tax: Paisa;
  total: Paisa;
  currency: CurrencyCode;
  /** Points this order would earn, at the loyalty config in force right now. */
  pointsEarnable: number;
}

export interface CartQuote {
  businessId: string;
  lines: PricedCartLine[];
  totals: OrderTotals;
  appliedPromoCode: string | null;
  appliedRedemptionId: string | null;
  /** Non-fatal notices: sold-out lines dropped, promo not applicable, etc. */
  warnings: QuoteWarning[];
  pickupSlots: PickupSlot[];
}

export interface QuoteWarning {
  code: string;
  message: string;
  menuItemId?: string;
}

export interface PickupSlot {
  /** ISO timestamp of the slot start. */
  time: ISODateString;
  label: string;
  available: boolean;
  isAsap: boolean;
}

/* --------------------------------------------------------------------- orders */

export interface OrderItemModifier {
  id: string;
  modifierName: string;
  optionName: string;
  priceDelta: Paisa;
}

export interface OrderItem {
  id: string;
  menuItemId: string | null;
  name: string;
  imageUrl: string | null;
  variantName: string | null;
  quantity: number;
  unitPrice: Paisa;
  lineTotal: Paisa;
  notes: string | null;
  modifiers: OrderItemModifier[];
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: ISODateString;
  note: string | null;
}

export interface OrderSummary {
  id: string;
  /** Human-readable, e.g. "G2841". */
  orderNumber: string;
  businessId: string;
  businessName: string;
  businessLogoUrl: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  itemCount: number;
  total: Paisa;
  currency: CurrencyCode;
  pickupMode: PickupMode;
  pickupAt: ISODateString;
  pickupMethod: PickupMethod;
  /** For CURBSIDE: the plate staff look for, and an optional description. */
  vehiclePlate: string | null;
  vehicleDetails: string | null;
  createdAt: ISODateString;
}

export interface OrderDetail extends OrderSummary {
  businessAddress: string;
  businessLatitude: number;
  businessLongitude: number;
  businessPhone: string | null;
  items: OrderItem[];
  totals: OrderTotals;
  paymentMethod: PaymentMethod | null;
  /** Only ever sent to the ordering customer and the owning cafe's staff. */
  pickupCode: string | null;
  /** Signed, short-lived payload for the QR the customer shows at the counter. */
  pickupQrToken: string | null;
  pickedUpAt: ISODateString | null;
  readyAt: ISODateString | null;
  estimatedReadyAt: ISODateString | null;
  cancellationReason: OrderRejectionReason | null;
  cancellationNote: string | null;
  customerNote: string | null;
  timeline: OrderStatusEvent[];
  pointsEarned: number | null;
  canCancel: boolean;
  canReview: boolean;
  updatedAt: ISODateString;
}

/** Merchant-side order shape: adds the customer, hides platform economics. */
export interface MerchantOrder extends OrderDetail {
  customerName: string;
  customerPhone: string | null;
  customerOrderCount: number;
}

/* -------------------------------------------------------------------- loyalty */

export interface PointsTransaction {
  id: string;
  amount: number;
  type: PointsTransactionType;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  /** The cafe whose loyalty card this moved. */
  businessId: string | null;
  businessName: string | null;
  balanceAfter: number;
  createdAt: ISODateString;
}

/** A customer's loyalty card at one cafe. */
export interface CafePoints {
  businessId: string;
  businessName: string;
  businessLogoUrl: string | null;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  /** That cafe's next reward to work toward, or null when all are unlocked. */
  nextReward: { rewardId: string; name: string; pointsRequired: number } | null;
  pointsToNextReward: number | null;
  progressToNextReward: number;
  /** How many active rewards the cafe offers. */
  rewardCount: number;
}

/**
 * Points are earned and spent per cafe. The top-level numbers are totals
 * across every card, for headlines; `cafes` is what can actually be spent,
 * and where.
 */
export interface PointsAccountSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  cafes: CafePoints[];
}

export interface Reward {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  pointsRequired: number;
  type: RewardType;
  discountAmount: Paisa | null;
  discountPercentage: number | null;
  maxDiscountAmount: Paisa | null;
  freeItemName: string | null;
  /** The cafe that offers it; redeemable only there, with points earned there. */
  businessId: string;
  businessName: string;
  expiresAt: ISODateString | null;
  isActive: boolean;
  /** Derived per-user: whether they have enough points right now. */
  isUnlocked: boolean;
}

export interface RewardRedemption {
  id: string;
  rewardId: string;
  rewardName: string;
  /** The cafe the reward belongs to: it can only be spent on an order there. */
  businessId: string;
  businessName: string;
  status: RedemptionStatus;
  pointsSpent: number;
  code: string;
  orderId: string | null;
  expiresAt: ISODateString | null;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ referrals */

export interface ReferralProgress {
  code: string;
  shareUrl: string;
  shareMessage: string;
  /** Referrals that signed up but have not completed a qualifying order. */
  pendingCount: number;
  qualifiedCount: number;
  rewardedCount: number;
  /** Configurable: how many qualified referrals unlock the referrer reward. */
  requiredForReward: number;
  referrals: ReferralEntry[];
}

export interface ReferralEntry {
  id: string;
  refereeName: string;
  status: ReferralStatus;
  signedUpAt: ISODateString;
  qualifiedAt: ISODateString | null;
}

/* ----------------------------------------------------------------- promotions */

export interface AppliedPromotion {
  code: string;
  type: PromotionType;
  description: string;
  discount: Paisa;
}

/* -------------------------------------------------------------------- reviews */

export interface Review {
  id: string;
  orderId: string | null;
  businessId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  rating: number;
  comment: string | null;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ analytics */

export interface MerchantAnalytics {
  rangeStart: ISODateString;
  rangeEnd: ISODateString;
  orderCount: number;
  completedCount: number;
  cancelledCount: number;
  grossRevenue: Paisa;
  netEarnings: Paisa;
  averageOrderValue: Paisa;
  averagePrepMinutes: number | null;
  repeatCustomerRate: number;
  topItems: Array<{ menuItemId: string; name: string; quantity: number; revenue: Paisa }>;
  ordersByDay: Array<{ date: string; orders: number; revenue: Paisa }>;
}

export interface AdminAnalytics {
  rangeStart: ISODateString;
  rangeEnd: ISODateString;
  orderCount: number;
  grossRevenue: Paisa;
  platformCommission: Paisa;
  averageOrderValue: Paisa;
  activeUsers: number;
  newUsers: number;
  repeatUserRate: number;
  pointsIssued: number;
  pointsRedeemed: number;
  rewardsRedeemed: number;
  referralSignups: number;
  referralConversions: number;
  topBusinesses: Array<{ businessId: string; name: string; orders: number; revenue: Paisa }>;
  topProducts: Array<{ menuItemId: string; name: string; quantity: number }>;
  ordersByDay: Array<{ date: string; orders: number; revenue: Paisa }>;
}

/**
 * A cafe that is on the map but not on Grab & Go yet, imported from
 * OpenStreetMap. It can be requested, never ordered from.
 */
export interface ListingSummary {
  id: string;
  name: string;
  addressLine: string;
  areaName: string | null;
  latitude: number;
  longitude: number;
  tags: string[];
  /** How many customers have asked for this cafe. */
  requestCount: number;
  /** Whether the signed-in viewer has asked; false when signed out. */
  requestedByMe: boolean;
}

/** An imported listing as the admin sees it, ranked by demand. */
export interface AdminListing extends ListingSummary {
  osmId: string;
  phone: string | null;
  claimed: boolean;
  status: BusinessStatus;
}
