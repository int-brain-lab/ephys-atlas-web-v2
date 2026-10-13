import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCatalogInventory } from '../../scripts/catalog-inventory.mjs';

const expected = {
  projects: [{ project_id: 'bwm', editions: [{ edition_id: 'original' }] }],
  datasets: [{ dataset_id: 'brainwide_map', releases: [{ release_id: 'original' }] }],
};

test('production QA rejects missing datasets even when every discovered dataset loads', () => {
  const actual = structuredClone(expected);
  actual.datasets = [];
  assert.throws(() => assertCatalogInventory(actual, expected), /brainwide_map/);
});

test('production QA rejects missing historical releases and editions', () => {
  for (const kind of ['releases', 'editions']) {
    const actual = structuredClone(expected);
    (kind === 'releases' ? actual.datasets[0] : actual.projects[0])[kind] = [];
    assert.throws(() => assertCatalogInventory(actual, expected), new RegExp(kind));
  }
});

test('production QA permits additions while retaining the expected inventory', () => {
  const actual = structuredClone(expected);
  actual.datasets.push({ dataset_id: 'new', releases: [{ release_id: 'new' }] });
  assertCatalogInventory(actual, expected);
});
