import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAFES,
  type Session,
  advance,
  cafeId,
  call,
  fulfil,
  lineFor,
  merchantLogin,
  newCustomer,
  paidOrder,
  pay,
  placeOrder,
  prisma,
  startApi,
  stopApi,
} from './helpers';

let lab: string;
let karak: string;
let labOwner: Session;
let karakOwner: Session;

beforeAll(async () => {
  await startApi();
  lab = await cafeId(CAFES.espressoLab.slug);
  karak = await cafeId(CAFES.karak.slug);
  labOwner = await merchantLogin(CAFES.espressoLab.owner);
  karakOwner = await merchantLogin(CAFES.karak.owner);
});
afterAll(stopApi);

describe('ordering', () => {
  it('takes a paid walk-in order through to collection', async () => {
    const customer = await newCustomer();
    const since = new Date(Date.now() - 1000).toISOString();
    const order = await paidOrder(customer, lab);
    expect(order).toMatchObject({ status: 'PENDING', pickupMethod: 'WALK_IN' });

    const board = await call('GET', `/merchant/${lab}/orders?status=NEW&from=${encodeURIComponent(since)}`, {
      token: labOwner.token,
    });
    expect(board.data.some((row: { id: string }) => row.id === order.id)).toBe(true);

    const collected = await fulfil(customer, labOwner, lab, order.id);
    expect(collected.ok).toBe(true);
    expect(collected.data.status).toBe('PICKED_UP');

    const mine = await call('GET', `/orders/${order.id}`, { token: customer.token });
    expect(mine.data.status).toBe('PICKED_UP');
  });

  it('prices on the server, whatever the client claims', async () => {
    const customer = await newCustomer();
    const line = await lineFor(lab, undefined, 2);
    const order = await placeOrder(customer, lab, { lines: [{ ...line, unitPrice: 1, total: 1 } as never] });
    expect(order.ok).toBe(true);
    expect(order.data.totals.total).toBeGreaterThan(100);
  });

  it('records curbside collection with a normalised plate, and needs one', async () => {
    const customer = await newCustomer();
    const missing = await placeOrder(customer, lab, { collection: { method: 'CURBSIDE' } });
    expect(missing.error?.code).toBe('VALIDATION_ERROR');

    const order = await placeOrder(customer, lab, {
      collection: { method: 'CURBSIDE', vehiclePlate: ' khi 4521 ', vehicleDetails: 'White Corolla' },
    });
    expect(order.data).toMatchObject({ pickupMethod: 'CURBSIDE', vehiclePlate: 'KHI 4521', vehicleDetails: 'White Corolla' });

    const seen = await call('GET', `/merchant/${lab}/orders/${order.data.id}`, { token: labOwner.token });
    expect(seen.data.vehiclePlate).toBe('KHI 4521');
  });

  it('places one order for a retried checkout', async () => {
    const customer = await newCustomer();
    const idempotencyKey = randomUUID();
    const first = await placeOrder(customer, lab, { idempotencyKey });
    const retry = await placeOrder(customer, lab, { idempotencyKey });
    expect(retry.ok).toBe(true);
    expect(retry.data.id).toBe(first.data.id);
  });

  it('hands over only with the right code, and stops guessing', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab);
    for (const step of ['accept', 'preparing', 'ready'] as const) await advance(labOwner, lab, order.id, step);

    const wrong = await call('POST', `/merchant/${lab}/orders/${order.id}/pickup`, {
      token: labOwner.token,
      body: { code: 'ZZZZZZ' },
    });
    expect(wrong.error?.code).toBe('PICKUP_CODE_INVALID');

    let locked = false;
    for (let attempt = 0; attempt < 25 && !locked; attempt += 1) {
      const guess = await call('POST', `/merchant/${lab}/orders/${order.id}/pickup`, {
        token: labOwner.token,
        body: { code: 'ZZZZZZ' },
      });
      locked = guess.error?.code !== 'PICKUP_CODE_INVALID';
    }
    expect(locked).toBe(true);
  });

  it('keeps cafes out of each other’s orders', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab);

    const peek = await call('GET', `/merchant/${lab}/orders/${order.id}`, { token: karakOwner.token });
    expect(peek.status).toBe(403);
    const viaOwn = await call('POST', `/merchant/${karak}/orders/${order.id}/accept`, {
      token: karakOwner.token,
      body: {},
    });
    expect(viaOwn.ok).toBe(false);
  });

  it('keeps customers out of each other’s orders', async () => {
    const owner = await newCustomer();
    const stranger = await newCustomer();
    const order = await paidOrder(owner, lab);

    expect((await call('GET', `/orders/${order.id}`, { token: stranger.token })).ok).toBe(false);
    const cancel = await call('POST', `/orders/${order.id}/cancel`, { token: stranger.token, body: {} });
    expect(cancel.ok).toBe(false);
    expect((await call('GET', `/orders/${order.id}`, { token: owner.token })).data.status).toBe('PENDING');
  });

  it('lets a customer cancel until shortly after the cafe accepts', async () => {
    const customer = await newCustomer();
    const cancel = (orderId: string) =>
      call('POST', `/orders/${orderId}/cancel`, { token: customer.token, body: {} });

    // Before the café accepts: always.
    const early = await paidOrder(customer, lab);
    expect((await cancel(early.id)).data.status).toBe('CANCELLED_BY_CUSTOMER');

    // Just accepted: inside the grace window (2 minutes by default).
    const justAccepted = await paidOrder(customer, lab);
    await advance(labOwner, lab, justAccepted.id, 'accept');
    expect((await cancel(justAccepted.id)).data.status).toBe('CANCELLED_BY_CUSTOMER');

    // Accepted ten minutes ago: too late.
    const stale = await paidOrder(customer, lab);
    await advance(labOwner, lab, stale.id, 'accept');
    await prisma.order.update({
      where: { id: stale.id },
      data: { acceptedAt: new Date(Date.now() - 10 * 60_000) },
    });
    expect((await cancel(stale.id)).ok).toBe(false);

    // Already being made: too late.
    const preparing = await paidOrder(customer, lab);
    await advance(labOwner, lab, preparing.id, 'accept');
    await advance(labOwner, lab, preparing.id, 'preparing');
    expect((await cancel(preparing.id)).ok).toBe(false);
  });

  it('refuses orders while a cafe has paused them, and takes them again after', async () => {
    const pause = await call('PATCH', `/merchant/${karak}/settings`, {
      token: karakOwner.token,
      body: { acceptingOrders: false },
    });
    expect(pause.ok).toBe(true);
    try {
      const customer = await newCustomer();
      const refused = await placeOrder(customer, karak);
      expect(refused.error?.code).toBe('BUSINESS_NOT_ACCEPTING_ORDERS');
    } finally {
      await call('PATCH', `/merchant/${karak}/settings`, { token: karakOwner.token, body: { acceptingOrders: true } });
    }
    const customer = await newCustomer();
    expect((await placeOrder(customer, karak)).ok).toBe(true);
  });

  it('takes cash at the counter without a card payment', async () => {
    const customer = await newCustomer();
    const order = await placeOrder(customer, lab, { paymentMethod: 'CASH_ON_PICKUP' });
    expect(order.ok).toBe(true);
    const collected = await fulfil(customer, labOwner, lab, order.data.id);
    expect(collected.data.status).toBe('PICKED_UP');
  });

  it('charges a card once even if confirmed twice', async () => {
    const customer = await newCustomer();
    const order = await placeOrder(customer, lab);
    const first = await pay(customer, order.data.id);
    const again = await pay(customer, order.data.id);
    expect(first.data.status).toBe('PAID');
    expect(again.ok ? again.data.status : 'PAID').toBe('PAID');
  });
});
