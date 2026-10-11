import { z } from 'zod';

/**
 * A café's POS connection. The endpoint's safety (HTTPS, public address) is
 * checked server-side, with DNS, because a schema cannot see where a hostname
 * points.
 */
export const posConnectionSchema = z
  .object({
    provider: z.enum(['NONE', 'WEBHOOK']),
    endpointUrl: z.string().trim().max(2048).nullish(),
    isEnabled: z.boolean().default(true),
  })
  .refine((value) => value.provider === 'NONE' || Boolean(value.endpointUrl), {
    message: 'Enter the endpoint your POS receives orders on',
    path: ['endpointUrl'],
  });

export type PosConnectionInput = z.infer<typeof posConnectionSchema>;
