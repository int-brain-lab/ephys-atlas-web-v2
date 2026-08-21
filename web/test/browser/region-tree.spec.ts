import { expect, test } from '@playwright/test';

test('region sidebar renders parent-closed Allen hierarchies at their real depth', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?colors=anatomy');

  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  await expect(page.locator('.region-row')).toHaveCount(874);

  const cerebrum = page.locator('.region-row[data-region-id="-567"]');
  const brainStem = page.locator('.region-row[data-region-id="-343"]');
  const cerebellum = page.locator('.region-row[data-region-id="-512"]');
  const cortex = page.locator('.region-row[data-region-id="-688"]');
  const motorLayer = page.locator('.region-row[data-region-id="-844"]');
  await expect(page.locator('.region-row[data-region-id="-997"]')).toHaveCount(0);
  await expect(page.locator('.region-row[data-region-id="-8"]')).toHaveCount(0);
  await expect(page.locator('.region-row[data-region-id="-1009"]')).toHaveCount(0);
  for (const topLevel of [cerebrum, brainStem, cerebellum]) {
    await expect(topLevel).toHaveAttribute('data-depth', '0');
    await expect(topLevel).not.toHaveAttribute('data-parent-id');
  }
  await expect(cortex).toHaveAttribute('data-parent-id', '-567');
  await expect(cortex).toHaveAttribute('data-depth', '1');
  await expect(motorLayer).toHaveAttribute('data-parent-id', '-985');
  await expect(motorLayer).toHaveAttribute('data-depth', '6');
  await expect(motorLayer).toHaveAttribute('aria-level', '7');
  await expect(motorLayer.locator('.region-row__swatch')).toHaveCSS('background-color', 'rgb(31, 157, 90)');

  await expect(cerebrum).toHaveCSS('--region-indent', '0.00rem');
  await expect(cortex).toHaveCSS('--region-indent', '0.42rem');
  await expect(motorLayer).toHaveCSS('--region-indent', '2.52rem');
});

test('reduced mappings expose real Allen ancestors as non-selectable containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?colors=anatomy&parcel=beryl');

  await expect(page.locator('.region-row')).toHaveCount(391);
  const berylContainer = page.locator('.region-row[data-region-id="-500"]');
  const berylRegion = page.locator('.region-row[data-region-id="-985"]');
  await expect(berylContainer).toHaveAttribute('data-mapping-member', 'false');
  await expect(berylContainer).toHaveAttribute('data-parent-id', '-315');
  await expect(berylContainer.locator('.region-row__button')).toHaveAttribute('aria-disabled', 'true');
  await expect(berylRegion).toHaveAttribute('data-mapping-member', 'true');
  await expect(berylRegion).toHaveAttribute('data-parent-id', '-500');

  await page.goto('/?colors=anatomy&parcel=cosmos');
  await expect(page.locator('.region-row')).toHaveCount(15);
  await expect(page.locator('.region-row[data-region-id="-695"]')).toHaveAttribute('data-mapping-member', 'false');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-parent-id', '-695');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-mapping-member', 'true');
});

test('ontology branches disclose accessibly and missing feature values stay visually blank', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const root = page.locator('.region-row[data-region-id="-567"]');
  const rootButton = root.locator('.region-row__button');
  const rootToggle = root.locator('.region-row__toggle');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await expect(rootToggle).toHaveAttribute('aria-label', 'Collapse CH');
  await expect(page.getByText('no value', { exact: true })).toHaveCount(0);

  await rootToggle.click();
  await expect(root).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.region-row[data-region-id="-688"]')).toBeHidden();
  await expect(page.locator('.region-row[data-region-id="-343"]')).toBeVisible();

  await rootButton.focus();
  await rootButton.press('ArrowRight');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.region-row[data-region-id="-688"]')).toBeVisible();
  await rootButton.press('ArrowRight');
  await expect(page.locator('.region-row[data-region-id="-688"] .region-row__button')).toBeFocused();
  await page.locator('.region-row[data-region-id="-688"] .region-row__button').press('ArrowLeft');
  await page.locator('.region-row[data-region-id="-688"] .region-row__button').press('ArrowLeft');
  await expect(rootButton).toBeFocused();
});

test('collapsing a branch smoothly moves the following rows into place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);

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
  await expect(page.locator('.region-row:visible')).toHaveCount(3);
  await expect(page.locator('.region-row[data-region-id="-567"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(collapseAll).toBeDisabled();
  await expect(expandAll).toBeEnabled();

  await expandAll.click();
  await expect(page.locator('.region-row:visible')).toHaveCount(874);
  await expect(page.locator('.region-row[data-region-id="-567"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseAll).toBeEnabled();
  await expect(expandAll).toBeDisabled();

  await page.getByLabel('Search brain regions').fill('mediodorsal');
  await expect(collapseAll).toBeDisabled();
  await expect(expandAll).toBeDisabled();
});

test('multi-region selection keeps first-selection order and identity colors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'FRP1, Frontal pole layer 1 (left)' }).click();
  const firstSelection = page.locator('.selected-region[data-region-id="-68"]');
  await expect(firstSelection).toHaveCSS('--selection-color', '#55a7f7');

  await page.getByRole('button', { name: 'FRP5, Frontal pole layer 5 (left)' }).click();
  const selectedRegions = page.locator('.selected-region');
  await expect(selectedRegions).toHaveCount(2);
  await expect(selectedRegions.nth(0)).toHaveAttribute('data-region-id', '-68');
  await expect(selectedRegions.nth(0)).toHaveCSS('--selection-color', '#55a7f7');
  await expect(selectedRegions.nth(1)).toHaveAttribute('data-region-id', '-526157192');
  await expect(selectedRegions.nth(1)).toHaveCSS('--selection-color', '#ef6f61');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-68,-526157192');
});
