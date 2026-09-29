import { Prisma } from '@prisma/client';
import type {
  BusinessDetail,
  BusinessSummary,
  DayOfWeek,
  MenuCategory,
  MenuItem,
  OrderDetail,
  OrderItem,
  OrderSummary,
  PointsTransaction,
  Reward,
  RewardRedemption,
  Review,
  UserProfile,
} from '@grabgo/types';

/**
 * Row-to-DTO mapping.
 *
 * The one place database shapes become API shapes. Keeping it explicit — rather
 * than returning Prisma rows straight from handlers — is what stops a password
 * hash, an internal note or a merchant's commission rate leaking into a customer
 * response the day someone adds a column.
 */

/* --------------------------------------------------------------- selections */

export const userWithProfile = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { profile: true },
});
export type UserWithProfile = Prisma.UserGetPayload<typeof userWithProfile>;

export const businessWithRelations = Prisma.validator<Prisma.BusinessDefaultArgs>()({
  include: { area: true, city: true, hours: true, holidays: true },
});
export type BusinessWithRelations = Prisma.BusinessGetPayload<typeof businessWithRelations>;

export const menuItemWithOptions = Prisma.validator<Prisma.MenuItemDefaultArgs>()({
  include: {
    variants: { orderBy: { sortOrder: 'asc' } },
    modifiers: {
      orderBy: { sortOrder: 'asc' },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    },
  },
});
export type MenuItemWithOptions = Prisma.MenuItemGetPayload<typeof menuItemWithOptions>;

export const orderWithRelations = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: {
    business: true,
    items: { include: { modifiers: true } },
    statusEvents: { orderBy: { createdAt: 'asc' } },
    payment: true,
    review: { select: { id: true } },
  },
});
export type OrderWithRelations = Prisma.OrderGetPayload<typeof orderWithRelations>;

/* ------------------------------------------------------------------- mapping */

export function toUserProfile(user: UserWithProfile): UserProfile {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    fullName: user.profile?.fullName ?? '',
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    phone: user.phone,
    phoneVerified: user.phoneVerifiedAt !== null,
    avatarUrl: user.profile?.avatarUrl ?? null,
    referralCode: user.referralCode,
    cityId: user.profile?.cityId ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface BusinessComputed {
  distanceMeters: number | null;
  isOpenNow: boolean;
  busyUntilMinutes: number | null;
  isFavourite: boolean;
  popularItems: string[];
  /** Live estimate, which may exceed the configured baseline when busy. */
  prepTimeMinutes: number;
}

export function toBusinessSummary(
  business: BusinessWithRelations,
  computed: BusinessComputed,
): BusinessSummary {
  return {
    id: business.id,
    slug: business.slug,
    name: business.name,
    type: business.type,
    status: business.status,
    logoUrl: business.logoUrl,
    coverImageUrl: business.coverImageUrl,
    areaName: business.area?.name ?? null,
    cityName: business.city?.name ?? null,
    rating: business.ratingCount > 0 ? Number(business.ratingAverage.toFixed(1)) : null,
    reviewCount: business.ratingCount,
    prepTimeMinutes: computed.prepTimeMinutes,
    distanceMeters: computed.distanceMeters,
    isOpenNow: computed.isOpenNow,
    acceptingOrders:
      business.acceptingOrders &&
      !business.temporarilyClosed &&
      business.status === 'ACTIVE',
    busyUntilMinutes: computed.busyUntilMinutes,
    tags: business.tags,
    priceTier: clampTier(business.priceTier),
    isFavorite: computed.isFavourite,
    popularItems: computed.popularItems,
  };
}

export function toBusinessDetail(
  business: BusinessWithRelations,
  computed: BusinessComputed,
): BusinessDetail {
  return {
    ...toBusinessSummary(business, computed),
    description: business.description,
    addressLine: business.addressLine,
    latitude: business.latitude,
    longitude: business.longitude,
    phone: business.phone,
    openingHours: business.hours
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((hour) => ({
        dayOfWeek: hour.dayOfWeek as DayOfWeek,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        isClosed: hour.isClosed,
      })),
    holidays: business.holidays.map((holiday) => ({
      id: holiday.id,
      date: holiday.date,
      name: holiday.name,
      isClosed: holiday.isClosed,
      opensAt: holiday.opensAt,
      closesAt: holiday.closesAt,
    })),
    minLeadTimeMinutes: business.minLeadTimeMinutes,
    maxScheduleAheadMinutes: business.maxScheduleAheadMinutes,
    loyaltyEnabled: business.loyaltyEnabled,
  };
}

function clampTier(tier: number): 1 | 2 | 3 | 4 {
  if (tier <= 1) return 1;
  if (tier >= 4) return 4;
  return tier === 3 ? 3 : 2;
}

export function toMenuItem(item: MenuItemWithOptions): MenuItem {
  return {
    id: item.id,
    businessId: item.businessId,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    basePrice: item.basePrice,
    currency: 'PKR',
    isAvailable: item.isAvailable,
    isSoldOut: item.isSoldOut,
    isPopular: item.isPopular,
    calories: item.calories,
    prepTimeMinutes: item.prepTimeMinutes,
    sortOrder: item.sortOrder,
    tags: item.tags,
    variants: item.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceDelta: variant.priceDelta,
      isDefault: variant.isDefault,
      isAvailable: variant.isAvailable,
      sortOrder: variant.sortOrder,
    })),
    modifiers: item.modifiers.map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      selectionType: modifier.selectionType,
      isRequired: modifier.isRequired,
      minSelections: modifier.minSelections,
      maxSelections: modifier.maxSelections,
      sortOrder: modifier.sortOrder,
      options: modifier.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDelta: option.priceDelta,
        isDefault: option.isDefault,
        isAvailable: option.isAvailable,
        sortOrder: option.sortOrder,
      })),
    })),
  };
}

export function toMenuCategory(
  category: { id: string; businessId: string; name: string; description: string | null; sortOrder: number; isActive: boolean },
  items: MenuItemWithOptions[],
): MenuCategory {
  return {
    id: category.id,
    businessId: category.businessId,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    items: items.map(toMenuItem),
  };
}

function toOrderItem(
  item: OrderWithRelations['items'][number],
): OrderItem {
  return {
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.name,
    imageUrl: item.imageUrl,
    variantName: item.variantName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    notes: item.notes,
    modifiers: item.modifiers.map((modifier) => ({
      id: modifier.id,
      modifierName: modifier.modifierName,
      optionName: modifier.optionName,
      priceDelta: modifier.priceDelta,
    })),
  };
}

export function toOrderSummary(order: OrderWithRelations): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    businessId: order.businessId,
    businessName: order.business.name,
    businessLogoUrl: order.business.logoUrl,
    status: order.status,
    paymentStatus: order.payment?.status ?? 'PENDING',
    itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
    total: order.total,
    currency: order.currency as 'PKR',
    pickupMode: order.pickupMode,
    pickupAt: order.pickupAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
  };
}

export interface OrderViewOptions {
  /**
   * The pickup code is a credential. It is only included for the customer who
   * placed the order and the staff of the cafe fulfilling it.
   */
  includePickupCode: boolean;
  pickupQrToken?: string | null;
  canCancel: boolean;
  canReview: boolean;
}

export function toOrderDetail(
  order: OrderWithRelations,
  options: OrderViewOptions,
): OrderDetail {
  return {
    ...toOrderSummary(order),
    businessAddress: order.business.addressLine,
    businessLatitude: order.business.latitude,
    businessLongitude: order.business.longitude,
    businessPhone: order.business.phone,
    items: order.items.map(toOrderItem),
    totals: {
      subtotal: order.subtotal,
      promoDiscount: order.promoDiscount,
      rewardDiscount: order.rewardDiscount,
      discountTotal: order.discountTotal,
      tax: order.tax,
      total: order.total,
      currency: order.currency as 'PKR',
      pointsEarnable: order.pointsEarned ?? 0,
    },
    paymentMethod: order.payment?.method ?? null,
    pickupCode: options.includePickupCode ? order.pickupCode : null,
    pickupQrToken: options.pickupQrToken ?? null,
    pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
    cancellationReason: order.cancellationReason,
    cancellationNote: order.cancellationNote,
    customerNote: order.customerNote,
    timeline: order.statusEvents.map((event) => ({
      status: event.status,
      at: event.createdAt.toISOString(),
      note: event.note,
    })),
    pointsEarned: order.pointsEarned,
    canCancel: options.canCancel,
    canReview: options.canReview,
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toPointsTransaction(row: {
  id: string;
  amount: number;
  type: PointsTransaction['type'];
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  balanceAfter: number;
  createdAt: Date;
}): PointsTransaction {
  return {
    id: row.id,
    amount: row.amount,
    type: row.type,
    description: row.description,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReward(
  reward: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    pointsRequired: number;
    type: Reward['type'];
    discountAmount: number | null;
    discountPercentage: number | null;
    maxDiscountAmount: number | null;
    freeItemMenuItemIds: string[];
    businessId: string | null;
    expiresAt: Date | null;
    isActive: boolean;
    business?: { name: string } | null;
  },
  balance: number,
): Reward {
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description,
    imageUrl: reward.imageUrl,
    pointsRequired: reward.pointsRequired,
    type: reward.type,
    discountAmount: reward.discountAmount,
    discountPercentage: reward.discountPercentage,
    maxDiscountAmount: reward.maxDiscountAmount,
    freeItemName: reward.freeItemMenuItemIds.length > 0 ? reward.name : null,
    businessId: reward.businessId,
    businessName: reward.business?.name ?? null,
    expiresAt: reward.expiresAt?.toISOString() ?? null,
    isActive: reward.isActive,
    isUnlocked: balance >= reward.pointsRequired,
  };
}

export function toRedemption(row: {
  id: string;
  rewardId: string;
  status: RewardRedemption['status'];
  pointsSpent: number;
  code: string;
  expiresAt: Date | null;
  createdAt: Date;
  reward: { name: string };
  order?: { id: string } | null;
}): RewardRedemption {
  return {
    id: row.id,
    rewardId: row.rewardId,
    rewardName: row.reward.name,
    status: row.status,
    pointsSpent: row.pointsSpent,
    code: row.code,
    orderId: row.order?.id ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReview(row: {
  id: string;
  orderId: string;
  businessId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  user: { profile: { fullName: string; avatarUrl: string | null } | null };
}): Review {
  const fullName = row.user.profile?.fullName ?? 'Grab & Go customer';
  return {
    id: row.id,
    orderId: row.orderId,
    businessId: row.businessId,
    // Reviews are public: show a first name and initial, not the full identity.
    authorName: abbreviateName(fullName),
    authorAvatarUrl: row.user.profile?.avatarUrl ?? null,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? 'Customer';
  const surname = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return surname ? `${first} ${surname.charAt(0).toUpperCase()}.` : first;
}
