import { z } from 'zod';
import {
  coordinatesSchema,
  emailSchema,
  fullNameSchema,
  idSchema,
  phoneSchema,
  shortTextSchema,
  urlSchema,
} from './common';

/** Customer profile, saved locations and favourites. */

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    avatarUrl: urlSchema.nullish(),
    cityId: idSchema.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export const savedAddressSchema = z.object({
  label: shortTextSchema.pipe(z.string().min(1).max(40)),
  addressLine: z.string().trim().min(4).max(255),
  areaId: idSchema.nullish(),
  cityId: idSchema,
  coordinates: coordinatesSchema.nullish(),
  isDefault: z.boolean().default(false),
});

export const setFavouriteSchema = z.object({
  businessId: idSchema,
});

/**
 * Manual location selection, used when the customer declines the OS permission.
 * Either an area or a coordinate is enough to personalise the home screen.
 */
export const setManualLocationSchema = z
  .object({
    areaId: idSchema.optional(),
    cityId: idSchema.optional(),
    coordinates: coordinatesSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.areaId ?? value.cityId ?? value.coordinates),
    'Choose an area or share your location',
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SavedAddressInput = z.infer<typeof savedAddressSchema>;
