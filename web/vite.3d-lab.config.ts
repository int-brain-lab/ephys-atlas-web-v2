import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadLocalMeshPack, localMeshPackPlugin } from './dev/mesh-pack-plugin.js';

/** Standalone real anatomy lab: no ephys development bundle is required. */
export default defineConfig(async () => {
  const d042 = await loadLocalMeshPack(process.env.EPHYS_ATLAS_D042_MESH_PACK ?? process.env.EPHYS_ATLAS_REAL_MESH_PACK ?? '../artifacts/mesh-d042-components-v1');
  const native = await loadLocalMeshPack(process.env.EPHYS_ATLAS_NATIVE_MESH_PACK ?? '../artifacts/mesh-native-review-v1', { allowReview: true });
  const nativeManifest = JSON.parse(await readFile(path.join(native.root, 'manifest.json'), 'utf8')) as {
    validation?: { report?: { path?: string; bytes?: number; sha256?: string } };
  };
  const reportResource = nativeManifest.validation?.report;
  if (!reportResource?.path || !Number.isSafeInteger(reportResource.bytes) || typeof reportResource.sha256 !== 'string') {
    throw new Error('Native review mesh pack does not declare an integrity-bound evidence report');
  }
  if (!native.allowedPaths.has(reportResource.path)) throw new Error('Native review evidence report is outside the declared pack graph');
  const reportTarget = path.resolve(native.root, reportResource.path);
  if (!reportTarget.startsWith(`${native.root}${path.sep}`)) throw new Error('Native review evidence report resolves outside the pack root');
  const reportBytes = await readFile(reportTarget);
  if (reportBytes.byteLength !== reportResource.bytes || createHash('sha256').update(reportBytes).digest('hex') !== reportResource.sha256) {
    throw new Error('Native review mesh pack evidence report differs from its manifest descriptor');
  }
  const report = JSON.parse(reportBytes.toString('utf8')) as { evidence?: unknown };
  if (!report.evidence) throw new Error('Native review mesh pack report does not contain review evidence');
  const catalogBytes = await readFile('../artifacts/mesh-d042-donor/catalog.json');
  if (createHash('sha256').update(catalogBytes).digest('hex') !== '71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b') {
    throw new Error('D042 region catalog hash differs');
  }
  return {
  define: {
    'import.meta.env.VITE_3D_LAB_VARIANTS': JSON.stringify([
      { id: 'd042', label: 'Old cut · D042', url: d042.manifestUrl, bytes: d042.manifestBytes, sha256: d042.manifestSha256 },
      { id: 'native', label: 'Native intact · proposed', url: native.manifestUrl, bytes: native.manifestBytes, sha256: native.manifestSha256 },
    ]),
    'import.meta.env.VITE_3D_LAB_REVIEW': JSON.stringify(report.evidence),
    'import.meta.env.VITE_3D_LAB_CATALOG': catalogBytes.toString('utf8'),
  },
  server: {
    host: '127.0.0.1',
    port: 4194,
    strictPort: true,
    open: '/3d-lab/',
  },
  plugins: [
    localMeshPackPlugin(d042),
    localMeshPackPlugin(native),
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
