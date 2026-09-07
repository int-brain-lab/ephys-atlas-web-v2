import { defineConfig } from 'vite';
import { meshPackFixturePlugin } from './dev/mesh-pack-fixture-plugin.js';

/** Standalone synthetic lab: no scientific development bundle is required. */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4194,
    strictPort: true,
    open: '/3d-lab/',
  },
  plugins: [
    meshPackFixturePlugin(),
    {
      name: '3d-lab-home',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (url.pathname !== '/' && url.pathname !== '/3d-lab') return next();
          response.writeHead(302, { Location: `/3d-lab/${url.search}` });
          response.end();
        });
      },
    },
  ],
});
