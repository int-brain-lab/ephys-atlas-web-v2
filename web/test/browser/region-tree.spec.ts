import { expect, test } from '@playwright/test';

test('region sidebar renders parent-closed Allen hierarchies at their real depth', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&colors=anatomy');

  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  await expect(page.locator('.region-row')).toHaveCount(874);

  const regionCount = page.locator('.region-search__count');
  await expect(regionCount).toHaveText('874 regions');
  const fullCountMetrics = await regionCount.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(fullCountMetrics.scrollWidth).toBeLessThanOrEqual(fullCountMetrics.clientWidth);
  await page.getByLabel('Search brain regions').fill('mediodorsal');
  await expect(regionCount).toHaveText('2 regions');
  await expect.poll(() => regionCount.evaluate((node) => node.getBoundingClientRect().width)).toBe(fullCountMetrics.width);
  await page.getByLabel('Search brain regions').fill('');

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

test('regional values use a shared labeled domain track and accessible exact values', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&colors=anatomy');

  await expect(page.locator('.region-statistic-domain')).toContainText('Mean:');
  await expect(page.locator('.region-statistic-domain')).toContainText('dB rel. V');
  const row = page.locator('.region-row[data-region-id="-362"]');
  await expect(row.locator('.region-row__track')).toHaveCount(1);
  await expect(row.locator('.region-row__bar')).toHaveCount(0);
  const value = row.locator('.region-row__value');
  await expect(value).toHaveAttribute('aria-label', /mean/i);
  await row.locator('.region-row__button').click();
  await expect(row.locator('.region-row__button')).toHaveAttribute('aria-pressed', 'true');
});

test('reduced mappings expose real Allen ancestors as non-selectable containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&colors=anatomy&parcel=beryl');

  await expect(page.locator('.region-row')).toHaveCount(391);
  const berylContainer = page.locator('.region-row[data-region-id="-500"]');
  const berylRegion = page.locator('.region-row[data-region-id="-985"]');
  await expect(berylContainer).toHaveAttribute('data-mapping-member', 'false');
  await expect(berylContainer).toHaveAttribute('data-parent-id', '-315');
  await expect(berylContainer.locator('.region-row__button')).toHaveAttribute('aria-expanded', 'true');
  await expect(berylContainer.locator('.region-row__button')).not.toHaveAttribute('aria-disabled');
  await expect(berylRegion).toHaveAttribute('data-mapping-member', 'true');
  await expect(berylRegion).toHaveAttribute('data-parent-id', '-500');

  await page.goto('/app/?v=4&colors=anatomy&parcel=cosmos');
  await expect(page.locator('.region-row')).toHaveCount(15);
  await expect(page.locator('.region-row[data-region-id="-695"]')).toHaveAttribute('data-mapping-member', 'false');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-parent-id', '-695');
  await expect(page.locator('.region-row[data-region-id="-315"]')).toHaveAttribute('data-mapping-member', 'true');
});

test('parent row clicks and keyboard activation toggle children without changing selection', async ({ page }) => {
  await page.goto('/app/');
  const selected = page.locator('[data-region-button="-362"]');
  await selected.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  const branch = page.locator('.region-row[data-region-id="-184"]');
  const button = branch.locator('.region-row__button');
  const child = page.locator('.region-row[data-region-id="-68"]');

  await button.click();
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(child).toBeHidden();
  await button.click({ modifiers: ['Control'] });
  await expect(child).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select multiple', exact: true }).check();
  await button.press('Space');
  await expect(child).toBeHidden();
  await button.press('Meta+Enter');
  await expect(child).toBeVisible();
  await expect(button).toBeFocused();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(button).not.toHaveAttribute('aria-pressed');
});

test('search and value sorting never make an Allen parent selectable', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await page.getByLabel('Search brain regions').fill('MOp');
  const parent = page.locator('[data-region-button="-985"]');
  await parent.click();
  await expect(parent).toHaveAttribute('aria-expanded', 'false');
  expect(new URL(page.url()).searchParams.get('selected')).toBeNull();
  await page.getByLabel('Search brain regions').fill('');
  await page.getByRole('button', { name: /Region order:/ }).click();
  await expect(page.locator('.region-list')).toHaveAttribute('data-order', 'value-desc');
  await expect(parent).toHaveCount(0);
  await expect(page.locator('[data-region-button="-362"]')).toBeVisible();
});

test('a Beryl mapping leaf remains selectable beneath an expandable hierarchy container', async ({ page }) => {
  await page.goto('/app/?v=4&colors=anatomy&parcel=beryl');
  const container = page.locator('[data-region-button="-500"]');
  const leaf = page.locator('[data-region-button="-985"]');
  await container.click();
  await expect(leaf).toBeHidden();
  await container.press('Enter');
  await expect(leaf).toBeVisible();
  await leaf.click();
  await expect(leaf).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-985');
});

test('ontology branches disclose accessibly and missing feature values stay visually blank', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');

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
  await page.goto('/app/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
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
  await page.goto('/app/');

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
  await page.goto('/app/');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);

  await page.getByRole('button', { name: 'FRP1, Frontal pole layer 1 (left)' }).click();
  const firstSelection = page.locator('.selected-region[data-region-id="-68"]');
  await expect(firstSelection).toHaveCSS('--selection-color', '#55a7f7');

  await page.getByRole('button', { name: 'FRP5, Frontal pole layer 5 (left)' }).click({ modifiers: ['Control'] });
  const selectedRegions = page.locator('.selected-region');
  await expect(selectedRegions).toHaveCount(2);
  await expect(selectedRegions.nth(0)).toHaveAttribute('data-region-id', '-68');
  await expect(selectedRegions.nth(0)).toHaveCSS('--selection-color', '#55a7f7');
  await expect(selectedRegions.nth(1)).toHaveAttribute('data-region-id', '-526157192');
  await expect(selectedRegions.nth(1)).toHaveCSS('--selection-color', '#ef6f61');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-68,-526157192');
});

test('value ordering switches to a flat ranking and restores the anatomical tree', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);

  const frontalPole = page.locator('.region-row[data-region-id="-184"]');
  await frontalPole.locator('.region-row__toggle').click();
  await expect(frontalPole).toHaveAttribute('aria-expanded', 'false');

  const orderButton = page.getByRole('button', { name: /Region order:/ });
  await expect(page.locator('.region-search__meta > :last-child')).toHaveClass('region-order');
  await expect(orderButton).toHaveAttribute('data-order', 'anatomy');
  await expect(orderButton).toHaveAttribute('title', 'Order: Anatomy · Next: Value descending');
  await expect(orderButton.locator('.region-order__icon')).toHaveCount(1);
  await expect(orderButton).toHaveText('');
  await orderButton.click();
  await expect(orderButton).toHaveAttribute('data-order', 'value-desc');
  await expect.poll(() => new URL(page.url()).searchParams.get('order')).toBe('value-desc');
  await expect(page.locator('.region-list')).toHaveAttribute('data-order', 'value-desc');
  await expect(page.locator('.region-tree-controls')).toBeHidden();
  await expect(page.locator('.region-row').nth(0)).toHaveAttribute('data-region-id', '-382');
  await expect(page.locator('.region-row').nth(1)).toHaveAttribute('data-region-id', '-362');
  await expect(page.locator('.region-row').nth(2)).toHaveAttribute('data-missing', 'true');
  await expect(page.locator('[data-region-button="-803"], [data-region-button="-477"]')).toHaveCount(0);
  await expect(page.locator('.region-row').nth(0)).toHaveAttribute('data-depth', '0');

  await orderButton.click();
  await expect(orderButton).toHaveAttribute('data-order', 'value-asc');
  await expect(page.locator('.region-row').nth(0)).toHaveAttribute('data-region-id', '-362');
  await expect(page.locator('.region-row').nth(1)).toHaveAttribute('data-region-id', '-382');

  await orderButton.click();
  await expect(orderButton).toHaveAttribute('data-order', 'anatomy');
  await expect.poll(() => new URL(page.url()).searchParams.get('order')).toBeNull();
  await expect(page.locator('.region-row')).toHaveCount(874);
  await expect(frontalPole).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.region-row[data-region-id="-68"]')).toBeHidden();
});
