import type { DatasetManifest, FeatureDescriptor } from '../data/contracts.js';

export interface FeatureSelection {
  readonly datasetId: string;
  readonly feature: FeatureDescriptor;
  readonly variant: 'raw' | 'denoised' | null;
}

const EPHYS_DATASETS = new Set(['ephys_atlas_channels', 'ephys_atlas_volumes']);

export function supportsFeatureContinuity(sourceDatasetId: string, destinationDatasetId: string): boolean {
  return EPHYS_DATASETS.has(sourceDatasetId) && EPHYS_DATASETS.has(destinationDatasetId);
}

export function featureSelection(manifest: DatasetManifest, feature: FeatureDescriptor): FeatureSelection {
  let variant: FeatureSelection['variant'] = null;
  if (manifest.dataset.id === 'ephys_atlas_channels') {
    const mode = manifest.provenance.recipe.feature_mode;
    if (mode === 'raw' || mode === 'denoised') variant = mode;
    else if (mode === 'both') {
      for (const candidate of ['raw', 'denoised'] as const) {
        const base = feature.id.endsWith(`.${candidate}`)
          ? feature.id.slice(0, -(`.${candidate}`.length)) : null;
        if (base === feature.valueSemantics.quantity || base === feature.valueSemantics.sourceColumn) {
          variant = candidate;
        }
      }
    }
  }
  return { datasetId: manifest.dataset.id, feature, variant };
}

/** Quantity correspondence is navigation convenience, not value equivalence. */
export function matchFeature(
  source: FeatureSelection,
  destination: DatasetManifest,
  remembered?: FeatureSelection,
): FeatureDescriptor | null {
  if (!supportsFeatureContinuity(source.datasetId, destination.dataset.id)) return null;
  // Scientific metadata supplies identity; labels and spelling similarity do not.
  const candidates = destination.features.filter((feature) =>
    feature.valueSemantics.quantity === source.feature.valueSemantics.quantity);
  const exact = candidates.find((feature) => feature.id === source.feature.id);
  if (exact) return exact;
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return null;

  const selections = candidates.map((feature) => featureSelection(destination, feature));
  // Preserve an explicit variant, then the destination's remembered selection.
  if (source.variant) {
    const sameVariant = selections.filter(({ variant }) => variant === source.variant);
    if (sameVariant.length === 1) return sameVariant[0]!.feature;
  }
  const previous = candidates.find((feature) => feature.id === remembered?.feature.id);
  if (previous) return previous;
  // W32 exposes both variants; the reviewed channel browsing preference is denoised.
  const denoised = selections.filter(({ variant }) => variant === 'denoised');
  return denoised.length === 1 ? denoised[0]!.feature : null;
}
