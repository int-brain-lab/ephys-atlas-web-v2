import { PROJECTION_PLANE_AXES, SLICE_WORLD_AXIS, type WorldAxis } from '../core/spatial.js';
import type {
  OrthogonalProjectionId,
  RepresentationKind,
  SecondaryTabId,
  StaticProjectionId,
  WorkspaceViewId,
} from './types.js';

export interface OrthogonalProjectionDefinition {
  readonly kind: 'orthogonal';
  readonly id: OrthogonalProjectionId;
  readonly label: string;
  readonly normalWorldAxis: WorldAxis;
  readonly planeWorldAxes: readonly [WorldAxis, WorldAxis];
  readonly representations: readonly RepresentationKind[];
  readonly supportsGuides: true;
}

export interface StaticProjectionDefinition {
  readonly kind: 'static';
  readonly id: StaticProjectionId;
  readonly label: string;
  readonly representations: readonly ['regional'];
  readonly supportsGuides: false;
}

export type ProjectionDefinition = OrthogonalProjectionDefinition | StaticProjectionDefinition;

export interface ProjectionWorkspaceViewDefinition {
  readonly kind: 'projection';
  readonly id: OrthogonalProjectionId;
  readonly label: string;
  readonly projectionId: OrthogonalProjectionId;
}

export interface SecondaryWorkspaceViewDefinition {
  readonly kind: 'secondary';
  readonly id: 'secondary';
  readonly label: string;
  readonly defaultTab: SecondaryTabId;
}

export type WorkspaceViewDefinition = ProjectionWorkspaceViewDefinition | SecondaryWorkspaceViewDefinition;

function orthogonal(id: OrthogonalProjectionId, label: string): OrthogonalProjectionDefinition {
  return {
    kind: 'orthogonal',
    id,
    label,
    normalWorldAxis: SLICE_WORLD_AXIS[id],
    planeWorldAxes: PROJECTION_PLANE_AXES[id],
    representations: ['regional', 'volume'],
    supportsGuides: true,
  };
}

function staticProjection(id: StaticProjectionId, label: string): StaticProjectionDefinition {
  return { kind: 'static', id, label, representations: ['regional'], supportsGuides: false };
}

export const ORTHOGONAL_PROJECTION_REGISTRY = [
  orthogonal('coronal', 'Coronal'),
  orthogonal('sagittal', 'Sagittal'),
  orthogonal('horizontal', 'Horizontal'),
] as const;

export const STATIC_PROJECTION_REGISTRY = [
  staticProjection('top', 'Top'),
  staticProjection('swanson', 'Swanson'),
] as const;

/** All enabled 2-D projections; workspace slots remain a separate registry. */
export const PROJECTION_REGISTRY = [
  ...ORTHOGONAL_PROJECTION_REGISTRY,
  ...STATIC_PROJECTION_REGISTRY,
] as const satisfies readonly ProjectionDefinition[];

export const PROJECTION_BY_ID: Readonly<Record<OrthogonalProjectionId, OrthogonalProjectionDefinition>> =
  Object.fromEntries(ORTHOGONAL_PROJECTION_REGISTRY.map((projection) => [projection.id, projection])) as Record<
    OrthogonalProjectionId,
    OrthogonalProjectionDefinition
  >;

/** Responsive workspace slots are distinct from projections and secondary-tab content. */
export const WORKSPACE_VIEW_REGISTRY = [
  ...ORTHOGONAL_PROJECTION_REGISTRY.map((projection) => ({
    kind: 'projection' as const,
    id: projection.id,
    label: projection.label,
    projectionId: projection.id,
  })),
  { kind: 'secondary', id: 'secondary', label: 'Context', defaultTab: 'summary' },
] as const satisfies readonly WorkspaceViewDefinition[];

export const WORKSPACE_VIEW_IDS = new Set<WorkspaceViewId>(WORKSPACE_VIEW_REGISTRY.map(({ id }) => id));
