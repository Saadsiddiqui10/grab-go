import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

/**
 * Talking to the test API directly, for the customer side of a scenario (the
 * dashboards are what is under test here), and signing in through the UI.
 */
export const API = 'http://localhost:4100/api/v1';
export const MERCHANT = 'http://localhost:5273';
export const ADMIN = 'http://localhost:5274';
export const PASSWORD = 'grabandgo2026';

let address = 1;
async function api<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ ok: boolean; data: T; error?: { code: string } }> {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Spread logins over addresses so the per-IP auth limit is not hit.
      'x-forwarded-for': `10.66.0.${(address++ % 250) + 1}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

export async function cafeId(slug: string): Promise<string> {
  const cafes = await api<Array<{ id: string; slug: string }>>('GET', '/cafes?limit=50');
  return cafes.data.find((cafe) => cafe.slug === slug)!.id;
}

/** A new customer places (and pays for) an order; returns its number and code. */
export async function customerOrders(
  slug: string,
  collection: unknown = { method: 'WALK_IN' },
): Promise<{ orderNumber: string; pickupCode: string; id: string }> {
  const email = `web+${randomUUID().slice(0, 8)}@example.com`;
  const registered = await api('POST', '/auth/register', { fullName: 'Web Customer', email, password: PASSWORD });
  const token = registered.data.tokens.accessToken as string;
  const businessId = await cafeId(slug);
  const menu = await api('GET', `/cafes/${businessId}/menu`);
  const item = menu.data.categories.flatMap((category: { items: any[] }) => category.items)[0];
  const order = await api(
    'POST',
    '/orders',
    {
      businessId,
      lines: [
        {
          menuItemId: item.id,
          ...(item.variants.length ? { variantId: item.variants[0].id } : {}),
          modifierOptionIds: item.modifiers.filter((group: any) => group.isRequired).map((group: any) => group.options[0].id),
          quantity: 1,
        },
      ],
      pickup: { mode: 'ASAP' },
      collection,
      paymentMethod: 'CASH_ON_PICKUP',
      idempotencyKey: randomUUID(),
    },
    token,
  );
  expect(order.ok, JSON.stringify(order.error)).toBe(true);
  const mine = await api('GET', `/orders/${order.data.id}`, undefined, token);
  return { orderNumber: order.data.orderNumber, pickupCode: mine.data.pickupCode, id: order.data.id };
}

export async function signIn(page: Page, origin: string, email: string): Promise<void> {
  await page.goto(origin);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
