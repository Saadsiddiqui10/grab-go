import { expect, test } from '@playwright/test';
import { MERCHANT, customerOrders, signIn } from './helpers';

/**
 * The café's order board, end to end in a browser: an order placed in the app
 * appears live, and staff take it through to handover with the customer's
 * code. Runs at desktop size and on an iPad in landscape.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page, MERCHANT, 'owner@espressolab.example');
  await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
});

test('a new order appears live and is handed over with the pickup code', async ({ page }) => {
  const order = await customerOrders('espresso-lab-clifton');

  // Arrives over the realtime socket, no reload.
  const ticket = page.locator('article.gg-ticket', { hasText: order.orderNumber });
  await expect(ticket).toBeVisible();

  await ticket.getByRole('button', { name: 'Accept' }).click();
  await page.locator('article.gg-ticket', { hasText: order.orderNumber }).getByRole('button', { name: 'Start preparing' }).click();
  await page.locator('article.gg-ticket', { hasText: order.orderNumber }).getByRole('button', { name: 'Mark ready' }).click();
  await page.locator('article.gg-ticket', { hasText: order.orderNumber }).getByRole('button', { name: 'Verify pickup' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pickup code').fill('ZZZZZZ');
  await dialog.getByRole('button', { name: 'Verify and complete' }).click();
  await expect(dialog.getByText(/not valid|incorrect|does not match/i)).toBeVisible();

  await dialog.getByLabel('Pickup code').fill(order.pickupCode);
  await dialog.getByRole('button', { name: 'Verify and complete' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator('.gg-column', { hasText: 'Completed' }).locator('article.gg-ticket', { hasText: order.orderNumber }),
  ).toBeVisible();
});

test('a curbside order shows the number plate on the ticket', async ({ page }) => {
  const order = await customerOrders('espresso-lab-clifton', {
    method: 'CURBSIDE',
    vehiclePlate: 'web 4521',
    vehicleDetails: 'Silver Alto',
  });
  const ticket = page.locator('article.gg-ticket', { hasText: order.orderNumber });
  await expect(ticket.getByText('Bring to car', { exact: false })).toBeVisible();
  await expect(ticket.getByText('WEB 4521')).toBeVisible();
  await expect(ticket.getByText('Silver Alto')).toBeVisible();
});

test('the four stages sit side by side', async ({ page }) => {
  const columns = page.locator('.gg-board > .gg-column');
  await expect(columns).toHaveCount(4);
  const tops = await columns.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // Touch screens get finger-sized buttons.
  if (test.info().project.name === 'ipad') {
    const height = await page.getByRole('button', { name: 'Refresh' }).evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }
});
