import { z } from 'zod';
import { emailSchema, fullNameSchema, idSchema, isoDateSchema, longTextSchema } from './common';

/** Admin and merchant-staff management contracts. */

export const adminUserQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED', 'ALL']).default('ALL'),
  role: z.enum(['CUSTOMER', 'MERCHANT', 'ADMIN', 'SUPER_ADMIN', 'ALL']).default('ALL'),
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const suspendUserSchema = z.object({
  reason: longTextSchema,
});

export const adminBusinessQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z
    .enum([
      'PENDING_APPROVAL',
      'ACTIVE',
      'REJECTED',
      'SUSPENDED',
      'TEMPORARILY_CLOSED',
      'ALL',
    ])
    .default('ALL'),
  cityId: idSchema.optional(),
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const businessDecisionSchema = z.object({
  /** Required on rejection so the applicant learns why. */
  note: longTextSchema.optional(),
});

export const rejectBusinessSchema = z.object({
  note: longTextSchema,
});

export const inviteStaffSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  staffRole: z.enum(['OWNER', 'MANAGER', 'STAFF']).default('STAFF'),
});

export const updateStaffSchema = z.object({
  staffRole: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(),
  isActive: z.boolean().optional(),
});

export const analyticsRangeSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Convenience presets the dashboards use before offering a custom range. */
  preset: z.enum(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).default('WEEK'),
});

export const createCitySchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().min(2).max(60),
  countryCode: z.string().trim().length(2).toUpperCase().default('PK'),
  timezone: z.string().trim().min(3).max(64).default('Asia/Karachi'),
  isActive: z.boolean().default(true),
});

export const createAreaSchema = z.object({
  cityId: idSchema,
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().min(2).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isActive: z.boolean().default(true),
});

export const analyticsEventSchema = z.object({
  event: z.string().trim().min(2).max(64),
  properties: z
    .record(z.string(), z.union([z.string().max(255), z.number(), z.boolean(), z.null()]))
    .optional(),
  occurredAt: isoDateSchema.optional(),
});

export const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventSchema).min(1).max(50),
});

export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type AnalyticsBatchInput = z.infer<typeof analyticsBatchSchema>;
