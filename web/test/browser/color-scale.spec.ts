import { expect, test } from '@playwright/test';

test('value scale is capability-aware and obsolete independent state is canonicalized', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');

  const scale = page.locator('select[aria-label="Value scale"]');
  await expect(scale).toHaveValue('auto');
  await expect(scale.locator('option:checked')).toHaveText('Auto (Linear)');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();

  await expect(scale.locator('option[value="log"]')).toBeDisabled();
  await page.goto('/?v=4&histScale=log&scale=log');
  await expect(page.locator('select[aria-label="Value scale"]')).toHaveValue('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('histScale')).toBeNull();

  await page.locator('select[aria-label="Value scale"]').selectOption('auto');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();
  await expect(page.locator('select[aria-label="Value scale"] option:checked')).toHaveText('Auto (Linear)');
});
