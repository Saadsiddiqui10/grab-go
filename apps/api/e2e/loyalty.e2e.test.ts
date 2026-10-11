import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAFES,
  DEMO_PASSWORD,
  type Session,
  cafeId,
  call,
  freshIp,
  fulfil,
  lineFor,
  login,
  merchantLogin,
  newCustomer,
  paidOrder,
  placeOrder,
  prisma,
  startApi,
  stopApi,
} from './helpers';

let lab: string;
let karak: string;
let labOwner: Session;
let karakOwner: Session;
let admin: Session;

beforeAll(async () => {
  await startApi();
  lab = await cafeId(CAFES.espressoLab.slug);
  karak = await cafeId(CAFES.karak.slug);
  labOwner = await merchantLogin(CAFES.espressoLab.owner);
  karakOwner = await merchantLogin(CAFES.karak.owner);
  admin = await login('admin@grabgo.pk');
});
afterAll(stopApi);

const points = async (customer: Session) =>
  (await call('GET', '/users/me/points', { token: customer.token })).data as {
    balance: number;
    cafes: Array<{ businessId: string; balance: number }>;
  };

const cardAt = async (customer: Session, businessId: string) =>
  (await points(customer)).cafes.find((card) => card.businessId === businessId)?.balance ?? 0;

/** Admin goodwill credit: the quickest honest way to fund a card in a test. */
const credit = (customer: Session, businessId: string, amount: number) =>
  call('POST', '/admin/points/adjust', {
    token: admin.token,
    body: { userId: customer.userId, businessId, amount, reason: 'e2e funding' },
  });

describe('café loyalty cards', () => {
  it('earns points on the card of the café that made the order, on collection', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab, { lines: [await lineFor(lab, undefined, 3)] });
    expect(await cardAt(customer, lab)).toBe(0);

    await fulfil(customer, labOwner, lab, order.id);

    const summary = await points(customer);
    expect(await cardAt(customer, lab)).toBeGreaterThan(0);
    expect(summary.cafes.map((card) => card.businessId)).toEqual([lab]);
    expect(summary.balance).toBe(await cardAt(customer, lab));
  });

  it('spends points only at the café that issued them', async () => {
    const customer = await newCustomer();
    await credit(customer, lab, 500);

    const rewards = (await call('GET', '/rewards', { token: customer.token })).data as Array<{
      id: string;
      businessId: string;
      pointsRequired: number;
      isUnlocked: boolean;
    }>;
    const atLab = rewards.find((reward) => reward.businessId === lab && reward.pointsRequired <= 500);
    const atKarak = rewards.find((reward) => reward.businessId === karak);
    expect(atLab?.isUnlocked).toBe(true);
    expect(atKarak?.isUnlocked).toBe(false);

    const refused = await call('POST', `/rewards/${atKarak?.id}/redeem`, { token: customer.token, body: {} });
    expect(refused.error?.code).toBe('INSUFFICIENT_POINTS');

    const redeemed = await call('POST', `/rewards/${atLab?.id}/redeem`, { token: customer.token, body: {} });
    expect(redeemed.ok).toBe(true);
    expect(await cardAt(customer, lab)).toBe(500 - (atLab?.pointsRequired ?? 0));
  });

  it('discounts an order at its own café, and nowhere else', async () => {
    const customer = await newCustomer();
    await credit(customer, lab, 300);
    const reward = (await call('GET', `/rewards?businessId=${lab}`, { token: customer.token })).data.find(
      (entry: { name: string }) => entry.name === 'Rs. 150 off',
    );
    const redemption = await call('POST', `/rewards/${reward.id}/redeem`, { token: customer.token, body: {} });
    expect(redemption.data).toMatchObject({ businessId: lab, status: 'ISSUED' });

    const elsewhere = await placeOrder(customer, karak, { redemptionId: redemption.data.id });
    expect(elsewhere.ok).toBe(false);

    const here = await placeOrder(customer, lab, { redemptionId: redemption.data.id });
    expect(here.ok).toBe(true);
    expect(here.data.totals.rewardDiscount).toBe(15_000);

    const reuse = await placeOrder(customer, lab, { redemptionId: redemption.data.id });
    expect(reuse.ok).toBe(false);
  });

  it('lets a café run its own rewards, and only its own', async () => {
    const created = await call('POST', `/merchant/${lab}/rewards`, {
      token: labOwner.token,
      body: { name: `E2E reward ${randomUUID().slice(0, 4)}`, pointsRequired: 40, type: 'FIXED_DISCOUNT', discountAmount: 5_000 },
    });
    expect(created.ok).toBe(true);
    const rewardId = created.data.id as string;

    try {
      const listed = await call('GET', `/merchant/${lab}/rewards`, { token: labOwner.token });
      expect(listed.data.some((reward: { id: string }) => reward.id === rewardId)).toBe(true);

      const otherCafe = await call('PATCH', `/merchant/${lab}/rewards/${rewardId}`, {
        token: karakOwner.token,
        body: { pointsRequired: 1 },
      });
      expect(otherCafe.status).toBe(403);
      const viaOwnRoute = await call('PATCH', `/merchant/${karak}/rewards/${rewardId}`, {
        token: karakOwner.token,
        body: { pointsRequired: 1 },
      });
      expect(viaOwnRoute.error?.code).toBe('NOT_FOUND');

      // Free items must come off the café's own menu.
      const karakItem = await lineFor(karak);
      const foreignItem = await call('POST', `/merchant/${lab}/rewards`, {
        token: labOwner.token,
        body: { name: 'Free chai', pointsRequired: 50, type: 'FREE_ITEM', freeItemMenuItemIds: [karakItem.menuItemId] },
      });
      expect(foreignItem.ok).toBe(false);
    } finally {
      const retired = await call('PATCH', `/merchant/${lab}/rewards/${rewardId}`, {
        token: labOwner.token,
        body: { isActive: false },
      });
      expect(retired.data.isActive).toBe(false);
    }
  });

  it('makes admins name a café for rewards and adjustments', async () => {
    const noCafe = await call('POST', '/admin/rewards', {
      token: admin.token,
      body: { name: 'Platform', pointsRequired: 10, type: 'FIXED_DISCOUNT', discountAmount: 1_000 },
    });
    expect(noCafe.error?.code).toBe('VALIDATION_ERROR');

    const customer = await newCustomer();
    const noCafeAdjust = await call('POST', '/admin/points/adjust', {
      token: admin.token,
      body: { userId: customer.userId, amount: 10, reason: 'missing cafe' },
    });
    expect(noCafeAdjust.error?.code).toBe('VALIDATION_ERROR');

    const made = await call('POST', '/admin/rewards', {
      token: admin.token,
      body: { businessId: karak, name: 'E2E admin reward', pointsRequired: 999, type: 'FIXED_DISCOUNT', discountAmount: 1_000, isActive: false },
    });
    const moved = await call('PATCH', `/admin/rewards/${made.data.id}`, { token: admin.token, body: { businessId: lab } });
    expect(moved.error?.code).toBe('VALIDATION_ERROR');
  });

  it('pays referral points onto the card of the café the friend ordered from', async () => {
    const referrer = await newCustomer();
    const code = (await call('GET', '/users/me/referrals', { token: referrer.token })).data.code as string;

    const ip = freshIp();
    const email = `e2e+friend-${randomUUID().slice(0, 6)}@example.com`;
    const registered = await call('POST', '/auth/register', {
      ip,
      body: { fullName: 'Friend', email, password: DEMO_PASSWORD, referralCode: code },
    });
    expect(registered.ok).toBe(true);
    // Referrals require a verified phone (anti-abuse). OTP sign-in has its own
    // coverage; here the friend's phone is marked verified directly.
    await prisma.user.update({
      where: { id: registered.data.user.id },
      data: { phone: `+92300${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, phoneVerifiedAt: new Date() },
    });
    const friend = await login(email);

    const order = await paidOrder(friend, karak, { lines: [await lineFor(karak, undefined, 3)] });
    await fulfil(friend, karakOwner, karak, order.id);

    expect(await cardAt(referrer, karak)).toBe(50);
    expect(await cardAt(referrer, lab)).toBe(0);
  });
});
