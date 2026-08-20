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
  await expect(cortex).toHaveCSS('--region-indent', '1.26rem');
  await expect(motorLayer).toHaveCSS('--region-indent', '3.36rem');
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
  await expect(page.locator('.region-row:visible')).toHaveCount(1);
  await expect(page.locator('.region-row[data-region-id="-8"]')).toBeHidden();

  await rootButton.focus();
  await rootButton.press('ArrowRight');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.region-row[data-region-id="-8"]')).toBeVisible();
  await rootButton.press('ArrowRight');
  await expect(page.locator('.region-row[data-region-id="-8"] .region-row__button')).toBeFocused();
  await page.locator('.region-row[data-region-id="-8"] .region-row__button').press('ArrowLeft');
  await page.locator('.region-row[data-region-id="-8"] .region-row__button').press('ArrowLeft');
  await expect(rootButton).toBeFocused();
});

test('collapsing a branch smoothly moves the following rows into place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const frontalPoleToggle = page.locator('.region-row[data-region-id="-184"] .region-row__toggle');
  const somatomotor = page.locator('.region-row[data-region-id="-500"]');
  const motion = await frontalPoleToggle.evaluate((toggle) => {
    const following = toggle.ownerDocument.querySelector<HTMLElement>('.region-row[data-region-id="-500"]');
    const beforeTop = following?.getBoundingClientRect().top ?? 0;
    (toggle as HTMLButtonElement).click();
    const animation = following?.getAnimations()[0];
    const firstFrame = animation?.effect instanceof KeyframeEffect
      ? animation.effect.getKeyframes()[0]
      : undefined;
    return { beforeTop, firstTransform: String(firstFrame?.transform ?? '') };
  });

  expect(motion.firstTransform).toMatch(/^translateY\([1-9]\d*(?:\.\d+)?px\)$/);
  await page.waitForTimeout(180);
  const finalTop = (await somatomotor.boundingBox())?.y ?? motion.beforeTop;
  expect(finalTop).toBeLessThan(motion.beforeTop - 100);
});

test('tree-wide controls collapse and expand every ontology branch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const collapseAll = page.getByRole('button', { name: 'Collapse all regions' });
  const expandAll = page.getByRole('button', { name: 'Expand all regions' });
  await expect(collapseAll).toBeEnabled();
  await expect(expandAll).toBeDisabled();

  await collapseAll.click();
  await expect(page.locator('.region-row:visible')).toHaveCount(1);
  await expect(page.locator('.region-row[data-region-id="-997"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(collapseAll).toBeDisabled();
  await expect(expandAll).toBeEnabled();

  await expandAll.click();
  await expect(page.locator('.region-row:visible')).toHaveCount(1097);
  await expect(page.locator('.region-row[data-region-id="-997"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseAll).toBeEnabled();
  await expect(expandAll).toBeDisabled();

  await page.getByLabel('Search brain regions').fill('mediodorsal');
  await expect(collapseAll).toBeDisabled();
  await expect(expandAll).toBeDisabled();
});
