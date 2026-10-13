import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const channels = 'ephys_atlas_channels';
const volumes = 'ephys_atlas_volumes';
const field = (page: Page, name: string) => page.locator(`[data-context-field="${name}"]`);
const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);

// Reuse golden fixture payloads directly through the test-only release server.
// Only synthetic identities/representation availability change; integrity is recomputed.
async function installCatalog(page: Page, legacy = false) {
  const source = JSON.parse(await readFile('../fixtures/golden-v1/manifest.json', 'utf8'));
  const featureSource = JSON.parse(await readFile('../fixtures/golden-v1/features/rms_ap/feature.json', 'utf8'));
  const documents = new Map<string, string>();
  const resource = (path: string, body: string) => ({ path, media_type: 'application/json',
    bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'),
    codec: { name: 'none', decoded_bytes: Buffer.byteLength(body) } });
  const dataset = (id: string, title: string) => {
    const kind = id === channels ? 'regional' : 'volume';
    const features = id === channels
      ? (legacy ? ['first', 'shared_quantity.raw', 'shared_quantity.denoised', 'channel_labels'] : ['first', 'shared_quantity', 'channel_labels'])
      : ['volume_first', 'shared_quantity'];
    const refs = features.map((featureId) => {
      const path = `features/rms_ap/feature.json?identity=${id}-${featureId}`;
      const body = JSON.stringify({ ...featureSource, id: featureId, label: featureId,
        value_semantics: { ...featureSource.value_semantics, quantity: featureId.replace(/\.(raw|denoised)$/, ''),
          source_column: featureId.replace(/\.(raw|denoised)$/, '') },
        display: { [kind]: featureSource.display[kind] },
        representations: { [kind]: featureSource.representations[kind] },
      });
      documents.set(`${id}-${featureId}`, body);
      return { id: featureId, descriptor: { format: 'ephys-atlas-feature-v1', resource: resource(path, body) } };
    });
    const body = JSON.stringify({ ...source, dataset_id: id, features: refs,
      provenance: { ...source.provenance,
        recipe: { ...source.provenance.recipe, feature_mode: legacy ? 'both' : 'denoised' } },
    });
    documents.set(id, body);
    return { dataset_id: id, title, default_release: 'golden-v1', releases: [{ release_id: 'golden-v1',
      label: 'Synthetic test release', manifest: resource(`./golden_fixture/golden-v1/manifest.json?identity=${id}`, body) }] };
  };
  const catalog = { schema_version: '1.0', default_project: 'ephys-atlas', projects: [{
    project_id: 'ephys-atlas', title: 'Ephys Atlas', dataset_ids: [channels, volumes], default_dataset: channels, editions: [],
  }], datasets: [dataset(channels, 'Channels'), dataset(volumes, 'Volumes')] };
  await page.route('**/*json?identity=*', async (route) => {
    const key = new URL(route.request().url()).searchParams.get('identity')!;
    await route.fulfill({ body: documents.get(key)!, contentType: 'application/json' });
  });
  await page.route('**/__real-data/catalog.json', (route) => route.fulfill({ json: catalog }));
}

async function chooseData(page: Page, name: string) {
  await field(page, 'data').locator('.context-menu__trigger').click();
  await field(page, 'data').getByRole('option', { name: new RegExp(`^${name}`) }).click();
}
async function chooseFeature(page: Page, name: string) {
  await field(page, 'feature').locator('.context-menu__trigger').click();
  await field(page, 'feature').getByRole('option', { name: new RegExp(`^${name}`) }).click();
}

for (const width of [1280, 390]) {
  test(`shared feature survives dataset switches and browser history at ${width}px`, async ({ page }) => {
    await installCatalog(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/?v=4&feature=shared_quantity&cursor=25,25,25');
    await expect(field(page, 'feature')).toContainText('shared_quantity');
    const initialHistory = await page.evaluate(() => history.length);
    await chooseData(page, 'Volumes');
    await expect.poll(() => param(page, 'dataset')).toBe(volumes);
    await expect.poll(() => param(page, 'feature')).toBe('shared_quantity');
    await expect.poll(() => param(page, 'repr')).toBe('volume');
    await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistory + 1);
    await chooseData(page, 'Channels');
    await expect.poll(() => param(page, 'dataset')).toBe(channels);
    await expect.poll(() => param(page, 'feature')).toBe('shared_quantity');
    await expect.poll(() => param(page, 'repr')).not.toBe('volume');
    await page.goBack();
    await expect.poll(() => param(page, 'dataset')).toBe(volumes);
    await expect.poll(() => param(page, 'feature')).toBe('shared_quantity');
    await page.goForward();
    await expect.poll(() => param(page, 'dataset')).toBe(channels);
    await expect(field(page, 'feature')).toContainText('shared_quantity');
    await chooseFeature(page, 'channel_labels');
    await expect.poll(() => param(page, 'feature')).toBe('channel_labels');
    await chooseData(page, 'Volumes');
    await expect.poll(() => param(page, 'dataset')).toBe(volumes);
    await expect.poll(() => param(page, 'feature')).toBe('shared_quantity');
    await page.reload();
    await expect(field(page, 'feature')).toContainText('shared_quantity');
  });
}

test('legacy raw feature maps to volume quantity and returns to the raw variant', async ({ page }) => {
  await installCatalog(page, true);
  await page.goto('/app/?v=4&feature=shared_quantity.raw&cursor=25,25,25');
  await expect(field(page, 'feature')).toContainText('shared_quantity.raw');
  await chooseData(page, 'Volumes');
  await expect.poll(() => param(page, 'feature')).toBe('shared_quantity');
  await expect.poll(() => param(page, 'repr')).toBe('volume');
  await chooseData(page, 'Channels');
  await expect.poll(() => param(page, 'feature')).toBe('shared_quantity.raw');
  await expect.poll(() => param(page, 'repr')).not.toBe('volume');
});

test('a channel-only feature falls back when volumes has no remembered selection', async ({ page }) => {
  await installCatalog(page);
  await page.goto('/app/?v=4&feature=channel_labels&cursor=25,25,25');
  await expect(field(page, 'feature')).toContainText('channel_labels');
  await chooseData(page, 'Volumes');
  await expect.poll(() => param(page, 'feature')).toBe('volume_first');
  await expect.poll(() => param(page, 'repr')).toBe('volume');
  await chooseData(page, 'Channels');
  await expect.poll(() => param(page, 'feature')).toBe('channel_labels');
});
