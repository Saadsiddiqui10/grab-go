import { z } from 'zod';
import {
  coordinatesSchema,
  dateKeySchema,
  dayOfWeekSchema,
  idSchema,
  longTextSchema,
  minutesOfDaySchema,
  paisaSchema,
  ratingSchema,
  shortTextSchema,
  slugSchema,
  urlSchema,
} from './common';

/**
 * Discovery, cafe profiles and menu management.
 *
 * The vocabulary is deliberately vertical-neutral — "business", "menu item",
 * "category" — so opening the platform to bakeries and restaurants is a matter of
 * seeding data, not renaming tables.
 */

export const businessTypeSchema = z.enum([
  'CAFE',
  'RESTAURANT',
  'BAKERY',
  'FAST_FOOD',
  'DESSERT',
  'BUBBLE_TEA',
  'OTHER',
]);

export const discoverSortSchema = z.enum([
  'RECOMMENDED',
  'NEAREST',
  'FASTEST',
  'RATING',
  'POPULAR',
]);

/**
 * The discover query.
 *
 * Location is optional throughout: a customer who declined the permission still
 * gets a full browsing experience, sorted by area instead of distance.
 */
export const discoverQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  cityId: idSchema.optional(),
  areaId: idSchema.optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().int().min(200).max(50_000).default(10_000),
  type: businessTypeSchema.optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')))
    .pipe(z.array(z.string().trim().min(1).max(40)).max(10))
    .optional(),
  openNow: z.coerce.boolean().optional(),
  favouritesOnly: z.coerce.boolean().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxPrepMinutes: z.coerce.number().int().min(1).max(120).optional(),
  priceTier: z.coerce.number().int().min(1).max(4).optional(),
  sort: discoverSortSchema.default('RECOMMENDED'),
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchMenuQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  cityId: idSchema.optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* --------------------------------------------------------- merchant: business */

export const openingHourSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    isClosed: z.boolean().default(false),
    opensAt: minutesOfDaySchema.nullable(),
    closesAt: minutesOfDaySchema.nullable(),
  })
  .refine(
    (value) => value.isClosed || (value.opensAt !== null && value.closesAt !== null),
    { message: 'Set both an opening and a closing time', path: ['opensAt'] },
  )
  .refine(
    (value) =>
      value.isClosed ||
      value.opensAt === null ||
      value.closesAt === null ||
      // Equal times would mean a zero-length day; past-midnight closes are allowed.
      value.opensAt !== value.closesAt,
    { message: 'Opening and closing times cannot be identical', path: ['closesAt'] },
  );

export const updateOpeningHoursSchema = z.object({
  hours: z.array(openingHourSchema).length(7, 'Provide all seven days'),
});

export const holidaySchema = z.object({
  date: dateKeySchema,
  name: shortTextSchema.optional(),
  isClosed: z.boolean().default(true),
  opensAt: minutesOfDaySchema.nullish(),
  closesAt: minutesOfDaySchema.nullish(),
});

export const updateBusinessProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: longTextSchema.nullish(),
  phone: z.string().trim().max(24).nullish(),
  logoUrl: urlSchema.nullish(),
  coverImageUrl: urlSchema.nullish(),
  addressLine: z.string().trim().min(4).max(255).optional(),
  areaId: idSchema.nullish(),
  coordinates: coordinatesSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  priceTier: z.number().int().min(1).max(4).optional(),
});

export const updateBusinessSettingsSchema = z.object({
  acceptingOrders: z.boolean().optional(),
  temporarilyClosed: z.boolean().optional(),
  prepTimeMinutes: z.number().int().min(1).max(120).optional(),
  minLeadTimeMinutes: z.number().int().min(0).max(120).optional(),
  maxScheduleAheadMinutes: z.number().int().min(15).max(7 * 24 * 60).optional(),
  maxConcurrentOrders: z.number().int().min(1).max(500).nullish(),
  maxOrdersPerSlot: z.number().int().min(1).max(100).nullish(),
  minimumOrderTotal: paisaSchema.optional(),
  loyaltyEnabled: z.boolean().optional(),
});

export const registerBusinessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
  type: businessTypeSchema.default('CAFE'),
  description: longTextSchema.optional(),
  addressLine: z.string().trim().min(4).max(255),
  areaId: idSchema,
  coordinates: coordinatesSchema,
  phone: z.string().trim().max(24).optional(),
  ownerEmail: z.string().trim().email().max(255),
  ownerName: z.string().trim().min(2).max(80),
});

/* ------------------------------------------------------------- merchant: menu */

export const menuCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: shortTextSchema.nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().default(true),
});

export const menuVariantSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(40),
  /** May be negative for a smaller size priced below the base. */
  priceDelta: z.number().int().min(-1_000_000).max(1_000_000),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99).optional(),
});

export const menuModifierOptionSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(40),
  priceDelta: z.number().int().min(-1_000_000).max(1_000_000),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99).optional(),
});

export const menuModifierSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(40),
    selectionType: z.enum(['SINGLE', 'MULTIPLE']),
    isRequired: z.boolean().default(false),
    minSelections: z.number().int().min(0).max(20).default(0),
    maxSelections: z.number().int().min(1).max(20).nullish(),
    sortOrder: z.number().int().min(0).max(99).optional(),
    options: z.array(menuModifierOptionSchema).min(1).max(30),
  })
  .refine(
    (value) =>
      value.maxSelections == null || value.maxSelections >= value.minSelections,
    { message: 'Maximum must be at least the minimum', path: ['maxSelections'] },
  )
  .refine(
    (value) => value.selectionType !== 'SINGLE' || (value.maxSelections ?? 1) === 1,
    { message: 'A single-select group allows exactly one choice', path: ['maxSelections'] },
  )
  .refine(
    (value) => value.options.filter((option) => option.isDefault).length <= 1 ||
      value.selectionType === 'MULTIPLE',
    { message: 'Only one option can be the default', path: ['options'] },
  );

export const createMenuItemSchema = z.object({
  categoryId: idSchema,
  name: z.string().trim().min(1).max(80),
  description: longTextSchema.nullish(),
  imageUrl: urlSchema.nullish(),
  basePrice: paisaSchema,
  isAvailable: z.boolean().default(true),
  isSoldOut: z.boolean().default(false),
  isPopular: z.boolean().default(false),
  calories: z.number().int().min(0).max(5000).nullish(),
  prepTimeMinutes: z.number().int().min(1).max(120).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  variants: z.array(menuVariantSchema).max(10).default([]),
  modifiers: z.array(menuModifierSchema).max(10).default([]),
});

export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  categoryId: idSchema.optional(),
});

/** The one-tap control a barista uses when the oat milk runs out. */
export const setItemAvailabilitySchema = z.object({
  isAvailable: z.boolean().optional(),
  isSoldOut: z.boolean().optional(),
});

export const reorderItemsSchema = z.object({
  /** Ids in their new display order. */
  ids: z.array(idSchema).min(1).max(200),
});

/* -------------------------------------------------------------------- reviews */

export const createReviewSchema = z.object({
  orderId: idSchema,
  rating: ratingSchema,
  comment: longTextSchema.nullish(),
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsSchema>;
export type OpeningHourInput = z.infer<typeof openingHourSchema>;

/* --------------------------------------------- listings (not on Grab & Go yet) */

export const listingsQuerySchema = z.object({
  /** One category slug, as on discovery. */
  tags: z.string().trim().max(40).optional(),
});

export const adminListingsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Hand an imported listing to its real owner, who then adds a menu. */
export const claimListingSchema = z.object({
  ownerEmail: z.string().trim().email().max(255),
  ownerName: z.string().trim().min(2).max(80),
});
