import type { FeaturePayload, RegionMetadata } from '../data/contracts.js';
import type {
  CursorState,
  EffectiveColoringState,
  ParcellationId,
  SliceAxis,
} from '../domain/types.js';
import type { DisplaySliceInventory } from './display-slice-inventory.js';

export interface ProjectionRenderModel {
  axis: SliceAxis;
  sliceIndex: number;
  cursor: CursorState;
  parcellation: ParcellationId;
  feature: FeaturePayload | null;
}

export interface ProjectionPresentation {
  feature: FeaturePayload | null;
  regions?: readonly RegionMetadata[];
  anatomyRegions?: readonly RegionMetadata[];
  coloring: EffectiveColoringState;
  selectedRegionIds: readonly string[];
  hoveredRegionId: string | null;
}

export interface RegionHit {
  regionId: string;
  axis: SliceAxis;
  sliceIndex: number;
}

export interface RegionInspection extends RegionHit {
  physicalRegionId: number;
  parcellation: ParcellationId;
  clientX: number;
  clientY: number;
}

export interface ProjectionInteractionSink {
  hover(hit: RegionHit | null): void;
  inspect(inspection: RegionInspection | null): void;
  toggleSelection(hit: RegionHit): void;
  stepSlice(axis: SliceAxis, delta: number): void;
  moveCursor(cursor: CursorState): void;
  reportError(error: unknown): void;
}

/** One retained DOM viewport owned by one projection frame. */
export interface ProjectionViewport {
  render(model: ProjectionRenderModel): void | Promise<void>;
  clear(): void;
  showError(error: unknown): void;
  destroy(): void;
}

/** Shared source/presentation boundary that creates retained projection views. */
export interface ProjectionViewportFactory {
  create(target: HTMLElement, axis: SliceAxis): ProjectionViewport;
  updatePresentation(presentation: ProjectionPresentation): void;
  setInteractionSink(sink: ProjectionInteractionSink): void;
  getDisplaySliceInventories(): Promise<Readonly<Record<SliceAxis, DisplaySliceInventory>> | null>;
  destroy(): void;
}

export class NullProjectionViewportFactory implements ProjectionViewportFactory {
  create(target: HTMLElement): ProjectionViewport {
    const message = document.createElement('p');
    message.className = 'renderer-placeholder';
    message.textContent = 'Projection viewport not connected';
    target.replaceChildren(message);
    return {
      render: () => undefined,
      clear: () => undefined,
      showError: () => undefined,
      destroy: () => target.replaceChildren(),
    };
  }

  updatePresentation(): void {}

  setInteractionSink(): void {}

  getDisplaySliceInventories(): Promise<null> {
    return Promise.resolve(null);
  }

  destroy(): void {}
}
