import { generateReferralCode } from '@grabgo/core';
import type { AuthSession, AuthTokens, UserProfile } from '@grabgo/types';
import type { AuthProvider, UserRole } from '@prisma/client';
import { prisma, type Tx } from '../db';
import { getEnv } from '../env';
import { HttpError, forbidden, notFound } from '../lib/http-error';
import {
  generateOtpCode,
  hashIp,
  hashToken,
  hashPassword,
  randomBytes,
  randomToken,
  verifyPassword,
  verifyPasswordOrDecoy,
} from '../lib/crypto';
import { signAccessToken } from '../lib/tokens';
import { toUserProfile, userWithProfile } from '../mappers';
import { attachReferralAtSignup } from './referral.service';
import { notifyReferralJoined } from './notification.service';
import { sendSms } from './sms.service';

/**
 * Authentication.
 *
 * Four ways in — phone OTP, email/password, Google, Apple — all landing on the
 * same session. The security posture:
 *
 *   - Refresh tokens are opaque, stored only as a hash, and rotated on every use.
 *     Presenting an already-rotated token revokes the whole family, because the
 *     only way that happens is if a token was stolen.
 *   - Login and password reset never reveal whether an account exists.
 *   - OTP codes are hashed, expiring and attempt-limited.
 */

const REFERRAL_CODE_ATTEMPTS = 6;

/* --------------------------------------------------------------- session issue */

export async function issueSession(
  tx: Tx,
  userId: string,
  context: { userAgent?: string | null; ipAddress?: string | null; deviceId?: string | null },
): Promise<AuthTokens> {
  const env = getEnv();

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      staffRoles: {
        where: { isActive: true },
        select: { businessId: true },
      },
    },
  });

  assertUsable(user.status);

  const refreshToken = randomToken(48);
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const session = await tx.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ipAddress: context.ipAddress ?? null,
      deviceId: context.deviceId ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  const accessToken = await signAccessToken(
    {
      sub: user.id,
      role: user.role,
      businesses: user.staffRoles.map((staff) => staff.businessId),
      sid: session.id,
    },
    env.AUTH_SECRET,
    env.ACCESS_TOKEN_TTL_SECONDS,
  );

  await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

function assertUsable(status: string): void {
  if (status === 'SUSPENDED') {
    throw new HttpError(
      'ACCOUNT_SUSPENDED',
      'This account has been suspended. Contact support for help.',
    );
  }
  if (status === 'DELETED') {
    throw new HttpError('INVALID_CREDENTIALS', 'That account no longer exists.');
  }
}

/**
 * Rotate a refresh token.
 *
 * Presenting a token that has already been rotated means someone is replaying a
 * stolen one — the whole session family is revoked rather than just refused.
 */
export async function refreshSession(
  refreshToken: string,
  context: { userAgent?: string | null; ipAddress?: string | null },
): Promise<AuthTokens> {
  const hash = hashToken(refreshToken);

  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        deviceId: true,
      },
    });

    if (!session) {
      throw new HttpError('UNAUTHENTICATED', 'Please sign in again.');
    }

    if (session.replacedById || session.revokedAt) {
      await tx.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new HttpError(
        'UNAUTHENTICATED',
        'Your session was ended for security. Please sign in again.',
      );
    }

    if (session.expiresAt < new Date()) {
      throw new HttpError('TOKEN_EXPIRED', 'Your session expired. Please sign in again.');
    }

    const tokens = await issueSession(tx, session.userId, {
      ...context,
      deviceId: session.deviceId,
    });

    const replacement = await tx.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashToken(tokens.refreshToken) },
      select: { id: true },
    });

    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    });

    return tokens;
  });
}

export async function logout(
  userId: string,
  options: { refreshToken?: string; allDevices?: boolean },
): Promise<void> {
  if (options.allDevices || !options.refreshToken) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return;
  }

  await prisma.session.updateMany({
    where: { userId, refreshTokenHash: hashToken(options.refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/* ------------------------------------------------------------- account creation */

async function allocateReferralCode(tx: Tx, displayName: string): Promise<string> {
  for (let attempt = 0; attempt < REFERRAL_CODE_ATTEMPTS; attempt += 1) {
    // Widen the random suffix after a couple of collisions rather than looping
    // forever on a popular first name.
    const code = generateReferralCode(displayName, randomBytes, attempt < 2 ? 3 : 5);
    const taken = await tx.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }

  return `GRAB${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`;
}

interface CreateUserInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  role?: UserRole;
  referralCode?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
}

async function createUser(tx: Tx, input: CreateUserInput): Promise<string> {
  const now = new Date();

  const user = await tx.user.create({
    data: {
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      emailVerifiedAt: input.emailVerified ? now : null,
      phoneVerifiedAt: input.phoneVerified ? now : null,
      role: input.role ?? 'CUSTOMER',
      referralCode: await allocateReferralCode(tx, input.fullName),
      profile: { create: { fullName: input.fullName } },
      pointsAccount: { create: {} },
    },
    select: { id: true },
  });

  if (input.referralCode) {
    const env = getEnv();
    const outcome = await attachReferralAtSignup(tx, {
      refereeId: user.id,
      code: input.referralCode,
      deviceId: input.deviceId ?? null,
      ipHash: hashIp(input.ipAddress ?? undefined, env.AUTH_SECRET),
    });

    if (outcome.attached) {
      const referral = await tx.referral.findUnique({
        where: { refereeId: user.id },
        select: { referrerId: true },
      });
      if (referral) void notifyReferralJoined(referral.referrerId);
    }
  }

  return user.id;
}

/* ------------------------------------------------------------ email + password */

export interface EmailRegistration {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  referralCode?: string;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function registerWithEmail(input: EmailRegistration): Promise<AuthSession> {
  const passwordHash = await hashPassword(input.password);

  const { userId, tokens } = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(
        'CONFLICT',
        'An account with that email already exists. Try signing in.',
      );
    }

    const id = await createUser(tx, {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash,
      referralCode: input.referralCode ?? null,
      deviceId: input.deviceId ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    await tx.authIdentity.create({
      data: { userId: id, provider: 'PASSWORD', providerAccountId: input.email },
    });

    const issued = await issueSession(tx, id, {
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      deviceId: input.deviceId ?? null,
    });

    return { userId: id, tokens: issued };
  });

  return buildSession(userId, tokens, 'PASSWORD', true);
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
}): Promise<AuthSession> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, status: true },
  });

  // Always run a bcrypt comparison, even with no account, so response time does
  // not reveal which emails are registered.
  const valid = await verifyPasswordOrDecoy(input.password, user?.passwordHash ?? null);

  if (!user || !valid) {
    throw new HttpError('INVALID_CREDENTIALS', 'That email or password is incorrect.');
  }

  assertUsable(user.status);

  const tokens = await prisma.$transaction((tx) =>
    issueSession(tx, user.id, {
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      deviceId: input.deviceId ?? null,
    }),
  );

  return buildSession(user.id, tokens, 'PASSWORD', false);
}

/* --------------------------------------------------------------------- phone */

export async function requestOtp(
  phone: string,
  intent: 'LOGIN' | 'SIGNUP' | 'VERIFY',
): Promise<{ expiresInSeconds: number; devCode?: string }> {
  const env = getEnv();
  const code = env.OTP_DEV_CODE ?? generateOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  // Invalidate outstanding challenges so only the newest code works.
  await prisma.otpChallenge.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.otpChallenge.create({
    data: { phone, codeHash: hashToken(code), purpose: intent, expiresAt },
  });

  await sendSms(phone, `${code} is your Grab & Go verification code. It expires in 5 minutes.`);

  return {
    expiresInSeconds: env.OTP_TTL_SECONDS,
    // Only ever populated in development, where env.ts permits OTP_DEV_CODE.
    ...(env.OTP_DEV_CODE ? { devCode: env.OTP_DEV_CODE } : {}),
  };
}

export async function verifyOtp(input: {
  phone: string;
  code: string;
  fullName?: string;
  referralCode?: string;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthSession> {
  const env = getEnv();

  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone: input.phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    throw new HttpError('OTP_INVALID', 'Request a new code and try again.');
  }

  if (challenge.expiresAt < new Date()) {
    throw new HttpError('OTP_EXPIRED', 'That code expired. Request a new one.');
  }

  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw new HttpError(
      'OTP_TOO_MANY_ATTEMPTS',
      'Too many incorrect codes. Request a new one.',
    );
  }

  if (challenge.codeHash !== hashToken(input.code)) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new HttpError('OTP_INVALID', 'That code is not correct.');
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const { userId, isNewUser, tokens } = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { phone: input.phone },
      select: { id: true, status: true },
    });

    if (existing) {
      assertUsable(existing.status);
      await tx.user.update({
        where: { id: existing.id },
        data: { phoneVerifiedAt: new Date() },
      });

      const issued = await issueSession(tx, existing.id, {
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        deviceId: input.deviceId ?? null,
      });

      return { userId: existing.id, isNewUser: false, tokens: issued };
    }

    const id = await createUser(tx, {
      fullName: input.fullName?.trim() || 'Grab & Go customer',
      phone: input.phone,
      phoneVerified: true,
      referralCode: input.referralCode ?? null,
      deviceId: input.deviceId ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    await tx.authIdentity.create({
      data: { userId: id, provider: 'PHONE_OTP', providerAccountId: input.phone },
    });

    const issued = await issueSession(tx, id, {
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      deviceId: input.deviceId ?? null,
    });

    return { userId: id, isNewUser: true, tokens: issued };
  });

  return buildSession(userId, tokens, 'PHONE_OTP', isNewUser);
}

/* --------------------------------------------------------------------- oauth */

export async function signInWithIdentity(input: {
  provider: 'GOOGLE' | 'APPLE';
  subject: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  referralCode?: string;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthSession> {
  const { userId, isNewUser, tokens } = await prisma.$transaction(async (tx) => {
    const identity = await tx.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.subject,
        },
      },
      select: { userId: true },
    });

    if (identity) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: identity.userId },
        select: { status: true },
      });
      assertUsable(user.status);

      const issued = await issueSession(tx, identity.userId, {
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        deviceId: input.deviceId ?? null,
      });
      return { userId: identity.userId, isNewUser: false, tokens: issued };
    }

    // Link to an existing account only when the provider vouched for the email.
    // Without that check, anyone able to mint a token for an unverified address
    // could take over the matching Grab & Go account.
    const linkable =
      input.email && input.emailVerified
        ? await tx.user.findUnique({
            where: { email: input.email },
            select: { id: true, status: true },
          })
        : null;

    if (linkable) {
      assertUsable(linkable.status);
      await tx.authIdentity.create({
        data: {
          userId: linkable.id,
          provider: input.provider,
          providerAccountId: input.subject,
          email: input.email,
        },
      });

      const issued = await issueSession(tx, linkable.id, {
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        deviceId: input.deviceId ?? null,
      });
      return { userId: linkable.id, isNewUser: false, tokens: issued };
    }

    const id = await createUser(tx, {
      fullName: input.fullName?.trim() || 'Grab & Go customer',
      email: input.email,
      emailVerified: input.emailVerified,
      referralCode: input.referralCode ?? null,
      deviceId: input.deviceId ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    await tx.authIdentity.create({
      data: {
        userId: id,
        provider: input.provider,
        providerAccountId: input.subject,
        email: input.email,
      },
    });

    const issued = await issueSession(tx, id, {
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      deviceId: input.deviceId ?? null,
    });

    return { userId: id, isNewUser: true, tokens: issued };
  });

  return buildSession(userId, tokens, input.provider, isNewUser);
}

/* ---------------------------------------------------------------- passwords */

/**
 * Start a password reset.
 *
 * Always resolves the same way, whether or not the email exists — otherwise the
 * endpoint becomes a way to enumerate accounts. The token is returned only in
 * development, where there is no mail transport wired up.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ devToken?: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') return {};

  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  // TODO(email): send via the transactional provider once one is configured.
  const env = getEnv();
  return env.NODE_ENV === 'development' ? { devToken: token } : {};
}

export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new HttpError('VALIDATION_ERROR', 'That reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Changing a password signs out everywhere: if the reset was because of a
    // compromise, the attacker's session must not survive it.
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    throw new HttpError(
      'VALIDATION_ERROR',
      'This account signs in with Google, Apple or a phone number.',
    );
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new HttpError('INVALID_CREDENTIALS', 'Your current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/* -------------------------------------------------------------- account removal */

/**
 * Delete an account.
 *
 * A soft delete: orders, payments and merchant statements are financial records
 * that must survive, so identifying fields are cleared and the row is retired
 * rather than dropped.
 */
export async function deleteAccount(userId: string, password?: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, status: true },
  });

  if (!user) throw notFound('That account');

  if (user.passwordHash) {
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError('INVALID_CREDENTIALS', 'Enter your password to delete your account.');
    }
  }

  const active = await prisma.order.count({
    where: { userId, status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] } },
  });

  if (active > 0) {
    throw new HttpError(
      'CONFLICT',
      'You have an order in progress. Collect or cancel it before deleting your account.',
    );
  }

  const suffix = randomToken(8);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        email: null,
        phone: null,
        passwordHash: null,
        // Freeing the referral code lets it be reissued, and stops a deleted
        // account's outstanding invites resolving to a dead user.
        referralCode: `DELETED${suffix}`,
      },
    }),
    prisma.userProfile.updateMany({
      where: { userId },
      data: { fullName: 'Deleted account', avatarUrl: null },
    }),
    prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } }),
    prisma.deviceToken.deleteMany({ where: { userId } }),
    prisma.authIdentity.deleteMany({ where: { userId } }),
  ]);
}

/* ------------------------------------------------------------------- helpers */

async function buildSession(
  userId: string,
  tokens: AuthTokens,
  provider: AuthProvider,
  isNewUser: boolean,
): Promise<AuthSession> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    ...userWithProfile,
  });

  return { user: toUserProfile(user), tokens, isNewUser, provider };
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({ where: { id: userId }, ...userWithProfile });
  if (!user || user.status === 'DELETED') throw notFound('That account');
  return toUserProfile(user);
}

/** Businesses this user actively staffs, used to authorise merchant routes. */
export async function getStaffBusinessIds(userId: string): Promise<string[]> {
  const rows = await prisma.cafeStaff.findMany({
    where: { userId, isActive: true },
    select: { businessId: true },
  });
  return rows.map((row) => row.businessId);
}

export async function assertStaffAccess(
  userId: string,
  businessId: string,
  minimumRole: 'OWNER' | 'MANAGER' | 'STAFF' = 'STAFF',
): Promise<void> {
  const staff = await prisma.cafeStaff.findUnique({
    where: { businessId_userId: { businessId, userId } },
    select: { staffRole: true, isActive: true },
  });

  if (!staff?.isActive) throw forbidden('You do not have access to this cafe.');

  const rank: Record<string, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if ((rank[staff.staffRole] ?? 0) < (rank[minimumRole] ?? 0)) {
    throw forbidden('You need a manager account to do that.');
  }
}
