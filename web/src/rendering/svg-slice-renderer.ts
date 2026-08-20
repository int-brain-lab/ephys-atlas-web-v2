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

const WHEEL_PIXELS_PER_SLICE = 50;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;

export class SvgSliceRenderer implements RegionalSliceRenderer {
  private currentAxis: SliceAxis | null = null;
  private currentIndex = -1;
  private currentFragment = '';
  private mapping: MappingName = 'beryl';
  private indexedMapping: MappingName | null = null;
  private hoveredRegionId: number | null = null;
  private readonly pathIndex = new Map<number, SVGPathElement[]>();
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

    if (this.currentIndex !== frame.index || this.currentFragment !== frame.svgFragment || this.indexedMapping !== frame.mapping) {
      this.mount.figureLayer.innerHTML = frame.svgFragment;
      this.currentIndex = frame.index;
      this.currentFragment = frame.svgFragment;
      this.indexedMapping = frame.mapping;
      this.rebuildPathIndex();
    }

    this.applyRegionState(frame);
    this.drawGuides(frame);
  }

  dispose(): void {
    this.abortController.abort();
    if (this.wheelFrame !== null) cancelAnimationFrame(this.wheelFrame);
    this.pathIndex.clear();
    this.mount.figureLayer.replaceChildren();
    this.mount.guideLayer.replaceChildren();
  }

  updateGuides(frame: RegionalSliceFrame): void {
    this.currentAxis = frame.axis;
    this.drawGuides(frame);
  }

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const path of this.mount.figureLayer.querySelectorAll<SVGPathElement>('path')) {
      const regionId = regionIdFromPath(this.mapping, path);
      if (regionId == null) continue;
      const paths = this.pathIndex.get(regionId) ?? [];
      paths.push(path);
      this.pathIndex.set(regionId, paths);
    }
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
      const slices = Math.trunc(this.wheelPixels / WHEEL_PIXELS_PER_SLICE);
      if (slices === 0) return;
      this.wheelPixels -= slices * WHEEL_PIXELS_PER_SLICE;
      if (this.currentAxis != null) this.options.onSliceStep?.(this.currentAxis, slices);
    });
  };
}
