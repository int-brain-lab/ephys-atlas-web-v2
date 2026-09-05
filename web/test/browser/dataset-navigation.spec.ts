import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const field = (page: Page, name: string) => page.locator(`[data-context-field="${name}"]`);
const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);

async function openDetails(page: Page) {
  if (await page.locator('.app-header__overflow').isVisible()) {
    await page.locator('.app-header__overflow-trigger').click();
    await page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Data details' }).click();
  } else {
    await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Data details' }).click();
  }
  return page.getByRole('dialog', { name: 'Data details' });
}

async function changeVersion(page: Page, name: RegExp) {
  const details = await openDetails(page);
  await details.getByText('Change version…', { exact: true }).click();
  await expect(details.getByRole('radio', { checked: true })).toHaveCount(1);
  await details.getByRole('radio', { name }).click();
  await expect(details).toBeHidden();
}

// Additional identities reuse canonical test-server resources with explicitly
// synthetic manifest identities and recomputed served-byte integrity.
async function groupedCatalog(page: Page): Promise<void> {
  const source = JSON.parse(await readFile('../fixtures/golden-v1/manifest.json', 'utf8'));
  const manifests = new Map<string, string>();
  const dataset = (id: string, title: string) => ({
    dataset_id: id, title, description: 'Synthetic navigation fixture', default_release: 'new',
    releases: ['old', 'new'].map((release) => {
      const body = JSON.stringify({ ...source, dataset_id: id, release: { ...source.release, release_id: release } });
      const path = `./golden_fixture/golden-v1/manifest.json?identity=${id}-${release}`;
      manifests.set(`${id}-${release}`, body);
      return { release_id: release, label: `Synthetic ${release}`, status: 'development', manifest: {
        path, media_type: 'application/json', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'),
        codec: { name: 'none', decoded_bytes: Buffer.byteLength(body) },
      } };
    }),
  });
  const edition = (id: string, ids: string[]) => ({ edition_id: id, label: 'Synthetic coordinated edition',
    dataset_releases: ids.map((dataset_id) => ({ dataset_id, release_id: 'old' })) });
  await page.route('**/manifest.json?identity=*', async (route) => {
    await route.fulfill({ json: JSON.parse(manifests.get(new URL(route.request().url()).searchParams.get('identity')!)!) });
  });
  const catalog = { schema_version: '1.0', default_project: 'ephys', projects: [
    { project_id: 'ephys', title: 'Ephys Atlas', dataset_ids: ['channels', 'clusters', 'extra'], default_dataset: 'channels',
      default_edition: 'coordinated', editions: [edition('coordinated', ['channels', 'clusters'])] },
    { project_id: 'bwm', title: 'Brain-Wide Map', dataset_ids: ['results'], default_dataset: 'results',
      default_edition: 'legacy', editions: [edition('legacy', ['results'])] },
  ], datasets: [dataset('clusters', 'Ephys Atlas clusters'), dataset('channels', 'Ephys Atlas channels'),
    dataset('extra', 'Additional synthetic data'), dataset('results', 'Brain-Wide Map')] };
  await page.route('**/__real-data/catalog.json', (route) => route.fulfill({ json: catalog }));
}

for (const width of [1680, 1024, 390]) {
  test(`Data selects datasets atomically with grouped project identity at ${width}px`, async ({ page }) => {
    await groupedCatalog(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(field(page, 'feature')).toContainText('AP RMS');
    const data = field(page, 'data');
    await expect(field(page, 'release')).toHaveCount(0);
    const initialHistory = await page.evaluate(() => history.length);
    await data.getByRole('button', { name: /^Data:/ }).press('ArrowDown');
    const ephys = data.getByRole('group', { name: 'Ephys Atlas', exact: true });
    await expect(ephys.getByRole('option')).toHaveText(['ChannelsSynthetic navigation fixture✓', 'ClustersSynthetic navigation fixture', 'Additional synthetic dataSynthetic navigation fixture']);
    await expect(ephys.getByRole('option').first()).toBeFocused();
    await expect(data.getByRole('group', { name: 'Brain-Wide Map', exact: true })).toBeVisible();
    await ephys.getByRole('option', { name: /^Clusters/ }).click();
    await expect.poll(() => param(page, 'dataset')).toBe('clusters');
    await expect.poll(() => param(page, 'release')).toBe('old');
    await expect.poll(() => param(page, 'edition')).toBe('coordinated');
    await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistory + 1);
    await expect(data.getByRole('button', { name: /^Data:/ })).toBeFocused();

    await changeVersion(page, /^Synthetic new/);
    await expect.poll(() => param(page, 'context')).toBe('custom');
    await expect.poll(() => param(page, 'base_edition')).toBe('coordinated');
    const overriddenUrl = page.url();
    await data.getByRole('button', { name: /^Data:/ }).click();
    await data.getByRole('option', { name: /^Clusters/ }).click();
    await expect(page).toHaveURL(overriddenUrl);
    await changeVersion(page, /^Synthetic old/);
    await expect.poll(() => param(page, 'context')).toBe('custom');
    await page.reload();
    const details = await openDetails(page);
    await expect(details).toContainText('This version was selected individually from Synthetic coordinated edition.');
    await details.getByRole('button', { name: 'Return to Synthetic coordinated edition' }).click();
    await expect.poll(() => param(page, 'edition')).toBe('coordinated');

    await data.getByRole('button', { name: /^Data:/ }).click();
    await data.getByRole('option', { name: /^Additional synthetic data/ }).click();
    await expect.poll(() => param(page, 'context')).toBe('custom');
    await expect.poll(() => param(page, 'base_edition')).toBe('coordinated');
    await expect.poll(() => param(page, 'release')).toBe('new');
    await data.getByRole('button', { name: /^Data:/ }).click();
    await data.getByRole('option', { name: /^Preserved legacy results/ }).click();
    await expect.poll(() => param(page, 'project')).toBe('bwm');
    await expect.poll(() => param(page, 'edition')).toBe('legacy');
    await expect.poll(() => param(page, 'release')).toBe('old');
    await expect(field(page, 'feature')).toContainText('AP RMS');
    await page.goBack();
    await expect.poll(() => param(page, 'dataset')).toBe('extra');
    await expect.poll(() => param(page, 'base_edition')).toBe('coordinated');
    await page.goForward();
    await expect.poll(() => param(page, 'project')).toBe('bwm');
    await page.reload();
    await expect(data).toContainText('Brain-Wide Map / Preserved legacy results');
  });
}

test('single version lives in Data details without a mode or version picker', async ({ page }) => {
  await page.goto('/?v=4&project=synthetic-development&edition=synthetic-current&dataset=golden_fixture&release=golden-v1');
  await expect(field(page, 'feature')).toContainText('AP RMS');
  await expect(field(page, 'release')).toHaveCount(0);
  const url = page.url();
  const details = await openDetails(page);
  await expect(details.getByRole('region', { name: 'Data version' })).toContainText('golden-v1');
  await expect(details).toContainText('Only available version');
  await expect(details.getByText('Change version…', { exact: true })).toHaveCount(0);
  await expect(details).not.toContainText('Choose releases individually');
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Data details' })).toBeFocused();
});

test('current version is a no-op and overrides preserve exact history', async ({ page }) => {
  await groupedCatalog(page);
  await page.goto('/');
  await expect(field(page, 'feature')).toContainText('AP RMS');
  await expect(field(page, 'data')).toContainText('Development data');
  const initial = page.url();
  const details = await openDetails(page);
  await details.getByText('Change version…', { exact: true }).click();
  await details.getByRole('radio', { name: /^Synthetic old/ }).click();
  await expect(page).toHaveURL(initial);
  await expect(details).toBeVisible();
  await details.getByRole('radio', { name: /^Synthetic new/ }).click();
  const changed = page.url();
  await expect.poll(() => param(page, 'release')).toBe('new');
  await page.goBack();
  await expect(page).toHaveURL(initial);
  await page.goForward();
  await expect(page).toHaveURL(changed);
  const reopened = await openDetails(page);
  await expect(reopened).toContainText('This version differs from Synthetic coordinated edition.');
});

test('exact links can restore the current dataset default without claiming a snapshot', async ({ page }) => {
  await groupedCatalog(page);
  await page.goto('/?v=4&project=ephys&context=custom&dataset=clusters&release=new');
  await expect(field(page, 'feature')).toContainText('AP RMS');
  const details = await openDetails(page);
  await details.getByRole('button', { name: 'Use default version' }).click();
  await expect.poll(() => param(page, 'dataset')).toBe('clusters');
  await expect.poll(() => param(page, 'release')).toBe('old');
  await expect.poll(() => param(page, 'context')).toBe('custom');
});

test('failed version keeps Data details available for recovery', async ({ page }) => {
  await groupedCatalog(page);
  await page.route('**/manifest.json?identity=channels-new', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/?v=4&project=ephys&context=custom&dataset=channels&release=new');
  const details = await openDetails(page);
  await expect(details.getByRole('status')).toContainText('Data unavailable');
  await expect(details.getByRole('region', { name: 'Data version' })).toContainText('new');
  await details.getByRole('button', { name: 'Use default version' }).click();
  await expect.poll(() => param(page, 'release')).toBe('old');
  await expect(field(page, 'feature')).toContainText('AP RMS');
});

test('phone version picker supports keyboard choice and Escape', async ({ page }) => {
  await groupedCatalog(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(field(page, 'feature')).toContainText('AP RMS');
  const details = await openDetails(page);
  await details.getByText('Change version…', { exact: true }).press('Enter');
  await details.getByRole('radio', { name: /^Synthetic new/ }).press('Space');
  await expect.poll(() => param(page, 'release')).toBe('new');
  await expect(details).toBeHidden();
  await openDetails(page);
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(page.getByLabel('More actions', { exact: true })).toBeFocused();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
});

for (const width of [390, 759, 760, 1099, 1100, 1480]) {
  test(`menus are bounded and keyboard reversible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(field(page, 'feature')).toContainText('AP RMS');
    const initialUrl = page.url();
    for (const name of ['data', 'feature', 'representation']) {
      const menu = field(page, name);
      const trigger = menu.locator('.context-menu__trigger');
      await trigger.press('ArrowDown');
      const panel = menu.locator('.context-menu__panel');
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS('background-color', 'rgb(13, 27, 39)');
      await expect.poll(() => panel.evaluate((node) => {
        const b = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + 10));
      })).toBe(true);
      await expect.poll(async () => {
        const b = (await menu.locator('.context-menu__panel').boundingBox())!;
        return b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= 844;
      }).toBe(true);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
    await field(page, 'data').locator('.context-menu__trigger').click();
    await field(page, 'feature').locator('.context-menu__trigger').click();
    await expect(field(page, 'data').locator('.context-menu__panel')).toBeHidden();
    await page.setViewportSize({ width: width === 390 ? 1100 : 390, height: 844 });
    await expect(page).toHaveURL(initialUrl);
    await expect(field(page, 'feature').locator('.context-menu__trigger')).toBeFocused();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width === 390 ? 1100 : 390);
  });
}

test('Data announces catalog loading and failure and retries', async ({ page }) => {
  let rejectCatalog: (() => void) | undefined;
  let attempts = 0;
  const gate = new Promise<void>((resolve) => { rejectCatalog = resolve; });
  await page.route('**/__real-data/catalog.json', async (route) => {
    if (++attempts > 1) return route.fallback();
    await gate;
    await route.fulfill({ status: 503, body: 'catalog unavailable' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const data = field(page, 'data');
  const trigger = data.locator('.context-menu__trigger');
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await trigger.click();
  await expect(data.getByRole('status')).toHaveText('Loading datasets…');
  rejectCatalog?.();
  await expect(data.getByRole('status')).toContainText('Data unavailable: HTTP 503');
  await data.getByRole('option', { name: /Retry catalog/ }).click();
  await expect(trigger).toBeFocused();
  await expect.poll(() => param(page, 'release')).toBe('golden-v1');
  expect(attempts).toBe(2);
});

test('invalid edition URL preserves its exact request and offers explicit recovery', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/golden_fixture/golden-v1/manifest.json')) requests++; });
  await page.goto('/?v=4&project=synthetic-development&edition=synthetic-current&dataset=golden_fixture&release=missing');
  const release = field(page, 'data');
  await expect(release).toContainText('Navigation unavailable · open to recover');
  await expect.poll(() => param(page, 'release')).toBe('missing');
  expect(requests).toBe(0);
  await release.locator('.context-menu__trigger').click();
  await expect(release.getByRole('group', { name: 'Navigation recovery' }).getByRole('option')).toHaveCount(3);
  await release.getByRole('option', { name: /Use snapshot version/ }).click();
  await expect(field(page, 'feature')).toContainText('AP RMS');
  expect(requests).toBe(1);
  await page.goBack();
  await expect.poll(() => param(page, 'release')).toBe('missing');
  await page.setViewportSize({ width: 390, height: 844 });
  await field(page, 'data').locator('.context-menu__trigger').click();
  await field(page, 'data').getByRole('option', { name: /Use catalog default/ }).click();
  await expect.poll(() => param(page, 'context')).toBe('custom');
  await expect.poll(() => param(page, 'release')).toBe('golden-v1');
});

test('unknown project exposes only catalog-default recovery', async ({ page }) => {
  await page.goto('/?v=4&project=unknown-project&context=custom&dataset=golden_fixture&release=golden-v1');
  await field(page, 'data').locator('.context-menu__trigger').click();
  const recovery = field(page, 'data').getByRole('group', { name: 'Navigation recovery' });
  await expect(recovery.getByRole('option')).toHaveCount(1);
  await recovery.getByRole('option').click();
  await expect.poll(() => param(page, 'project')).toBe('synthetic-development');
});

test('keyboard opening More actions and Data keeps one menu open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const feature = field(page, 'feature');
  await feature.locator('.context-menu__trigger').press('ArrowDown');
  const more = page.getByText('⋯', { exact: true });
  await more.locator('..').focus();
  await page.keyboard.press('Enter');
  await expect(feature.locator('.context-menu__panel')).toBeHidden();
  await expect(page.locator('.app-header__overflow')).toHaveAttribute('open', '');
  await field(page, 'data').locator('.context-menu__trigger').press('ArrowDown');
  await expect(page.locator('.app-header__overflow')).not.toHaveAttribute('open', '');
  await expect(field(page, 'data').locator('.context-menu__panel')).toBeVisible();
});
