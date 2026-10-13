import assert from 'node:assert/strict';

// Expected discovery comes from a reviewed baseline, independently of live discovery.
export function assertCatalogInventory(actual, expected) {
  const inventory = catalog => ({
    projects: catalog.projects.map(p => p.project_id),
    datasets: catalog.datasets.map(d => d.dataset_id),
    releases: catalog.datasets.flatMap(d => d.releases.map(r => `${d.dataset_id}/${r.release_id}`)),
    editions: catalog.projects.flatMap(p => p.editions.map(e => `${p.project_id}/${e.edition_id}`)),
  });
  const available = inventory(actual);
  for (const [kind, ids] of Object.entries(inventory(expected))) {
    const missing = ids.filter(id => !available[kind].includes(id));
    assert.deepEqual(missing, [], `Catalog is missing expected ${kind}: ${missing.join(', ')}`);
  }
}
