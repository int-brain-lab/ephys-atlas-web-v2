import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const REAL_PREFIX = '/__real-data/';
const ANATOMY_PREFIX = '/atlas/anatomy/';
const PUBLIC_ROOT = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));

function mediaType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.f32') || filePath.endsWith('.f64') || filePath.endsWith('.i32') || filePath.endsWith('.u32')) {
    return 'application/octet-stream';
  }
  return 'application/octet-stream';
}

interface RealDevelopmentRelease {
  releaseRoot: string;
  datasetId: 'ephys_atlas_channels';
  releaseId: string;
  featureId: string;
}

async function loadRealDevelopmentRelease(releasePath: string, featureId: string): Promise<RealDevelopmentRelease> {
  const releaseRoot = path.resolve(releasePath);
  const manifestPath = path.join(releaseRoot, 'manifest.json');
  let document: unknown;
  try {
    document = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Cannot read real development release manifest at ${manifestPath}`, { cause: error });
  }
  if (!document || typeof document !== 'object') throw new Error(`Invalid release manifest at ${manifestPath}`);
  const manifest = document as {
    dataset_id?: unknown;
    features?: unknown;
    release?: { immutable?: unknown; release_id?: unknown };
  };
  if (manifest.dataset_id !== 'ephys_atlas_channels') {
    throw new Error(`dev-real requires an ephys_atlas_channels release; found ${String(manifest.dataset_id)}`);
  }
  if (manifest.release?.immutable !== true || typeof manifest.release.release_id !== 'string') {
    throw new Error(`dev-real requires an immutable release identity in ${manifestPath}`);
  }
  if (!Array.isArray(manifest.features)
    || !manifest.features.some((feature) => feature && typeof feature === 'object' && (feature as { id?: unknown }).id === featureId)) {
    throw new Error(`Default feature ${featureId} is not present in ${manifestPath}`);
  }
  return {
    releaseRoot,
    datasetId: manifest.dataset_id,
    releaseId: manifest.release.release_id,
    featureId,
  };
}

function realReleasePlugin(release: RealDevelopmentRelease): Plugin {
  const { releaseRoot, datasetId, releaseId } = release;
  return {
    name: 'ephys-atlas-real-development-release',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (pathname === `${REAL_PREFIX}catalog.json`) {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({
            schemaVersion: '0.1',
            datasets: [{
              id: datasetId,
              title: 'Ephys Atlas channels (real development release)',
              description: 'Pinned local development release; not the paper snapshot.',
              defaultRelease: releaseId,
              releases: [{
                id: releaseId,
                label: releaseId,
                manifest: `./${datasetId}/${releaseId}/manifest.json`,
                immutable: true,
              }],
            }],
          }));
          return;
        }
        const releasePrefix = `${REAL_PREFIX}${datasetId}/${releaseId}/`;
        if (!pathname.startsWith(releasePrefix)) return next();
        const relative = decodeURIComponent(pathname.slice(releasePrefix.length));
        const target = path.resolve(releaseRoot, relative);
        if (target !== releaseRoot && !target.startsWith(`${releaseRoot}${path.sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        try {
          if (!(await stat(target)).isFile()) return next();
          response.setHeader('Content-Type', mediaType(target));
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          response.end(await readFile(target));
        } catch {
          next();
        }
      });
    },
  };
}

function anatomyPackPlugin(): Plugin {
  const middleware = (cacheControl: string) => async (
    request: { url?: string },
    response: { statusCode: number; setHeader(name: string, value: string | number): void; end(body?: Uint8Array | string): void },
    next: () => void,
  ) => {
    const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
    if (!pathname.startsWith(ANATOMY_PREFIX)
      || (!pathname.endsWith('.json.gz') && !pathname.endsWith('.isvg.gz'))) return next();
    const target = path.resolve(PUBLIC_ROOT, decodeURIComponent(pathname.slice(1)));
    if (!target.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      response.statusCode = 403;
      response.end('Forbidden');
      return;
    }
    try {
      const bytes = await readFile(target);
      response.setHeader('Content-Type', 'application/gzip');
      response.setHeader('Content-Length', bytes.byteLength);
      response.setHeader('Cache-Control', cacheControl);
      response.end(bytes);
    } catch {
      next();
    }
  };
  return {
    name: 'opaque-anatomy-gzip-packs',
    configureServer(server) {
      server.middlewares.use(middleware('no-store'));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware('public, max-age=31536000, immutable'));
    },
  };
}

export default defineConfig(async () => {
  const releasePath = process.env.EPHYS_ATLAS_REAL_RELEASE;
  if (!releasePath) return { plugins: [anatomyPackPlugin()] };
  const release = await loadRealDevelopmentRelease(
    releasePath,
    process.env.EPHYS_ATLAS_REAL_FEATURE ?? 'rms_ap.denoised',
  );
  return {
    define: {
      'import.meta.env.VITE_DEFAULT_DATASET_ID': JSON.stringify(release.datasetId),
      'import.meta.env.VITE_DEFAULT_RELEASE_ID': JSON.stringify(release.releaseId),
      'import.meta.env.VITE_DEFAULT_FEATURE_ID': JSON.stringify(release.featureId),
    },
    plugins: [anatomyPackPlugin(), realReleasePlugin(release)],
  };
});
