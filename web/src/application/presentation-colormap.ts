import type { RepresentationDisplay } from '../data/contracts.js';
import type { ColormapSelection } from '../domain/types.js';
import { isColormapId, type ColormapId } from './colormap-palettes.js';

export interface ResolvedPresentationColormap {
  readonly selection: ColormapSelection;
  readonly automaticColormap: ColormapId;
  readonly effectiveColormap: ColormapId;
}

/** Resolve release-owned palette preferences without making unregistered values renderable. */
export function resolvePresentationColormap(
  selection: ColormapSelection,
  display: RepresentationDisplay | undefined,
): ResolvedPresentationColormap {
  const automaticColormap = display?.colormap && isColormapId(display.colormap)
    ? display.colormap
    : 'viridis';
  return {
    selection,
    automaticColormap,
    effectiveColormap: selection === 'auto' ? automaticColormap : selection,
  };
}
