import { expect, test, type Page } from '@playwright/test';

async function openTour(page: Page): Promise<void> {
  const help = page.getByRole('dialog', { name: 'Help & getting started' });
  await page.getByRole('button', { name: 'Help' }).first().click();
  await help.getByRole('button', { name: 'Show me the essentials' }).click();
  await expect(help).not.toBeVisible();
  await expect(page.locator('.help-tour__card')).toBeVisible();
}

async function expectInsideViewport(page: Page, selector: string): Promise<void> {
  const bounds = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
}

test('regional essentials tour uses real controls without changing view state', async ({ page }) => {
  await page.goto('/');
  const urlBefore = page.url();
  await openTour(page);

  const card = page.locator('.help-tour__card');
  await expect(card).toContainText('Step 1 of 5');
  await expect(card.getByRole('heading')).toHaveText('Choose a dataset and feature');
  await expect(page.locator('[data-help-anchor="context"]')).toHaveAttribute('data-help-highlighted', 'true');

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Step 2 of 5');
  await expect(page.locator('[data-help-anchor="navigation"][data-help-highlighted="true"]')).toBeVisible();
  await card.getByRole('button', { name: 'Back' }).click();
  await expect(card).toContainText('Step 1 of 5');
  await card.getByRole('button', { name: 'Next' }).click();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card.getByRole('heading')).toHaveText('Inspect and select regions');
  await expect(page.locator('[data-help-anchor="regions"][data-help-highlighted="true"]')).toBeVisible();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card.getByRole('heading')).toHaveText('Understand the values');
  await expect(page.locator('[data-help-anchor="values"][data-help-highlighted="true"]')).toBeVisible();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Step 5 of 5');
  await expect(page.locator('[data-help-anchor="actions"][data-help-highlighted="true"]')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Done' })).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  await page.keyboard.press('Escape');
  await expect(card).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Help' }).first()).toBeFocused();
});

test('volume tour uses voxel-specific Markdown guidance', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  await openTour(page);
  const card = page.locator('.help-tour__card');

  await card.getByRole('button', { name: 'Next' }).click();
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card.getByRole('heading')).toHaveText('Inspect a voxel');
  await expect(card).toContainText('Missing or outside voxels');
  await expect(page.locator('[data-help-anchor="navigation"][data-help-highlighted="true"]')).toBeVisible();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('not the volume grid or source voxel values');
  await card.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card).not.toBeVisible();
});

test('phone tour targets visible responsive controls and remains in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  await page.locator('.app-header__overflow-trigger').click();
  const help = page.getByRole('dialog', { name: 'Help & getting started' });
  await page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Help' }).click();
  await help.getByRole('button', { name: 'Show me the essentials' }).click();

  const card = page.locator('.help-tour__card');
  for (let step = 1; step <= 5; step += 1) {
    await expect(card).toContainText(`Step ${step} of 5`);
    await expectInsideViewport(page, '.help-tour__card');
    await expectInsideViewport(page, '[data-help-highlighted="true"]');
    if (step < 5) await card.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.locator('.app-header__overflow-trigger')).toHaveAttribute('data-help-highlighted', 'true');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).not.toBeVisible();
  await expect(page.locator('.app-header__overflow-trigger')).toBeFocused();
});
