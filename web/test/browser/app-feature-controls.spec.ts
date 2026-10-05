import { expect, test } from '@playwright/test';

test('long feature menus scroll without option descriptions overlapping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await expect(feature.getByRole('option')).toHaveCount(1);
  const list = feature.locator('.context-menu__list');
  await list.evaluate((node) => {
    node.style.height = '180px';
    node.style.maxHeight = '180px';
    const template = node.querySelector<HTMLButtonElement>('.context-menu__option');
    if (!template) throw new Error('Expected a feature option');
    for (let index = 1; index < 30; index += 1) {
      const clone = template.cloneNode(true) as HTMLButtonElement;
      clone.dataset.contextOption = `synthetic-layout-feature-${index}`;
      node.append(clone);
    }
  });

  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await feature.locator('.context-menu__option').evaluateAll((options) => options.every((option) => {
    const copy = option.querySelector<HTMLElement>('.context-menu__option-copy');
    if (!copy) return false;
    const optionBounds = option.getBoundingClientRect();
    const copyBounds = copy.getBoundingClientRect();
    return copyBounds.top >= optionBounds.top && copyBounds.bottom <= optionBounds.bottom;
  }))).toBe(true);
});

test('large feature catalogs stay bounded while search covers every feature field', async ({ page }) => {
  await page.goto('/app/');
  // The viewer and its CSS load lazily after the landing entry document.
  await expect(page.locator('.atlas-app')).toBeVisible();
  await page.evaluate(async () => {
    const { ContextMenu } = await import('/src/ui/context-menu.ts');
    const host = document.createElement('dl');
    host.id = 'large-feature-picker-test';
    document.body.append(host);
    const menu = new ContextMenu({
      fieldName: 'large-feature-test',
      label: 'Feature',
      searchable: true,
      virtualizeAbove: 30,
      onOpen: () => undefined,
      onSelect: (option: { id: string }) => { host.dataset.selected = option.id; },
    });
    host.append(menu.field);
    const options = Array.from({ length: 4_345 }, (_, index) => ({
      id: `experiment-${index + 1}`,
      label: index === 4_344 ? 'Reln — sagittal experiment' : `Gene display name ${index + 1}`,
      description: index === 4_344 ? 'duplicate symbol disambiguated by feature display name' : 'AGEA expression energy',
      metadata: `experiment ${index + 1}`,
      keywords: index === 4_344 ? 'unique archive metadata' : '',
    }));
    menu.setDisplay('Gene display name 4,001');
    menu.setOptions(options, ['experiment-4001'], { emptyMessage: 'No features are available.' });
  });

  const picker = page.locator('#large-feature-picker-test');
  await picker.locator('.context-menu__trigger').click();
  await expect.poll(() => picker.getByRole('option').count()).toBeLessThan(30);
  await expect(picker.locator('.context-menu__list')).not.toHaveAttribute('data-options');
  await expect(picker.getByRole('option', { selected: true })).toHaveAttribute('data-context-option', 'experiment-4001');
  await expect(picker.getByRole('status')).toHaveText('4,345 matching feature options.');
  expect(await picker.getByRole('option', { selected: true }).evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(72);
  const list = picker.getByRole('listbox');
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(picker.locator('[data-context-option="experiment-4345"]')).toBeVisible();
  await expect(picker.locator('[data-context-option="experiment-4345"]')).toHaveAttribute('aria-posinset', '4345');
  await expect(picker.locator('[data-context-option="experiment-4345"]')).toHaveAttribute('aria-setsize', '4345');
  await list.evaluate(node => { node.scrollTop = 0; });
  await expect(picker.locator('[data-context-option="experiment-1"]')).toBeVisible();
  await picker.getByRole('searchbox').press('ArrowDown');
  await page.keyboard.press('End');
  await expect(picker.locator('[data-context-option="experiment-4345"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(picker.locator('[data-context-option="experiment-1"]')).toBeFocused();
  for (let index = 0; index < 35; index++) await page.keyboard.press('ArrowDown');
  await expect(picker.locator('[data-context-option="experiment-36"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(picker.locator('[data-context-option="experiment-36"]')).not.toBeFocused();
  await expect.poll(() => picker.getByRole('option').count()).toBeLessThan(30);

  const search = picker.getByRole('searchbox');
  await search.fill('no matching experiment anywhere');
  await expect(picker.getByRole('option')).toHaveCount(0);
  await expect(picker.getByText('No matching options', { exact: true })).toBeVisible();
  await search.fill('unique archive metadata');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await expect(picker.getByRole('option')).toContainText('Reln — sagittal experiment');
  await expect(picker.getByRole('status')).toHaveText('1 matching feature option.');
  await search.press('ArrowDown');
  await expect(picker.getByRole('option')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('data-selected', 'experiment-4345');
  await expect(picker.locator('.context-menu__panel')).toBeHidden();

  await picker.locator('.context-menu__trigger').click();
  await page.keyboard.press('Escape');
  await expect(picker.locator('.context-menu__trigger')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await picker.locator('.context-menu__trigger').click();
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(picker.locator('[data-context-option="experiment-4345"]')).toBeVisible();
  await picker.locator('[data-context-option="experiment-4345"]').click();
  await expect(picker).toHaveAttribute('data-selected', 'experiment-4345');
});

test('context menus explain release loading and failure instead of becoming inert', async ({ page }) => {
  let releaseManifest: (() => void) | undefined;
  const manifestGate = new Promise<void>((resolve) => {
    releaseManifest = resolve;
  });
  await page.route('**/__real-data/**/manifest.json', async (route) => {
    await manifestGate;
    await route.fulfill({ status: 503, body: 'release unavailable' });
  });
  await page.goto('/app/');

  const feature = page.locator('[data-context-field="feature"]');
  const featureTrigger = feature.locator('.context-menu__trigger');
  await expect(featureTrigger).toBeEnabled();
  await expect(featureTrigger).toHaveAttribute('aria-busy', 'true');
  await featureTrigger.click();
  await expect(feature.getByRole('status')).toHaveText('Loading features…');

  releaseManifest?.();
  await expect(featureTrigger).toHaveAttribute('aria-busy', 'false');
  await expect(feature.getByRole('status')).toContainText('Features unavailable:');

  const representation = page.locator('[data-context-field="representation"]');
  const representationTrigger = representation.locator('.context-menu__trigger');
  await representationTrigger.click();
  await expect(representation.getByRole('status')).toContainText('Views unavailable:');
});

test('scientific context menus and color controls are driven by the loaded release', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');

  const dataset = page.locator('[data-context-field="data"]');
  const datasetTrigger = dataset.locator('.context-menu__trigger');
  await expect(datasetTrigger).toHaveAttribute('aria-expanded', 'false');
  const headerBounds = await page.locator('.app-header').boundingBox();
  const triggerBounds = await datasetTrigger.boundingBox();
  expect(headerBounds).not.toBeNull();
  expect(triggerBounds).not.toBeNull();
  expect(triggerBounds!.y).toBeLessThanOrEqual(headerBounds!.y + 2);
  expect(triggerBounds!.y + triggerBounds!.height).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height - 2);
  await datasetTrigger.click({ position: { x: triggerBounds!.width / 2, y: 2 } });
  await expect(dataset.locator('.context-menu__panel')).toHaveAttribute('data-open', 'true');
  const selectedDataset = dataset.getByRole('option', { selected: true });
  await expect(selectedDataset.locator('.context-menu__option-label')).toHaveText('IBL Ephys Atlas v2 golden fixture');
  await expect(selectedDataset.locator('.context-menu__option-detail')).toContainText('deterministic non-scientific dataset');
  await expect(dataset.locator('.context-menu__group').filter({ hasText: 'Synthetic development data' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(datasetTrigger).toBeFocused();

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  const featureSearch = feature.getByLabel('Search features…');
  await expect(featureSearch).toBeFocused();
  await featureSearch.fill('rms_ap');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await expect(feature.getByRole('option', { selected: true })).toContainText('AP RMS (golden fixture)');
  await expect(feature.getByRole('option', { selected: true })).toContainText('dB rel. V');
  await expect(feature.getByRole('option', { selected: true })).toContainText(
    'Synthetic feature exercising regional values, descriptive statistics, histogram, volume chunks and download metadata.',
  );
  await featureSearch.fill('download metadata');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await featureSearch.fill('does not exist');
  await expect(feature.locator('.context-menu__list')).toHaveAttribute('data-empty', 'true');
  await page.keyboard.press('Escape');

  const featureSummary = page.locator('.secondary-view');
  await expect(featureSummary.locator('.feature-summary__description')).toHaveText(
    'Synthetic feature exercising regional values, descriptive statistics, histogram, volume chunks and download metadata.',
  );
  await expect(featureSummary.locator('.feature-summary')).toContainText('Observations');

  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await expect(representation.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
  await expect(representation.getByRole('group', { name: 'Representation' })).toBeVisible();
  await expect(representation.getByRole('group', { name: 'Parcellation' })).toBeVisible();
  await expect(representation.getByRole('option', { selected: true })).toHaveCount(2);
  await expect(representation.getByRole('option', { name: /Regional/ })).toHaveAttribute('aria-selected', 'true');
  await expect(representation.getByRole('option', { name: /Allen/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await expect(settings).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(settings.getByRole('heading', { name: 'Data' })).toHaveCount(0);
  await expect(page.getByLabel('Regional statistic').locator('option')).toHaveCount(5);
  await expect(page.getByLabel('Regional statistic').locator('option', { hasText: 'Standard deviation' })).toHaveCount(1);
  await expect(page.getByLabel('Regional statistic').locator('option', { hasText: 'Count' })).toHaveCount(0);
  const coloredRegion = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  const meanFill = await coloredRegion.evaluate((element) => getComputedStyle(element).fill);
  await page.getByLabel('Regional statistic').selectOption('std');
  await expect(page.getByLabel('Regional statistic')).toHaveValue('std');
  await expect.poll(() => new URL(page.url()).searchParams.get('stat')).toBe('std');
  await expect(page.locator('.region-row[data-region-id="-362"] .region-row__value')).toHaveAttribute('aria-label', /^std /);
  await expect.poll(() => coloredRegion.evaluate((element) => getComputedStyle(element).fill)).not.toBe(meanFill);
  await expect(page.getByLabel('Feature colormap').locator('option')).toHaveText(['Auto (Viridis)', 'Berlin', 'Viridis', 'Cividis', 'Magma', 'Plasma', 'Inferno', 'Blues', 'YlOrRd', 'Coolwarm']);
  await expect(page.getByLabel('Feature color legend')).toBeVisible();
  await expect(page.locator('.color-legend__unit')).toHaveText('dB rel. V');
  await expect(page.locator('.color-range__histogram-bin')).toHaveCount(8);
  const rangeBar = page.locator('.color-legend__bar');
  await expect(rangeBar).toHaveAttribute('data-distribution-domain', 'focused');
  await expect(rangeBar).toHaveAttribute('data-range-editable', 'false');
  await expect(rangeBar).toHaveAttribute('data-minimum-position', 'below');
  await expect(rangeBar).toHaveAttribute('data-maximum-position', 'above');
  await expect(page.locator('.color-legend__tails')).toHaveText('1 below · 1 above');
  await expect(page.getByRole('slider', { name: 'Minimum color value', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Maximum color value', exact: true })).toBeDisabled();
  await expect(page.locator('.color-legend__minimum')).toHaveText('-0.500');
  await expect(page.locator('.color-legend__maximum')).toHaveText('3.50');
  await expect(page.locator('.color-legend__domain-minimum')).toHaveText('0.00');
  await expect(page.locator('.color-legend__domain-maximum')).toHaveText('3.00');
  await page.getByRole('button', { name: 'Enter exact minimum color value' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Exact minimum color value' })).toHaveValue('-0.5');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await settings.getByLabel('Distribution domain').selectOption('full');
  await expect(rangeBar).toHaveAttribute('data-distribution-domain', 'full');
  await expect(rangeBar).toHaveAttribute('data-range-editable', 'true');
  await expect(page.locator('.color-legend__tails')).toBeHidden();
  await expect(page.getByRole('slider', { name: 'Minimum color value', exact: true })).toHaveValue('-0.5');
  await expect(page.getByRole('slider', { name: 'Maximum color value', exact: true })).toHaveValue('3.5');
  await expect(page.locator('.color-legend__minimum')).toHaveText('-0.500');
  await expect(page.locator('.color-legend__maximum')).toHaveText('3.50');
  await expect(page.locator('.color-legend__domain-minimum')).toHaveText('-0.500');
  await expect(page.locator('.color-legend__domain-maximum')).toHaveText('3.50');
  await expect(page.locator('.color-legend__minimum')).toHaveAttribute('data-side', 'right');
  await expect(page.locator('.color-legend__maximum')).toHaveAttribute('data-side', 'left');
  const activeLabelBounds = await page.locator('.color-range__value').evaluateAll((labels) => labels.map((label) => {
    const bounds = label.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, bottom: bounds.bottom };
  }));
  expect(activeLabelBounds[0]!.right).toBeLessThan(activeLabelBounds[1]!.left);
  await expect(settings.getByRole('spinbutton')).toHaveCount(0);

  const minimumBounds = await rangeBar.boundingBox();
  expect(minimumBounds).not.toBeNull();
  const minimumHandleBounds = await page.locator('.color-range__handle--min').boundingBox();
  expect(minimumHandleBounds).not.toBeNull();
  expect(activeLabelBounds[0]!.bottom).toBeLessThanOrEqual(minimumBounds!.y);
  await page.mouse.move(
    minimumHandleBounds!.x + minimumHandleBounds!.width / 2,
    minimumHandleBounds!.y + minimumHandleBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    minimumBounds!.x + minimumBounds!.width * .25,
    minimumBounds!.y + minimumBounds!.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBeNull();
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-mode', 'fixed');
  await expect.poll(async () => Number(
    await page.locator('.distribution-chart__color-range').getAttribute('data-minimum'),
  )).toBeCloseTo(Number(await page.getByRole('slider', { name: 'Minimum color value', exact: true }).inputValue()), 10);
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  await expect(rangeBar).toHaveCSS('background-image', 'none');
  await expect(page.locator('.color-range__selection')).toHaveCSS('background-image', /linear-gradient/);

  await page.getByLabel('Feature colormap').selectOption('cividis');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBe('cividis');
  await expect(page.locator('.color-legend__bar')).toHaveAttribute('data-colormap', 'cividis');
  await expect(page.locator('.color-range__selection')).toHaveCSS('background-image', /rgb\(0, 34, 78\)/);

  const rangeBeforeWindowDrag = new URL(page.url()).searchParams.get('range')!.split(',').map(Number);
  const selectionBounds = await page.locator('.color-range__selection').boundingBox();
  expect(selectionBounds).not.toBeNull();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2,
    selectionBounds!.y + selectionBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2 - minimumBounds!.width * .05,
    selectionBounds!.y + selectionBounds!.height / 2,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBe(rangeBeforeWindowDrag.join(','));
  const rangeAfterWindowDrag = new URL(page.url()).searchParams.get('range')!.split(',').map(Number);
  expect(rangeAfterWindowDrag[0]).not.toBe(rangeBeforeWindowDrag[0]);
  expect(rangeAfterWindowDrag[1]).not.toBe(rangeBeforeWindowDrag[1]);
  expect(rangeAfterWindowDrag[1]!).toBeGreaterThan(rangeAfterWindowDrag[0]!);

  await page.getByRole('button', { name: 'Enter exact minimum color value' }).click();
  const exactMinimum = page.getByRole('spinbutton', { name: 'Exact minimum color value', exact: true });
  await expect(exactMinimum).toBeFocused();
  await exactMinimum.fill('-2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Enter exact maximum color value' }).click();
  await page.getByRole('spinbutton', { name: 'Exact maximum color value', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('-2,8');
  await expect(page.locator('.color-legend__minimum')).toHaveText('-2.00');
  await expect(page.locator('.color-legend__maximum')).toHaveText('8.00');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-2');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '8');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBe('cividis');
  await expect(page.getByLabel('Feature colormap')).toHaveValue('cividis');
  await expect(page.getByLabel('Color range mode')).toHaveValue('auto');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-mode', 'auto');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-0.5');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '3.5');

  await page.getByRole('slider', { name: 'Maximum color value', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBeNull();
});

test('Auto colormap follows synthetic representation preferences while explicit palettes persist', async ({ page }) => {
  await page.goto('/app/');
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  const closeSettingsButton = page.getByRole('button', { name: 'Close Visualization settings' });
  await settingsButton.click();
  const colormap = page.getByLabel('Feature colormap');
  const legend = page.locator('.color-legend__bar');
  await expect(colormap).toHaveValue('auto');
  await expect(colormap.locator('option:checked')).toHaveText('Auto (Viridis)');
  await expect(legend).toHaveAttribute('data-colormap', 'viridis');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBeNull();

  const representation = page.locator('[data-context-field="representation"]');
  await closeSettingsButton.click();
  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Volume/ }).click();
  await settingsButton.click();
  await expect(colormap.locator('option:checked')).toHaveText('Auto (Magma)');
  await expect(legend).toHaveAttribute('data-colormap', 'magma');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBeNull();

  await colormap.selectOption('cividis');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBe('cividis');
  await expect(legend).toHaveAttribute('data-colormap', 'cividis');
  await closeSettingsButton.click();
  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Regional/ }).click();
  await settingsButton.click();
  await expect(legend).toHaveAttribute('data-colormap', 'cividis');

  await colormap.selectOption('auto');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBeNull();
  await expect(legend).toHaveAttribute('data-colormap', 'viridis');
  await closeSettingsButton.click();
  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Volume/ }).click();
  await settingsButton.click();
  await expect(legend).toHaveAttribute('data-colormap', 'magma');
});

test('manual Coolwarm retains a declared center or shows its uncentered range meaning', async ({ page }) => {
  await page.goto('/app/');
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  const closeSettingsButton = page.getByRole('button', { name: 'Close Visualization settings' });
  await settingsButton.click();
  const colormap = page.getByLabel('Feature colormap');
  const coolwarm = colormap.locator('option[value="coolwarm"]');
  await expect(coolwarm).toBeEnabled();
  await colormap.selectOption('coolwarm');
  await expect(page.locator('.color-legend__bar')).toHaveAttribute('data-colormap', 'coolwarm');
  await expect(page.locator('.color-range__selection')).toHaveCSS('background-image', /rgb\(221, 221, 221\)/);

  const representation = page.locator('[data-context-field="representation"]');
  await closeSettingsButton.click();
  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Volume/ }).click();
  await settingsButton.click();
  await expect(coolwarm).toBeEnabled();
  await expect(colormap).toHaveValue('coolwarm');
  await expect(page.locator('.color-legend__bar')).toHaveAttribute('data-colormap', 'coolwarm');
  await expect(page.locator('.settings-control__note')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBe('coolwarm');
});

test('scientific context picker becomes a bounded phone sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  const panel = feature.locator('.context-menu__panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'fixed');
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeGreaterThan(0);
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect.poll(async () => {
    const settled = await panel.boundingBox();
    return settled ? settled.y + settled.height : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(844);

  await page.getByRole('button', { name: 'Coronal', exact: true }).click();
  await expect(feature.locator('.context-menu__trigger')).toHaveAttribute('aria-expanded', 'false');
});

test('color range remains directly editable in the phone settings drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await expect(settings).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const rangeBar = page.locator('.color-legend__bar');
  await expect(rangeBar).toBeVisible();
  const barBounds = await rangeBar.boundingBox();
  const settingsBounds = await settings.boundingBox();
  expect(barBounds).not.toBeNull();
  expect(settingsBounds).not.toBeNull();
  expect(barBounds!.x).toBeGreaterThanOrEqual(settingsBounds!.x);
  expect(barBounds!.x + barBounds!.width).toBeLessThanOrEqual(settingsBounds!.x + settingsBounds!.width);

  await settings.getByLabel('Distribution domain').selectOption('full');
  await expect(rangeBar).toHaveAttribute('data-range-editable', 'true');
  await rangeBar.click({ position: { x: barBounds!.width * .01, y: barBounds!.height / 2 } });
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await page.getByRole('button', { name: 'Enter exact minimum color value' }).click();
  const editorBounds = await page.locator('.color-range__exact').boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(editorBounds!.x).toBeGreaterThanOrEqual(settingsBounds!.x);
  expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(settingsBounds!.x + settingsBounds!.width);
});

