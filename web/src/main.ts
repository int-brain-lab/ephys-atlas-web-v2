import './styles.css';
import { AtlasApp } from './app.js';
import { HybridSliceRenderer } from './rendering/hybrid-slice-renderer.js';
import { LegacyCuratedSvgSliceRenderer } from './rendering/legacy-svg-renderer.js';
import { SchemaVolumeSliceRenderer } from './rendering/volume-slice-renderer.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const renderer = new HybridSliceRenderer(
  new LegacyCuratedSvgSliceRenderer(),
  new SchemaVolumeSliceRenderer(),
);
const catalogUrl = import.meta.env.VITE_DATASET_CATALOG_URL as string | undefined;
const app = new AtlasApp(root, { renderer, ...(catalogUrl ? { catalogUrl } : {}) });
void app.start();
