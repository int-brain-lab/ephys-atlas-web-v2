import { expect, test } from '@playwright/test';

test('regional indicators are read-only colorbars for every finite value with exact tooltips', async ({ page }) => {
  await page.goto('/app/?v=4&colors=anatomy&scale=linear&range=2,3');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  const finiteRows = page.locator('.region-row[data-missing="false"]');
  expect(await finiteRows.count()).toBeGreaterThan(0);
  expect(await finiteRows.locator('.region-row__track').count()).toBe(await finiteRows.count());
  await expect(page.locator('.region-row[data-missing="true"] .region-row__track')).toHaveCount(0);
  const zeroValue = page.locator('.region-row[data-region-id="-477"] .region-row__value');
  await expect(zeroValue).toHaveAttribute('title', /^mean: 0 dB rel\. V/);
  await expect(zeroValue.locator('.region-row__track')).toHaveCount(1);
  const value = page.locator('.region-row[data-region-id="-362"] .region-row__value');
  await expect(value).toHaveAttribute('title', /mean: .* dB rel\. V · below color range, clipped to lower edge/);
  const track = value.locator('.region-row__track');
  await expect(track).toHaveCSS('width', '52px');
  await expect(track).toHaveCSS('height', '6px');
  await expect(track).toHaveCSS('background-image', /linear-gradient/);
  const tick = track.locator('.region-row__tick');
  await expect(tick).toHaveCSS('width', '2px');
  await expect(tick).toHaveCSS('height', '10px');
  expect(await tick.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--region-value'))).toBe('0%');
  await expect(track.locator('[role="slider"], input')).toHaveCount(0);
});

test('regional colorbars update their palette and nonlinear positions while preserving selection', async ({ page }) => {
  await page.goto('/app/?v=4&scale=linear');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  const row = page.locator('.region-row[data-region-id="-362"]');
  await row.locator('.region-row__button').click();
  const tick = row.locator('.region-row__tick');
  const initialPosition = await tick.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--region-value'));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Feature colormap').selectOption('cividis');
  await expect(row.locator('.region-row__track')).toHaveCSS('background-image', /rgb\(0, 34, 78\)/);
  await page.getByLabel('Color mapping').selectOption('pseudolog');
  await expect.poll(() => tick.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--region-value'))).not.toBe(initialPosition);
  const pseudoPosition = await tick.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--region-value'));
  await page.getByLabel('Color mapping').selectOption('quantile-uniform');
  await expect.poll(() => tick.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--region-value'))).not.toBe(pseudoPosition);
  await expect(row).toHaveAttribute('data-selected', 'true');
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume');
  await expect(page.locator('.region-statistic-domain')).toContainText('Anatomy only');
  await expect(page.locator('.region-row__track')).toHaveCount(0);
});
