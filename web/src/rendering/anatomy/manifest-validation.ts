import { planeToWorld, type SliceAxis } from '../../core/spatial.js';
import { ANATOMY_AXES, type AnatomyProjection, type AnatomySynchronizationSentinel } from './types.js';
import { finiteNumber, integer, record, string, tuple } from './manifest-projection.js';

export function parseSynchronizationSentinels(
  value: unknown,
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>,
): readonly AnatomySynchronizationSentinel[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('synchronization_sentinels must contain at least two entries');
  return value.map((entry, sentinelIndex) => {
    const context = `synchronization_sentinels[${sentinelIndex}]`;
    const item = record(entry, context);
    const worldUm = tuple(item.world_um, 3, `${context}.world_um`) as [number, number, number];
    const rawIndices = record(item.projection_indices, `${context}.projection_indices`);
    const projectionIndices = {} as Record<SliceAxis, [number, number, number]>;
    for (const axis of ANATOMY_AXES) {
      const indices = tuple(rawIndices[axis], 3, `${context}.projection_indices.${axis}`) as [number, number, number];
      const mapped = planeToWorld(projections[axis].planeIndexToWorldUm, {
        slice: indices[0], u: indices[1], v: indices[2],
      });
      const actual = [mapped.ml, mapped.ap, mapped.dv];
      if (actual.some((coordinate, index) => Math.abs(coordinate - worldUm[index]!) > 1e-6)) {
        throw new Error(`${context}.projection_indices.${axis} does not map to world_um`);
      }
      projectionIndices[axis] = indices;
    }
    return { name: string(item.name, `${context}.name`), worldUm, projectionIndices };
  });
}

export function parseProvenancePin(value: unknown, context: string, requireClean = false): Readonly<Record<string, unknown>> {
  const pin = record(value, context);
  string(pin.repository, `${context}.repository`);
  const commit = string(pin.commit, `${context}.commit`);
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`${context}.commit is invalid`);
  if (requireClean && pin.dirty !== false) throw new Error('anatomy generator provenance must be from a clean commit');
  return pin;
}

export function parseProvenance(value: unknown): Readonly<Record<string, unknown>> {
  const provenance = record(value, 'provenance');
  for (const name of ['iblatlas', 'generator'] as const) {
    parseProvenancePin(provenance[name], `provenance.${name}`, name === 'generator');
  }
  const simplification = record(provenance.simplification, 'provenance.simplification');
  const algorithm = simplification.algorithm;
  if (algorithm !== 'GEOS coverage_simplify' && algorithm !== 'exact collinear vertex removal') {
    throw new Error('unsupported anatomy simplification algorithm');
  }
  const tolerance = finiteNumber(simplification.tolerance_um, 'provenance.simplification.tolerance_um');
  const interval = finiteNumber(simplification.boundary_sampling_interval_voxels, 'provenance.simplification.boundary_sampling_interval_voxels');
  const errorBound = finiteNumber(simplification.boundary_error_bound_um, 'provenance.simplification.boundary_error_bound_um');
  if (tolerance < 0 || interval <= 0 || interval > 1 || errorBound < 0) throw new Error('anatomy simplification provenance has invalid bounds');
  if (algorithm === 'exact collinear vertex removal' && (tolerance !== 0 || errorBound !== 0)) {
    throw new Error('exact anatomy simplification must declare zero tolerance and boundary error');
  }
  return provenance;
}

export function parseValidation(
  value: unknown,
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>,
  bilateral: boolean,
): Readonly<Record<string, unknown>> {
  const validation = record(value, 'validation');
  if (validation.topology_valid !== true || validation.coverage_valid !== true) throw new Error('anatomy topology and coverage validation must pass');
  for (const key of ['uncovered_voxels', 'multiply_covered_voxels', 'adjacency_mismatches', 'invalid_geometries'] as const) {
    if (validation[key] !== 0) throw new Error(`validation.${key} must be zero`);
  }
  if (!Array.isArray(validation.missing_atlas_ids) || validation.missing_atlas_ids.length) throw new Error('validation.missing_atlas_ids must be empty');
  const expectedSlices = ANATOMY_AXES.reduce((sum, axis) => sum + projections[axis].sliceCount, 0);
  if (validation.source_slices !== expectedSlices || validation.emitted_slices !== expectedSlices) {
    throw new Error(`anatomy validation must account for all ${expectedSlices} projection slices`);
  }
  const boundary = record(validation.boundary_error_um, 'validation.boundary_error_um');
  const upperBound = finiteNumber(boundary.max_upper_bound, 'validation.boundary_error_um.max_upper_bound');
  const accepted = finiteNumber(validation.accepted_max_boundary_error_um, 'validation.accepted_max_boundary_error_um');
  if (upperBound < 0 || accepted < 0 || upperBound > accepted) throw new Error('anatomy boundary error exceeds its accepted maximum');
  const minimumIou = finiteNumber(validation.minimum_eligible_region_iou, 'validation.minimum_eligible_region_iou');
  const acceptedIou = finiteNumber(validation.accepted_minimum_region_iou, 'validation.accepted_minimum_region_iou');
  if (minimumIou < acceptedIou || acceptedIou < 0.98) throw new Error('anatomy region IoU is below its accepted minimum');
  const coordinateTolerance = finiteNumber(validation.coordinate_tolerance_um, 'validation.coordinate_tolerance_um');
  const sentinelError = finiteNumber(validation.sentinel_max_error_um, 'validation.sentinel_max_error_um');
  if (coordinateTolerance <= 0 || sentinelError < 0 || sentinelError > coordinateTolerance) {
    throw new Error('anatomy synchronization sentinel error exceeds coordinate tolerance');
  }
  if (bilateral) {
    if (validation.background_topology_valid !== true) throw new Error('bilateral anatomy background topology validation must pass');
    const before = integer(validation.internal_background_components_before, 'validation.internal_background_components_before');
    const after = integer(validation.internal_background_components_after, 'validation.internal_background_components_after');
    if (before !== after) throw new Error('bilateral anatomy changed internal background topology');
  }
  return validation;
}
