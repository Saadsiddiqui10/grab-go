import { z } from 'zod';
import {
  emailSchema,
  fullNameSchema,
  idSchema,
  otpSchema,
  passwordSchema,
  phoneSchema,
} from './common';

/**
 * Authentication contracts.
 *
 * The app offers four ways in — phone OTP, email/password, Google and Apple — and
 * each lands on the same `AuthSession`. Referral codes ride along at signup so a
 * friend's invite survives account creation.
 */

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4)
  .max(16)
  .regex(/^[A-Z0-9]+$/, 'Referral codes are letters and numbers only');

/** Sent with every auth call so referral abuse checks have something to key on. */
export const deviceContextSchema = z.object({
  deviceId: z.string().trim().min(8).max(128).optional(),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

export const registerWithEmailSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  referralCode: referralCodeSchema.optional(),
  device: deviceContextSchema.optional(),
});

export const loginWithEmailSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  device: deviceContextSchema.optional(),
});

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  /** Distinguishes a login from a signup so the copy and rate limits can differ. */
  intent: z.enum(['LOGIN', 'SIGNUP', 'VERIFY']).default('LOGIN'),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
  /** Supplied on first signup; ignored when the account already exists. */
  fullName: fullNameSchema.optional(),
  referralCode: referralCodeSchema.optional(),
  device: deviceContextSchema.optional(),
});

/**
 * OAuth: the client sends the provider's identity token, never a profile it
 * assembled itself. The server verifies the signature against the provider's JWKS
 * before trusting a single field.
 */
export const oauthSchema = z.object({
  provider: z.enum(['GOOGLE', 'APPLE']),
  idToken: z.string().min(16).max(8192),
  /** Apple returns the name only on the very first authorisation. */
  fullName: fullNameSchema.optional(),
  nonce: z.string().max(255).optional(),
  referralCode: referralCodeSchema.optional(),
  device: deviceContextSchema.optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16).max(2048),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(2048).optional(),
  /** Sign out everywhere, e.g. after a password change. */
  allDevices: z.boolean().default(false),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(16).max(512),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

/**
 * Account deletion is destructive and irreversible, so it is confirmed twice:
 * the user re-authenticates and types the word.
 */
export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE'),
  password: z.string().max(128).optional(),
});

export const registerDeviceSchema = z.object({
  token: z.string().trim().min(8).max(512),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  deviceId: z.string().trim().max(128).optional(),
});

export const merchantLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  businessId: idSchema.optional(),
});

export type RegisterWithEmailInput = z.infer<typeof registerWithEmailSchema>;
export type LoginWithEmailInput = z.infer<typeof loginWithEmailSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type OAuthInput = z.infer<typeof oauthSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type DeviceContext = z.infer<typeof deviceContextSchema>;
