import './styles.css';
import { AtlasApp } from './app.js';
import { LegacyCuratedSvgSliceRenderer } from './rendering/legacy-svg-renderer.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const app = new AtlasApp(root, { renderer: new LegacyCuratedSvgSliceRenderer() });
void app.start();
