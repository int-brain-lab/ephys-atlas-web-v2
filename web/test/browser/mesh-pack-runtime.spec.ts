import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const fixtureRoot = new URL('../../../fixtures/mesh-pack-v1/pack/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8'));
const encoded = await readFile(new URL('default.eam3.gz', fixtureRoot));

test('module worker decodes the verified tiny bilateral mesh pack', async ({ page }) => {
  await page.route('**/__mesh_fixture', (route) => route.fulfill({
    status: 200,
    contentType: 'application/vnd.ibl.eam3',
    body: encoded,
  }));
  await page.goto('/');
  const result = await page.evaluate(async ({ resource, decoder }) => {
    const { MeshPackRuntime } = await import('/src/rendering/3d/mesh-pack-runtime.ts');
    const response = await fetch('/__mesh_fixture');
    const runtime = new MeshPackRuntime();
    try {
      const decoded = await runtime.decode(await response.arrayBuffer(), resource, decoder, 1024 * 1024);
      return {
        hemispheres: decoded.chunks.map((chunk) => chunk.hemisphere),
        signedAllenIds: decoded.chunks.flatMap((chunk) => chunk.ranges.map((range) => range.signedAllenId)),
        triangles: decoded.chunks.reduce((total, chunk) => total + chunk.indices.length / 3, 0),
      };
    } finally {
      runtime.dispose();
    }
  }, { resource: manifest.lods[0].resource, decoder: manifest.lods[0].decoder });
  expect(result).toEqual({ hemispheres: ['left', 'right'], signedAllenIds: [-315, 315], triangles: 12 });
});
