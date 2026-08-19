import './styles.css';
import { AtlasApp } from './app.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');

const app = new AtlasApp(root);
void app.start();
