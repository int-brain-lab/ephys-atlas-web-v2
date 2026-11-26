import { expect, test } from '@playwright/test';

test('two selected regions show a clickable feature crossplot', async ({ page }) => {
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-362,-382');
  await page.locator('.analysis-panel__toggle').click();
  const point = page.locator('.region-pair__point[data-pair-feature="rms_ap"]');
  await expect(point).toHaveAttribute('data-group', 'ap');
  await expect(point).toHaveClass(/is-current/);
  await expect(page.locator('.region-pair__list li')).toHaveCount(1);
});
