import type { VolumeFeaturePayload } from '../data/contracts.js';
import { decodeBinaryArray } from '../data/validate.js';
import { volumeAxisDimension } from './chunked-volume-source.js';
import type { VolumeSlice, VolumeSliceSource } from './volume.js';

async function decompress(buffer: ArrayBuffer, codec: 'none' | 'gzip'): Promise<ArrayBuffer> {
  if (codec === 'none') return buffer;
  if (!('DecompressionStream' in globalThis)) throw new Error('gzip volume validity masks require DecompressionStream support');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Adds a checksummed full-grid uint8 validity mask to decoded scalar planes. */
export class VolumeValiditySliceSource implements VolumeSliceSource {
  private maskPromise: Promise<Uint8Array> | null = null;

  constructor(
    private readonly feature: VolumeFeaturePayload,
    private readonly source: VolumeSliceSource,
  ) {
    if (feature.descriptor.validity.kind !== 'mask') throw new Error('validity wrapper requires mask validity');
  }

  async loadSlice(axis: VolumeSlice['axis'], index: number, signal?: AbortSignal): Promise<VolumeSlice> {
    const [slice, mask] = await Promise.all([
      this.source.loadSlice(axis, index, signal),
      this.loadMask(),
    ]);
    const descriptor = this.feature.descriptor.validity;
    if (descriptor.kind !== 'mask') throw new Error('volume validity changed while loading');
    const shape = this.feature.descriptor.grid.shape;
    const fixedDimension = volumeAxisDimension(this.feature, slice.axis);
    const widthDimension = volumeAxisDimension(this.feature, slice.widthAxis);
    const heightDimension = volumeAxisDimension(this.feature, slice.heightAxis);
    const validity = new Uint8Array(slice.width * slice.height);
    for (let y = 0; y < slice.height; y += 1) {
      for (let x = 0; x < slice.width; x += 1) {
        const raw = [0, 0, 0] as [number, number, number];
        raw[fixedDimension] = slice.index;
        raw[widthDimension] = x;
        raw[heightDimension] = y;
        validity[y * slice.width + x] = mask[((raw[0] * shape[1]!) + raw[1]) * shape[2]! + raw[2]]!;
      }
    }
    return { ...slice, validity };
  }

  async prefetchAdjacent(axis: VolumeSlice['axis'], index: number, radius?: number, signal?: AbortSignal): Promise<void> {
    await this.source.prefetchAdjacent?.(axis, index, radius, signal);
  }

  dispose(): void {
    this.maskPromise = null;
    this.source.dispose?.();
  }

  private loadMask(): Promise<Uint8Array> {
    if (!this.maskPromise) {
      this.maskPromise = this.fetchMask();
      void this.maskPromise.catch(() => { this.maskPromise = null; });
    }
    return this.maskPromise;
  }

  private async fetchMask(): Promise<Uint8Array> {
    const validity = this.feature.descriptor.validity;
    if (validity.kind !== 'mask') throw new Error('volume validity mask is unavailable');
    const resource = validity.mask.resource;
    const encoded = await this.feature.loadResource(resource.path, undefined, resource);
    const buffer = await decompress(encoded, resource.codec.name);
    const values = decodeBinaryArray(buffer, {
      format: 'raw-binary-array-v1',
      ...resource,
      dtype: 'uint8',
      shape: validity.mask.shape,
      order: 'C',
      endianness: 'not-applicable',
    });
    return Uint8Array.from(values);
  }
}
