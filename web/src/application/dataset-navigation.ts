import type { DatasetCatalog, DatasetCatalogEntry, DatasetProject } from '../data/contracts.js';
import type { DatasetNavigationContext, DatasetNavigationRequest } from '../domain/types.js';

export interface ResolvedDatasetNavigation {
  readonly context: DatasetNavigationContext;
  readonly project: DatasetProject | undefined;
  readonly dataset: DatasetCatalogEntry;
  readonly releaseId: string;
}

function projectFor(catalog: DatasetCatalog, id: string): DatasetProject {
  const project = catalog.projects.find((item) => item.id === id);
  if (!project) throw new Error(`Unknown project ${id}`);
  return project;
}

function datasetFor(catalog: DatasetCatalog, id: string): DatasetCatalogEntry {
  const dataset = catalog.datasets.find((item) => item.id === id);
  if (!dataset) throw new Error(`Unknown dataset ${id}`);
  return dataset;
}

/** Resolve a dataset/release selection without applying URL or application state. */
export function resolveDatasetNavigation(
  catalog: DatasetCatalog,
  datasetId?: string,
  releaseId?: string,
  context?: DatasetNavigationContext,
): ResolvedDatasetNavigation {
  const resolvedContext = context ?? { kind: 'custom', projectId: catalog.defaultProject };
  if (resolvedContext.kind === 'local') {
    const dataset = datasetFor(catalog, datasetId ?? 'local');
    if (dataset.source !== 'local') throw new Error('Local context requires a local dataset');
    const release = releaseId ?? dataset.defaultRelease;
    if (!dataset.releases.some((item) => item.id === release)) throw new Error(`Unknown release ${release}`);
    return { context: resolvedContext, project: undefined, dataset, releaseId: release };
  }
  const project = projectFor(catalog, resolvedContext.projectId);
  const dataset = datasetFor(catalog, datasetId ?? project.defaultDataset);
  if (!project.datasetIds.includes(dataset.id)) throw new Error(`Dataset ${dataset.id} is outside project ${project.id}`);
  let selected = releaseId;
  if (resolvedContext.kind === 'edition') {
    const edition = project.editions.find((item) => item.id === resolvedContext.editionId);
    if (!edition) throw new Error(`Unknown edition ${resolvedContext.editionId}`);
    const mappedRelease = edition.datasetReleases.get(dataset.id);
    if (!mappedRelease) throw new Error(`Dataset ${dataset.id} is outside edition ${edition.id}`);
    if (selected && selected !== mappedRelease) {
      throw new Error(`Release ${selected} does not match edition ${edition.id} mapping ${mappedRelease}`);
    }
    selected = mappedRelease;
  }
  if (!selected && resolvedContext.kind === 'custom' && resolvedContext.baseEditionId) {
    const edition = project.editions.find((item) => item.id === resolvedContext.baseEditionId);
    if (!edition) throw new Error(`Unknown base edition ${resolvedContext.baseEditionId}`);
    selected = edition.datasetReleases.get(dataset.id);
  }
  selected ??= dataset.defaultRelease;
  if (!dataset.releases.some((item) => item.id === selected)) throw new Error(`Unknown release ${selected}`);
  return { context: resolvedContext, project, dataset, releaseId: selected };
}

/** Resolve raw URL/default intent only after a validated catalog is available. */
export function resolveDatasetNavigationRequest(
  catalog: DatasetCatalog,
  request: DatasetNavigationRequest,
): ResolvedDatasetNavigation {
  if (request.context === 'local') {
    if (request.projectId || request.editionId || request.baseEditionId) {
      throw new Error('Local context cannot include public project or edition identity');
    }
    return resolveDatasetNavigation(catalog, request.datasetId, request.releaseId, { kind: 'local' });
  }
  const requestedDataset = request.datasetId ? datasetFor(catalog, request.datasetId) : undefined;
  const projectId = request.projectId
    ?? (requestedDataset?.source === 'published' ? requestedDataset.projectId : catalog.defaultProject);
  const project = projectFor(catalog, projectId);
  if (requestedDataset?.source === 'local') throw new Error('Local data requires explicit local context');
  if (request.context === 'edition' || request.editionId) {
    if (!request.editionId) throw new Error('Edition context requires an edition id');
    return resolveDatasetNavigation(catalog, request.datasetId, request.releaseId, {
      kind: 'edition', projectId, editionId: request.editionId,
    });
  }
  if (request.context === 'custom' || request.datasetId || request.releaseId || request.baseEditionId) {
    if (request.baseEditionId && !project.editions.some(({ id }) => id === request.baseEditionId)) {
      throw new Error(`Unknown base edition ${request.baseEditionId}`);
    }
    return resolveDatasetNavigation(catalog, request.datasetId, request.releaseId, {
      kind: 'custom', projectId, ...(request.baseEditionId ? { baseEditionId: request.baseEditionId } : {}),
    });
  }
  if (project.defaultEdition) {
    return resolveDatasetNavigation(catalog, request.datasetId, undefined, {
      kind: 'edition', projectId, editionId: project.defaultEdition,
    });
  }
  return resolveDatasetNavigation(catalog, request.datasetId, undefined, { kind: 'custom', projectId });
}

export function switchNavigationDataset(
  catalog: DatasetCatalog,
  current: ResolvedDatasetNavigation,
  datasetId: string,
): ResolvedDatasetNavigation {
  if (current.context.kind === 'edition') {
    const editionId = current.context.editionId;
    const edition = current.project?.editions.find(({ id }) => id === editionId);
    if (!edition?.datasetReleases.has(datasetId)) {
      return resolveDatasetNavigation(catalog, datasetId, undefined, {
        kind: 'custom', projectId: current.context.projectId, baseEditionId: editionId,
      });
    }
  }
  return resolveDatasetNavigation(catalog, datasetId, undefined, current.context);
}

export function selectNavigationProject(catalog: DatasetCatalog, projectId: string): ResolvedDatasetNavigation {
  return resolveDatasetNavigationRequest(catalog, { projectId });
}

export function selectNavigationEdition(
  catalog: DatasetCatalog,
  projectId: string,
  editionId: string,
): ResolvedDatasetNavigation {
  return resolveDatasetNavigationRequest(catalog, { context: 'edition', projectId, editionId });
}

export function overrideNavigationRelease(
  catalog: DatasetCatalog,
  current: ResolvedDatasetNavigation,
  releaseId: string,
): ResolvedDatasetNavigation {
  const context = current.context.kind === 'edition'
    ? { kind: 'custom' as const, projectId: current.context.projectId, baseEditionId: current.context.editionId }
    : current.context;
  return resolveDatasetNavigation(catalog, current.dataset.id, releaseId, context);
}
