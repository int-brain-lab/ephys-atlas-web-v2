import type { RepresentationDisplay } from '../data/contracts.js';
import type { ColormapSelection } from '../domain/types.js';
import { COLORMAPS, colormapDefinition, isColormapId, type ColormapId } from './colormap-palettes.js';

export interface ResolvedPresentationColormap {
  readonly selection: ColormapSelection;
  readonly automaticColormap: ColormapId;
  readonly effectiveColormap: ColormapId;
  readonly availableColormaps: readonly ColormapId[];
  readonly divergingCenter?: number;
}

/** Resolve release-owned palette preferences without making unregistered values renderable. */
export function resolvePresentationColormap(
  selection: ColormapSelection,
  display: RepresentationDisplay | undefined,
): ResolvedPresentationColormap {
  const divergingCenter = Number.isFinite(display?.divergingCenter) ? display?.divergingCenter : undefined;
  const availableColormaps = COLORMAPS
    .filter(({ kind }) => kind !== 'diverging' || divergingCenter !== undefined)
    .map(({ id }) => id);
  const preferred = display?.colormap && isColormapId(display.colormap)
    ? display.colormap
    : 'viridis';
  const automaticColormap = availableColormaps.includes(preferred) ? preferred : 'viridis';
  const requested = selection === 'auto' ? automaticColormap : selection;
  const effectiveColormap = availableColormaps.includes(requested) ? requested : automaticColormap;
  return {
    selection,
    automaticColormap,
    effectiveColormap,
    availableColormaps,
    ...(colormapDefinition(effectiveColormap)?.kind === 'diverging' && divergingCenter !== undefined
      ? { divergingCenter }
      : {}),
  };
}
