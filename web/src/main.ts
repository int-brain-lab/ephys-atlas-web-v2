import './styles.css';
import { AtlasApp } from './app.js';
import { DEFAULT_VIEW_STATE } from './domain/defaults.js';
import type { ParcellationId } from './domain/types.js';
import { RetainedProjectionViewportFactory } from './rendering/retained-projection-viewport.js';
import { LazyBrainScene3DViewportFactory } from './rendering/3d/lazy-brain-scene-viewport.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

function revealApplication(): void {
  root!.hidden = false;
  const status = document.querySelector<HTMLElement>('#app-bootstrap-status');
  if (status) status.hidden = true;
}

function showStartupFailure(error: unknown): void {
  root!.hidden = true;
  const status = document.querySelector<HTMLElement>('#app-bootstrap-status');
  if (status) {
    status.hidden = false;
    status.textContent = 'Unable to load the atlas. Reload the page and try again.';
    status.setAttribute('role', 'alert');
  }
  console.error('Unable to start atlas', error);
}

const defaultProjectionPackUrl =
  '/atlas/projections/ibl-static-registered-v1/manifest.json';
const projectionPackUrl = import.meta.env.VITE_PROJECTION_PACK_URL as string | undefined;
const viewportFactory = new RetainedProjectionViewportFactory({
  projectionPackUrl: projectionPackUrl ?? defaultProjectionPackUrl,
});
const catalogUrl = import.meta.env.VITE_DATASET_CATALOG_URL as string | undefined;
const developmentDatasetId = import.meta.env.VITE_DEFAULT_DATASET_ID as string | undefined;
const developmentReleaseId = import.meta.env.VITE_DEFAULT_RELEASE_ID as string | undefined;
const developmentFeatureId = import.meta.env.VITE_DEFAULT_FEATURE_ID as string | undefined;
const developmentParcellation = import.meta.env.VITE_DEFAULT_PARCELLATION_ID as string | undefined;
const developmentParcellationId: ParcellationId = developmentParcellation === 'beryl'
  || developmentParcellation === 'cosmos'
  ? developmentParcellation
  : 'allen';
const developmentDefaultView = developmentDatasetId && developmentReleaseId && developmentFeatureId
  ? {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: developmentDatasetId, releaseId: developmentReleaseId },
    featureId: developmentFeatureId,
    parcellation: developmentParcellationId,
  }
  : undefined;
function optionalScene3DFactory() {
  const url = import.meta.env.VITE_BRAIN_MESH_MANIFEST_URL as string | undefined;
  const sha256 = import.meta.env.VITE_BRAIN_MESH_MANIFEST_SHA256 as string | undefined;
  const bytesText = import.meta.env.VITE_BRAIN_MESH_MANIFEST_BYTES as string | undefined;
  if (!url && !sha256 && !bytesText) return undefined;
  const bytes = Number(bytesText);
  if (!url || !/^[0-9a-f]{64}$/.test(sha256 ?? '') || !Number.isSafeInteger(bytes) || bytes <= 0) {
    console.error('Ignoring incomplete VITE_BRAIN_MESH_MANIFEST_* configuration');
    return undefined;
  }
  return new LazyBrainScene3DViewportFactory({
    url: new URL(url, location.href).toString(), bytes, sha256: sha256!,
  });
}

function start(): void {
  const scene3dFactory = optionalScene3DFactory();
  const app = new AtlasApp(root!, {
    viewportFactory,
    ...(scene3dFactory ? { scene3dFactory } : {}),
    ...(catalogUrl ? { catalogUrl } : {}),
    ...(developmentDefaultView ? { defaultView: developmentDefaultView } : {}),
  });
  if (window.location.hash === '#help') app.openHelpGuide();
  revealApplication();
  void app.start().catch(showStartupFailure);
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('lab') === 'agea-coverage') {
  void import('./labs/agea-coverage-lab.js').then(({ startAgeaCoverageLab }) => {
    const dispose = startAgeaCoverageLab(root);
    import.meta.hot?.dispose(dispose);
    revealApplication();
  }).catch(showStartupFailure);
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('lab') === 'multi-feature') {
  void import('./labs/multi-feature-lab.js').then(({ startMultiFeatureLab }) => {
    const dispose = startMultiFeatureLab(root);
    import.meta.hot?.dispose(dispose);
    revealApplication();
  }).catch(showStartupFailure);
} else {
  start();
}
