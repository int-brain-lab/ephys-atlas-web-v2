import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('fixed alignment review, linked navigation, notes and restoration', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto('/?lab=agea-coverage&mode=alignment');
  const status = page.locator('.alignment-status');
  await expect(status).toContainText('Alignment ready');
  await expect(page.locator('.alignment-viewport[data-volume-index]')).toHaveCount(3);
  await expect(page.locator('.alignment-caveat')).toContainText('not independent biological registration');
  await page.getByRole('button', { name: 'Hippocampus', exact: true }).click();
  await expect(status).toContainText('Alignment ready');
  const cursor = await page.locator('.alignment-inspector').innerText();
  await page.getByLabel('Alignment review note').fill('Review hippocampal boundary');
  await page.getByRole('button', { name: 'Save review note', exact: true }).click();
  await expect(page.locator('.alignment-notes')).toContainText('Review hippocampal boundary');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download alignment review', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe('agea-alignment-review.json');
  const report = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(report.alignment_accepted).toBe(false);
  expect(report.scientific_release).toBe(false);
  expect(report.notes[0].note).toBe('Review hippocampal boundary');
  expect(report.alignment.projection_pack.sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({ path: 'artifacts/agea-alignment-desktop.png', fullPage: true });
  await page.reload();
  await expect(status).toContainText('Alignment ready');
  await expect(page.locator('.alignment-inspector')).toHaveText(cursor, { useInnerText: true });
  await page.getByLabel('Alignment base layer').selectOption('expression');
  await expect(status).toContainText('original expression');
  await page.getByLabel('Website outlines', { exact: true }).uncheck();
  await expect(page.locator('.alignment-viewport .projection-viewport[data-anatomy-outlines="false"]')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/agea-alignment-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  await expect(page.locator('.agea-inspector')).toBeVisible();
});

test('corrupt reference image is rejected before alignment rendering', async ({ page }) => {
  await page.route('**/lab-anatomy-image.f32.gz', route => route.fulfill({ body: Buffer.from('corrupt') }));
  await page.goto('/?lab=agea-coverage&mode=alignment');
  await expect(page.locator('.alignment-status')).toContainText('Alignment unavailable');
  await expect(page.locator('.alignment-viewport[data-volume-index]')).toHaveCount(0);
});
