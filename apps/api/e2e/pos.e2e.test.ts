import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processDuePosJobs } from '../src/services/pos/pos.service';
import {
  CAFES,
  type Session,
  advance,
  cafeId,
  call,
  merchantLogin,
  newCustomer,
  paidOrder,
  prisma,
  startApi,
  stopApi,
} from './helpers';

/**
 * A stand-in POS: a local HTTP receiver that verifies each signature exactly
 * as the docs tell real receivers to, and can be told to fail.
 */
interface Received {
  event: string;
  deliveryId: string;
  signatureValid: boolean;
  body: any;
}

let secret = '';
let reply = 200;
const received: Received[] = [];
const receiver = http.createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    const timestamp = request.headers['x-grabgo-timestamp'];
    const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
    if (reply === 200) {
      received.push({
        event: String(request.headers['x-grabgo-event']),
        deliveryId: String(request.headers['x-grabgo-delivery']),
        signatureValid: expected === request.headers['x-grabgo-signature'],
        body: JSON.parse(raw),
      });
    }
    response.writeHead(reply);
    response.end(reply === 200 ? 'ok' : 'nope');
  });
});

let endpointUrl = '';
let lab: string;
let owner: Session;
const pos = () => `/merchant/${lab}/pos`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const eventsFor = (orderId: string) => received.filter((entry) => entry.body.order?.id === orderId).map((entry) => entry.event);

beforeAll(async () => {
  await startApi();
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  endpointUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/grabgo`;
  lab = await cafeId(CAFES.espressoLab.slug);
  owner = await merchantLogin(CAFES.espressoLab.owner);

  await call('PUT', pos(), { token: owner.token, body: { provider: 'WEBHOOK', endpointUrl, isEnabled: true } });
  // A connection left by an earlier run keeps its secret; rotate to a known one.
  secret = (await call('POST', `${pos()}/rotate-secret`, { token: owner.token, body: {} })).data.secret;
});

afterAll(async () => {
  await call('PUT', pos(), { token: owner.token, body: { provider: 'NONE' } });
  await new Promise((resolve) => receiver.close(resolve));
  await stopApi();
});

beforeEach(() => {
  reply = 200;
});

describe('POS integration', () => {
  it('shows the secret once and never in the status', async () => {
    const again = await call('PUT', pos(), { token: owner.token, body: { provider: 'WEBHOOK', endpointUrl, isEnabled: true } });
    expect(again.data.secret).toBeNull();
    const status = await call('GET', pos(), { token: owner.token });
    expect(JSON.stringify(status.data)).not.toContain(secret);
    expect(status.data).toMatchObject({ provider: 'WEBHOOK', isEnabled: true, hasSecret: true });
  });

  it('sends a signed test ping', async () => {
    const test = await call('POST', `${pos()}/test`, { token: owner.token, body: {} });
    expect(test.data.ok).toBe(true);
    expect(received.at(-1)).toMatchObject({ event: 'ping', signatureValid: true });
  });

  it('delivers an order’s life in order, signed, without the pickup code', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab, {
      collection: { method: 'CURBSIDE', vehiclePlate: 'POS 1' },
    });
    await advance(owner, lab, order.id, 'accept');
    await settle();

    expect(eventsFor(order.id)).toEqual(['order.created', 'order.paid', 'order.accepted']);
    const created = received.find((entry) => entry.body.order?.id === order.id)!;
    expect(created.signatureValid).toBe(true);
    expect(created.body.order.pickup.vehiclePlate).toBe('POS 1');
    expect(created.body.order).not.toHaveProperty('pickupCode');

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { pickupCode: true } });
    expect(JSON.stringify(created.body)).not.toContain(row.pickupCode);
  });

  it('retries a POS that is down, and the sweep delivers once it is back', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab);
    await settle();

    reply = 503;
    await advance(owner, lab, order.id, 'accept');
    await settle();

    const job = await prisma.posSyncJob.findUniqueOrThrow({ where: { eventKey: `${order.id}:order.accepted` } });
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: 503 });
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // The POS recovers; bring the retry due and run the maintenance sweep.
    reply = 200;
    await prisma.posSyncJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date() } });
    await processDuePosJobs();

    const done = await prisma.posSyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect(received.some((entry) => entry.deliveryId === job.id && entry.event === 'order.accepted')).toBe(true);
  });

  it('fails a rejected payload at once, and lets staff retry it', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab);
    await settle();

    reply = 400;
    await advance(owner, lab, order.id, 'accept');
    await settle();

    const status = await call('GET', pos(), { token: owner.token });
    const problem = status.data.recentProblems.find((entry: { orderId: string }) => entry.orderId === order.id);
    expect(problem).toMatchObject({ status: 'FAILED', attempts: 1, lastStatusCode: 400 });

    reply = 200;
    const retried = await call('POST', `${pos()}/retry`, { token: owner.token, body: { jobId: problem.id } });
    expect(retried.ok).toBe(true);
    expect(eventsFor(order.id)).toContain('order.accepted');
  });

  it('queues nothing new for a replayed transition', async () => {
    const customer = await newCustomer();
    const order = await paidOrder(customer, lab);
    await advance(owner, lab, order.id, 'accept');
    await settle();
    const before = received.length;

    await advance(owner, lab, order.id, 'accept');
    await settle();
    expect(received.length).toBe(before);
  });

  it('refuses unsafe endpoints and other cafés', async () => {
    const ftp = await call('PUT', pos(), { token: owner.token, body: { provider: 'WEBHOOK', endpointUrl: 'ftp://x.example', isEnabled: true } });
    expect(ftp.error?.code).toBe('VALIDATION_ERROR');

    const karakOwner = await merchantLogin(CAFES.karak.owner);
    expect((await call('GET', pos(), { token: karakOwner.token })).status).toBe(403);
    expect((await call('POST', `${pos()}/retry`, { token: karakOwner.token, body: {} })).status).toBe(403);
  });

  it('sends nothing once switched off', async () => {
    await call('PUT', pos(), { token: owner.token, body: { provider: 'NONE' } });
    try {
      const customer = await newCustomer();
      const order = await paidOrder(customer, lab);
      await settle();
      expect(eventsFor(order.id)).toEqual([]);
    } finally {
      await call('PUT', pos(), { token: owner.token, body: { provider: 'WEBHOOK', endpointUrl, isEnabled: true } });
    }
  });
});
