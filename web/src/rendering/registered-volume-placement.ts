import type { VolumeFeaturePayload } from '../data/contracts.js';
import { applyAffine, worldToPlane, type Matrix4, type ViewBox } from './coordinate-space.js';
import { volumeAxisDimension } from './chunked-volume-source.js';
import type { RegisteredProjectionRegistration } from './projection-pack-source.js';
import type { VolumeSlice } from './volume.js';
import { assertCompatibleReferenceSpace } from './volume-inspection.js';

export interface RegisteredVolumeCanvasPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly viewBox: ViewBox;
}

function volumeIndexToPlane(
  feature: VolumeFeaturePayload,
  registration: RegisteredProjectionRegistration,
  index: readonly [number, number, number],
) {
  const affine = feature.descriptor.grid.indexToWorldUm;
  if (affine.length !== 16) throw new Error('volume index_to_world_um must contain 16 values');
  const [ml, ap, dv] = applyAffine(affine as Matrix4, index);
  return worldToPlane(registration.worldToPlaneIndex, { ml, ap, dv });
}

/** Position a raw nearest-neighbor plane inside the registered anatomy viewBox. */
export function registeredVolumeCanvasPlacement(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  registration: RegisteredProjectionRegistration,
): RegisteredVolumeCanvasPlacement {
  assertCompatibleReferenceSpace(registration, feature);
  if (slice.axis !== registration.axis) throw new Error('volume plane and projection axes differ');
  const fixed = volumeAxisDimension(feature, slice.axis);
  const width = volumeAxisDimension(feature, slice.widthAxis);
  const height = volumeAxisDimension(feature, slice.heightAxis);
  if (new Set([fixed, width, height]).size !== 3) throw new Error('volume plane axes are not independent');
  const corner = (rawWidth: number, rawHeight: number) => {
    const index = [0, 0, 0] as [number, number, number];
    index[fixed] = slice.index;
    index[width] = rawWidth;
    index[height] = rawHeight;
    return volumeIndexToPlane(feature, registration, index);
  };
  const low = corner(-0.5, -0.5);
  const right = corner(slice.width - 0.5, -0.5);
  const down = corner(-0.5, slice.height - 0.5);
  const diagonal = corner(slice.width - 0.5, slice.height - 0.5);
  const epsilon = 1e-7;
  if (Math.abs(right.v - low.v) > epsilon || Math.abs(down.u - low.u) > epsilon) {
    throw new Error('volume grid is not axis-aligned with the registered projection');
  }
  const x = Math.min(low.u, right.u, down.u, diagonal.u);
  const y = Math.min(low.v, right.v, down.v, diagonal.v);
  const projectedWidth = Math.max(low.u, right.u, down.u, diagonal.u) - x;
  const projectedHeight = Math.max(low.v, right.v, down.v, diagonal.v) - y;
  if (!(projectedWidth > 0 && projectedHeight > 0)) throw new Error('volume plane has an empty projected extent');
  return {
    x,
    y,
    width: projectedWidth,
    height: projectedHeight,
    flipX: right.u < low.u,
    flipY: down.v < low.v,
    viewBox: registration.viewBox,
  };
}

