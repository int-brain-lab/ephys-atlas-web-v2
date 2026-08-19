import { expect, test } from '@playwright/test';

test('loads the provisional catalog and exposes renderer slots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'IBL Ephys Atlas' })).toBeVisible();
  await expect(page.getByLabel('Dataset')).toHaveValue('ephys_atlas_channels');
  await expect(page.getByLabel('Feature')).toHaveValue('firing_rate');
  await expect(page.getByRole('img', { name: 'coronal brain slice' })).toContainText('Slice renderer not connected');
});

test('common state is human-readable in the URL', async ({ page }) => {
  await page.goto('/?v=1&parcel=beryl&slices=10,20,30&selected=CA1,VISp');
  await expect(page.getByLabel('Parcellation')).toHaveValue('beryl');
  await expect(page.locator('#coronal-slider')).toHaveValue('10');
  await expect(page.getByText('CA1', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/parcel=beryl/);
});
