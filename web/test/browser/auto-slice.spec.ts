import { expect, test, type Page } from '@playwright/test';

const region = (page: Page, id: string) => page.locator(`[data-region-button="${id}"]`);
const cursor = (page: Page) => new URL(page.url()).searchParams.get('cursor');
async function visibleRegion(page: Page, id: string) {
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const view = page.getByRole('region', { name: `${axis} view`, exact: true });
    await expect(view).toHaveAttribute('data-state', 'ready');
    await expect(view.locator(`.atlas-region[data-allen-id="${id}"], .atlas-region[data-allen-id="-${id}"]`).first()).toBeVisible();
  }
}

test('auto-slice reveals a selected region and disabled state survives reload', async ({ page }) => {
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  const toggle = page.getByRole('checkbox', { name: 'Auto-slice', exact: true });
  await expect(toggle).toBeChecked();
  await expect(page.locator('#auto-slice-hint')).toContainText('keep slices fixed');
  await region(page, '-68').click();
  await visibleRegion(page, '68');
  await expect.poll(() => cursor(page)).not.toBe('-5399,4000,-668');
  const positioned = cursor(page);
  await toggle.uncheck();
  await region(page, '-362').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  expect(cursor(page)).toBe(positioned);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  expect(cursor(page)).toBe(positioned);
  await toggle.check();
  expect(cursor(page)).toBe(positioned);
  await region(page, '-362').press('Enter');
  await visibleRegion(page, '362');
});

test('turning auto-slice off cancels pending search without moving slices', async ({ page }) => {
  await page.route('**/registered/**/*.isvg.gz', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  await region(page, '-68').click();
  await expect(page.getByText('Finding slices for the selected region…')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Auto-slice', exact: true }).uncheck();
  const fixed = cursor(page);
  await page.waitForTimeout(1000);
  expect(cursor(page)).toBe(fixed);
  await expect(page.getByText('Finding slices for the selected region…')).not.toBeVisible();
});

test('manual navigation cancels lookup and a newer selection wins', async ({ page }) => {
  await page.route('**/registered/**/*.isvg.gz', async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.continue();
  });
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  await region(page, '-68').click();
  await expect(page.getByText('Finding slices for the selected region…')).toBeVisible();
  const slider = page.locator('[data-view="coronal"] input[type="range"]');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(page.getByText('Finding slices for the selected region…')).not.toBeVisible();
  await expect.poll(() => cursor(page)).not.toBe('-5399,4000,-668');
  const manual = cursor(page);
  await page.waitForTimeout(500);
  expect(cursor(page)).toBe(manual);
  await region(page, '-68').click();
  await region(page, '-362').click();
  await visibleRegion(page, '362');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.getByText('Finding slices for the selected region…')).not.toBeVisible();
});
