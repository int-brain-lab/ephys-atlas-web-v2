import type { DatasetId } from '../../domain/types.js';
import {
  SCHEMA_VERSION,
  type DatasetCatalog,
  type DatasetCatalogEntry,
} from '../contracts.js';
import { parseEncodedResource } from './binary.js';
import { array, DATASET_ID_PATTERN, IDENTIFIER_PATTERN, object, string, unique } from './primitives.js';

function fields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) throw new Error(`${context}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${context}.${key} is not supported`);
  }
}

function optionalString(value: unknown, context: string): string | undefined {
  return value === undefined ? undefined : string(value, context);
}

function nonEmptyArray(value: unknown, context: string): unknown[] {
  const result = array(value, context);
  if (result.length === 0) throw new Error(`${context} must not be empty`);
  return result;
}

function parseStatus(value: unknown, context: string): 'legacy' | 'development' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'legacy' && value !== 'development') {
    throw new Error(`${context} must be legacy or development`);
  }
  return value;
}

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  const root = object(value, 'catalog');
  fields(root, ['schema_version', 'default_project', 'projects', 'datasets'], [], 'catalog');
  if (root.schema_version !== SCHEMA_VERSION) {
    throw new Error(`catalog.schema_version must be ${SCHEMA_VERSION}`);
  }

  const datasets: DatasetCatalogEntry[] = array(root.datasets, 'catalog.datasets').map((raw, index) => {
    const context = `catalog.datasets[${index}]`;
    const item = object(raw, context);
    fields(item, ['dataset_id', 'title', 'default_release', 'releases'], ['description'], context);
    const releases = nonEmptyArray(item.releases, `${context}.releases`).map((releaseRaw, releaseIndex) => {
      const releaseContext = `${context}.releases[${releaseIndex}]`;
      const release = object(releaseRaw, releaseContext);
      fields(release, ['release_id', 'label', 'manifest'], ['status', 'description'], releaseContext);
      const manifestResource = parseEncodedResource(release.manifest, `${releaseContext}.manifest`);
      const id = string(release.release_id, `${releaseContext}.release_id`);
      if (!IDENTIFIER_PATTERN.test(id)) throw new Error(`${releaseContext}.release_id is invalid`);
      const label = string(release.label, `${releaseContext}.label`);
      if (id === label) throw new Error(`${releaseContext}.label must differ from release_id`);
      const status = parseStatus(release.status, `${releaseContext}.status`);
      const description = optionalString(release.description, `${releaseContext}.description`);
      return {
        id,
        label,
        ...(status ? { status } : {}),
        ...(description ? { description } : {}),
        manifest: manifestResource.path,
        manifestResource,
        immutable: true,
      };
    });
    const id = string(item.dataset_id, `${context}.dataset_id`) as DatasetId;
    if (!DATASET_ID_PATTERN.test(id) || id === 'local') {
      throw new Error(`catalog dataset ${id} has an invalid or reserved id`);
    }
    unique(releases.map((release) => release.id), `catalog dataset ${id} release ids`);
    const defaultRelease = string(item.default_release, `${context}.default_release`);
    if (!IDENTIFIER_PATTERN.test(defaultRelease)) throw new Error(`${context}.default_release is invalid`);
    if (!releases.some((release) => release.id === defaultRelease)) {
      throw new Error(`catalog dataset ${id} defaultRelease is missing from releases`);
    }
    const description = optionalString(item.description, `${context}.description`);
    return {
      id,
      source: 'published',
      projectId: '',
      title: string(item.title, `${context}.title`),
      ...(description ? { description } : {}),
      releases,
      defaultRelease,
    };
  });
  unique(datasets.map((dataset) => dataset.id), 'catalog dataset ids');

  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const memberships = new Map<string, string>();
  const projects = nonEmptyArray(root.projects, 'catalog.projects').map((raw, index) => {
    const context = `catalog.projects[${index}]`;
    const item = object(raw, context);
    fields(
      item,
      ['project_id', 'title', 'dataset_ids', 'default_dataset', 'editions'],
      ['description', 'default_edition'],
      context,
    );
    const id = string(item.project_id, `${context}.project_id`);
    if (!IDENTIFIER_PATTERN.test(id) || id === 'local') {
      throw new Error(`catalog project ${id} has an invalid or reserved id`);
    }
    const datasetIds = nonEmptyArray(item.dataset_ids, `${context}.dataset_ids`).map((datasetRaw, datasetIndex) => {
      const datasetId = string(datasetRaw, `${context}.dataset_ids[${datasetIndex}]`) as DatasetId;
      if (!datasetById.has(datasetId)) throw new Error(`project ${id} references unknown dataset ${datasetId}`);
      if (memberships.has(datasetId)) throw new Error(`dataset ${datasetId} belongs to more than one project`);
      memberships.set(datasetId, id);
      return datasetId;
    });
    unique(datasetIds, `catalog project ${id} dataset ids`);
    const defaultDataset = string(item.default_dataset, `${context}.default_dataset`) as DatasetId;
    if (!datasetIds.includes(defaultDataset)) {
      throw new Error(`project ${id} default_dataset is outside its membership`);
    }
    const editions = array(item.editions, `${context}.editions`).map((editionRaw, editionIndex) => {
      const editionContext = `${context}.editions[${editionIndex}]`;
      const edition = object(editionRaw, editionContext);
      fields(edition, ['edition_id', 'label', 'dataset_releases'], ['description'], editionContext);
      const pairs = nonEmptyArray(edition.dataset_releases, `${editionContext}.dataset_releases`).map((pairRaw, pairIndex) => {
        const pairContext = `${editionContext}.dataset_releases[${pairIndex}]`;
        const pair = object(pairRaw, pairContext);
        fields(pair, ['dataset_id', 'release_id'], [], pairContext);
        const datasetId = string(pair.dataset_id, `${pairContext}.dataset_id`);
        const releaseId = string(pair.release_id, `${pairContext}.release_id`);
        if (!IDENTIFIER_PATTERN.test(releaseId)) throw new Error(`${pairContext}.release_id is invalid`);
        const dataset = datasetById.get(datasetId);
        if (!dataset || !datasetIds.includes(datasetId as DatasetId)) {
          throw new Error(`${editionContext} references dataset outside project`);
        }
        if (!dataset.releases.some((release) => release.id === releaseId)) {
          throw new Error(`${editionContext} references unknown release`);
        }
        return [datasetId, releaseId] as const;
      });
      unique(pairs.map(([datasetId]) => datasetId), `${editionContext} dataset ids`);
      const description = optionalString(edition.description, `${editionContext}.description`);
      const editionId = string(edition.edition_id, `${editionContext}.edition_id`);
      if (!IDENTIFIER_PATTERN.test(editionId)) throw new Error(`${editionContext}.edition_id is invalid`);
      return {
        id: editionId,
        label: string(edition.label, `${editionContext}.label`),
        ...(description ? { description } : {}),
        datasetReleases: new Map(pairs),
      };
    });
    unique(editions.map((edition) => edition.id), `catalog project ${id} edition ids`);
    const defaultEdition = optionalString(item.default_edition, `${context}.default_edition`);
    if (defaultEdition !== undefined && !IDENTIFIER_PATTERN.test(defaultEdition)) {
      throw new Error(`${context}.default_edition is invalid`);
    }
    if (defaultEdition !== undefined && !editions.some((edition) => edition.id === defaultEdition)) {
      throw new Error(`project ${id} default_edition is missing`);
    }
    for (const datasetId of datasetIds) datasetById.get(datasetId)!.projectId = id;
    const description = optionalString(item.description, `${context}.description`);
    return {
      id,
      title: string(item.title, `${context}.title`),
      ...(description ? { description } : {}),
      datasetIds,
      defaultDataset,
      ...(defaultEdition ? { defaultEdition } : {}),
      editions,
    };
  });
  unique(projects.map((project) => project.id), 'catalog project ids');
  if (memberships.size !== datasets.length) throw new Error('every dataset must belong to exactly one project');
  const defaultProject = string(root.default_project, 'catalog.default_project');
  if (!IDENTIFIER_PATTERN.test(defaultProject)) throw new Error('catalog.default_project is invalid');
  if (!projects.some((project) => project.id === defaultProject)) {
    throw new Error('catalog default_project is missing');
  }
  return { schemaVersion: SCHEMA_VERSION, defaultProject, projects, datasets };
}
