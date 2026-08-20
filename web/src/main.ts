import './styles.css';
import { AtlasApp } from './app.js';
import { HybridSliceRenderer } from './rendering/hybrid-slice-renderer.js';
import { LegacyCuratedSvgSliceRenderer } from './rendering/legacy-svg-renderer.js';
import { ChunkedVolumeSliceRenderer } from './rendering/volume-slice-renderer.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const renderer = new HybridSliceRenderer(
  new LegacyCuratedSvgSliceRenderer(),
  new ChunkedVolumeSliceRenderer(),
);
const app = new AtlasApp(root, { renderer });
void app.start();
