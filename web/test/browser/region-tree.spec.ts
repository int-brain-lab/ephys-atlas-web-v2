import { expect, test } from '@playwright/test';

test('region sidebar renders parent-closed Allen hierarchies at their real depth', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?colors=anatomy');

  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  await expect(page.locator('.region-row')).toHaveCount(1097);

  const root = page.locator('.region-row[data-region-id="-997"]');
  const cortex = page.locator('.region-row[data-region-id="-688"]');
  const motorLayer = page.locator('.region-row[data-region-id="-844"]');
  await expect(root).toHaveAttribute('data-depth', '0');
  await expect(cortex).toHaveAttribute('data-parent-id', '-567');
  await expect(cortex).toHaveAttribute('data-depth', '3');
  await expect(motorLayer).toHaveAttribute('data-parent-id', '-985');
  await expect(motorLayer).toHaveAttribute('data-depth', '8');
  await expect(motorLayer).toHaveAttribute('aria-level', '9');
  await expect(motorLayer.locator('.region-row__swatch')).toHaveCSS('background-color', 'rgb(31, 157, 90)');

  await expect(root).toHaveCSS('--region-indent', '0.00rem');
  await expect(cortex).toHaveCSS('--region-indent', '1.74rem');
  await expect(motorLayer).toHaveCSS('--region-indent', '4.64rem');
});

test('reduced mappings expose real Allen ancestors as non-selectable containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?colors=anatomy&parcel=beryl');

  await expect(page.locator('.region-row')).toHaveCount(393);
  const berylContainer = page.locator('.region-row[data-region-id="-500"]');
  const berylRegion = page.locator('.region-row[data-region-id="-985"]');
  await expect(berylContainer).toHaveAttribute('data-mapping-member', 'false');
  await expect(berylContainer).toHaveAttribute('data-parent-id', '-315');
  await expect(berylContainer.locator('.region-row__button')).toHaveAttribute('aria-disabled', 'true');
  await expect(berylRegion).toHaveAttribute('data-mapping-member', 'true');
  await expect(berylRegion).toHaveAttribute('data-parent-id', '-500');

  await page.goto('/?colors=anatomy&parcel=cosmos');
  await expect(page.locator('.region-row')).toHaveCount(17);
  await expect(page.locator('.region-row[data-region-id="-695"]')).toHaveAttribute('data-mapping-member', 'false');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-parent-id', '-695');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-mapping-member', 'true');
});

test('ontology branches disclose accessibly and missing feature values stay visually blank', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const root = page.locator('.region-row[data-region-id="-997"]');
  const rootButton = root.locator('.region-row__button');
  const rootToggle = root.locator('.region-row__toggle');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await expect(rootToggle).toHaveAttribute('aria-label', 'Collapse root');
  await expect(page.getByText('no value', { exact: true })).toHaveCount(0);

  await rootToggle.click();
  await expect(root).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);

  await rootButton.focus();
  await rootButton.press('ArrowRight');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await rootButton.press('ArrowRight');
  await expect(page.locator('.region-row[data-region-id="-8"] .region-row__button')).toBeFocused();
  await page.locator('.region-row[data-region-id="-8"] .region-row__button').press('ArrowLeft');
  await page.locator('.region-row[data-region-id="-8"] .region-row__button').press('ArrowLeft');
  await expect(rootButton).toBeFocused();
});
