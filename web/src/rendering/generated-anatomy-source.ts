import type { SliceAxis } from '../domain/types.js';
import { assertInverseAffines, planeToWorld, SLICE_WORLD_AXIS, worldToPlane, type Matrix4, type WorldAxis, type WorldCoordinateUm } from './coordinate-space.js';
import { createAnatomyPackDecoder, type AnatomyPackDecoder } from './generated-anatomy-pack-decoder.js';
import { createIsvgPackRuntime, type IsvgPackRuntime } from './isvg-pack-runtime.js';
import type { SvgPackFragment } from './svg-pack.js';
import type { AnatomyPackDecodeContext, AnatomyPackDecodePhase, SlicePack } from './generated-anatomy-pack-codec.js';
import type {
  AnatomySlice,
  AnatomySliceSource,
  SliceGuide,
  SliceIndices,
  ViewBox,
} from './types.js';

const SHA256 = /^[0-9a-f]{64}$/;
const AXES = ['coronal', 'sagittal', 'horizontal'] as const;
const WORLD_ROW: Readonly<Record<WorldAxis, number>> = { ml: 0, ap: 1, dv: 2 };

interface PackArtifact {
  packIndex: number;
  firstSliceIndex: number;
  sliceCount: number;
  path: string;
  bytes: number;
  uncompressedBytes: number;
  sha256: string;
  mediaType?: string;
  packId?: string;
  firstDisplayIndex?: number;
}

interface PackSet {
  packDepth: 8 | 16 | 32;
  packs: readonly PackArtifact[];
}

export interface AnatomyProjection {
  axis: SliceAxis;
  fixedWorldAxis: WorldAxis;
  planeAxes: readonly [WorldAxis, WorldAxis];
  sliceCount: number;
  /** Optional until the regenerated sparse-display manifest is published. */
  displaySliceIndices?: readonly number[];
  displaySliceCount?: number;
  sliceShape: readonly [number, number];
  viewBox: ViewBox;
  planeIndexToWorldUm: Matrix4;
  worldToPlaneIndex: Matrix4;
  packSets: Readonly<Partial<Record<'8' | '16' | '32', PackSet>>>;
}

export interface AnatomyPackManifest {
  format: 'anatomy-pack-v1' | 'anatomy-pack-v2' | 'anatomy-pack-v3';
  schemaVersion: '1.0' | '2.0' | '3.0';
  packId: string;
  immutable: true;
  createdAt: string;
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>;
  source: Readonly<Record<string, unknown>>;
  coordinateSystem: Readonly<Record<string, unknown>>;
  provenance: Readonly<Record<string, unknown>>;
  validation: Readonly<Record<string, unknown>>;
  synchronizationSentinels: readonly AnatomySynchronizationSentinel[];
  parent?: Readonly<Record<string, unknown>>;
  sampling?: Readonly<Record<string, unknown>>;
}

export interface AnatomySynchronizationSentinel {
  name: string;
  worldUm: readonly [number, number, number];
  projectionIndices: Readonly<Record<SliceAxis, readonly [number, number, number]>>;
}

export interface GeneratedAnatomySliceSourceOptions {
  manifestUrl: string;
  packDepth?: 8 | 16 | 32;
  fetchImpl?: typeof fetch;
  maxCachedBytes?: number;
  scheduleIdle?: (callback: () => void) => void;
  onPerformance?: (event: AnatomyPackPerformanceEvent) => void;
}

export type AnatomyPackPerformancePhase =
  | 'fetch'
  | 'read-response'
  | 'sha256'
  | 'gunzip'
  | 'utf8'
  | 'json-parse'
  | 'validate'
  | 'worker-roundtrip';

export interface AnatomyPackPerformanceEvent {
  phase: AnatomyPackPerformancePhase;
  axis: SliceAxis;
  packIndex: number;
  path: string;
  durationMs: number;
  compressedBytes: number;
  decodedBytes?: number;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${context} must be an integer >= ${minimum}`);
  return Number(value);
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function tuple(value: unknown, length: number, context: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${context} must contain ${length} numbers`);
  return value.map((item, index) => finiteNumber(item, `${context}[${index}]`));
}

function matrix(value: unknown, context: string): Matrix4 {
  return tuple(value, 16, context) as unknown as Matrix4;
}

function worldAxis(value: unknown, context: string): WorldAxis {
  if (value !== 'ml' && value !== 'ap' && value !== 'dv') throw new Error(`${context} must be ml, ap, or dv`);
  return value;
}

function safeRelativePath(value: unknown, context: string): string {
  const path = string(value, context);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${context} must be a safe relative path`);
  }
  return path;
}

function parseArtifact(value: unknown, context: string, indexed = false): PackArtifact {
  const item = record(value, context);
  if (indexed ? item.media_type !== 'application/vnd.ibl.indexed-svg' : item.media_type !== 'application/json') throw new Error(`${context}.media_type is not supported`);
  if (item.compression !== 'gzip') throw new Error(`${context}.compression must be gzip`);
  const sha256 = string(item.sha256, `${context}.sha256`);
  if (!SHA256.test(sha256)) throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
  return {
    packIndex: integer(item.pack_index, `${context}.pack_index`),
    firstSliceIndex: integer(item.first_slice_index, `${context}.first_slice_index`),
    sliceCount: integer(item.slice_count, `${context}.slice_count`, 1),
    path: safeRelativePath(item.path, `${context}.path`),
    bytes: integer(item.bytes, `${context}.bytes`, 1),
    uncompressedBytes: integer(item.uncompressed_bytes, `${context}.uncompressed_bytes`, 1),
    sha256,
    ...(indexed ? { mediaType: String(item.media_type), packId: string(item.pack_id, `${context}.pack_id`), firstDisplayIndex: integer(item.first_display_index, `${context}.first_display_index`) } : {}),
  };
}

function parsePackSet(value: unknown, depth: 8 | 16 | 32, context: string, indexed = false): PackSet {
  const item = record(value, context);
  if (item.pack_depth !== depth) throw new Error(`${context}.pack_depth must be ${depth}`);
  const pathTemplate = safeRelativePath(item.path_template, `${context}.path_template`);
  if (!pathTemplate.includes('{pack}') || (!indexed && !pathTemplate.endsWith('.json.gz')) || (indexed && !pathTemplate.endsWith('.isvg.gz'))) {
    throw new Error(`${context}.path_template must address numbered .json.gz packs`);
  }
  if (!Array.isArray(item.packs) || !item.packs.length) throw new Error(`${context}.packs must be non-empty`);
  const packs = item.packs.map((entry, index) => parseArtifact(entry, `${context}.packs[${index}]`, indexed));
  for (let index = 0; index < packs.length; index += 1) {
    const pack = packs[index]!;
    if (pack.packIndex !== index) throw new Error(`${context}.packs must have contiguous pack_index values`);
    if (!indexed && pack.firstSliceIndex !== index * depth) throw new Error(`${context}.packs[${index}] has a non-contiguous slice range`);
    if (indexed && pack.firstDisplayIndex !== index * depth) throw new Error(`${context}.packs[${index}] has a non-contiguous display range`);
    if (pack.sliceCount > depth) throw new Error(`${context}.packs[${index}].slice_count exceeds pack_depth`);
  }
  return { packDepth: depth, packs };
}

function parseDisplaySliceIndices(value: unknown, sliceCount: number, context: string): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) throw new Error(`${context} must contain at least one native slice index`);
  const indices = value.map((entry, index) => integer(entry, `${context}[${index}]`));
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= sliceCount) throw new Error(`${context}[${index}] is outside the projection slice range`);
    if (index > 0 && indices[index]! <= indices[index - 1]!) throw new Error(`${context} must be strictly increasing`);
  }
  return indices;
}

function nearestDisplaySlice(indices: readonly number[], target: number): { nativeIndex: number; ordinal: number } {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (indices[middle]! < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return { nativeIndex: indices[0]!, ordinal: 0 };
  if (low === indices.length) return { nativeIndex: indices[low - 1]!, ordinal: low - 1 };
  const lower = indices[low - 1]!;
  const upper = indices[low]!;
  return upper - target < target - lower
    ? { nativeIndex: upper, ordinal: low }
    : { nativeIndex: lower, ordinal: low - 1 };
}

function parseProjection(value: unknown, axis: SliceAxis, resolutionUm: 10 | 25, indexed = false): AnatomyProjection {
  const item = record(value, `projections.${axis}`);
  const fixedWorldAxis = worldAxis(item.fixed_world_axis, `projections.${axis}.fixed_world_axis`);
  if (fixedWorldAxis !== SLICE_WORLD_AXIS[axis]) throw new Error(`projections.${axis}.fixed_world_axis is inconsistent with the projection`);
  if (!Array.isArray(item.plane_axes) || item.plane_axes.length !== 2) throw new Error(`projections.${axis}.plane_axes must contain two axes`);
  const planeAxes = item.plane_axes.map((entry, index) => worldAxis(entry, `projections.${axis}.plane_axes[${index}]`)) as [WorldAxis, WorldAxis];
  const expected = axis === 'coronal' ? ['ml', 'dv'] : axis === 'sagittal' ? ['ap', 'dv'] : ['ml', 'ap'];
  if (planeAxes[0] !== expected[0] || planeAxes[1] !== expected[1]) throw new Error(`projections.${axis}.plane_axes has the wrong display orientation`);
  const shape = tuple(item.slice_shape, 2, `projections.${axis}.slice_shape`);
  if (shape.some((number) => !Number.isInteger(number) || number <= 0)) throw new Error(`projections.${axis}.slice_shape must contain positive integers`);
  const rawViewBox = tuple(item.view_box, 4, `projections.${axis}.view_box`);
  if (rawViewBox[2]! <= 0 || rawViewBox[3]! <= 0) throw new Error(`projections.${axis}.view_box must have positive dimensions`);
  if (rawViewBox[0] !== -0.5 || rawViewBox[1] !== -0.5 || rawViewBox[2] !== shape[1] || rawViewBox[3] !== shape[0]) {
    throw new Error(`projections.${axis}.view_box must follow the declared voxel-edge and slice-shape convention`);
  }
  const planeIndexToWorldUm = matrix(item.plane_index_to_world_um, `projections.${axis}.plane_index_to_world_um`);
  const worldToPlaneIndex = matrix(item.world_to_plane_index, `projections.${axis}.world_to_plane_index`);
  assertInverseAffines(planeIndexToWorldUm, worldToPlaneIndex);
  const expectedColumns: Readonly<Record<WorldAxis, number>> = {
    [fixedWorldAxis]: 0,
    [planeAxes[0]]: 1,
    [planeAxes[1]]: 2,
  } as Readonly<Record<WorldAxis, number>>;
  for (const worldName of ['ml', 'ap', 'dv'] as const) {
    const row = WORLD_ROW[worldName];
    for (let column = 0; column < 3; column += 1) {
      const coefficient = planeIndexToWorldUm[row * 4 + column]!;
      if (column === expectedColumns[worldName]) {
        if (Math.abs(Math.abs(coefficient) - resolutionUm) > 1e-9) {
          throw new Error(`projections.${axis} ${worldName} step must be ${resolutionUm} um`);
        }
      } else if (Math.abs(coefficient) > 1e-9) {
        throw new Error(`projections.${axis} affine couples orthogonal anatomy axes`);
      }
    }
  }
  if (
    Math.abs(planeIndexToWorldUm[12]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[13]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[14]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[15] - 1) > 1e-12
  ) throw new Error(`projections.${axis} affine must be an affine transform in homogeneous coordinates`);
  const rawPackSets = record(item.pack_sets, `projections.${axis}.pack_sets`);
  const packSets: Partial<Record<'8' | '16' | '32', PackSet>> = {};
  if (rawPackSets['8'] !== undefined) packSets['8'] = parsePackSet(rawPackSets['8'], 8, `projections.${axis}.pack_sets.8`, indexed);
  if (rawPackSets['16'] !== undefined) packSets['16'] = parsePackSet(rawPackSets['16'], 16, `projections.${axis}.pack_sets.16`, indexed);
  if (rawPackSets['32'] !== undefined) packSets['32'] = parsePackSet(rawPackSets['32'], 32, `projections.${axis}.pack_sets.32`, indexed);
  if (!packSets['8'] && !packSets['16'] && !packSets['32']) throw new Error(`projections.${axis}.pack_sets must provide a supported pack depth`);
  const sliceCount = integer(item.slice_count, `projections.${axis}.slice_count`, 1);
  const displaySliceIndices = parseDisplaySliceIndices(item.display_slice_indices, sliceCount, `projections.${axis}.display_slice_indices`);
  for (const packSet of Object.values(packSets)) {
    if (!packSet) continue;
    const covered = packSet.packs.reduce((sum, pack) => sum + pack.sliceCount, 0);
    if (covered !== (indexed ? displaySliceIndices?.length : sliceCount)) throw new Error(`projections.${axis} depth-${packSet.packDepth} packs cover ${covered} slices`);
  }
  return {
    axis,
    fixedWorldAxis,
    planeAxes,
    sliceCount,
    ...(displaySliceIndices ? { displaySliceIndices, displaySliceCount: displaySliceIndices.length } : {}),
    sliceShape: [shape[0]!, shape[1]!],
    viewBox: { x: rawViewBox[0]!, y: rawViewBox[1]!, width: rawViewBox[2]!, height: rawViewBox[3]! },
    planeIndexToWorldUm,
    worldToPlaneIndex,
    packSets,
  };
}

function parseSynchronizationSentinels(
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
    for (const axis of AXES) {
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

function parseProvenancePin(value: unknown, context: string, requireClean = false): Readonly<Record<string, unknown>> {
  const pin = record(value, context);
  string(pin.repository, `${context}.repository`);
  const commit = string(pin.commit, `${context}.commit`);
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`${context}.commit is invalid`);
  if (requireClean && pin.dirty !== false) throw new Error('anatomy generator provenance must be from a clean commit');
  return pin;
}

function parseProvenance(value: unknown): Readonly<Record<string, unknown>> {
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

function parseValidation(
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
  const expectedSlices = AXES.reduce((sum, axis) => sum + projections[axis].sliceCount, 0);
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

export function parseAnatomyPackManifest(value: unknown): AnatomyPackManifest {
  const root = record(value, 'anatomy manifest');
  const v1 = root.format === 'anatomy-pack-v1' && root.schema_version === '1.0';
  const v2 = root.format === 'anatomy-pack-v2' && root.schema_version === '2.0';
  const v3 = root.format === 'anatomy-pack-v3' && root.schema_version === '3.0';
  if (!v1 && !v2 && !v3) throw new Error('unsupported anatomy manifest format');
  const format = v3 ? 'anatomy-pack-v3' as const : v2 ? 'anatomy-pack-v2' as const : 'anatomy-pack-v1' as const;
  const schemaVersion = v3 ? '3.0' as const : v2 ? '2.0' as const : '1.0' as const;
  const resolutionUm = v1 ? 25 : 10;
  if (root.immutable !== true) throw new Error('anatomy manifest must be immutable');
  const packId = string(root.pack_id, 'pack_id');
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(packId)) throw new Error('pack_id is invalid');
  const createdAt = string(root.created_at, 'created_at');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('created_at must be an ISO date-time');
  const coordinateSystem = record(root.coordinate_system, 'coordinate_system');
  if (coordinateSystem.units !== 'um') throw new Error('coordinate_system.units must be um');
  if (coordinateSystem.matrix_order !== 'row-major') throw new Error('coordinate_system.matrix_order must be row-major');
  if (coordinateSystem.voxel_centers !== 'integer-indices' || coordinateSystem.voxel_edges !== 'half-integer-indices') {
    throw new Error('anatomy manifest must declare integer voxel centers and half-integer voxel edges');
  }
  if (JSON.stringify(coordinateSystem.world_axes) !== JSON.stringify(['ml', 'ap', 'dv'])) {
    throw new Error('coordinate_system.world_axes must be [ml, ap, dv]');
  }
  if (v3) {
    const parent = record(root.parent, 'parent');
    if (parent.format !== 'anatomy-pack-v2') throw new Error('v3 parent must be anatomy-pack-v2');
    const parentPackId = string(parent.pack_id, 'parent.pack_id');
    const parentDigest = string(parent.manifest_sha256, 'parent.manifest_sha256');
    if (!SHA256.test(parentDigest)) throw new Error('parent.manifest_sha256 must be a SHA-256 digest');
    if (parentPackId === string(root.pack_id, 'pack_id')) throw new Error('v3 parent and child pack IDs must differ');
    const source = record(parent.source, 'parent.source');
    if (source.atlas !== 'Allen CCFv3' || source.resolution_um !== 10 || source.hemisphere !== 'bilateral') throw new Error('v3 parent source is not bilateral 10 um Allen CCFv3');
    const ids = record(source.region_ids, 'parent.source.region_ids');
    if (ids.domain !== 'signed_allen_atlas_id' || ids.left_sign !== 'negative' || ids.right_sign !== 'positive' || ids.background_id !== 0) throw new Error('parent.source.region_ids is invalid');
    for (const key of ['annotation', 'region_lut'] as const) {
      const descriptor = record(source[key], `parent.source.${key}`);
      safeRelativePath(descriptor.path, `parent.source.${key}.path`);
      integer(descriptor.bytes, `parent.source.${key}.bytes`, 1);
      if (!SHA256.test(string(descriptor.sha256, `parent.source.${key}.sha256`))) throw new Error(`parent.source.${key}.sha256 is invalid`);
    }
    const rawProjections = record(root.projections, 'projections');
    const projections = {
      coronal: parseProjection(rawProjections.coronal, 'coronal', 10, true),
      sagittal: parseProjection(rawProjections.sagittal, 'sagittal', 10, true),
      horizontal: parseProjection(rawProjections.horizontal, 'horizontal', 10, true),
    };
    for (const axis of AXES) {
      const projection = projections[axis];
      if (!projection.displaySliceIndices || projection.displaySliceIndices.length !== projection.displaySliceCount) throw new Error(`projections.${axis} must declare display slices`);
      const item = record(rawProjections[axis], `projections.${axis}`);
      if (item.lattice_spacing_um !== 80 || item.display_slice_count !== projection.displaySliceIndices.length) throw new Error(`projections.${axis} has invalid 80 um display lattice`);
      if (projection.displaySliceIndices.some((nativeIndex, ordinal) => ordinal > 0 && nativeIndex - projection.displaySliceIndices![ordinal - 1]! !== 8)) {
        throw new Error(`projections.${axis} display inventory is not spaced by 80 um`);
      }
      const anchorIndex = integer(item.lattice_anchor_slice_index, `projections.${axis}.lattice_anchor_slice_index`);
      const anchorWorld = finiteNumber(item.lattice_origin_um, `projections.${axis}.lattice_origin_um`);
      const expectedAnchorWorld = planeToWorld(projection.planeIndexToWorldUm, { slice: anchorIndex, u: 0, v: 0 })[projection.fixedWorldAxis];
      if (!projection.displaySliceIndices.includes(anchorIndex) || Math.abs(anchorWorld - expectedAnchorWorld) > 1e-6) {
        throw new Error(`projections.${axis} display lattice anchor is invalid`);
      }
      const packSet = projection.packSets['8'];
      if (!packSet) throw new Error(`projections.${axis} must provide depth-eight indexed packs`);
      for (const pack of packSet.packs) {
        const firstSlice = projection.displaySliceIndices[pack.firstDisplayIndex!];
        if (pack.packId !== `${string(root.pack_id, 'pack_id')}:${axis}:${pack.packIndex}` || pack.firstSliceIndex !== firstSlice) {
          throw new Error(`projections.${axis} pack identity or display range is invalid`);
        }
      }
    }
    const sampling = record(root.sampling, 'sampling');
    if (sampling.native_resolution_um !== 10 || sampling.spacing_um !== 80 || sampling.pack_depth !== 8) throw new Error('v3 sampling must declare native 10 um, display 80 um, depth 8');
    const parentProvenance = parseProvenance(parent.provenance);
    const childProvenance = record(root.provenance, 'provenance');
    parseProvenancePin(childProvenance.generator, 'provenance.generator', true);
    if (childProvenance.derivation !== 'byte-preserving SVG fragment extraction from validated parent anatomy-pack-v2') {
      throw new Error('v3 provenance derivation is invalid');
    }
    const parentValidation = parseValidation(parent.validation, projections, true);
    const validation = record(root.validation, 'validation');
    const nativeSlices = AXES.reduce((sum, axis) => sum + projections[axis].sliceCount, 0);
    const displaySlices = AXES.reduce((sum, axis) => sum + (projections[axis].displaySliceIndices?.length ?? 0), 0);
    if (validation.native_source_slices !== nativeSlices || validation.display_emitted_slices !== displaySlices) throw new Error('v3 validation slice counts are invalid');
    return {
      format, schemaVersion, packId: string(root.pack_id, 'pack_id'), immutable: true, createdAt,
      source, coordinateSystem, projections, provenance: childProvenance, validation,
      synchronizationSentinels: parseSynchronizationSentinels(parent.synchronization_sentinels, projections),
      parent: { ...parent, provenance: parentProvenance, validation: parentValidation }, sampling,
    };
  }
  const source = record(root.source, 'source');
  const hemisphere = v2 ? 'bilateral' : 'left';
  if (source.atlas !== 'Allen CCFv3' || source.resolution_um !== resolutionUm || source.hemisphere !== hemisphere) {
    throw new Error(`generated anatomy must be the ${resolutionUm} um ${hemisphere} Allen CCFv3 atlas`);
  }
  const ids = record(source.region_ids, 'source.region_ids');
  if (ids.domain !== 'signed_allen_atlas_id' || ids.left_sign !== 'negative' || ids.background_id !== 0) {
    throw new Error('source.region_ids must declare negative signed Allen IDs with background 0');
  }
  if (v2 && ids.right_sign !== 'positive') throw new Error('bilateral source.region_ids must declare positive right IDs');
  for (const key of ['annotation', 'region_lut'] as const) {
    const descriptor = record(source[key], `source.${key}`);
    safeRelativePath(descriptor.path, `source.${key}.path`);
    integer(descriptor.bytes, `source.${key}.bytes`, 1);
    const digest = string(descriptor.sha256, `source.${key}.sha256`);
    if (!SHA256.test(digest)) throw new Error(`source.${key}.sha256 must be 64 lowercase hexadecimal characters`);
  }
  const rawProjections = record(root.projections, 'projections');
  const projections = {
    coronal: parseProjection(rawProjections.coronal, 'coronal', resolutionUm),
    sagittal: parseProjection(rawProjections.sagittal, 'sagittal', resolutionUm),
    horizontal: parseProjection(rawProjections.horizontal, 'horizontal', resolutionUm),
  };
  const provenance = parseProvenance(root.provenance);
  const validation = parseValidation(root.validation, projections, v2);
  return {
    format,
    schemaVersion,
    packId,
    immutable: true,
    createdAt,
    source,
    coordinateSystem,
    projections,
    provenance,
    validation,
    synchronizationSentinels: parseSynchronizationSentinels(root.synchronization_sentinels, projections),
  };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class GeneratedAnatomySliceSource implements AnatomySliceSource {
  private readonly fetchImpl: typeof fetch;
  private readonly cacheMode: RequestCache;
  private readonly packDepth: 8 | 16 | 32 | undefined;
  private readonly manifestUrl: string;
  private readonly maxCachedBytes: number;
  private readonly scheduleIdle: (callback: () => void) => void;
  private readonly onPerformance: ((event: AnatomyPackPerformanceEvent) => void) | undefined;
  private readonly decoder: AnatomyPackDecoder;
  private isvgRuntime: IsvgPackRuntime | null = null;
  private manifestPromise: Promise<AnatomyPackManifest> | null = null;
  private readonly packs = new Map<string, Promise<SlicePack>>();
  private readonly isvgPacks = new Map<string, Promise<void>>();
  private readonly packDecodedBytes = new Map<string, number>();
  private readonly settledPackKeys = new Set<string>();
  private readonly packLru: string[] = [];
  private readonly queuedPrefetches = new Map<SliceAxis, { index: number; direction: -1 | 1 }>();
  private cachedBytes = 0;
  private prefetchScheduled = false;

  constructor(options: GeneratedAnatomySliceSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.packDepth = options.packDepth;
    this.onPerformance = options.onPerformance;
    this.decoder = createAnatomyPackDecoder();
    this.maxCachedBytes = options.maxCachedBytes ?? 32 * 1024 * 1024;
    if (!Number.isInteger(this.maxCachedBytes) || this.maxCachedBytes <= 0) {
      throw new RangeError('maxCachedBytes must be a positive integer');
    }
    this.scheduleIdle = options.scheduleIdle ?? ((callback) => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(() => callback(), { timeout: 1_000 });
      } else {
        globalThis.setTimeout(callback, 0);
      }
    });
    const baseUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/';
    this.manifestUrl = new URL(options.manifestUrl, baseUrl).toString();
    this.cacheMode = 'force-cache';
  }

  loadManifest(): Promise<AnatomyPackManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetchManifest();
      this.manifestPromise.catch(() => { this.manifestPromise = null; });
    }
    return this.manifestPromise;
  }

  async getDisplaySliceIndices(): Promise<Readonly<Record<SliceAxis, readonly number[]>> | null> {
    const projections = (await this.loadManifest()).projections;
    if (!projections.coronal.displaySliceIndices
      || !projections.sagittal.displaySliceIndices
      || !projections.horizontal.displaySliceIndices) return null;
    return {
      coronal: projections.coronal.displaySliceIndices,
      sagittal: projections.sagittal.displaySliceIndices,
      horizontal: projections.horizontal.displaySliceIndices,
    };
  }

  async loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice> {
    const manifest = await this.loadManifest();
    const projection = manifest.projections[axis];
    if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
      throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
    }
    if (manifest.format === 'anatomy-pack-v3') return this.loadV3Slice(manifest, axis, index, signal);
    const packSet = this.packDepth == null
      ? projection.packSets['16'] ?? projection.packSets['32']
      : projection.packSets[String(this.packDepth) as '16' | '32'];
    if (!packSet) throw new Error(`${axis} anatomy has no depth-${this.packDepth} pack set`);
    const artifact = packSet.packs.find((candidate) => index >= candidate.firstSliceIndex && index < candidate.firstSliceIndex + candidate.sliceCount);
    if (!artifact) throw new Error(`${axis} anatomy index ${index} is not covered by a pack`);
    const pack = await this.loadPack(manifest, axis, packSet.packDepth as 16 | 32, artifact, signal);
    const slice = pack.slices[index - artifact.firstSliceIndex];
    if (!slice || slice.sliceIndex !== index) throw new Error(`${artifact.path} does not contain ${axis} slice ${index}`);
    return { packFormat: manifest.format, axis, ...slice, viewBox: projection.viewBox };
  }

  async worldFromSliceIndices(indices: SliceIndices): Promise<WorldCoordinateUm> {
    const manifest = await this.loadManifest();
    const world: WorldCoordinateUm = { ml: 0, ap: 0, dv: 0 };
    for (const axis of AXES) {
      const projection = manifest.projections[axis];
      const index = indices[axis];
      if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
        throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
      }
      const coordinate = planeToWorld(projection.planeIndexToWorldUm, { slice: index, u: 0, v: 0 });
      world[projection.fixedWorldAxis] = coordinate[projection.fixedWorldAxis];
    }
    return world;
  }

  async guidesForWorld(axis: SliceAxis, world: WorldCoordinateUm): Promise<readonly SliceGuide[]> {
    const projection = (await this.loadManifest()).projections[axis];
    const plane = worldToPlane(projection.worldToPlaneIndex, world);
    return projection.planeAxes.map((worldAxis, index) => ({
      sourceAxis: AXES.find((candidate) => SLICE_WORLD_AXIS[candidate] === worldAxis)!,
      targetAxis: axis,
      dimension: index === 0 ? 'x' : 'y',
      position: index === 0 ? plane.u : plane.v,
    }));
  }

  prefetchNextPack(axis: SliceAxis, index: number, direction: -1 | 1): void {
    this.queuedPrefetches.set(axis, { index, direction });
    if (this.prefetchScheduled) return;
    this.prefetchScheduled = true;
    this.scheduleIdle(() => {
      this.prefetchScheduled = false;
      const queued = [...this.queuedPrefetches];
      this.queuedPrefetches.clear();
      void this.prefetchQueuedNextPacks(queued).catch(() => {});
    });
  }

  dispose(): void {
    this.decoder.dispose();
    this.isvgRuntime?.dispose();
    this.isvgRuntime = null;
  }

  private async fetchManifest(): Promise<AnatomyPackManifest> {
    const response = await this.fetchImpl(this.manifestUrl, { cache: this.cacheMode });
    if (!response.ok) throw new Error(`Anatomy manifest request failed (${response.status})`);
    return parseAnatomyPackManifest(await response.json());
  }

  private loadPack(manifest: AnatomyPackManifest, axis: SliceAxis, packDepth: 16 | 32, artifact: PackArtifact, signal?: AbortSignal): Promise<SlicePack> {
    const key = `${axis}:${packDepth}:${artifact.path}`;
    let pending = this.packs.get(key);
    if (!pending) {
      pending = this.fetchPack(manifest, axis, packDepth, artifact, signal);
      this.packs.set(key, pending);
      this.touchPack(key);
      void pending.then(
        () => {
          this.settledPackKeys.add(key);
          this.packDecodedBytes.set(key, artifact.uncompressedBytes);
          this.cachedBytes += artifact.uncompressedBytes;
          this.trimPackCache();
        },
        () => this.deletePack(key),
      );
    } else {
      this.touchPack(key);
    }
    return pending;
  }

  private async prefetchQueuedNextPacks(entries: readonly (readonly [SliceAxis, { index: number; direction: -1 | 1 }])[]): Promise<void> {
    const manifest = await this.loadManifest();
    const pending: Promise<unknown>[] = [];
    for (const [axis, { index, direction }] of entries) {
      const projection = manifest.projections[axis];
      if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) continue;
      if (manifest.format === 'anatomy-pack-v3') {
        const display = projection.displaySliceIndices!;
        const displayIndex = nearestDisplaySlice(display, index).ordinal + direction;
        const set = projection.packSets['8'];
        const artifact = set?.packs.find((candidate) => displayIndex >= candidate.firstDisplayIndex! && displayIndex < candidate.firstDisplayIndex! + candidate.sliceCount);
        if (artifact) pending.push(this.ensureV3Pack(
          manifest,
          axis,
          artifact,
          undefined,
          display.slice(artifact.firstDisplayIndex!, artifact.firstDisplayIndex! + artifact.sliceCount),
        ));
        continue;
      }
      const packSet = this.packDepth == null
        ? projection.packSets['16'] ?? projection.packSets['32']
        : projection.packSets[String(this.packDepth) as '16' | '32'];
      if (!packSet) continue;
      const current = packSet.packs.find((artifact) => (
        index >= artifact.firstSliceIndex && index < artifact.firstSliceIndex + artifact.sliceCount
      ));
      if (!current) continue;
      const neighbor = packSet.packs[current.packIndex + direction];
      if (neighbor) pending.push(this.loadPack(manifest, axis, packSet.packDepth as 16 | 32, neighbor));
    }
    await Promise.allSettled(pending);
  }

  private async loadV3Slice(manifest: AnatomyPackManifest, axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice> {
    this.isvgRuntime ??= createIsvgPackRuntime({ maxDecodedBytes: this.maxCachedBytes });
    const projection = manifest.projections[axis];
    const display = projection.displaySliceIndices!;
    const resolved = nearestDisplaySlice(display, index);
    const nearest = resolved.nativeIndex;
    const packSet = projection.packSets['8'];
    if (!packSet) throw new Error(`${axis} anatomy v3 has no depth-8 pack set`);
    const displayIndex = resolved.ordinal;
    const artifact = packSet.packs.find((candidate) => displayIndex >= candidate.firstDisplayIndex! && displayIndex < candidate.firstDisplayIndex! + candidate.sliceCount);
    if (!artifact || !artifact.packId) throw new Error(`${axis} anatomy display slice ${nearest} is not covered by a pack`);
    const fragment = await this.loadV3Pack(manifest, axis, artifact, signal, display.slice(artifact.firstDisplayIndex!, artifact.firstDisplayIndex! + artifact.sliceCount), nearest);
    return { packFormat: 'anatomy-pack-v3', axis, sliceIndex: fragment.sliceIndex, worldCoordinateUm: fragment.worldCoordinateUm, paths: [], svgFragment: fragment.svg, viewBox: projection.viewBox };
  }

  private async loadV3Pack(manifest: AnatomyPackManifest, axis: SliceAxis, artifact: PackArtifact, signal: AbortSignal | undefined, expectedSlices: readonly number[], targetSlice: number): Promise<SvgPackFragment> {
    const key = artifact.packId!;
    await this.ensureV3Pack(manifest, axis, artifact, signal, expectedSlices);
    const fragment = await this.isvgRuntime!.get(artifact.packId!, targetSlice);
    if (fragment) return fragment;
    this.isvgPacks.delete(key);
    return this.loadV3Pack(manifest, axis, artifact, signal, expectedSlices, targetSlice);
  }

  private ensureV3Pack(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    artifact: PackArtifact,
    signal: AbortSignal | undefined,
    expectedSlices: readonly number[],
  ): Promise<void> {
    this.isvgRuntime ??= createIsvgPackRuntime({ maxDecodedBytes: this.maxCachedBytes });
    const key = artifact.packId!;
    let pending = this.isvgPacks.get(key);
    if (!pending) {
      pending = this.fetchV3Pack(manifest, axis, artifact, signal, expectedSlices);
      this.isvgPacks.set(key, pending);
      void pending.catch(() => this.isvgPacks.delete(key));
    }
    return pending;
  }

  private async fetchV3Pack(manifest: AnatomyPackManifest, axis: SliceAxis, artifact: PackArtifact, signal: AbortSignal | undefined, expectedSlices: readonly number[]): Promise<void> {
    let started = this.performanceStart();
    const response = await this.fetchImpl(new URL(artifact.path, this.manifestUrl), { cache: this.cacheMode, ...(signal ? { signal } : {}) });
    this.reportPerformance('fetch', axis, artifact, started);
    if (!response.ok) throw new Error(`Anatomy pack request failed (${response.status}): ${artifact.path}`);
    started = this.performanceStart();
    const buffer = await response.arrayBuffer();
    this.reportPerformance('read-response', axis, artifact, started);
    if (buffer.byteLength !== artifact.bytes) throw new Error(`${artifact.path} has ${buffer.byteLength} bytes; expected ${artifact.bytes}`);
    started = this.performanceStart();
    const digest = await sha256Hex(buffer);
    this.reportPerformance('sha256', axis, artifact, started);
    if (digest !== artifact.sha256) throw new Error(`SHA-256 mismatch for anatomy pack ${artifact.path}`);
    const projection = manifest.projections[axis];
    const entries = expectedSlices.map((sliceIndex) => ({ sliceIndex, worldCoordinateUm: planeToWorld(projection.planeIndexToWorldUm, { slice: sliceIndex, u: 0, v: 0 })[projection.fixedWorldAxis] }));
    started = this.performanceStart();
    const result = await this.isvgRuntime!.loadPack({ projection: axis, packId: artifact.packId!, uncompressedBytes: artifact.uncompressedBytes, entries }, buffer);
    this.reportPerformance('worker-roundtrip', axis, artifact, started, result.decodedBytes);
    for (const evicted of result.evictedPackIds) this.isvgPacks.delete(evicted);
  }

  private touchPack(key: string): void {
    const previousIndex = this.packLru.indexOf(key);
    if (previousIndex >= 0) this.packLru.splice(previousIndex, 1);
    this.packLru.push(key);
  }

  private trimPackCache(): void {
    while (this.cachedBytes > this.maxCachedBytes && this.settledPackKeys.size > 1) {
      const candidateIndex = this.packLru.findIndex((key) => this.settledPackKeys.has(key));
      if (candidateIndex < 0) return;
      const [candidate] = this.packLru.splice(candidateIndex, 1);
      if (candidate) {
        this.cachedBytes -= this.packDecodedBytes.get(candidate) ?? 0;
        this.packs.delete(candidate);
        this.packDecodedBytes.delete(candidate);
        this.settledPackKeys.delete(candidate);
      }
    }
  }

  private deletePack(key: string): void {
    this.cachedBytes -= this.packDecodedBytes.get(key) ?? 0;
    this.packs.delete(key);
    this.packDecodedBytes.delete(key);
    this.settledPackKeys.delete(key);
    const index = this.packLru.indexOf(key);
    if (index >= 0) this.packLru.splice(index, 1);
  }

  private async fetchPack(manifest: AnatomyPackManifest, axis: SliceAxis, packDepth: 16 | 32, artifact: PackArtifact, signal?: AbortSignal): Promise<SlicePack> {
    const url = new URL(artifact.path, this.manifestUrl).toString();
    let started = this.performanceStart();
    const response = await this.fetchImpl(url, { cache: this.cacheMode, ...(signal ? { signal } : {}) });
    this.reportPerformance('fetch', axis, artifact, started);
    if (!response.ok) throw new Error(`Anatomy pack request failed (${response.status}): ${artifact.path}`);
    started = this.performanceStart();
    const buffer = await response.arrayBuffer();
    this.reportPerformance('read-response', axis, artifact, started);
    if (buffer.byteLength !== artifact.bytes) throw new Error(`${artifact.path} has ${buffer.byteLength} bytes; expected ${artifact.bytes}`);
    started = this.performanceStart();
    const digest = await sha256Hex(buffer);
    this.reportPerformance('sha256', axis, artifact, started);
    if (digest !== artifact.sha256) throw new Error(`SHA-256 mismatch for anatomy pack ${artifact.path}`);

    const projection = manifest.projections[axis];
    const context: AnatomyPackDecodeContext = {
      format: manifest.format as 'anatomy-pack-v1' | 'anatomy-pack-v2',
      packId: manifest.packId,
      axis,
      packDepth,
      fixedWorldAxis: projection.fixedWorldAxis,
      planeIndexToWorldUm: projection.planeIndexToWorldUm,
      artifact: {
        packIndex: artifact.packIndex,
        firstSliceIndex: artifact.firstSliceIndex,
        sliceCount: artifact.sliceCount,
        path: artifact.path,
        uncompressedBytes: artifact.uncompressedBytes,
      },
    };
    started = this.performanceStart();
    const decoded = await this.decoder.decode(buffer, context);
    for (const timing of decoded.timings) {
      this.reportPerformanceDuration(timing.phase, axis, artifact, timing.durationMs, decoded.decodedBytes);
    }
    if (this.decoder.offThread) {
      this.reportPerformance('worker-roundtrip', axis, artifact, started, decoded.decodedBytes);
    }
    return decoded.pack;
  }

  private reportPerformance(
    phase: AnatomyPackPerformancePhase,
    axis: SliceAxis,
    artifact: PackArtifact,
    started: number,
    decodedBytes?: number,
  ): void {
    this.reportPerformanceDuration(phase, axis, artifact, performance.now() - started, decodedBytes);
  }

  private reportPerformanceDuration(
    phase: AnatomyPackPerformancePhase | AnatomyPackDecodePhase,
    axis: SliceAxis,
    artifact: PackArtifact,
    durationMs: number,
    decodedBytes?: number,
  ): void {
    if (!this.onPerformance) return;
    try {
      this.onPerformance({
        phase,
        axis,
        packIndex: artifact.packIndex,
        path: artifact.path,
        durationMs,
        compressedBytes: artifact.bytes,
        ...(decodedBytes == null ? {} : { decodedBytes }),
      });
    } catch {
      // Performance observers must not affect rendering.
    }
  }

  private performanceStart(): number {
    return this.onPerformance ? performance.now() : 0;
  }
}
