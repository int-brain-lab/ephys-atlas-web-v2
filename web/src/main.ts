import './styles.css';
import { AtlasApp } from './app.js';
import { GeneratedAnatomySliceRenderer } from './rendering/generated-anatomy-renderer.js';
import { GeneratedAnatomySliceSource } from './rendering/generated-anatomy-source.js';
import { HybridSliceRenderer } from './rendering/hybrid-slice-renderer.js';
import { SchemaVolumeSliceRenderer } from './rendering/volume-slice-renderer.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const defaultAnatomyManifestUrl =
  '/atlas/anatomy/allen-ccfv3-25um-left-t15-4a565958b938/manifest.json';
const anatomyManifestUrl = import.meta.env.VITE_ANATOMY_MANIFEST_URL as string | undefined;
const renderer = new HybridSliceRenderer(
  new GeneratedAnatomySliceRenderer(new GeneratedAnatomySliceSource({
    manifestUrl: anatomyManifestUrl ?? defaultAnatomyManifestUrl,
    packDepth: 16,
  })),
  new SchemaVolumeSliceRenderer(),
);
const catalogUrl = import.meta.env.VITE_DATASET_CATALOG_URL as string | undefined;
const app = new AtlasApp(root, { renderer, ...(catalogUrl ? { catalogUrl } : {}) });
void app.start();
