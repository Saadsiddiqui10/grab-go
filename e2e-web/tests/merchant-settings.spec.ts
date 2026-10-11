import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { MERCHANT, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page, MERCHANT, 'owner@espressolab.example');
  await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
});

test('a café creates, sees and retires its own reward', async ({ page }) => {
  const name = `Web reward ${randomUUID().slice(0, 4)}`;
  await page.getByRole('link', { name: 'Rewards' }).click();
  await page.getByRole('button', { name: 'New reward' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Free flat white').fill(name);
  await dialog.getByLabel('Points required').fill('120');
  await dialog.getByRole('button', { name: 'Create' }).click();

  const row = page.locator('tr', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('Active')).toBeVisible();

  await row.getByRole('button', { name: 'Retire' }).click();
  await expect(row.getByText('Retired')).toBeVisible();
});

test('the POS card explains the connection and refuses an unsafe endpoint', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  const pos = page.locator('#pos');
  await expect(pos.getByRole('heading', { name: 'Point of sale' })).toBeVisible();

  await pos.getByRole('combobox').selectOption('WEBHOOK');
  await pos.getByLabel('Endpoint URL').fill('ftp://pos.example.com');
  await pos.getByRole('button', { name: 'Save connection' }).click();
  await expect(pos.locator('.gg-error')).toContainText('https://');

  // Leave it as found.
  await pos.getByRole('combobox').selectOption('NONE');
  await pos.getByRole('button', { name: 'Save connection' }).click();
  await expect(pos.getByText('Not connected').first()).toBeVisible();
});
