import type { SliceAxis } from '../domain/types.js';

export type DisplaySliceIndices = Readonly<Record<SliceAxis, readonly number[]>>;

export interface DisplaySliceProjection {
  readonly sliceCount: number;
  readonly displaySliceIndices?: readonly number[];
}

/** A display-plane domain over the authoritative native slice indices. */
export interface DisplaySliceInventory {
  readonly indices: readonly number[];
  readonly count: number;
  nativeIndexAtOrdinal(ordinal: number): number;
  ordinalForNativeIndex(nativeIndex: number): number;
  step(ordinal: number, delta: number): number;
}

function integer(value: number, context: string): number {
  if (!Number.isInteger(value)) throw new RangeError(`${context} must be an integer`);
  return value;
}

/**
 * Build a validated display inventory. Lists are intentionally supplied by the
 * manifest: display sampling must not be inferred from affine spacing.
 */
export function createDisplaySliceInventory(indices: readonly number[], context = 'display_slice_indices'): DisplaySliceInventory {
  if (!indices.length) throw new RangeError(`${context} must contain at least one native slice index`);
  const normalized = indices.map((index, position) => integer(index, `${context}[${position}]`));
  for (let position = 1; position < normalized.length; position += 1) {
    if (normalized[position]! <= normalized[position - 1]!) {
      throw new RangeError(`${context} must be strictly increasing`);
    }
  }

  const nearestOrdinal = (nativeIndex: number): number => {
    const query = integer(nativeIndex, 'nativeIndex');
    let low = 0;
    let high = normalized.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = normalized[middle]!;
      if (candidate === query) return middle;
      if (candidate < query) low = middle + 1;
      else high = middle - 1;
    }
    if (low === 0) return 0;
    if (low === normalized.length) return normalized.length - 1;
    // Equal-distance ties deliberately resolve toward the lower native index.
    const before = normalized[low - 1]!;
    const after = normalized[low]!;
    return query - before <= after - query ? low - 1 : low;
  };

  return {
    indices: normalized,
    count: normalized.length,
    nativeIndexAtOrdinal(ordinal: number): number {
      const value = integer(ordinal, 'display ordinal');
      if (value < 0 || value >= normalized.length) throw new RangeError(`display ordinal ${value} is outside [0, ${normalized.length - 1}]`);
      return normalized[value]!;
    },
    ordinalForNativeIndex: nearestOrdinal,
    step(ordinal: number, delta: number): number {
      const current = integer(ordinal, 'display ordinal');
      const amount = integer(delta, 'display ordinal delta');
      if (current < 0 || current >= normalized.length) throw new RangeError(`display ordinal ${current} is outside [0, ${normalized.length - 1}]`);
      return Math.min(normalized.length - 1, Math.max(0, current + amount));
    },
  };
}

export function createDisplaySliceInventories(indices: DisplaySliceIndices): Readonly<Record<SliceAxis, DisplaySliceInventory>> {
  return {
    coronal: createDisplaySliceInventory(indices.coronal, 'coronal.display_slice_indices'),
    sagittal: createDisplaySliceInventory(indices.sagittal, 'sagittal.display_slice_indices'),
    horizontal: createDisplaySliceInventory(indices.horizontal, 'horizontal.display_slice_indices'),
  };
}

/** Adapt the parsed manifest projections without changing native state semantics. */
export function createDisplaySliceInventoriesFromManifest(
  projections: Readonly<Record<SliceAxis, DisplaySliceProjection>>,
): Readonly<Record<SliceAxis, DisplaySliceInventory>> {
  const indices = {} as Record<SliceAxis, readonly number[]>;
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const projection = projections[axis];
    if (!projection.displaySliceIndices) throw new Error(`${axis}.display_slice_indices is required for sparse display navigation`);
    if (projection.displaySliceIndices.some((index) => index < 0 || index >= projection.sliceCount)) {
      throw new RangeError(`${axis}.display_slice_indices contains an index outside the native slice range`);
    }
    indices[axis] = projection.displaySliceIndices;
  }
  return createDisplaySliceInventories(indices);
}
