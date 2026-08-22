import type { FeaturePayload } from '../data/contracts.js';
import type {
  CursorState,
  EffectiveColoringState,
  ParcellationId,
  ProjectionId,
  SliceAxis,
  StaticProjectionId,
} from '../domain/types.js';
import type { DisplaySliceInventory } from './display-slice-inventory.js';
import type { VolumeValidityStatus } from './volume-inspection.js';
import type { RegionalPresentation } from '../application/regional-presentation.js';

export interface ProjectionRenderModel {
  axis: SliceAxis;
  sliceIndex: number;
  cursor: CursorState;
  parcellation: ParcellationId;
  feature: FeaturePayload | null;
}

export interface ProjectionPresentation {
  regional: RegionalPresentation;
  feature: FeaturePayload | null;
  coloring: EffectiveColoringState;
  volumeOpacity: number;
  anatomyOutlines: boolean;
}

export interface RegionHit {
  regionId: string;
  projectionId: ProjectionId;
  sliceIndex: number | null;
}

export interface RegionInspection extends RegionHit {
  physicalRegionId: number;
  parcellation: ParcellationId;
  clientX: number;
  clientY: number;
}

export interface VolumeInspection {
  readonly kind: 'volume';
  readonly axis: SliceAxis;
  readonly projectionId: SliceAxis;
  readonly sliceIndex: number;
  readonly parcellation: ParcellationId;
  readonly clientX: number;
  readonly clientY: number;
  readonly status: VolumeValidityStatus;
  readonly world: Readonly<{ ml: number; ap: number; dv: number }>;
  readonly fractionalIndex: readonly [number, number, number];
  readonly voxelIndex?: readonly [number, number, number];
  readonly value?: number;
  readonly regionId?: string;
  readonly physicalRegionId?: number;
}

export type ProjectionInspection = RegionInspection | VolumeInspection;

export interface StaticProjectionRenderModel {
  readonly projectionId: StaticProjectionId;
  readonly parcellation: ParcellationId;
  readonly feature: FeaturePayload | null;
}

export interface ProjectionInteractionSink {
  hover(hit: RegionHit | null): void;
  inspect(inspection: ProjectionInspection | null): void;
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

export interface StaticProjectionViewport {
  render(model: StaticProjectionRenderModel): void | Promise<void>;
  clear(): void;
  showError(error: unknown): void;
  destroy(): void;
}

/** Shared source/presentation boundary that creates retained projection views. */
export interface ProjectionViewportFactory {
  create(target: HTMLElement, axis: SliceAxis): ProjectionViewport;
  createStatic(target: HTMLElement, projectionId: StaticProjectionId): StaticProjectionViewport;
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

  createStatic(target: HTMLElement): StaticProjectionViewport {
    const message = document.createElement('p');
    message.className = 'renderer-placeholder';
    message.textContent = 'Static projection viewport not connected';
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
