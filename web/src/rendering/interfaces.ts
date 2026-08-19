import type { AppState, ColoringState, ViewState } from '../domain/types.js';
import type { CursorState, ParcellationId, SliceAxis, SliceState } from '../domain/types.js';
import type { FeaturePayload } from '../data/contracts.js';

export interface SliceRenderModel {
  axis: SliceAxis;
  sliceIndex: number;
  slices: SliceState;
  cursor: CursorState;
  parcellation: ParcellationId;
  selectedRegionIds: readonly string[];
  feature: FeaturePayload | null;
  coloring: ColoringState;
}

export interface SliceRenderer {
  render(target: HTMLElement, model: SliceRenderModel): void | Promise<void>;
  clear(target: HTMLElement): void;
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
  moveCursor(cursor: CursorState): void;
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
