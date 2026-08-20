import './styles.css';
import { AtlasApp } from './app.js';
import { DEFAULT_VIEW_STATE } from './domain/defaults.js';
import { GeneratedAnatomySliceRenderer } from './rendering/generated-anatomy-renderer.js';
import { GeneratedAnatomySliceSource } from './rendering/generated-anatomy-source.js';
import { HybridSliceRenderer } from './rendering/hybrid-slice-renderer.js';
import { SchemaVolumeSliceRenderer } from './rendering/volume-slice-renderer.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const defaultAnatomyManifestUrl =
  '/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a/manifest.json';
const anatomyManifestUrl = import.meta.env.VITE_ANATOMY_MANIFEST_URL as string | undefined;
const renderer = new HybridSliceRenderer(
  new GeneratedAnatomySliceRenderer(new GeneratedAnatomySliceSource({
    manifestUrl: anatomyManifestUrl ?? defaultAnatomyManifestUrl,
    packDepth: 8,
  })),
  new SchemaVolumeSliceRenderer(),
);
const catalogUrl = import.meta.env.VITE_DATASET_CATALOG_URL as string | undefined;
const developmentDatasetId = import.meta.env.VITE_DEFAULT_DATASET_ID as string | undefined;
const developmentReleaseId = import.meta.env.VITE_DEFAULT_RELEASE_ID as string | undefined;
const developmentFeatureId = import.meta.env.VITE_DEFAULT_FEATURE_ID as string | undefined;
const developmentDefaultView = developmentDatasetId === 'ephys_atlas_channels' && developmentReleaseId && developmentFeatureId
  ? {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: 'ephys_atlas_channels' as const, releaseId: developmentReleaseId },
    featureId: developmentFeatureId,
  }
  : undefined;
const app = new AtlasApp(root, {
  renderer,
  ...(catalogUrl ? { catalogUrl } : {}),
  ...(developmentDefaultView ? { defaultView: developmentDefaultView } : {}),
});
void app.start();
