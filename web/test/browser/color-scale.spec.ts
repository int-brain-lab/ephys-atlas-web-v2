import { expect, test } from '@playwright/test';

test('scale and analytical domain are release-aware, synchronized, and canonicalized', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');

  const scale = page.locator('select[aria-label="Value scale"]');
  const domain = page.locator('select[aria-label="Distribution domain"]');
  const chart = page.locator('.distribution-chart');
  await expect(scale).toHaveValue('auto');
  await expect(scale.locator('option:checked')).toHaveText('Auto (Signed log)');
  await expect(domain).toHaveValue('auto');
  await expect(domain.locator('option:checked')).toHaveText('Auto (Focused)');
  await expect(chart).toHaveAttribute('data-axis-scale', 'symlog');
  await expect(chart).toHaveAttribute('data-distribution-domain', 'focused');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('dist')).toBeNull();

  await expect(scale.locator('option[value="log"]')).toHaveAttribute('disabled', '');
  await scale.selectOption('linear');
  await expect(chart).toHaveAttribute('data-axis-scale', 'linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await domain.selectOption('full');
  await expect(chart).toHaveAttribute('data-distribution-domain', 'full');
  await expect.poll(() => new URL(page.url()).searchParams.get('dist')).toBe('full');

  await page.goto('/?v=4&histScale=log&scale=log&dist=unknown');
  await expect(page.locator('select[aria-label="Value scale"]')).toHaveValue('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('histScale')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('dist')).toBe('full');
});

test('Focused uses whole-population probabilities and gives the compact range the same viewport', async ({ page }) => {
  await page.goto('/?v=4&selected=-477,-803&scale=symlog&dist=focused');
  const chart = page.locator('.distribution-chart');
  await expect(chart.locator('.distribution-chart__tails')).toHaveAttribute('data-visible', 'true');
  await expect(chart.locator('.distribution-chart__tails')).toContainText('Below');
  await expect(chart.locator('.distribution-chart__global')).not.toHaveAttribute('data-probability-sum', '1');
  await expect(chart.locator('.distribution-chart__legend-item[data-region-id="-477"]')).toContainText('outside focus');
  const colorRange = chart.locator('.distribution-chart__color-range');
  await expect(colorRange).toHaveAttribute('data-minimum-position', 'below');
  await expect(colorRange).toHaveAttribute('data-maximum-position', 'above');
  await expect(colorRange.locator('.distribution-chart__range-boundary--min')).toHaveAttribute('visibility', 'hidden');
  await expect(colorRange.locator('.distribution-chart__range-boundary--max')).toHaveAttribute('visibility', 'hidden');
  await expect(chart.locator('.distribution-chart__range-note')).toHaveText(
    'Color range extends below and above the Focused interval.',
  );
  await expect(chart.locator('.distribution-chart__marker[data-region-id="-803"]')).toHaveCount(0);
  const search = page.getByLabel('Search brain regions');
  await search.fill('Pallidum');
  await page.getByRole('button', { name: /PAL, Pallidum/ }).hover();
  await expect(chart.locator('.distribution-chart__hover-marker')).toHaveAttribute('data-visible', 'false');
  await expect(page.locator('.regional-distribution__tails').first()).toContainText('tails:');

  const compactRange = page.locator('.color-legend__bar');
  const compactBins = page.locator('.color-range__histogram-bin');
  await expect(compactRange).toHaveAttribute('data-distribution-domain', 'focused');
  await expect(page.locator('.color-legend__domain-minimum')).toHaveText('0.00');
  await expect(page.locator('.color-legend__domain-maximum')).toHaveText('3.00');
  await expect(page.locator('.color-legend__tails')).toHaveText('1 below · 1 above');
  await expect(compactRange).toHaveAttribute('data-range-editable', 'false');
  await expect(compactRange).toHaveAttribute('data-minimum-position', 'below');
  await expect(compactRange).toHaveAttribute('data-maximum-position', 'above');
  await expect(compactBins).toHaveCount(8);

  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(chart).toHaveAttribute('data-distribution-domain', 'full');
  await expect(chart.locator('.distribution-chart__tails')).toHaveAttribute('data-visible', 'false');
  await expect(compactRange).toHaveAttribute('data-distribution-domain', 'full');
  await expect(page.locator('.color-legend__domain-minimum')).toHaveText('-0.500');
  await expect(page.locator('.color-legend__domain-maximum')).toHaveText('3.50');
  await expect(page.locator('.color-legend__tails')).toBeHidden();
  await expect(compactRange).toHaveAttribute('data-range-editable', 'true');
  await expect(compactBins).toHaveCount(8);
  await expect.poll(() => new URL(page.url()).searchParams.get('dist')).toBe('full');
});

test('nonpositive manual Log range reconciles before volume rendering and preserves the range', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&scale=log&dist=focused&range=-2,8');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  await expect(page.locator('.distribution-chart')).toHaveAttribute('data-axis-scale', 'linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('dist')).toBe('full');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('-2,8');
});

test('volume exposes release-declared scales and remains global valid-voxel-only', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&scale=symlog&dist=focused&cursor=25,25,25');
  const chart = page.locator('.distribution-chart');
  await expect(chart).toHaveAttribute('data-axis-scale', 'symlog');
  await expect(chart).toHaveAttribute('data-distribution-domain', 'focused');
  await expect(chart.locator('.distribution-chart__region')).toHaveCount(0);
  await expect(chart).toContainText('Valid voxels');
  await expect(chart.locator('.distribution-chart__tails')).toHaveAttribute('data-visible', 'true');
});
