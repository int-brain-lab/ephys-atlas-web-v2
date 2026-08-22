import { cursorStateToWorld, type CursorState, type SliceGuide, type SliceIndices } from '../core/spatial.js';
import {
  linkedGuidesForWorld,
  regionalIndexToCoordinateUm,
  worldToRegionalIndices,
} from '../core/slice-calibration.js';
import { PROJECTION_BY_ID } from './projections.js';
import type { OrthogonalProjectionId } from './types.js';

export interface OrthogonalNavigationState {
  readonly projectionId: OrthogonalProjectionId;
  readonly nativeIndex: number;
  readonly worldCoordinateUm: number;
  readonly guides: readonly SliceGuide[];
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
    guides: linkedGuidesForWorld(world, projection.id),
  };
}
