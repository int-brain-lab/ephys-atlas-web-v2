import { expect, test } from '@playwright/test';

test('automatic color scale defaults and URL overrides persist', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');

  const scale = page.getByLabel('Color scale');
  await expect(scale).toHaveValue('auto');
  await expect(scale.locator('option:checked')).toHaveText('Auto (Linear)');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();

  await scale.selectOption('log');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('log');
  await page.reload();
  await expect(page.getByLabel('Color scale')).toHaveValue('log');

  await page.getByLabel('Color scale').selectOption('auto');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();
  await expect(page.getByLabel('Color scale').locator('option:checked')).toHaveText('Auto (Linear)');
});
