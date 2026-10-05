/** Schema-v1 volume semantic checks; the release contract is unchanged. */

import {
  type JsonObject,
  DTYPE_BYTES,
  fail,
  object,
  array,
  numberArray,
  integers,
  expect,
  unique,
  product,
} from './schema-v1-common.js';

export function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 + 1e-10 * Math.abs(right);
}

export function affineSemantics(matrixValue: unknown, shape: number[], extentValue: unknown, inverseValue?: unknown): void {
  const matrix = numberArray(matrixValue, 16, 'affine');
  const extent = numberArray(extentValue, 6, 'voxel-edge extent');
  if (matrix.slice(12).some((value, index) => value !== [0, 0, 0, 1][index])) fail('affine homogeneous row is invalid');
  const inverse = new Array<number>(16).fill(0);
  inverse[15] = 1;
  for (let row = 0; row < 3; row += 1) {
    const columns = [0, 1, 2].filter((column) => matrix[row * 4 + column] !== 0);
    if (columns.length !== 1) fail('affine spatial row is not a signed permutation');
    const column = columns[0]!;
    const scale = matrix[row * 4 + column]!;
    const translation = matrix[row * 4 + 3]!;
    inverse[column * 4 + row] = 1 / scale;
    inverse[column * 4 + 3] = -translation / scale;
  }
  for (let column = 0; column < 3; column += 1) {
    if ([0, 1, 2].filter((row) => matrix[row * 4 + column] !== 0).length !== 1) {
      fail('affine spatial column is not a signed permutation');
    }
  }
  if (inverseValue !== undefined) {
    const declared = numberArray(inverseValue, 16, 'inverse affine');
    if (declared.some((value, index) => !close(value, inverse[index]!))) fail('declared affine inverse is invalid');
  }
  const derived: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    const column = [0, 1, 2].find((candidate) => matrix[row * 4 + candidate] !== 0)!;
    const scale = matrix[row * 4 + column]!;
    const translation = matrix[row * 4 + 3]!;
    const edges = [translation - scale * 0.5, translation + scale * (shape[column]! - 0.5)];
    derived.push(Math.min(...edges), Math.max(...edges));
  }
  if (extent.some((value, index) => !close(value, derived[index]!))) fail('voxel-edge extent is invalid');
}

export function volumeSemantics(document: JsonObject): void {
  expect(document.format, 'ephys-atlas-volume-v1', 'volume format');
  const grid = object(document.grid, 'volume grid');
  const shape = integers(grid.shape, 'volume shape');
  if (shape.length !== 3 || shape.some((size) => size <= 0)) fail('volume shape must contain three positive integers');
  affineSemantics(grid.index_to_world_um, shape, grid.voxel_edge_extent_um, grid.world_to_index);
  const validity = object(document.validity, 'volume validity');
  if (validity.kind === 'mask') {
    const mask = object(validity.mask, 'validity mask');
    if (mask.dtype !== 'uint8' || JSON.stringify(mask.shape) !== JSON.stringify(shape)) fail('validity mask dtype or shape is invalid');
    const codes = object(validity.codes, 'validity codes');
    unique([codes.valid, codes.outside, codes.missing], 'validity code');
  } else if (validity.kind !== 'sentinel') fail('volume validity discriminant is invalid');
}

export function indexSemantics(document: JsonObject): void {
  const layout = document.layout;
  const entries = array(layout === 'chunks3d' ? document.chunks : document.packs, 'volume resources').map((item) => object(item, 'volume resource'));
  unique(entries.map((entry) => object(entry.resource, 'resource').path), 'volume resource path');
  for (const entry of entries) {
    const decoded = object(entry.decoded, 'decoded block');
    const shape = integers(decoded.shape, 'decoded block shape');
    const bytes = DTYPE_BYTES[String(decoded.dtype)];
    if (bytes === undefined || object(object(entry.resource, 'resource').codec, 'codec').decoded_bytes !== product(shape) * bytes) fail('volume decoded block length is invalid');
  }
  if (layout === 'chunks3d') unique(entries.map((entry) => entry.origin), 'chunk origin');
  else if (layout === 'orthogonal_slice_packs') {
    if (new Set(entries.map((entry) => entry.axis)).size !== 3) fail('slice packs must cover three axes');
    for (const entry of entries) {
      const decoded = object(entry.decoded, 'decoded block');
      if (array(decoded.storage_axes, 'storage axes')[0] !== entry.axis || integers(decoded.shape, 'decoded shape')[0] !== entry.slice_count) fail('slice-pack axis or count is invalid');
    }
  } else fail('volume layout is invalid');
}
