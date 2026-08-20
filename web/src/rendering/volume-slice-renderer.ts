import type { ColoringState } from '../domain/types.js';
import type { VolumeFeaturePayload } from '../data/contracts.js';
import { CanvasVolumeSliceRenderer } from './canvas-volume-renderer.js';
import { SchemaChunks3dVolumeSource, regionalSliceToVolumeIndex } from './chunked-volume-source.js';
import type { RendererPresentation, SliceRenderModel, SliceRenderer } from './interfaces.js';
import { VolumeSliceLoader, type VolumeSlice } from './volume.js';

const PALETTES: Record<string, readonly [number, number, number][]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
};

interface VolumeMount {
  canvas: HTMLCanvasElement;
  renderer: CanvasVolumeSliceRenderer;
  feature: VolumeFeaturePayload | null;
  slice: VolumeSlice | null;
}

function interpolate(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function paletteColor(name: string, normalized: number): readonly [number, number, number] {
  const palette = PALETTES[name] ?? PALETTES.viridis!;
  const t = Math.max(0, Math.min(1, normalized));
  const scaled = t * (palette.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(palette.length - 1, lowerIndex + 1);
  const local = scaled - lowerIndex;
  const lower = palette[lowerIndex] ?? palette[0]!;
  const upper = palette[upperIndex] ?? lower;
  return [
    interpolate(lower[0], upper[0], local),
    interpolate(lower[1], upper[1], local),
    interpolate(lower[2], upper[2], local),
  ];
}

function finiteRange(values: Float32Array): readonly [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return max > min ? [min, max] : [min, min + 1];
}

function displayRange(feature: VolumeFeaturePayload, slice: VolumeSlice, coloring: ColoringState): readonly [number, number] | null {
  if (coloring.range.mode === 'fixed') {
    return coloring.range.max > coloring.range.min ? [coloring.range.min, coloring.range.max] : null;
  }
  const declared = feature.descriptor.valueRange;
  if (declared && declared[0] != null && declared[1] != null && declared[1] > declared[0]) {
    return [declared[0], declared[1]];
  }
  return finiteRange(slice.data);
}

function rgbaForSlice(feature: VolumeFeaturePayload, slice: VolumeSlice, coloring: ColoringState): Uint8ClampedArray {
  const range = displayRange(feature, slice, coloring);
  const rgba = new Uint8ClampedArray(slice.data.length * 4);
  if (!range) return rgba;
  const [min, max] = range;
  const log = coloring.scale === 'log' && min > 0 && max > min;
  const lo = log ? Math.log(min) : min;
  const hi = log ? Math.log(max) : max;
  const span = hi - lo;

  for (let index = 0; index < slice.data.length; index += 1) {
    const value = slice.data[index]!;
    const offset = index * 4;
    if (!Number.isFinite(value) || (log && value <= 0)) {
      rgba[offset + 3] = 0;
      continue;
    }
    const scalar = log ? Math.log(value) : value;
    const normalized = span > 0 ? (scalar - lo) / span : 0.5;
    const [r, g, b] = paletteColor(coloring.colormap, normalized);
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

export class ChunkedVolumeSliceRenderer implements SliceRenderer {
  private readonly loaders = new WeakMap<VolumeFeaturePayload, VolumeSliceLoader>();
  private readonly mounts = new Map<HTMLElement, VolumeMount>();
  private presentation: RendererPresentation | null = null;

  updatePresentation(presentation: RendererPresentation): void {
    this.presentation = presentation;
    if (presentation.feature?.representation !== 'volume') return;
    for (const mount of this.mounts.values()) {
      if (mount.feature !== presentation.feature || !mount.slice) continue;
      mount.renderer.render({
        axis: mount.slice.axis,
        index: mount.slice.index,
        width: mount.slice.width,
        height: mount.slice.height,
        rgba: rgbaForSlice(presentation.feature, mount.slice, presentation.coloring),
      });
    }
  }

  async render(target: HTMLElement, model: SliceRenderModel): Promise<void> {
    const feature = model.feature;
    if (!feature || feature.representation !== 'volume') throw new Error('Volume renderer requires a decoded volume feature');
    const loader = this.loader(feature);
    const volumeIndex = regionalSliceToVolumeIndex(feature, model.axis, model.sliceIndex);
    const slice = await loader.loadSlice(model.axis, volumeIndex);
    const mount = this.mount(target);
    const coloring = this.presentation?.coloring ?? {
      statistic: 'mean',
      colormap: 'viridis',
      range: { mode: 'auto' as const },
      scale: 'linear' as const,
    };
    mount.renderer.render({
      axis: slice.axis,
      index: slice.index,
      width: slice.width,
      height: slice.height,
      rgba: rgbaForSlice(feature, slice, coloring),
    });
    mount.feature = feature;
    mount.slice = slice;
    target.dataset.sliceAsset = 'schema-volume-v0.1';
    target.dataset.volumeIndex = String(volumeIndex);
    target.dataset.volumeFeature = feature.featureId;
    void loader.prefetchAdjacent(model.axis, volumeIndex, 1).catch(() => undefined);
  }

  clear(target: HTMLElement): void {
    const mount = this.mounts.get(target);
    mount?.renderer.dispose();
    this.mounts.delete(target);
    target.replaceChildren();
    delete target.dataset.sliceAsset;
    delete target.dataset.volumeIndex;
    delete target.dataset.volumeFeature;
  }

  destroy(): void {
    for (const [target, mount] of this.mounts) {
      mount.renderer.dispose();
      target.replaceChildren();
    }
    this.mounts.clear();
  }

  private loader(feature: VolumeFeaturePayload): VolumeSliceLoader {
    let loader = this.loaders.get(feature);
    if (!loader) {
      loader = new VolumeSliceLoader(new SchemaChunks3dVolumeSource(feature));
      this.loaders.set(feature, loader);
    }
    return loader;
  }

  private mount(target: HTMLElement): VolumeMount {
    const existing = this.mounts.get(target);
    if (existing) return existing;
    const canvas = document.createElement('canvas');
    canvas.className = 'view-frame__volume-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Ephys atlas volume slice');
    target.replaceChildren(canvas);
    const mount: VolumeMount = {
      canvas,
      renderer: new CanvasVolumeSliceRenderer(canvas),
      feature: null,
      slice: null,
    };
    this.mounts.set(target, mount);
    return mount;
  }
}
