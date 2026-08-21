import { expect, test } from '@playwright/test';

test('selected-region comparison omits the interquartile-range column', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first().dispatchEvent('pointerup');

  const table = page.locator('.regional-comparison__table');
  await expect(table).toBeAttached();
  await expect(table.locator('thead')).not.toContainText('Q25–Q75');
  await expect(table.locator('thead')).toContainText('Min–Max');
  await expect(table.locator('tbody tr').first().locator('th, td')).toHaveCount(7);
});
