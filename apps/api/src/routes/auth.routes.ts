import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  confirmPasswordResetSchema,
  deleteAccountSchema,
  loginWithEmailSchema,
  logoutSchema,
  merchantLoginSchema,
  oauthSchema,
  refreshTokenSchema,
  registerDeviceSchema,
  registerWithEmailSchema,
  requestOtpSchema,
  requestPasswordResetSchema,
  verifyOtpSchema,
} from '@grabgo/validation';
import { parse } from '../lib/validate';
import { success } from '../lib/http-error';
import { clientIp, requireAuth, userAgent } from '../lib/auth-context';
import {
  changePassword,
  confirmPasswordReset,
  deleteAccount,
  getProfile,
  loginWithEmail,
  logout,
  refreshSession,
  registerWithEmail,
  requestOtp,
  requestPasswordReset,
  signInWithIdentity,
  verifyOtp,
} from '../services/auth.service';
import { verifyAppleIdToken, verifyGoogleIdToken } from '../services/oauth.service';
import { registerDeviceToken, removeDeviceToken } from '../services/user.service';

/**
 * Authentication routes.
 *
 * The tighter rate limits here are the point: these are the endpoints worth
 * attacking, and the generous global limit is wrong for them.
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const strictLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  } as const;

  const otpLimit = {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  } as const;

  app.post('/auth/register', strictLimit, async (request, reply) => {
    const body = parse(registerWithEmailSchema, request.body);

    const session = await registerWithEmail({
      fullName: body.fullName,
      email: body.email,
      password: body.password,
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.referralCode ? { referralCode: body.referralCode } : {}),
      deviceId: body.device?.deviceId ?? null,
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
    });

    return reply.code(201).send(success(session));
  });

  app.post('/auth/login', strictLimit, async (request) => {
    const body = parse(loginWithEmailSchema, request.body);

    const session = await loginWithEmail({
      email: body.email,
      password: body.password,
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
      deviceId: body.device?.deviceId ?? null,
    });

    return success(session);
  });

  /** Merchant dashboard sign-in. Same credentials, same session shape. */
  app.post('/auth/merchant/login', strictLimit, async (request) => {
    const body = parse(merchantLoginSchema, request.body);

    const session = await loginWithEmail({
      email: body.email,
      password: body.password,
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
    });

    return success(session);
  });

  app.post('/auth/otp/request', otpLimit, async (request) => {
    const body = parse(requestOtpSchema, request.body);
    const result = await requestOtp(body.phone, body.intent);
    return success(result);
  });

  app.post('/auth/otp/verify', strictLimit, async (request) => {
    const body = parse(verifyOtpSchema, request.body);

    const session = await verifyOtp({
      phone: body.phone,
      code: body.code,
      ...(body.fullName ? { fullName: body.fullName } : {}),
      ...(body.referralCode ? { referralCode: body.referralCode } : {}),
      deviceId: body.device?.deviceId ?? null,
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
    });

    return success(session);
  });

  app.post('/auth/oauth', strictLimit, async (request) => {
    const body = parse(oauthSchema, request.body);

    // The identity token is verified against the provider's own keys before a
    // single field of it is believed.
    const identity =
      body.provider === 'GOOGLE'
        ? await verifyGoogleIdToken(body.idToken)
        : await verifyAppleIdToken(body.idToken, body.fullName ?? null);

    const session = await signInWithIdentity({
      provider: identity.provider,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      fullName: identity.fullName ?? body.fullName ?? null,
      ...(body.referralCode ? { referralCode: body.referralCode } : {}),
      deviceId: body.device?.deviceId ?? null,
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
    });

    return success(session);
  });

  app.post('/auth/refresh', async (request) => {
    const body = parse(refreshTokenSchema, request.body);

    const tokens = await refreshSession(body.refreshToken, {
      userAgent: userAgent(request) ?? null,
      ipAddress: clientIp(request) ?? null,
    });

    return success(tokens);
  });

  app.post('/auth/logout', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(logoutSchema, request.body ?? {});

    await logout(principal.userId, {
      ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
      allDevices: body.allDevices,
    });

    return success({ loggedOut: true });
  });

  app.post('/auth/password/reset-request', strictLimit, async (request) => {
    const body = parse(requestPasswordResetSchema, request.body);
    const result = await requestPasswordReset(body.email);
    // Always the same answer, whether or not the account exists.
    return success({ sent: true, ...result });
  });

  app.post('/auth/password/reset', strictLimit, async (request) => {
    const body = parse(confirmPasswordResetSchema, request.body);
    await confirmPasswordReset(body.token, body.password);
    return success({ reset: true });
  });

  app.post('/auth/password/change', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(changePasswordSchema, request.body);
    await changePassword(principal.userId, body.currentPassword, body.newPassword);
    return success({ changed: true });
  });

  app.get('/auth/me', async (request) => {
    const principal = await requireAuth(request);
    return success(await getProfile(principal.userId));
  });

  app.delete('/auth/account', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(deleteAccountSchema, request.body ?? {});
    await deleteAccount(principal.userId, body.password);
    return success({ deleted: true });
  });

  /* --------------------------------------------------------------- devices */

  app.post('/auth/devices', async (request, reply) => {
    const principal = await requireAuth(request);
    const body = parse(registerDeviceSchema, request.body);

    await registerDeviceToken(principal.userId, {
      token: body.token,
      platform: body.platform,
      ...(body.deviceId ? { deviceId: body.deviceId } : {}),
    });

    return reply.code(201).send(success({ registered: true }));
  });

  app.delete('/auth/devices/:token', async (request) => {
    const principal = await requireAuth(request);
    const { token } = request.params as { token: string };
    await removeDeviceToken(principal.userId, token);
    return success({ removed: true });
  });
}
