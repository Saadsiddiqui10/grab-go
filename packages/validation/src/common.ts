import { z } from 'zod';

/**
 * Primitives every other schema is built from.
 *
 * Defined once so "what is a valid phone number" has exactly one answer across
 * the signup form, the merchant staff invite, and the admin user search.
 */

export const cuidSchema = z
  .string()
  .min(8, 'Invalid id')
  .max(64, 'Invalid id')
  .regex(/^[a-z0-9_-]+$/i, 'Invalid id');

export const idSchema = cuidSchema;

/**
 * Pakistani mobile numbers, normalised to E.164.
 *
 * Accepts the three forms people actually type — `03001234567`, `3001234567`,
 * `+923001234567` — and stores one. Without this, the same person can create two
 * accounts with what they consider the same number.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine(
    (value) => /^(\+92|92|0)?3\d{9}$/.test(value),
    'Enter a valid Pakistani mobile number, e.g. 0300 1234567',
  )
  .transform((value) => {
    const digits = value.replace(/^\+?92/, '').replace(/^0/, '');
    return `+92${digits}`;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(255);

/**
 * Password policy: length over composition rules.
 *
 * A 10-character passphrase resists guessing better than "P@ss1!", and arbitrary
 * symbol requirements mostly produce predictable substitutions.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'That password is too long')
  .refine((value) => value.trim().length > 0, 'Password cannot be blank');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your name')
  .max(80, 'That name is too long');

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const paisaSchema = z
  .number()
  .int('Amounts must be a whole number of paisa')
  .min(0)
  .max(100_000_000);

export const basisPointsSchema = z.number().int().min(0).max(10_000);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Query strings arrive as text, so booleans and numbers are coerced. */
export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

export const minutesOfDaySchema = z.number().int().min(0).max(1439);

export const dayOfWeekSchema = z.number().int().min(0).max(6);

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

/** Free text a customer types. Trimmed, length-capped, never trusted as markup. */
export const shortTextSchema = z.string().trim().max(280);
export const longTextSchema = z.string().trim().max(2000);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes');

export const urlSchema = z.string().trim().url('Enter a valid URL').max(2048);

export const ratingSchema = z.number().int().min(1).max(5);
