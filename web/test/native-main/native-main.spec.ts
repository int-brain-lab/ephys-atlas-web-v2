import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test('approved Native is lazy, retained, URL-linked anatomy in the real full website', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  let manifest: any;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if(request.url().includes('/__local-assets/mesh/')) requests.push(request.url()); });
  page.on('response', async (response) => {
    if(response.url().includes('/__local-assets/mesh/') && response.url().endsWith('/manifest.json')) manifest=await response.json();
  });
  await page.goto('/');
  await expect(page.getByRole('tab',{name:'3-D',exact:true})).toBeVisible();
  expect(requests).toEqual([]);
  const catalog=await page.evaluate(async () => (await fetch('/__real-data/catalog.json')).json());
  expect(catalog.datasets.map((dataset:any)=>dataset.dataset_id)).toEqual([
    'ephys_atlas_channels','ephys_atlas_clusters','brainwide_map','ephys_atlas_volumes','agea',
  ]);
  await page.getByRole('tab',{name:'3-D',exact:true}).click();
  const host=page.locator('[data-scene3d-host="connected"]');
  await expect(host).toHaveAttribute('data-scene3d-state','ready');
  await expect(host).toHaveAttribute('data-lod','native-full');
  await expect(host).toHaveAttribute('data-geometry-uploads','1');
  expect(manifest.pack_id).toBe('ibl-native-d070-b5f5abc7d0bb3575');
  expect(manifest.purpose).toBe('production');
  expect(manifest.presentation_boundary.status).toBe('reviewed');
  expect(manifest.components.length).toBe(1140);
  expect(manifest.lods[0].triangle_count).toBe(966645);
  const notice=page.locator('.secondary-view__scene3d-notice');
  await expect(notice).toHaveText('3-D anatomy');
  await expect(page.locator('#movement-review')).toHaveCount(0);
  await page.getByRole('slider',{name:'Explode 3-D brain'}).fill('0.35');
  await expect(host).toHaveAttribute('data-explode','0.35');
  await page.getByLabel('Search brain regions').fill('AON');
  await page.locator('[data-region-button="-159"]').click();
  await expect(host).toHaveAttribute('data-transparency','weighted-blended');
  expect(new URL(page.url()).searchParams.get('selected')).toContain('-159');
  const meshRequestCount=requests.length;
  await page.getByRole('tab',{name:'Summary',exact:true}).click();
  await expect(host).toHaveAttribute('data-active','false');
  await page.getByRole('tab',{name:'3-D',exact:true}).click();
  await expect(host).toHaveAttribute('data-active','true');
  await expect(host).toHaveAttribute('data-geometry-uploads','1');
  expect(requests.length).toBe(meshRequestCount);
  await page.reload();
  await expect(host).toHaveAttribute('data-explode','0.35');
  await expect(host).toHaveAttribute('data-transparency','weighted-blended');
  await page.screenshot({path:'/tmp/atlas-native-main.png'});
  expect(errors).toEqual([]);
});

test('validated full-catalog workflow visits every local dataset with retained Native geometry', async () => {
  test.setTimeout(150_000);
  const result = await promisify(execFile)('uv', [
    'run','--project','builder','--extra','test','--locked','python','-m','tools.development_bundle',
    'run','--cwd','web','data/development-bundle-v5.json','--','node','scripts/validate-local-full.mjs',
    'http://127.0.0.1:4196/','../artifacts/native-main-browser-evidence',
  ], {cwd:path.resolve('..'),timeout:140_000});
  expect(result.stdout).toContain('ibl-native-d070-b5f5abc7d0bb3575');
  expect(result.stdout).toContain('"browser_errors":[]');
});
