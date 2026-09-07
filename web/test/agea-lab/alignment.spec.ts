import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('fixed alignment review, linked navigation, notes and restoration', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto('/?lab=agea-coverage&mode=alignment');
  const status = page.locator('.alignment-status');
  await expect(status).toContainText('Alignment ready');
  await expect(page.locator('.alignment-viewport[data-volume-index]')).toHaveCount(3);
  await expect(page.locator('.alignment-caveat')).toContainText('not independent biological registration');
  expect(await page.locator('.agea-lab').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(7, 16, 25)');
  await expect(page.getByLabel('Search gene or experiment')).not.toBeVisible();
  await expect(page.getByLabel('Coarse AGEA boundaries')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await page.getByLabel('Review location').selectOption('2');
  await expect(status).toContainText('Alignment ready');
  await page.getByLabel('Alignment review note').fill('Review hippocampal boundary');
  await page.getByRole('button', { name: 'Unsure', exact: true }).click();
  await expect(page.getByLabel('Review location')).toHaveValue('3');
  await expect(status).toContainText('Alignment ready');
  const cursor = await page.locator('.alignment-inspector').textContent();
  await expect(page.locator('.alignment-review-count')).toHaveText('1 note saved');
  await expect(page.locator('.alignment-notes')).toContainText('Review hippocampal boundary');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download alignment review', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe('agea-alignment-review.json');
  const report = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(report.alignment_accepted).toBe(false);
  expect(report.scientific_release).toBe(false);
  expect(report.notes[0].note).toBe('Review hippocampal boundary');
  expect(report.notes[0].context.review_stop.label).toBe('Hippocampus');
  expect(report.notes[0].judgment).toBe('Uncertain');
  expect(report.current.review_stop.label).toBe('Cerebellum');
  expect(report.alignment.projection_pack.sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({ path: 'artifacts/agea-alignment-desktop.png', fullPage: true });
  await page.reload();
  await expect(status).toContainText('Alignment ready');
  await expect(page.getByLabel('Review location')).toHaveValue('3');
  await expect(page.locator('.alignment-inspector')).toHaveText(cursor!);
  await expect(page.locator('.alignment-review-count')).toHaveText('No notes yet');
  await page.getByText('More overlay options', { exact: true }).click();
  await page.getByLabel('Coarse AGEA boundaries').check();
  await page.reload();
  await expect(status).toContainText('Alignment ready');
  await expect(page.getByLabel('Coarse AGEA boundaries')).toBeChecked();
  await page.getByText('Change experiment', { exact: false }).click();
  await expect(page.getByLabel('Search gene or experiment')).toBeVisible();
  await page.getByLabel('Search gene or experiment').fill('Slc17a7');
  await page.locator('.agea-results button').first().click();
  await page.getByText('Change experiment', { exact: false }).click();
  await page.getByLabel('Alignment base layer').selectOption('expression');
  await expect(status).toContainText('original expression');
  await page.getByLabel('Website outlines', { exact: true }).uncheck();
  await expect(page.locator('.alignment-viewport .projection-viewport[data-anatomy-outlines="false"]')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/agea-alignment-mobile.png', fullPage: true });
  await page.getByText('Other investigation tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  await expect(page.locator('.agea-inspector')).toBeVisible();
});

test('corrupt reference image is rejected before alignment rendering', async ({ page }) => {
  await page.route('**/lab-anatomy-image.f32.gz', route => route.fulfill({ body: Buffer.from('corrupt') }));
  await page.goto('/?lab=agea-coverage&mode=alignment');
  await expect(page.locator('.alignment-status')).toContainText('Alignment unavailable');
  await expect(page.locator('.alignment-viewport[data-volume-index]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Looks consistent', exact: true })).toBeDisabled();
});

test('guided pass records each location without advancing past the last', async ({ page }) => {
  await page.goto('/?lab=agea-coverage&mode=alignment');
  for (let index = 0; index < 5; index++) {
    await expect(page.locator('.alignment-status')).toContainText('Alignment ready');
    await expect(page.getByLabel('Review location')).toHaveValue(String(index));
    await page.getByRole('button', { name: 'Looks consistent', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(page.locator('.alignment-review-count')).toContainText('5 notes saved');
  await page.getByText('Saved notes', { exact: true }).click();
  await expect(page.locator('.alignment-notes li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Revisit', exact: true }).first().click();
  await expect(page.getByLabel('Review location')).toHaveValue('0');
});
