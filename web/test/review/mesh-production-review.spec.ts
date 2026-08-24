import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const root = process.env.EPHYS_ATLAS_MESH_REVIEW_ROOT;
if (!root) throw new Error('EPHYS_ATLAS_MESH_REVIEW_ROOT is required');
const review = path.resolve(root, 'review');

test('exact candidate remains retained through presentation review and emits evidence', async ({ page }) => {
  const geometryRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/pack\/(compact|high)\.eam3\.gz$/.test(new URL(request.url()).pathname)) geometryRequests.push(request.url());
  });
  await page.goto('/__mesh-review/review/index.html');
  await expect(page.locator('#status')).toHaveText('Verified compact, high, and source loaded');
  expect(geometryRequests).toHaveLength(2);
  const initialUploads = await uploads(page);
  expect(initialUploads).toEqual({ compact: '2', high: '2' });

  const signedIds = await page.locator('#region option').allTextContents();
  expect(signedIds).toEqual(['-222', '222', '-763', '763', '-927', '927', '-526322264', '526322264', '-599626923', '599626923']);
  for (const identifier of signedIds) {
    await page.selectOption('#region', identifier);
    await page.selectOption('#mapping', 'allen');
    await page.locator('#explode').fill(identifier.startsWith('-') ? '0' : '1');
    await expect(page.locator('#diagnostics')).toContainText(`"signed_allen_id": ${identifier}`);
  }
  for (const mapping of ['beryl', 'cosmos', 'allen']) await page.selectOption('#mapping', mapping);
  expect(geometryRequests).toHaveLength(2);
  expect(await uploads(page)).toEqual(initialUploads);

  for (const width of ['320', '480', '800']) {
    await page.selectOption('#width', width);
    await expect(page.locator('#comparison')).toHaveAttribute('data-width', width);
    await page.screenshot({ path: path.join(review, 'screenshots', `candidate-${width}px.png`), fullPage: true });
  }
  const config = JSON.parse(await readFile(path.join(review, 'review-config.json'), 'utf8')) as { pack_id: string; builder_commit: string };
  const evidence = {
    format: 'atlas-mesh-browser-review-evidence-v1',
    pack_id: config.pack_id,
    builder_commit: config.builder_commit,
    browser: await page.evaluate(() => navigator.userAgent),
    reviewed_signed_allen_ids: signedIds.map(Number),
    mappings: ['allen', 'beryl', 'cosmos'],
    widths_px: [320, 480, 800],
    geometry_request_count: geometryRequests.length,
    geometry_uploads_before: initialUploads,
    geometry_uploads_after: await uploads(page),
    presentation_changes_triggered_no_geometry_request_or_upload: true,
    screenshots: ['candidate-320px.png', 'candidate-480px.png', 'candidate-800px.png'],
  };
  await writeFile(path.join(review, 'browser-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const summaryPath = path.join(review, 'review-summary.json');
  const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as { automated_evidence: Record<string, string> };
  summary.automated_evidence.presentation_changes_geometry_requests = 'pass';
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
});

async function uploads(page: import('@playwright/test').Page): Promise<{ compact: string | undefined; high: string | undefined }> {
  return page.evaluate(() => ({
    compact: document.querySelector<HTMLElement>('#compact')?.dataset.geometryUploads,
    high: document.querySelector<HTMLElement>('#high')?.dataset.geometryUploads,
  }));
}
