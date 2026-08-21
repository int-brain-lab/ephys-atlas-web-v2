import {
  assertInverseAffines,
  SLICE_WORLD_AXIS,
  type Matrix4,
  type SliceAxis,
  type WorldAxis,
} from '../../core/spatial.js';
import type { AnatomyProjection, PackArtifact, PackSet } from './types.js';

export const SHA256 = /^[0-9a-f]{64}$/;
const WORLD_ROW: Readonly<Record<WorldAxis, number>> = { ml: 0, ap: 1, dv: 2 };

export function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

export function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

export function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${context} must be an integer >= ${minimum}`);
  return Number(value);
}

export function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

export function tuple(value: unknown, length: number, context: string): number[] {
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

export function safeRelativePath(value: unknown, context: string): string {
  const path = string(value, context);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${context} must be a safe relative path`);
  }
  return path;
}

function parseArtifact(value: unknown, context: string, indexed = false): PackArtifact {
  const item = record(value, context);
  if (indexed ? item.media_type !== 'application/vnd.ibl.indexed-svg' : item.media_type !== 'application/json') {
    throw new Error(`${context}.media_type is not supported`);
  }
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
    ...(indexed ? {
      mediaType: String(item.media_type),
      packId: string(item.pack_id, `${context}.pack_id`),
      firstDisplayIndex: integer(item.first_display_index, `${context}.first_display_index`),
    } : {}),
  };
}

function parsePackSet(value: unknown, depth: 8 | 16 | 32, context: string, indexed = false): PackSet {
  const item = record(value, context);
  if (item.pack_depth !== depth) throw new Error(`${context}.pack_depth must be ${depth}`);
  const pathTemplate = safeRelativePath(item.path_template, `${context}.path_template`);
  if (!pathTemplate.includes('{pack}') || (!indexed && !pathTemplate.endsWith('.json.gz')) || (indexed && !pathTemplate.endsWith('.isvg.gz'))) {
    throw new Error(`${context}.path_template must address numbered ${indexed ? '.isvg.gz' : '.json.gz'} packs`);
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

export function nearestDisplaySlice(indices: readonly number[], target: number): { nativeIndex: number; ordinal: number } {
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

export function parseProjection(value: unknown, axis: SliceAxis, resolutionUm: 10 | 25, indexed = false): AnatomyProjection {
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
        if (Math.abs(Math.abs(coefficient) - resolutionUm) > 1e-9) throw new Error(`projections.${axis} ${worldName} step must be ${resolutionUm} um`);
      } else if (Math.abs(coefficient) > 1e-9) {
        throw new Error(`projections.${axis} affine couples orthogonal anatomy axes`);
      }
    }
  }
  if (
    Math.abs(planeIndexToWorldUm[12]) > 1e-12
    || Math.abs(planeIndexToWorldUm[13]) > 1e-12
    || Math.abs(planeIndexToWorldUm[14]) > 1e-12
    || Math.abs(planeIndexToWorldUm[15] - 1) > 1e-12
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
