import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../docs/assets/generated/manifest.json', import.meta.url));
const manifest = {
  schema_version: 1,
  generator: 'web/test/docs-screenshots/docs-screenshots.spec.ts',
  browser: 'pinned Playwright Chromium',
  fixture: 'fixtures/golden-v1',
  viewport: { width: 1680, height: 1050 },
  device_scale_factor: 1,
  captures: [
    {
      key: 'desktop-overview',
      file: 'desktop-overview.png',
      route: '/?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom&selected=-477,-803&scale=symlog&dist=focused',
    },
    {
      key: 'linked-anatomical-views',
      file: 'linked-anatomical-views.png',
      route: '/?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom&selected=-477,-803&scale=symlog&dist=focused',
    },
    {
      key: 'encoding-and-distribution-controls',
      file: 'encoding-and-distribution-controls.png',
      route: '/?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom&selected=-477,-803&scale=symlog&dist=focused',
    },
    {
      key: 'local-import-preview',
      file: 'local-import-preview.png',
      route: '/?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom&selected=-477,-803&scale=symlog&dist=focused',
      archive: 'fixtures/golden-v1.ibl-ephys-atlas.zip',
    },
  ],
};
const expected = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let actual;
  try {
    actual = await readFile(output, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('documentation screenshot manifest is missing; run `just docs-screenshots`');
    }
    throw error;
  }
  if (actual !== expected) {
    throw new Error('documentation screenshot manifest is stale; run `just docs-screenshots`');
  }
} else {
  await mkdir(fileURLToPath(new URL('../../docs/assets/generated/', import.meta.url)), { recursive: true });
  await writeFile(output, expected);
}
