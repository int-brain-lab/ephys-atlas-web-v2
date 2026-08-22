import type { DatasetId } from '../../domain/types.js';
import { SCHEMA_VERSION, type DatasetCatalog } from '../contracts.js';
import { parseEncodedResource } from './binary.js';
import { array, DATASET_ID_PATTERN, object, string, unique } from './primitives.js';

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  const root = object(value, 'catalog');
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`catalog.schema_version must be ${SCHEMA_VERSION}`);
  const datasets = array(root.datasets, 'catalog.datasets').map((value, index) => {
    const item = object(value, `catalog.datasets[${index}]`);
    const releases = array(item.releases, `catalog.datasets[${index}].releases`).map((value, releaseIndex) => {
      const context = `catalog.datasets[${index}].releases[${releaseIndex}]`;
      const release = object(value, context);
      const manifestResource = parseEncodedResource(release.manifest, `${context}.manifest`);
      return {
        id: string(release.release_id, `${context}.release_id`),
        label: string(release.release_id, `${context}.release_id`),
        manifest: manifestResource.path,
        manifestResource,
        immutable: true,
      };
    });
    const id = string(item.dataset_id, `catalog.datasets[${index}].dataset_id`) as DatasetId;
    if (!DATASET_ID_PATTERN.test(id)) throw new Error(`catalog dataset ${id} has an invalid id`);
    unique(releases.map((release) => release.id), `catalog dataset ${id} release ids`);
    const defaultRelease = item.default_release === undefined
      ? releases.at(-1)?.id ?? ''
      : string(item.default_release, `catalog.datasets[${index}].default_release`);
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
