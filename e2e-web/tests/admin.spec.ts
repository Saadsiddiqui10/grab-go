import { expect, test } from '@playwright/test';
import { ADMIN, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page, ADMIN, 'admin@grabgo.pk');
  await expect(page).toHaveURL(/overview/);
});

test('an admin manages a café’s menu from the cafés list', async ({ page }) => {
  await page.getByRole('link', { name: 'Cafes' }).click();
  await page.locator('tr', { hasText: 'Espresso Lab' }).getByRole('button', { name: 'Manage' }).click();

  await expect(page.getByRole('heading', { name: 'Espresso Lab' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cafe profile' })).toBeVisible();

  const row = page.locator('tr', { hasText: 'Iced Latte' });
  await row.getByRole('button', { name: 'Mark sold out' }).click();
  await expect(row.getByText('Sold out')).toBeVisible();
  await row.getByRole('button', { name: 'Back in stock' }).click();
  await expect(row.getByText('Available')).toBeVisible();
});

test('admin rewards must belong to a café', async ({ page }) => {
  await page.getByRole('link', { name: 'Loyalty' }).click();
  await page.getByRole('button', { name: 'New reward' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Cafe')).toBeVisible();
  const options = await dialog.getByLabel('Cafe').locator('option').allTextContents();
  expect(options).toContain('Espresso Lab');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
