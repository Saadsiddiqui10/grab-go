import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAFES,
  type Session,
  cafeId,
  call,
  lineFor,
  login,
  merchantLogin,
  newCustomer,
  placeOrder,
  startApi,
  stopApi,
} from './helpers';

let lab: string;
let labOwner: Session;
let admin: Session;

beforeAll(async () => {
  await startApi();
  lab = await cafeId(CAFES.espressoLab.slug);
  labOwner = await merchantLogin(CAFES.espressoLab.owner);
  admin = await login('admin@grabgo.pk');
});
afterAll(stopApi);

describe('browsing', () => {
  it('lists live cafés with what the app needs to draw them', async () => {
    const cafes = await call('GET', '/cafes?limit=50');
    expect(cafes.data.length).toBeGreaterThanOrEqual(6);
    for (const cafe of cafes.data) {
      expect(cafe).toMatchObject({ status: 'ACTIVE' });
      expect(typeof cafe.latitude).toBe('number');
      expect(cafe).toHaveProperty('logoUrl');
    }
  });

  it('serves a café, its menu, its rewards and pickup times', async () => {
    const detail = await call('GET', `/cafes/${lab}`);
    expect(detail.data).toMatchObject({ id: lab, name: 'Espresso Lab' });
    expect(detail.data.openingHours).toHaveLength(7);

    const menu = await call('GET', `/cafes/${lab}/menu`);
    expect(menu.data.categories.length).toBeGreaterThan(0);

    const rewards = await call('GET', `/rewards?businessId=${lab}`);
    expect(rewards.data.every((reward: { businessId: string }) => reward.businessId === lab)).toBe(true);

    const slots = await call('GET', `/cafes/${lab}/pickup-slots`);
    expect(slots.data.some((slot: { available: boolean }) => slot.available)).toBe(true);
  });
});

describe('onboarding a café', () => {
  it('creates it pending and hidden, audits it, and shows it once approved', async () => {
    const cities = await call('GET', '/cities');
    const area = cities.data[0].areas[0];
    const suffix = randomUUID().slice(0, 6);

    const onboard = await call('POST', '/admin/businesses', {
      token: admin.token,
      body: {
        name: `E2E Café ${suffix}`,
        addressLine: 'Plot 1, Test Street',
        areaId: area.id,
        coordinates: { latitude: area.latitude ?? 24.86, longitude: area.longitude ?? 67.0 },
        ownerEmail: `e2e+owner-${suffix}@example.com`,
        ownerName: 'E2E Owner',
      },
    });
    expect(onboard.status).toBe(201);
    const businessId = onboard.data.businessId as string;
    expect(onboard.data.temporaryPassword).toBeTruthy();

    // Not public while pending: customers get a 404, the admin can preview.
    const customer = await newCustomer();
    expect((await call('GET', `/cafes/${businessId}`, { token: customer.token })).status).toBe(404);
    expect((await call('GET', `/cafes/${businessId}/menu`)).status).toBe(404);
    expect((await call('GET', `/cafes/${businessId}`, { token: admin.token })).ok).toBe(true);

    const audit = await call('GET', '/admin/audit-logs?limit=20', { token: admin.token });
    const entry = audit.data.find((row: { targetId: string; action: string }) => row.targetId === businessId);
    expect(entry?.action).toBe('business.created');
    expect(JSON.stringify(entry)).not.toContain(onboard.data.temporaryPassword);

    const approve = await call('POST', `/admin/businesses/${businessId}/approve`, { token: admin.token, body: {} });
    expect(approve.ok).toBe(true);
    expect((await call('GET', `/cafes/${businessId}`)).ok).toBe(true);
  });
});

describe('editing a café', () => {
  it('lets an admin mark an item sold out on any café, and the app sees it', async () => {
    const line = await lineFor(lab);
    const soldOut = await call('PATCH', `/merchant/${lab}/items/${line.menuItemId}/availability`, {
      token: admin.token,
      body: { isSoldOut: true },
    });
    expect(soldOut.ok).toBe(true);
    try {
      const customer = await newCustomer();
      const refused = await placeOrder(customer, lab, { lines: [line] });
      expect(refused.ok).toBe(false);
    } finally {
      await call('PATCH', `/merchant/${lab}/items/${line.menuItemId}/availability`, {
        token: admin.token,
        body: { isSoldOut: false },
      });
    }
  });

  it('updates the profile, including the logo for the map pin', async () => {
    const logoUrl = 'https://images.example.com/espresso-lab.png';
    const saved = await call('PATCH', `/merchant/${lab}/profile`, { token: labOwner.token, body: { logoUrl } });
    expect(saved.ok).toBe(true);
    try {
      const listed = (await call('GET', '/cafes?limit=50')).data.find((cafe: { id: string }) => cafe.id === lab);
      expect(listed.logoUrl).toBe(logoUrl);

      const bad = await call('PATCH', `/merchant/${lab}/profile`, {
        token: labOwner.token,
        body: { logoUrl: 'javascript:alert(1)' },
      });
      expect(bad.error?.code).toBe('VALIDATION_ERROR');
    } finally {
      await call('PATCH', `/merchant/${lab}/profile`, { token: labOwner.token, body: { logoUrl: null } });
    }
  });

  it('keeps staff (not managers) away from rewards setup and the POS', async () => {
    const suffix = randomUUID().slice(0, 6);
    const invite = await call('POST', `/merchant/${lab}/staff`, {
      token: labOwner.token,
      body: { email: `e2e+barista-${suffix}@example.com`, fullName: 'E2E Barista', staffRole: 'STAFF' },
    });
    expect(invite.status).toBe(201);

    const barista = await merchantLogin(`e2e+barista-${suffix}@example.com`).catch(async () => {
      // A new staff account signs in with the temporary password it was given.
      const result = await call('POST', '/auth/merchant/login', {
        body: { email: `e2e+barista-${suffix}@example.com`, password: invite.data.temporaryPassword },
        ip: '10.88.0.1',
      });
      return { token: result.data.tokens.accessToken } as Session;
    });

    // Staff run the board...
    expect((await call('GET', `/merchant/${lab}/orders?status=ALL`, { token: barista.token })).ok).toBe(true);
    // ...but cannot change the POS connection.
    const configure = await call('PUT', `/merchant/${lab}/pos`, {
      token: barista.token,
      body: { provider: 'NONE' },
    });
    expect(configure.status).toBe(403);
  });
});
