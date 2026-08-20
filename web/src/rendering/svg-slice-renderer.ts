import { regionIdFromPath } from './region-id.js';
import type {
  MappingName,
  RegionalSliceFrame,
  RegionalSliceRenderer,
  SliceAxis,
  SliceRegionPointerEvent,
} from './types.js';

export interface SvgSliceRendererMount {
  svg: SVGSVGElement;
  figureLayer: SVGGElement;
  guideLayer: SVGGElement;
}

export interface SvgSliceRendererOptions {
  onRegionPointer?: (event: SliceRegionPointerEvent) => void;
  onSliceStep?: (axis: SliceAxis, delta: number) => void;
}

const WHEEL_PIXELS_PER_NAVIGATION_STEP = 100;
const WHEEL_SLICE_STRIDE = 4;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;
const MAX_PREPARED_SLICE_LAYERS = 8;

interface PreparedSliceLayer {
  layer: SVGGElement;
  pathIndex: Map<number, SVGPathElement[]>;
  svgFragment: string;
}

export class SvgSliceRenderer implements RegionalSliceRenderer {
  private currentAxis: SliceAxis | null = null;
  private mapping: MappingName = 'beryl';
  private hoveredRegionId: number | null = null;
  private pathIndex: ReadonlyMap<number, readonly SVGPathElement[]> = new Map();
  private readonly preparedLayers = new Map<string, PreparedSliceLayer>();
  private activeLayerKey: string | null = null;
  private readonly abortController = new AbortController();
  private wheelPixels = 0;
  private wheelFrame: number | null = null;

  constructor(
    private readonly mount: SvgSliceRendererMount,
    private readonly options: SvgSliceRendererOptions = {},
  ) {
    const signal = this.abortController.signal;
    mount.figureLayer.addEventListener('pointermove', this.onPointerMove, { signal });
    mount.figureLayer.addEventListener('pointerleave', this.onPointerLeave, { signal });
    mount.figureLayer.addEventListener('pointerup', this.onClick, { signal });
    mount.svg.addEventListener('wheel', this.onWheel, { signal, passive: false });
  }

  render(frame: RegionalSliceFrame): void {
    this.currentAxis = frame.axis;
    this.mapping = frame.mapping;
    this.mount.svg.setAttribute(
      'viewBox',
      `${frame.viewBox.x} ${frame.viewBox.y} ${frame.viewBox.width} ${frame.viewBox.height}`,
    );

    this.activatePreparedLayer(frame);

    this.applyRegionState(frame);
    this.drawGuides(frame);
  }

  dispose(): void {
    this.abortController.abort();
    if (this.wheelFrame !== null) cancelAnimationFrame(this.wheelFrame);
    this.pathIndex = new Map();
    this.preparedLayers.clear();
    this.activeLayerKey = null;
    this.mount.figureLayer.replaceChildren();
    this.mount.guideLayer.replaceChildren();
  }

  updateGuides(frame: RegionalSliceFrame): void {
    this.currentAxis = frame.axis;
    this.drawGuides(frame);
  }

  private activatePreparedLayer(frame: RegionalSliceFrame): void {
    const key = this.preparedLayerKey(frame);
    const cached = this.preparedLayers.get(key);
    const prepared = cached?.svgFragment === frame.svgFragment
      ? cached
      : this.prepareLayer(frame, key);
    this.touchPreparedLayer(key, prepared);
    if (this.activeLayerKey !== key || this.mount.figureLayer.firstChild !== prepared.layer) {
      this.mount.figureLayer.replaceChildren(prepared.layer);
      this.activeLayerKey = key;
    }
    this.pathIndex = prepared.pathIndex;
  }

  private prepareLayer(frame: RegionalSliceFrame, key: string): PreparedSliceLayer {
    this.evictPreparedLayerIfNeeded();
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.innerHTML = frame.svgFragment;
    const pathIndex = new Map<number, SVGPathElement[]>();
    for (const path of layer.querySelectorAll<SVGPathElement>('path')) {
      const regionId = regionIdFromPath(frame.mapping, path);
      if (regionId == null) continue;
      const paths = pathIndex.get(regionId) ?? [];
      paths.push(path);
      pathIndex.set(regionId, paths);
    }
    const prepared = { layer, pathIndex, svgFragment: frame.svgFragment };
    this.preparedLayers.set(key, prepared);
    return prepared;
  }

  private touchPreparedLayer(key: string, prepared: PreparedSliceLayer): void {
    this.preparedLayers.delete(key);
    this.preparedLayers.set(key, prepared);
  }

  private evictPreparedLayerIfNeeded(): void {
    if (this.preparedLayers.size < MAX_PREPARED_SLICE_LAYERS) return;
    for (const key of this.preparedLayers.keys()) {
      if (key === this.activeLayerKey) continue;
      this.preparedLayers.delete(key);
      return;
    }
  }

  private preparedLayerKey(frame: RegionalSliceFrame): string {
    return `${frame.axis}\u0000${frame.mapping}\u0000${frame.index}`;
  }

  private applyRegionState(frame: RegionalSliceFrame): void {
    for (const [regionId, paths] of this.pathIndex) {
      const fill = frame.regionColors?.get(regionId);
      const selected = frame.selectedRegionIds?.has(regionId) ?? false;
      const highlighted = frame.highlightedRegionIds?.has(regionId) ?? frame.highlightedRegionId === regionId;
      for (const path of paths) {
        if (fill) path.style.fill = fill;
        else path.style.removeProperty('fill');
        path.classList.toggle('is-selected', selected);
        path.classList.toggle('is-highlighted', highlighted);
      }
    }
  }

  private drawGuides(frame: RegionalSliceFrame): void {
    const { x, y, width, height } = frame.viewBox;
    this.mount.guideLayer.replaceChildren();
    for (const guide of frame.guides) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.dataset.sourceAxis = guide.sourceAxis;
      line.classList.add('slice-guide');
      if (guide.dimension === 'x') {
        line.setAttribute('x1', String(guide.position));
        line.setAttribute('x2', String(guide.position));
        line.setAttribute('y1', String(y));
        line.setAttribute('y2', String(y + height));
      } else {
        line.setAttribute('x1', String(x));
        line.setAttribute('x2', String(x + width));
        line.setAttribute('y1', String(guide.position));
        line.setAttribute('y2', String(guide.position));
      }
      this.mount.guideLayer.append(line);
    }
  }

  private eventRegionId(event: Event): number | null {
    const target = event.target;
    if (!(target instanceof SVGPathElement)) return null;
    return regionIdFromPath(this.mapping, target);
  }

  private emitRegion(type: SliceRegionPointerEvent['type'], regionId: number, event: PointerEvent): void {
    if (this.currentAxis == null) return;
    this.options.onRegionPointer?.({ axis: this.currentAxis, regionId, type, originalEvent: event });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const regionId = this.eventRegionId(event);
    if (regionId === this.hoveredRegionId) return;
    if (this.hoveredRegionId != null) this.emitRegion('leave', this.hoveredRegionId, event);
    this.hoveredRegionId = regionId;
    if (regionId != null) this.emitRegion('hover', regionId, event);
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (this.hoveredRegionId != null) this.emitRegion('leave', this.hoveredRegionId, event);
    this.hoveredRegionId = null;
  };

  private readonly onClick = (event: PointerEvent): void => {
    const regionId = this.eventRegionId(event);
    if (regionId != null) this.emitRegion('select', regionId, event);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.currentAxis == null || event.deltaY === 0) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE_HEIGHT_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? WHEEL_PAGE_HEIGHT_PX
        : 1;
    this.wheelPixels -= event.deltaY * unit;
    if (this.wheelFrame !== null) return;
    this.wheelFrame = requestAnimationFrame(() => {
      this.wheelFrame = null;
      const steps = Math.trunc(this.wheelPixels / WHEEL_PIXELS_PER_NAVIGATION_STEP);
      if (steps === 0) return;
      this.wheelPixels -= steps * WHEEL_PIXELS_PER_NAVIGATION_STEP;
      if (this.currentAxis != null) this.options.onSliceStep?.(this.currentAxis, steps * WHEEL_SLICE_STRIDE);
    });
  };
}
