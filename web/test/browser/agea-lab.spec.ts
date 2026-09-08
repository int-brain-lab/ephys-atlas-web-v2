import { test, expect } from '@playwright/test';

test('AGEA lab requires explicit local source configuration', async ({ page }) => {
  await page.route('**/__agea_lab__/coverage-lab-index.json', route => route.fulfill({ status: 503, body: 'AGEA lab data is not configured.' }));
  await page.goto('/app/?lab=agea-coverage');
  await expect(page.getByRole('status')).toContainText('AGEA lab data is not configured');
  await expect(page.locator('.agea-views canvas')).toHaveCount(0);
});
