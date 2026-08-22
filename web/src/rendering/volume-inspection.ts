import type { VolumeFeaturePayload } from '../data/contracts.js';
import { applyAffine, planeToWorld, worldToPlane, type Matrix4, type WorldCoordinateUm } from '../core/spatial.js';
import type { RegisteredProjectionRegistration } from './projection-pack-source.js';
import { volumeAxisDimension } from './chunked-volume-source.js';
import type { VolumeSlice } from './volume.js';

export type VolumeValidityStatus =
  | 'valid'
  | 'outside'
  | 'missing'
  | 'out-of-grid'
  | 'unsupported-validity';

export interface VolumePlaneInspection {
  readonly status: VolumeValidityStatus;
  readonly world: WorldCoordinateUm;
  readonly fractionalIndex: readonly [number, number, number];
  readonly voxelIndex?: readonly [number, number, number];
  readonly value?: number;
}

export function assertCompatibleReferenceSpace(
  registration: RegisteredProjectionRegistration,
  feature: VolumeFeaturePayload,
): void {
  const volumeReference = feature.descriptor.grid.referenceSpaceId;
  if (registration.referenceSpaceId !== volumeReference) {
    throw new Error(
      `Cannot composite ${registration.referenceSpaceId} anatomy with ${volumeReference} volume`,
    );
  }
}

function matrix(value: readonly number[], name: string): Matrix4 {
  if (value.length !== 16) throw new Error(`${name} must contain 16 values`);
  return value as Matrix4;
}

function rawIndexForWorld(feature: VolumeFeaturePayload, world: WorldCoordinateUm): [number, number, number] {
  return applyAffine(matrix(feature.descriptor.grid.worldToIndex, 'volume world_to_index'), [
    world.ml,
    world.ap,
    world.dv,
  ]);
}

function validityStatus(feature: VolumeFeaturePayload, value: number, maskCode?: number): VolumeValidityStatus {
  const validity = feature.descriptor.validity;
  if (validity.kind === 'mask') {
    if (maskCode === undefined) return 'unsupported-validity';
    if (maskCode === validity.codes.outside) return 'outside';
    if (maskCode === validity.codes.missing) return 'missing';
    if (maskCode !== validity.codes.valid) throw new Error(`volume validity mask contains unknown code ${maskCode}`);
    return Number.isFinite(value) ? 'valid' : 'missing';
  }
  if (value === validity.outsideValue) return 'outside';
  if (!Number.isFinite(value)) return 'missing';
  return 'valid';
}

/** Inspect a displayed plane point independently of SVG path coverage and device pixel ratio. */
export function inspectVolumePlanePoint(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  registration: RegisteredProjectionRegistration,
  plane: Readonly<{ u: number; v: number }>,
): VolumePlaneInspection {
  assertCompatibleReferenceSpace(registration, feature);
  if (slice.axis !== registration.axis) throw new Error('volume plane and projection axes differ');
  const fixedDimension = volumeAxisDimension(feature, slice.axis);
  const fixedRaw = [0, 0, 0] as [number, number, number];
  fixedRaw[fixedDimension] = slice.index;
  const fixedWorldRaw = applyAffine(
    matrix(feature.descriptor.grid.indexToWorldUm, 'volume index_to_world_um'),
    fixedRaw,
  );
  const fixedWorld = { ml: fixedWorldRaw[0], ap: fixedWorldRaw[1], dv: fixedWorldRaw[2] };
  const projectionSlice = worldToPlane(registration.worldToPlaneIndex, fixedWorld).slice;
  const world = planeToWorld(registration.planeIndexToWorldUm, {
    slice: projectionSlice,
    u: plane.u,
    v: plane.v,
  });
  const fractionalIndex = rawIndexForWorld(feature, world);
  const shape = feature.descriptor.grid.shape;
  if (fractionalIndex.some((value, dimension) => value < -0.5 || value >= shape[dimension]! - 0.5)) {
    return { status: 'out-of-grid', world, fractionalIndex };
  }
  const voxelIndex = fractionalIndex.map((value) => Math.floor(value + 0.5)) as [number, number, number];
  if (voxelIndex[fixedDimension] !== slice.index) {
    throw new Error('inspected point does not map back to the displayed volume plane');
  }
  const widthDimension = volumeAxisDimension(feature, slice.widthAxis);
  const heightDimension = volumeAxisDimension(feature, slice.heightAxis);
  const offset = voxelIndex[heightDimension]! * slice.width + voxelIndex[widthDimension]!;
  const value = slice.data[offset] ?? NaN;
  const status = validityStatus(feature, value, slice.validity?.[offset]);
  return {
    status,
    world,
    fractionalIndex,
    voxelIndex,
    ...(status === 'valid' ? { value } : {}),
  };
}

export function volumeValueIsVisible(feature: VolumeFeaturePayload, value: number, maskCode?: number): boolean {
  return validityStatus(feature, value, maskCode) === 'valid';
}
