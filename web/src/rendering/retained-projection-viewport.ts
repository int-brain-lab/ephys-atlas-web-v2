import type { ColoringState, EffectiveColoringState, SliceAxis } from '../domain/types.js';
import type { VolumeFeaturePayload } from '../data/contracts.js';
import { applyAffine, cursorStateToWorld, worldToPlane, type Matrix4, type ViewBox } from './coordinate-space.js';
import { regionalPresentationColors, regionalPresentationIds } from '../application/regional-presentation.js';
import { SvgSliceRenderer } from './svg-slice-renderer.js';
import type { RegionalSliceFrame, SliceRegionPointerEvent } from './types.js';
import { CanvasVolumeSliceRenderer } from './canvas-volume-renderer.js';
import {
  SchemaChunks3dVolumeSource,
  locateVolumePlane,
  volumeAxisDimension,
} from './chunked-volume-source.js';
import { SchemaSlicePackVolumeSource } from './slice-pack-volume-source.js';
import { VolumeValiditySliceSource } from './volume-validity-source.js';
import { RetainedStaticProjectionViewport } from './static-projection-viewport.js';
import { VolumeSliceLoader, type VolumeSlice, type VolumeSliceSource } from './volume.js';
import { paletteRgb } from '../application/colormap-palettes.js';
import { regionIdFromPath } from './region-id.js';
import {
  ProjectionPackSource,
  type RegisteredProjectionRegistration,
  type RegisteredProjectionSlice,
  type RegisteredProjectionSource,
} from './projection-pack-source.js';
import {
  assertCompatibleReferenceSpace,
  inspectVolumePlanePoint,
  volumeValueIsVisible,
} from './volume-inspection.js';
import type {
  ProjectionInteractionSink,
  ProjectionPresentation,
  ProjectionRenderModel,
  ProjectionViewport,
  ProjectionViewportFactory,
  RegionHit,
  StaticProjectionViewport,
} from './projection-viewport.js';

interface PendingRender {
  readonly model: ProjectionRenderModel;
  readonly token: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface RetainedMount {
  readonly root: HTMLDivElement;
  readonly scalar: SVGSVGElement;
  readonly scalarHost: SVGForeignObjectElement;
  readonly canvas: HTMLCanvasElement;
  readonly volume: CanvasVolumeSliceRenderer;
  readonly svg: SVGSVGElement;
  readonly regional: SvgSliceRenderer;
  readonly error: HTMLDivElement;
}

export interface RegisteredVolumeCanvasPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly viewBox: ViewBox;
}

function volumeIndexToPlane(
  feature: VolumeFeaturePayload,
  registration: RegisteredProjectionRegistration,
  index: readonly [number, number, number],
) {
  const affine = feature.descriptor.grid.indexToWorldUm;
  if (affine.length !== 16) throw new Error('volume index_to_world_um must contain 16 values');
  const [ml, ap, dv] = applyAffine(affine as Matrix4, index);
  return worldToPlane(registration.worldToPlaneIndex, { ml, ap, dv });
}

/** Position a raw nearest-neighbor plane inside the registered anatomy viewBox. */
export function registeredVolumeCanvasPlacement(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  registration: RegisteredProjectionRegistration,
): RegisteredVolumeCanvasPlacement {
  assertCompatibleReferenceSpace(registration, feature);
  if (slice.axis !== registration.axis) throw new Error('volume plane and projection axes differ');
  const fixed = volumeAxisDimension(feature, slice.axis);
  const width = volumeAxisDimension(feature, slice.widthAxis);
  const height = volumeAxisDimension(feature, slice.heightAxis);
  if (new Set([fixed, width, height]).size !== 3) throw new Error('volume plane axes are not independent');
  const corner = (rawWidth: number, rawHeight: number) => {
    const index = [0, 0, 0] as [number, number, number];
    index[fixed] = slice.index;
    index[width] = rawWidth;
    index[height] = rawHeight;
    return volumeIndexToPlane(feature, registration, index);
  };
  const low = corner(-0.5, -0.5);
  const right = corner(slice.width - 0.5, -0.5);
  const down = corner(-0.5, slice.height - 0.5);
  const diagonal = corner(slice.width - 0.5, slice.height - 0.5);
  const epsilon = 1e-7;
  if (Math.abs(right.v - low.v) > epsilon || Math.abs(down.u - low.u) > epsilon) {
    throw new Error('volume grid is not axis-aligned with the registered projection');
  }
  const x = Math.min(low.u, right.u, down.u, diagonal.u);
  const y = Math.min(low.v, right.v, down.v, diagonal.v);
  const projectedWidth = Math.max(low.u, right.u, down.u, diagonal.u) - x;
  const projectedHeight = Math.max(low.v, right.v, down.v, diagonal.v) - y;
  if (!(projectedWidth > 0 && projectedHeight > 0)) throw new Error('volume plane has an empty projected extent');
  return {
    x,
    y,
    width: projectedWidth,
    height: projectedHeight,
    flipX: right.u < low.u,
    flipY: down.v < low.v,
    viewBox: registration.viewBox,
  };
}

const DEFAULT_PRESENTATION: ProjectionPresentation = {
  regional: {
    mapping: 'allen', anatomyColors: new Map(), featureColors: null,
    visibleRegionIds: new Set(), selectedRegionIds: new Set(), highlightedRegionId: null, featureSide: null,
  },
  feature: null,
  coloring: {
    mode: 'feature',
    statistic: 'mean',
    colormap: 'viridis',
    range: { mode: 'auto' },
    scale: 'linear',
  },
  volumeOpacity: 1,
  anatomyOutlines: true,
};

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

function displayRange(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  coloring: ColoringState,
): readonly [number, number] | null {
  if (coloring.range.mode === 'fixed') {
    return coloring.range.max > coloring.range.min ? [coloring.range.min, coloring.range.max] : null;
  }
  const declared = feature.descriptor.valueRange;
  if (declared && declared[0] != null && declared[1] != null && declared[1] > declared[0]) {
    return [declared[0], declared[1]];
  }
  return finiteRange(slice.data);
}

function rgbaForSlice(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  coloring: EffectiveColoringState,
): Uint8ClampedArray {
  const range = displayRange(feature, slice, coloring);
  const rgba = new Uint8ClampedArray(slice.data.length * 4);
  if (!range) return rgba;
  const [min, max] = range;
  if (coloring.scale === 'log' && !(min > 0 && max > min)) return rgba;
  const log = coloring.scale === 'log';
  const lo = log ? Math.log(min) : min;
  const hi = log ? Math.log(max) : max;
  const span = hi - lo;
  for (let index = 0; index < slice.data.length; index += 1) {
    const value = slice.data[index]!;
    const offset = index * 4;
    if (!volumeValueIsVisible(feature, value, slice.validity?.[index]) || (log && value <= 0)) continue;
    const scalar = log ? Math.log(value) : value;
    const [r, g, b] = paletteRgb(coloring.colormap, span > 0 ? (scalar - lo) / span : 0.5);
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function regionalFrame(
  model: ProjectionRenderModel,
  slice: RegisteredProjectionSlice,
  guides: RegionalSliceFrame['guides'],
  presentation: ProjectionPresentation,
): RegionalSliceFrame {
  const semantics = presentation.regional;
  return {
    axis: model.axis,
    index: slice.sliceIndex,
    mapping: model.parcellation,
    svgFragment: slice.svgFragment,
    viewBox: slice.viewBox,
    guides,
    regionColors: regionalPresentationColors(semantics, true),
    selectedRegionIds: semantics.selectedRegionIds,
    highlightedRegionIds: semantics.highlightedRegionId == null
      ? new Set()
      : regionalPresentationIds([semantics.highlightedRegionId]),
  };
}

class RetainedProjectionViewport implements ProjectionViewport {
  private readonly mount: RetainedMount;
  private renderToken = 0;
  private pending: PendingRender | null = null;
  private inFlight = false;
  private activeRenderAbort: AbortController | null = null;
  private volumePrefetchAbort: AbortController | null = null;
  private frame: RegionalSliceFrame | null = null;
  private volumeFeature: VolumeFeaturePayload | null = null;
  private volumeSlice: VolumeSlice | null = null;
  private volumeRegistration: RegisteredProjectionRegistration | null = null;
  private requestedIndex = 0;
  private renderedRequestedIndex: number | null = null;
  private requestedParcellation: ProjectionRenderModel['parcellation'] = 'allen';
  private previousNativeIndex: number | null = null;

  constructor(
    private readonly target: HTMLElement,
    private readonly axis: SliceAxis,
    private readonly source: RegisteredProjectionSource,
    private readonly presentation: () => ProjectionPresentation,
    private readonly interactionSink: () => ProjectionInteractionSink | null,
    private readonly volumeSource: (feature: VolumeFeaturePayload) => VolumeSliceSource,
  ) {
    this.mount = this.createMount();
    this.applyLayerPresentation(this.presentation());
    target.replaceChildren(this.mount.root);
  }

  render(model: ProjectionRenderModel): Promise<void> {
    if (model.axis !== this.axis) return Promise.reject(new Error(`${this.axis} viewport cannot render ${model.axis}`));
    const token = ++this.renderToken;
    this.activeRenderAbort?.abort();
    this.volumePrefetchAbort?.abort();
    this.requestedIndex = model.sliceIndex;
    this.requestedParcellation = model.parcellation;
    this.hideError();
    this.pending?.resolve();
    return new Promise<void>((resolve, reject) => {
      this.pending = { model, token, resolve, reject };
      this.pump();
    });
  }

  updatePresentation(): void {
    const presentation = this.presentation();
    this.applyLayerPresentation(presentation);
    if (this.frame) {
      if (presentation.regional.mapping !== this.requestedParcellation) {
        this.mount.regional.render({
          ...this.frame,
          selectedRegionIds: new Set(),
          highlightedRegionIds: new Set(),
        });
        return;
      }
      const slice: RegisteredProjectionSlice = {
        axis: this.axis,
        sliceIndex: this.frame.index,
        worldCoordinateUm: Number(this.target.dataset.worldCoordinateUm ?? 0),
        svgFragment: this.frame.svgFragment,
        viewBox: this.frame.viewBox,
      };
      this.frame = regionalFrame({
        axis: this.axis,
        sliceIndex: this.requestedIndex,
        cursor: { xUm: 0, yUm: 0, zUm: 0 },
        parcellation: this.requestedParcellation,
        feature: presentation.feature,
      }, slice, this.frame.guides, presentation);
      this.mount.regional.render(this.frame);
    }
    if (this.volumeFeature && this.volumeSlice && presentation.feature === this.volumeFeature) {
      this.paintVolume(this.volumeFeature, this.volumeSlice, presentation.coloring);
    }
  }

  clear(): void {
    this.renderToken += 1;
    this.activeRenderAbort?.abort();
    this.activeRenderAbort = null;
    this.volumePrefetchAbort?.abort();
    this.volumePrefetchAbort = null;
    this.pending?.resolve();
    this.pending = null;
    this.frame = null;
    this.volumeFeature = null;
    this.volumeSlice = null;
    this.volumeRegistration = null;
    this.previousNativeIndex = null;
    this.renderedRequestedIndex = null;
    this.mount.regional.clear();
    this.mount.volume.dispose();
    this.mount.root.dataset.mode = 'empty';
    delete this.target.dataset.sliceAsset;
    delete this.target.dataset.assetIndex;
    delete this.target.dataset.worldCoordinateUm;
    delete this.target.dataset.volumeIndex;
    delete this.target.dataset.volumeFeature;
  }

  showError(error: unknown): void {
    this.mount.error.textContent = error instanceof Error ? error.message : 'Projection could not be rendered';
    this.mount.error.hidden = false;
  }

  destroy(): void {
    this.clear();
    this.mount.regional.dispose();
    this.target.replaceChildren();
  }

  private pump(): void {
    if (this.inFlight || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.inFlight = true;
    const abort = new AbortController();
    this.activeRenderAbort = abort;
    void this.renderNow(request.model, request.token, abort.signal)
      .then(request.resolve, request.reject)
      .finally(() => {
        if (this.activeRenderAbort === abort) this.activeRenderAbort = null;
        this.inFlight = false;
        this.pump();
      });
  }

  private async renderNow(model: ProjectionRenderModel, token: number, signal: AbortSignal): Promise<void> {
    if (model.feature?.representation === 'volume') await this.renderVolume(model, token, signal);
    else await this.renderRegional(model, token, signal);
  }

  private async renderRegional(model: ProjectionRenderModel, token: number, signal: AbortSignal): Promise<void> {
    const world = cursorStateToWorld(model.cursor);
    const sameGeometry = this.frame?.axis === model.axis
      && this.renderedRequestedIndex === model.sliceIndex
      && this.frame.mapping === model.parcellation;
    if (sameGeometry && this.frame) {
      const guides = await this.source.guidesForWorld(model.axis, world);
      if (this.renderToken !== token) return;
      this.frame = { ...this.frame, guides };
      this.mount.regional.updateGuides(this.frame);
      this.volumeFeature = null;
      this.volumeSlice = null;
      this.volumeRegistration = null;
      this.mount.root.dataset.mode = 'regional';
      this.target.dataset.sliceAsset = 'projection-pack-v1';
      delete this.target.dataset.volumeIndex;
      delete this.target.dataset.volumeFeature;
      return;
    }
    const [slice, guides] = await Promise.all([
      this.source.loadSlice(model.axis, model.sliceIndex, signal),
      this.source.guidesForWorld(model.axis, world),
    ]);
    if (this.renderToken !== token) return;
    const previous = this.previousNativeIndex;
    this.frame = regionalFrame(model, slice, guides, this.presentation());
    this.mount.regional.render(this.frame);
    this.volumeFeature = null;
    this.volumeSlice = null;
    this.volumeRegistration = null;
    this.mount.root.dataset.mode = 'regional';
    this.target.dataset.sliceAsset = 'projection-pack-v1';
    this.target.dataset.assetIndex = String(slice.sliceIndex);
    this.target.dataset.worldCoordinateUm = String(slice.worldCoordinateUm);
    delete this.target.dataset.volumeIndex;
    delete this.target.dataset.volumeFeature;
    this.previousNativeIndex = model.sliceIndex;
    this.renderedRequestedIndex = model.sliceIndex;
    if (previous !== null && previous !== model.sliceIndex) {
      const direction = model.sliceIndex > previous ? 1 : -1;
      void this.source.prefetchNeighbor(model.axis, model.sliceIndex, direction).catch(() => undefined);
    }
  }

  private async renderVolume(model: ProjectionRenderModel, token: number, signal: AbortSignal): Promise<void> {
    const feature = model.feature;
    if (!feature || feature.representation !== 'volume') throw new Error('Volume viewport requires a volume feature');
    const world = cursorStateToWorld(model.cursor);
    const [registration, anatomySlice, guides] = await Promise.all([
      this.source.getRegistration(model.axis),
      this.source.loadSlice(model.axis, model.sliceIndex, signal),
      this.source.guidesForWorld(model.axis, world),
    ]);
    if (this.renderToken !== token) return;
    this.frame = regionalFrame(model, anatomySlice, guides, this.presentation());
    this.mount.regional.render(this.frame);
    this.volumeFeature = null;
    this.volumeSlice = null;
    this.volumeRegistration = null;
    this.mount.root.dataset.mode = 'regional';
    this.target.dataset.sliceAsset = 'projection-pack-v1';
    this.target.dataset.assetIndex = String(anatomySlice.sliceIndex);
    this.target.dataset.worldCoordinateUm = String(anatomySlice.worldCoordinateUm);
    this.renderedRequestedIndex = model.sliceIndex;
    assertCompatibleReferenceSpace(registration, feature);
    const location = locateVolumePlane(feature, model.axis, world);
    if (location.status === 'out-of-grid') {
      throw new RangeError(`${model.axis} cursor is outside the declared volume extent`);
    }
    const volumeIndex = location.index;
    const loader = this.volumeSource(feature);
    const slice = await loader.loadSlice(model.axis, volumeIndex, signal);
    if (this.renderToken !== token) return;
    this.placeVolume(registeredVolumeCanvasPlacement(feature, slice, registration));
    this.paintVolume(feature, slice, this.presentation().coloring);
    this.volumeFeature = feature;
    this.volumeSlice = slice;
    this.volumeRegistration = registration;
    this.mount.root.dataset.mode = 'composite';
    this.target.dataset.sliceAsset = 'schema-volume-v1';
    this.target.dataset.volumeIndex = String(volumeIndex);
    this.target.dataset.volumeFeature = feature.featureId;
    const prefetchAbort = new AbortController();
    this.volumePrefetchAbort = prefetchAbort;
    void loader.prefetchAdjacent?.(model.axis, volumeIndex, 1, prefetchAbort.signal)?.catch(() => undefined);
  }

  private placeVolume(placement: RegisteredVolumeCanvasPlacement): void {
    const { scalar, scalarHost, canvas } = this.mount;
    scalar.setAttribute(
      'viewBox',
      `${placement.viewBox.x} ${placement.viewBox.y} ${placement.viewBox.width} ${placement.viewBox.height}`,
    );
    scalarHost.setAttribute('x', String(placement.x));
    scalarHost.setAttribute('y', String(placement.y));
    scalarHost.setAttribute('width', String(placement.width));
    scalarHost.setAttribute('height', String(placement.height));
    canvas.dataset.flipX = String(placement.flipX);
    canvas.dataset.flipY = String(placement.flipY);
  }

  private paintVolume(
    feature: VolumeFeaturePayload,
    slice: VolumeSlice,
    coloring: EffectiveColoringState,
  ): void {
    this.mount.volume.render({
      axis: slice.axis,
      index: slice.index,
      width: slice.width,
      height: slice.height,
      rgba: rgbaForSlice(feature, slice, coloring),
    });
  }

  private applyLayerPresentation(presentation: ProjectionPresentation): void {
    const opacity = Number.isFinite(presentation.volumeOpacity)
      ? Math.min(1, Math.max(0, presentation.volumeOpacity))
      : 1;
    this.mount.scalar.style.opacity = String(opacity);
    this.mount.root.dataset.anatomyOutlines = String(presentation.anatomyOutlines ?? true);
  }

  private onRegionPointer(event: SliceRegionPointerEvent): void {
    const sink = this.interactionSink();
    if (!sink) return;
    if (event.type === 'leave') {
      sink.hover(null);
      sink.inspect(null);
      return;
    }
    const hit: RegionHit = {
      regionId: String(-Math.abs(event.regionId)),
      projectionId: this.axis,
      sliceIndex: this.requestedIndex,
    };
    if (event.type === 'select') sink.toggleSelection(hit);
    else if (event.type === 'hover') sink.hover(hit);
    else if (this.mount.root.dataset.mode !== 'composite') sink.inspect({
      ...hit,
      physicalRegionId: event.regionId,
      parcellation: this.requestedParcellation,
      clientX: event.originalEvent.clientX,
      clientY: event.originalEvent.clientY,
    });
  }

  private onVolumePointer(event: PointerEvent): void {
    if (this.mount.root.dataset.mode !== 'composite') return;
    const feature = this.volumeFeature;
    const slice = this.volumeSlice;
    const registration = this.volumeRegistration;
    const sink = this.interactionSink();
    if (!feature || !slice || !registration || !sink) return;
    const screen = this.mount.scalar.getScreenCTM();
    if (!screen) return;
    try {
      const plane = new DOMPoint(event.clientX, event.clientY).matrixTransform(screen.inverse());
      const inspection = inspectVolumePlanePoint(feature, slice, registration, { u: plane.x, v: plane.y });
      const path = event.target instanceof Element ? event.target.closest<SVGPathElement>('path') : null;
      const physicalRegionId = path ? regionIdFromPath('allen', path) : null;
      const mappedRegionId = path ? regionIdFromPath(this.requestedParcellation, path) : null;
      sink.inspect({
        kind: 'volume',
        axis: this.axis,
        projectionId: this.axis,
        sliceIndex: this.requestedIndex,
        parcellation: this.requestedParcellation,
        clientX: event.clientX,
        clientY: event.clientY,
        ...inspection,
        ...(mappedRegionId == null ? {} : { regionId: String(-Math.abs(mappedRegionId)) }),
        ...(physicalRegionId == null ? {} : { physicalRegionId }),
      });
    } catch (error) {
      sink.reportError(error);
      sink.inspect(null);
    }
  }

  private createMount(): RetainedMount {
    const root = document.createElement('div');
    root.className = 'projection-viewport';
    root.dataset.mode = 'empty';
    root.addEventListener('pointermove', (event) => this.onVolumePointer(event));
    root.addEventListener('pointerleave', () => this.interactionSink()?.inspect(null));
    const scalar = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    scalar.classList.add('projection-viewport__scalar');
    scalar.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    scalar.setAttribute('aria-hidden', 'true');
    const scalarHost = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    scalarHost.classList.add('projection-viewport__scalar-host');
    const canvas = document.createElement('canvas');
    canvas.className = 'view-frame__volume-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Ephys atlas volume slice');
    scalarHost.append(canvas);
    scalar.append(scalarHost);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('projection-viewport__regional', 'view-frame__brain-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Registered Allen atlas anatomical slice');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const figureLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    figureLayer.classList.add('view-frame__slice-figure');
    const guideLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    guideLayer.classList.add('view-frame__guide-layer');
    guideLayer.setAttribute('aria-hidden', 'true');
    svg.append(figureLayer, guideLayer);
    const error = document.createElement('div');
    error.className = 'projection-viewport__error';
    error.setAttribute('role', 'status');
    error.hidden = true;
    root.append(scalar, svg, error);
    return {
      root,
      scalar,
      scalarHost,
      canvas,
      volume: new CanvasVolumeSliceRenderer(canvas),
      svg,
      regional: new SvgSliceRenderer(
        { svg, figureLayer, guideLayer },
        {
          onRegionPointer: (event) => this.onRegionPointer(event),
          onSliceStep: (axis, delta) => this.interactionSink()?.stepSlice(axis, delta),
        },
      ),
      error,
    };
  }

  private hideError(): void {
    this.mount.error.hidden = true;
    this.mount.error.textContent = '';
  }
}

export interface RetainedProjectionViewportFactoryOptions {
  readonly projectionPackUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly maxDecodedBytes?: number;
  readonly maxVolumeDecodedBytes?: number;
  /** Deterministic test seam; production uses projectionPackUrl. */
  readonly source?: RegisteredProjectionSource;
}

/** Reserve decoded validity bytes before assigning the shared volume cache budget. */
export function volumeScalarCacheBudget(
  feature: VolumeFeaturePayload,
  maxDecodedBytes: number,
): number {
  if (!Number.isFinite(maxDecodedBytes) || maxDecodedBytes <= 0) {
    throw new RangeError('maxDecodedBytes must be positive');
  }
  const validityBytes = feature.descriptor.validity.kind === 'mask'
    ? feature.descriptor.validity.mask.resource.codec.decodedBytes
    : 0;
  const cacheBytes = maxDecodedBytes - validityBytes;
  if (cacheBytes <= 0) throw new Error('volume validity mask exceeds the decoded-memory budget');
  return cacheBytes;
}

export class RetainedProjectionViewportFactory implements ProjectionViewportFactory {
  private readonly source: RegisteredProjectionSource;
  private readonly viewports = new Set<RetainedProjectionViewport>();
  private readonly staticViewports = new Set<RetainedStaticProjectionViewport>();
  private readonly maxVolumeDecodedBytes: number;
  private activeVolumeFeature: VolumeFeaturePayload | null = null;
  private activeVolumeSource: VolumeSliceSource | null = null;
  private presentation: ProjectionPresentation = DEFAULT_PRESENTATION;
  private sink: ProjectionInteractionSink | null = null;

  constructor(options: RetainedProjectionViewportFactoryOptions) {
    this.maxVolumeDecodedBytes = options.maxVolumeDecodedBytes ?? 96 * 1024 * 1024;
    if (!Number.isFinite(this.maxVolumeDecodedBytes) || this.maxVolumeDecodedBytes <= 0) {
      throw new RangeError('maxVolumeDecodedBytes must be positive');
    }
    if (options.source) this.source = options.source;
    else {
      if (!options.projectionPackUrl) throw new Error('projectionPackUrl is required without a test source');
      this.source = new ProjectionPackSource({
        manifestUrl: options.projectionPackUrl,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.maxDecodedBytes ? { maxDecodedBytes: options.maxDecodedBytes } : {}),
      });
    }
  }

  create(target: HTMLElement, axis: SliceAxis): ProjectionViewport {
    const viewport = new RetainedProjectionViewport(
      target,
      axis,
      this.source,
      () => this.presentation,
      () => this.sink,
      (feature) => this.volumeSource(feature),
    );
    this.viewports.add(viewport);
    return viewport;
  }

  createStatic(target: HTMLElement, projectionId: import('../domain/types.js').StaticProjectionId): StaticProjectionViewport {
    const viewport = new RetainedStaticProjectionViewport(
      target,
      projectionId,
      this.source,
      () => this.presentation,
      () => this.sink,
    );
    this.staticViewports.add(viewport);
    return viewport;
  }

  updatePresentation(presentation: ProjectionPresentation): void {
    this.presentation = presentation;
    for (const viewport of this.viewports) viewport.updatePresentation();
    for (const viewport of this.staticViewports) viewport.updatePresentation();
  }

  setInteractionSink(sink: ProjectionInteractionSink): void {
    this.sink = sink;
  }

  getDisplaySliceInventories() {
    return this.source.getDisplaySliceInventories();
  }

  destroy(): void {
    for (const viewport of this.viewports) viewport.destroy();
    this.viewports.clear();
    for (const viewport of this.staticViewports) viewport.destroy();
    this.staticViewports.clear();
    this.activeVolumeSource?.dispose?.();
    this.activeVolumeSource = null;
    this.activeVolumeFeature = null;
    this.source.dispose();
  }

  private volumeSource(feature: VolumeFeaturePayload): VolumeSliceSource {
    if (this.activeVolumeFeature === feature && this.activeVolumeSource) return this.activeVolumeSource;
    this.activeVolumeSource?.dispose?.();
    const cacheBytes = volumeScalarCacheBudget(feature, this.maxVolumeDecodedBytes);
    const scalarSource: VolumeSliceSource = feature.descriptor.layout === 'chunks3d'
      ? new VolumeSliceLoader(new SchemaChunks3dVolumeSource(feature), { cacheBytes })
      : new SchemaSlicePackVolumeSource(feature, cacheBytes);
    const source = feature.descriptor.validity.kind === 'mask'
      ? new VolumeValiditySliceSource(feature, scalarSource)
      : scalarSource;
    this.activeVolumeFeature = feature;
    this.activeVolumeSource = source;
    return source;
  }
}
