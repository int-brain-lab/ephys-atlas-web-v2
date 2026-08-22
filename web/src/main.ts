import './styles.css';
import { AtlasApp } from './app.js';
import { DEFAULT_VIEW_STATE } from './domain/defaults.js';
import { RetainedProjectionViewportFactory } from './rendering/retained-projection-viewport.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const defaultProjectionPackUrl =
  '/atlas/projections/synthetic-static-registered-v1/manifest.json';
const projectionPackUrl = import.meta.env.VITE_PROJECTION_PACK_URL as string | undefined;
const viewportFactory = new RetainedProjectionViewportFactory({
  projectionPackUrl: projectionPackUrl ?? defaultProjectionPackUrl,
});
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
  viewportFactory,
  ...(catalogUrl ? { catalogUrl } : {}),
  ...(developmentDefaultView ? { defaultView: developmentDefaultView } : {}),
});
void app.start();
