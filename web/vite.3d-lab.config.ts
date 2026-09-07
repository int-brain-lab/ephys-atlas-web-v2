import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadLocalMeshPack, localMeshPackPlugin } from './dev/mesh-pack-plugin.js';

/** Standalone real anatomy lab: no ephys development bundle is required. */
export default defineConfig(async () => {
  const pack = await loadLocalMeshPack(process.env.EPHYS_ATLAS_REAL_MESH_PACK ?? '../artifacts/mesh-d042-components-v1');
  const catalogBytes = await readFile('../artifacts/mesh-d042-donor/catalog.json');
  if (createHash('sha256').update(catalogBytes).digest('hex') !== '71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b') {
    throw new Error('D042 region catalog hash differs');
  }
  return {
  define: {
    'import.meta.env.VITE_3D_LAB_MESH': JSON.stringify({ url: pack.manifestUrl, bytes: pack.manifestBytes, sha256: pack.manifestSha256 }),
    'import.meta.env.VITE_3D_LAB_CATALOG': catalogBytes.toString('utf8'),
  },
  server: {
    host: '127.0.0.1',
    port: 4194,
    strictPort: true,
    open: '/3d-lab/',
  },
  plugins: [
    localMeshPackPlugin(pack),
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
  };
});
