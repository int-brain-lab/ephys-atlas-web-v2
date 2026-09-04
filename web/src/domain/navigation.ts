import { cursorStateToWorld, type CursorState, type SliceIndices } from '../core/spatial.js';
import {
  regionalIndexToCoordinateUm,
  worldToRegionalIndices,
} from '../core/slice-calibration.js';
import { PROJECTION_BY_ID } from './projections.js';
import type { OrthogonalProjectionId } from './types.js';
import type { DatasetCatalog, DatasetCatalogEntry, DatasetProject } from '../data/contracts.js';

export type DatasetNavigationContext =
  | { readonly kind: 'edition'; readonly projectId: string; readonly editionId: string }
  | { readonly kind: 'custom'; readonly projectId: string; readonly baseEditionId?: string }
  | { readonly kind: 'local' };

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
  if (!selected && resolvedContext.kind === 'edition') {
    const edition = project.editions.find((item) => item.id === resolvedContext.editionId);
    if (!edition) throw new Error(`Unknown edition ${resolvedContext.editionId}`);
    selected = edition.datasetReleases.get(dataset.id);
  }
  if (!selected && resolvedContext.kind === 'custom' && resolvedContext.baseEditionId) {
    const edition = project.editions.find((item) => item.id === resolvedContext.baseEditionId);
    selected = edition?.datasetReleases.get(dataset.id);
  }
  selected ??= dataset.defaultRelease;
  if (!dataset.releases.some((item) => item.id === selected)) throw new Error(`Unknown release ${selected}`);
  return { context: resolvedContext, project, dataset, releaseId: selected };
}

export interface OrthogonalNavigationState {
  readonly projectionId: OrthogonalProjectionId;
  readonly nativeIndex: number;
  readonly worldCoordinateUm: number;
}

export function deriveRegionalSliceIndices(cursor: CursorState): SliceIndices {
  return worldToRegionalIndices(cursorStateToWorld(cursor));
}

export function deriveOrthogonalNavigation(
  cursor: CursorState,
  projectionId: OrthogonalProjectionId,
): OrthogonalNavigationState {
  const projection = PROJECTION_BY_ID[projectionId];
  const world = cursorStateToWorld(cursor);
  const nativeIndex = worldToRegionalIndices(world)[projection.id];
  return {
    projectionId,
    nativeIndex,
    worldCoordinateUm: regionalIndexToCoordinateUm(projection.id, nativeIndex),
  };
}
