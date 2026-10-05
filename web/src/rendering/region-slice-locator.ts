import type { ParcellationId } from '../domain/types.js';
import type { SliceAxis, SliceIndices } from '../core/spatial.js';
import type { RegisteredProjectionSource } from './projection-pack-source.js';

const AXES = ['coronal', 'sagittal', 'horizontal'] as const;
const MAPPINGS = ['allen', 'beryl', 'cosmos'] as const;
type SliceRegions = Readonly<Record<ParcellationId, ReadonlySet<number>>>;

/** A small presence index over verified display geometry, never feature values. */
export class RegionSliceLocator {
  private readonly regions = new Map<string, SliceRegions>();

  constructor(private readonly source: RegisteredProjectionSource) {}

  observe(axis: SliceAxis, index: number, fragment: string): void {
    const key = `${axis}:${index}`;
    if (this.regions.has(key)) return;
    const regions = { allen: new Set<number>(), beryl: new Set<number>(), cosmos: new Set<number>() };
    for (const path of fragment.matchAll(/<path\b[^>]*>/g)) {
      for (const mapping of MAPPINGS) {
        const value = new RegExp(`\\bdata-${mapping}-id="(-?\\d+)"`).exec(path[0])?.[1];
        if (value !== undefined) regions[mapping].add(Math.abs(Number(value)));
      }
    }
    this.regions.set(key, regions);
  }

  async locate(
    regionId: string,
    mapping: ParcellationId,
    current: SliceIndices,
    signal: AbortSignal,
  ): Promise<SliceIndices | null> {
    const id = Math.abs(Number(regionId));
    if (!Number.isSafeInteger(id) || id === 0) return null;
    const inventories = await this.source.getDisplaySliceInventories();
    signal.throwIfAborted();
    const result = await Promise.all(AXES.map(async axis => {
      const inventory = inventories[axis];
      const visible = inventory.nativeIndexAtOrdinal(inventory.ordinalForNativeIndex(current[axis]));
      const candidates = [...inventory.indices].sort((a, b) => Math.abs(a - current[axis]) - Math.abs(b - current[axis]) || a - b);
      for (const index of candidates) {
        signal.throwIfAborted();
        const key = `${axis}:${index}`;
        if (!this.regions.has(key)) {
          // Pack reads are shared with retained viewports. Let an in-flight read
          // finish so cancelling this lookup cannot abort a manual navigation.
          const slice = await this.source.loadSlice(axis, index);
          signal.throwIfAborted();
          this.observe(axis, slice.sliceIndex, slice.svgFragment);
        }
        if (this.regions.get(key)?.[mapping].has(id)) {
          // A visible region does not require snapping a native cursor to a display plane.
          return index === visible ? current[axis] : index;
        }
      }
      return null;
    }));
    signal.throwIfAborted();
    if (result.some(index => index === null)) return null;
    return { coronal: result[0]!, sagittal: result[1]!, horizontal: result[2]! };
  }
}
