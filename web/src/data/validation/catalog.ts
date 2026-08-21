import type { DatasetId } from '../../domain/types.js';
import { SCHEMA_VERSION, type DatasetCatalog } from '../contracts.js';
import { array, boolean, DATASET_ID_PATTERN, object, string, unique } from './primitives.js';

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  const root = object(value, 'catalog');
  if (root.schemaVersion !== SCHEMA_VERSION) throw new Error(`catalog.schemaVersion must be ${SCHEMA_VERSION}`);
  const datasets = array(root.datasets, 'catalog.datasets').map((value, index) => {
    const item = object(value, `catalog.datasets[${index}]`);
    const releases = array(item.releases, `catalog.datasets[${index}].releases`).map((value, releaseIndex) => {
      const context = `catalog.datasets[${index}].releases[${releaseIndex}]`;
      const release = object(value, context);
      return {
        id: string(release.id, `${context}.id`),
        label: string(release.label, `${context}.label`),
        manifest: string(release.manifest, `${context}.manifest`),
        immutable: boolean(release.immutable, `${context}.immutable`),
      };
    });
    const id = string(item.id, `catalog.datasets[${index}].id`) as DatasetId;
    if (!DATASET_ID_PATTERN.test(id)) throw new Error(`catalog dataset ${id} has an invalid id`);
    unique(releases.map((release) => release.id), `catalog dataset ${id} release ids`);
    const defaultRelease = string(item.defaultRelease, `catalog.datasets[${index}].defaultRelease`);
    if (!releases.some((release) => release.id === defaultRelease)) {
      throw new Error(`catalog dataset ${id} defaultRelease is missing from releases`);
    }
    return {
      id,
      title: string(item.title, `catalog.datasets[${index}].title`),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      releases,
      defaultRelease,
    };
  });
  unique(datasets.map((dataset) => dataset.id), 'catalog dataset ids');
  return { schemaVersion: SCHEMA_VERSION, datasets };
}
