import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { prisma } from '../src/db';

/**
 * The e2e harness: the whole API, in process, driven through `app.inject`
 * (no port), against the seeded e2e database.
 */

export const DEMO_PASSWORD = 'grabandgo2026';

let app: FastifyInstance | null = null;

export async function startApi(): Promise<FastifyInstance> {
  app ??= await buildServer();
  await app.ready();
  return app;
}

export async function stopApi(): Promise<void> {
  await app?.close();
  app = null;
  await prisma.$disconnect();
}

export { prisma };

export interface ApiResult<T = any> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string; fields?: Record<string, string[]> };
}

// Each signed-in client gets its own address, as real phones would, so the
// suite's many logins do not trip the per-IP auth limit meant for attackers.
let nextAddress = 1;
export const freshIp = (): string => `10.77.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}`;

export async function call<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { token?: string; body?: unknown; ip?: string } = {},
): Promise<ApiResult<T>> {
  if (!app) throw new Error('startApi() first');
  const response = await app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: options.ip ?? '10.99.0.1',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
  });
  const json = response.json() as { ok: boolean; data: T; error?: ApiResult['error'] };
  return { status: response.statusCode, ok: json.ok, data: json.data, ...(json.error ? { error: json.error } : {}) };
}

/* ------------------------------------------------------------------ actors */

export interface Session {
  token: string;
  refreshToken: string;
  userId: string;
  ip: string;
}

function toSession(result: ApiResult, ip: string): Session {
  if (!result.ok) throw new Error(`Sign-in failed: ${result.error?.code} ${result.error?.message}`);
  const tokens = result.data.tokens ?? result.data;
  return {
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId: result.data.user?.id,
    ip,
  };
}

export async function login(email: string, password = DEMO_PASSWORD): Promise<Session> {
  const ip = freshIp();
  return toSession(await call('POST', '/auth/login', { body: { email, password }, ip }), ip);
}

export async function merchantLogin(email: string): Promise<Session> {
  const ip = freshIp();
  return toSession(
    await call('POST', '/auth/merchant/login', { body: { email, password: DEMO_PASSWORD }, ip }),
    ip,
  );
}

/** A brand-new customer, so tests never share points, orders or rewards. */
export async function newCustomer(): Promise<Session & { email: string }> {
  const ip = freshIp();
  const email = `e2e+${randomUUID().slice(0, 8)}@example.com`;
  const session = toSession(
    await call('POST', '/auth/register', {
      body: { fullName: 'E2E Customer', email, password: DEMO_PASSWORD },
      ip,
    }),
    ip,
  );
  return { ...session, email };
}

/* ------------------------------------------------------------------ cafés */

export const CAFES = {
  espressoLab: { slug: 'espresso-lab-clifton', owner: 'owner@espressolab.example' },
  karak: { slug: 'karak-and-co-dha', owner: 'owner@karakco.example' },
  roastery: { slug: 'the-roastery-zamzama', owner: 'owner@roastery.example' },
} as const;

export async function cafeId(slug: string): Promise<string> {
  const result = await call<Array<{ id: string; slug: string }>>('GET', '/cafes?limit=50');
  const found = result.data.find((cafe) => cafe.slug === slug);
  if (!found) throw new Error(`No seeded cafe ${slug}`);
  return found.id;
}

/** A cart line for a plain item (first variant, no extras). */
export async function lineFor(
  businessId: string,
  itemName?: string,
  quantity = 1,
): Promise<{ menuItemId: string; variantId?: string; modifierOptionIds: string[]; quantity: number }> {
  const menu = await call('GET', `/cafes/${businessId}/menu`);
  const items = menu.data.categories.flatMap((category: { items: any[] }) => category.items);
  const item = itemName ? items.find((entry: any) => entry.name === itemName) : items[0];
  if (!item) throw new Error(`No item ${itemName ?? ''} at ${businessId}`);
  // Required option groups take their first option.
  const modifierOptionIds = (item.modifiers ?? [])
    .filter((group: any) => group.isRequired || group.minSelections > 0)
    .map((group: any) => group.options[0]?.id)
    .filter(Boolean);
  return {
    menuItemId: item.id,
    ...(item.variants?.length ? { variantId: item.variants[0].id } : {}),
    modifierOptionIds,
    quantity,
  };
}

/* ----------------------------------------------------------------- orders */

export async function placeOrder(
  customer: Session,
  businessId: string,
  options: {
    lines?: Awaited<ReturnType<typeof lineFor>>[];
    collection?: unknown;
    paymentMethod?: 'CARD' | 'CASH_ON_PICKUP';
    redemptionId?: string;
    idempotencyKey?: string;
  } = {},
): Promise<ApiResult> {
  return call('POST', '/orders', {
    token: customer.token,
    ip: customer.ip,
    body: {
      businessId,
      lines: options.lines ?? [await lineFor(businessId)],
      pickup: { mode: 'ASAP' },
      ...(options.collection ? { collection: options.collection } : {}),
      ...(options.redemptionId ? { redemptionId: options.redemptionId } : {}),
      paymentMethod: options.paymentMethod ?? 'CARD',
      idempotencyKey: options.idempotencyKey ?? randomUUID(),
    },
  });
}

export async function pay(customer: Session, orderId: string): Promise<ApiResult> {
  const initiated = await call('POST', '/payments/initiate', {
    token: customer.token,
    ip: customer.ip,
    body: { orderId, method: 'CARD' },
  });
  if (!initiated.ok) return initiated;
  return call('POST', '/payments/confirm', {
    token: customer.token,
    ip: customer.ip,
    body: { paymentId: initiated.data.paymentId ?? initiated.data.id },
  });
}

/** A paid card order, ready for the café to work. */
export async function paidOrder(customer: Session, businessId: string, options: Parameters<typeof placeOrder>[2] = {}) {
  const order = await placeOrder(customer, businessId, options);
  if (!order.ok) throw new Error(`Order failed: ${order.error?.code} ${order.error?.message}`);
  const payment = await pay(customer, order.data.id);
  if (!payment.ok || payment.data.status !== 'PAID') throw new Error(`Payment failed: ${JSON.stringify(payment)}`);
  return order.data;
}

export async function advance(
  merchant: Session,
  businessId: string,
  orderId: string,
  step: 'accept' | 'preparing' | 'ready' | 'complete',
): Promise<ApiResult> {
  return call('POST', `/merchant/${businessId}/orders/${orderId}/${step}`, {
    token: merchant.token,
    ip: merchant.ip,
    body: {},
  });
}

/** Accept, prepare, ready, then hand over with the customer's real code. */
export async function fulfil(customer: Session, merchant: Session, businessId: string, orderId: string): Promise<ApiResult> {
  for (const step of ['accept', 'preparing', 'ready'] as const) {
    const result = await advance(merchant, businessId, orderId, step);
    if (!result.ok) throw new Error(`${step} failed: ${result.error?.code} ${result.error?.message}`);
  }
  const mine = await call('GET', `/orders/${orderId}`, { token: customer.token, ip: customer.ip });
  return call('POST', `/merchant/${businessId}/orders/${orderId}/pickup`, {
    token: merchant.token,
    ip: merchant.ip,
    body: { code: mine.data.pickupCode },
  });
}
