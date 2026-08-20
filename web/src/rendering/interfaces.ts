import type { ColoringState, CursorState, ParcellationId, SliceAxis, SliceState } from '../domain/types.js';
import type { FeaturePayload } from '../data/contracts.js';

export interface SliceRenderModel {
  axis: SliceAxis;
  sliceIndex: number;
  slices: SliceState;
  cursor: CursorState;
  parcellation: ParcellationId;
  selectedRegionIds: readonly string[];
  feature: FeaturePayload | null;
}

export interface RendererPresentation {
  feature: FeaturePayload | null;
  coloring: ColoringState;
  selectedRegionIds: readonly string[];
  hoveredRegionId: string | null;
}

export interface SliceRenderer {
  render(target: HTMLElement, model: SliceRenderModel): void | Promise<void>;
  clear(target: HTMLElement): void;
  updatePresentation?(presentation: RendererPresentation): void;
  setInteractionSink?(sink: RendererInteractionSink): void;
  destroy?(): void;
}

export interface RegionHit {
  regionId: string;
  axis: SliceAxis;
  sliceIndex: number;
}

export interface RendererInteractionSink {
  hover(hit: RegionHit | null): void;
  toggleSelection(hit: RegionHit): void;
  stepSlice(axis: SliceAxis, delta: number): void;
  moveCursor(cursor: CursorState): void;
  reportError(error: unknown): void;
}

export class NullSliceRenderer implements SliceRenderer {
  render(target: HTMLElement): void {
    target.replaceChildren();
    const message = document.createElement('p');
    message.className = 'renderer-placeholder';
    message.textContent = 'Slice renderer not connected';
    target.append(message);
  }

  clear(target: HTMLElement): void {
    target.replaceChildren();
  }
}
