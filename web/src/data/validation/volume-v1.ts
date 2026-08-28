import type { VolumeFeatureSummary, VolumeRepresentationDescriptor, VolumeValidStatistics } from '../contracts.js';
import { parseEncodedResource } from './binary.js';
import { array, integerArray, numberArray, object, string, unique } from './primitives.js';

function decodedBlock(value: unknown, context: string) {
  const block = object(value, context);
  const storageAxes = array(block.storage_axes, `${context}.storage_axes`)
    .map((axis, index) => string(axis, `${context}.storage_axes[${index}]`));
  if (storageAxes.length !== 3 || !['i0', 'i1', 'i2'].every((axis) => storageAxes.includes(axis))) {
    throw new Error(`${context}.storage_axes must be a permutation of i0, i1, i2`);
  }
  if (block.dtype !== 'float16' && block.dtype !== 'float32') throw new Error(`${context}.dtype is unsupported`);
  if (block.order !== 'C' || block.endianness !== 'little') throw new Error(`${context} decoding contract is unsupported`);
  return {
    dtype: block.dtype,
    shape: integerArray(block.shape, 3, `${context}.shape`),
    storageAxes,
  };
}

function resourceEntry(value: unknown, context: string) {
  const entry = object(value, context);
  return {
    decoded: decodedBlock(entry.decoded, `${context}.decoded`),
    resource: parseEncodedResource(entry.resource, `${context}.resource`),
  };
}

function nonnegativeIntegerArray(value: unknown, length: number, context: string): number[] {
  const values = array(value, context);
  if (values.length !== length
    || values.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0)) {
    throw new Error(`${context} must contain ${length} non-negative integers`);
  }
  return values as number[];
}

export function parseVolumeResourceIndex(
  value: unknown,
  descriptor: VolumeRepresentationDescriptor,
): Record<string, unknown> {
  const root = object(value, 'volume resource index');
  if (root.schema_version !== '1.0' || root.format !== 'ephys-atlas-volume-resource-index-v1') {
    throw new Error('volume resource index format is unsupported');
  }
  if (root.grid_id !== descriptor.grid.gridId || root.layout !== descriptor.layout) {
    throw new Error('volume resource index identity does not match feature descriptor');
  }
  if (root.layout === 'chunks3d') {
    const chunkShape = integerArray(root.chunk_shape, 3, 'volume resource index.chunk_shape');
    const chunks = array(root.chunks, 'volume resource index.chunks').map((value, index) => {
      const raw = object(value, `volume resource index.chunks[${index}]`);
      return {
        origin: nonnegativeIntegerArray(raw.origin, 3, `volume resource index.chunks[${index}].origin`),
        ...resourceEntry(raw, `volume resource index.chunks[${index}]`),
      };
    });
    unique(chunks.map((chunk) => chunk.origin.join('/')), 'volume chunk origins');
    unique(chunks.map((chunk) => chunk.resource.path), 'volume chunk paths');
    const expectedOrigins: string[] = [];
    for (let i0 = 0; i0 < descriptor.grid.shape[0]; i0 += chunkShape[0]!) {
      for (let i1 = 0; i1 < descriptor.grid.shape[1]; i1 += chunkShape[1]!) {
        for (let i2 = 0; i2 < descriptor.grid.shape[2]; i2 += chunkShape[2]!) expectedOrigins.push(`${i0}/${i1}/${i2}`);
      }
    }
    if (chunks.length !== expectedOrigins.length
      || expectedOrigins.some((origin) => !chunks.some((chunk) => chunk.origin.join('/') === origin))) {
      throw new Error('volume chunks do not cover the grid exactly');
    }
    for (const chunk of chunks) {
      if (chunk.decoded.dtype !== descriptor.array.dtype) throw new Error('volume chunk dtype differs from feature');
      const rawShape = chunk.origin.map((origin, dimension) => (
        Math.min(chunkShape[dimension]!, descriptor.grid.shape[dimension]! - origin)
      ));
      const expectedShape = chunk.decoded.storageAxes.map((axis) => rawShape[Number(axis[1])]!);
      if (chunk.decoded.shape.some((size, index) => size !== expectedShape[index])) {
        throw new Error('volume chunk decoded shape is inconsistent with its origin');
      }
    }
    return { chunk_shape: chunkShape, chunks };
  }
  if (root.layout !== 'orthogonal_slice_packs') throw new Error('volume resource index layout is unsupported');
  if (typeof root.pack_depth !== 'number' || !Number.isInteger(root.pack_depth) || root.pack_depth <= 0) {
    throw new Error('volume resource index.pack_depth must be positive');
  }
  const packs = array(root.packs, 'volume resource index.packs').map((value, index) => {
    const raw = object(value, `volume resource index.packs[${index}]`);
    if (!['i0', 'i1', 'i2'].includes(String(raw.axis))) throw new Error('volume pack axis is unsupported');
    if (typeof raw.first_slice !== 'number' || !Number.isInteger(raw.first_slice) || raw.first_slice < 0) throw new Error('volume pack first_slice is invalid');
    if (typeof raw.slice_count !== 'number' || !Number.isInteger(raw.slice_count) || raw.slice_count <= 0) throw new Error('volume pack slice_count is invalid');
    return {
      axis: raw.axis,
      firstSlice: raw.first_slice,
      sliceCount: raw.slice_count,
      ...resourceEntry(raw, `volume resource index.packs[${index}]`),
    };
  });
  unique(packs.map((pack) => `${String(pack.axis)}/${pack.firstSlice}`), 'volume slice-pack positions');
  unique(packs.map((pack) => pack.resource.path), 'volume slice-pack paths');
  for (let dimension = 0; dimension < 3; dimension += 1) {
    const axis = `i${dimension}`;
    const expectedStarts = [];
    for (let first = 0; first < descriptor.grid.shape[dimension]!; first += root.pack_depth as number) expectedStarts.push(first);
    const axisPacks = packs.filter((pack) => pack.axis === axis);
    if (axisPacks.length !== expectedStarts.length
      || expectedStarts.some((first) => !axisPacks.some((pack) => pack.firstSlice === first))) {
      throw new Error(`volume slice packs do not cover ${axis} exactly`);
    }
    for (const pack of axisPacks) {
      const expectedCount = Math.min(root.pack_depth as number, descriptor.grid.shape[dimension]! - pack.firstSlice);
      if (pack.sliceCount !== expectedCount || pack.decoded.dtype !== descriptor.array.dtype) {
        throw new Error(`volume ${axis} pack decoding contract differs from feature`);
      }
      const expectedShape = pack.decoded.storageAxes.map((storageAxis) => (
        storageAxis === axis ? pack.sliceCount : descriptor.grid.shape[Number(storageAxis[1])]!
      ));
      if (pack.decoded.storageAxes[0] !== axis
        || pack.decoded.shape.some((size, index) => size !== expectedShape[index])) {
        throw new Error(`volume ${axis} pack decoded shape is inconsistent`);
      }
    }
  }
  return { pack_depth: root.pack_depth, packs };
}

export function parseVolumeSummary(
  value: unknown,
  descriptor: VolumeRepresentationDescriptor,
): VolumeFeatureSummary {
  const root = object(value, 'volume summary');
  if (root.schema_version !== '1.0' || root.format !== 'ephys-atlas-volume-summary-v1') {
    throw new Error('volume summary format is unsupported');
  }
  if (root.grid_id !== descriptor.grid.gridId) throw new Error('volume summary grid identity differs from feature');
  const shape = integerArray(root.grid_shape, 3, 'volume summary.grid_shape');
  if (shape.some((size, index) => size !== descriptor.grid.shape[index])) throw new Error('volume summary shape differs from feature');
  const count = (field: string): number => {
    const result = root[field];
    if (typeof result !== 'number' || !Number.isInteger(result) || result < 0) {
      throw new Error(`volume summary.${field} must be a non-negative integer`);
    }
    return result;
  };
  const total = count('total_voxel_count');
  const valid = count('valid_voxel_count');
  const outside = count('outside_voxel_count');
  const missing = count('missing_voxel_count');
  if (total !== shape.reduce((product, size) => product * size, 1) || total !== valid + outside + missing) {
    throw new Error('volume summary counts are inconsistent');
  }
  const statistics = object(root.valid_statistics, 'volume summary.valid_statistics');
  const statistic = (field: keyof VolumeValidStatistics): number | null => {
    const result = statistics[field];
    if (result !== null && (typeof result !== 'number' || !Number.isFinite(result))) {
      throw new Error(`volume summary.valid_statistics.${field} must be finite or null`);
    }
    if ((valid === 0) !== (result === null)) {
      throw new Error('volume summary valid-statistics nullability is inconsistent with the valid voxel count');
    }
    return result as number | null;
  };
  const validStatistics: VolumeValidStatistics = {
    min: statistic('min'),
    max: statistic('max'),
    mean: statistic('mean'),
    std: statistic('std'),
    median: statistic('median'),
    q05: statistic('q05'),
    q25: statistic('q25'),
    q75: statistic('q75'),
    q95: statistic('q95'),
  };
  let valueRange: readonly [number | null, number | null] = [null, null];
  if (valid > 0) {
    const robust = numberArray([validStatistics.q05, validStatistics.q95], 2, 'volume summary robust range');
    const extent = numberArray([validStatistics.min, validStatistics.max], 2, 'volume summary value extent');
    const robustMinimum = robust[0]!;
    const robustMaximum = robust[1]!;
    valueRange = robustMaximum > robustMinimum
      ? [robustMinimum, robustMaximum]
      : [extent[0]!, extent[1]!];
  }
  let histogram: VolumeFeatureSummary['histogram'];
  if (root.histogram !== undefined) {
    const rawHistogram = object(root.histogram, 'volume summary.histogram');
    const edges = array(rawHistogram.edges, 'volume summary.histogram.edges').map((edge, index) => {
      if (typeof edge !== 'number' || !Number.isFinite(edge)) {
        throw new Error(`volume summary.histogram.edges[${index}] must be finite`);
      }
      return edge;
    });
    if (edges.length < 2 || edges.some((edge, index) => index > 0 && edge <= edges[index - 1]!)) {
      throw new Error('volume summary.histogram.edges must be strictly increasing');
    }
    const counts = array(rawHistogram.counts, 'volume summary.histogram.counts');
    if (counts.length !== edges.length - 1
      || counts.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0)
      || (counts as number[]).reduce((sum, item) => sum + item, 0) !== valid) {
      throw new Error('volume summary.histogram.counts must conserve the valid voxel population');
    }
    if (rawHistogram.bin_rule !== 'left-closed-right-open-last-closed') {
      throw new Error('volume summary.histogram.bin_rule is unsupported');
    }
    histogram = {
      axisScale: 'linear',
      edges,
      globalCounts: counts as number[],
      binRule: rawHistogram.bin_rule,
    };
  }
  return {
    totalVoxelCount: total,
    validVoxelCount: valid,
    outsideVoxelCount: outside,
    missingVoxelCount: missing,
    validStatistics,
    valueRange,
    ...(histogram ? { histogram } : {}),
  };
}
