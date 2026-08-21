import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const REAL_PREFIX = '/__real-data/';
const DATASET_ID = /^[a-z0-9][a-z0-9._-]*$/;

interface RealDevelopmentRelease {
  releaseRoot: string;
  datasetId: string;
  releaseId: string;
  featureId: string;
}

function mediaType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

export async function loadRealDevelopmentRelease(
  releasePath: string,
  featureId: string,
): Promise<RealDevelopmentRelease> {
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
  if (typeof manifest.dataset_id !== 'string' || !DATASET_ID.test(manifest.dataset_id)) {
    throw new Error(`dev-real requires a valid dataset_id in ${manifestPath}`);
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

export function realReleasePlugin(release: RealDevelopmentRelease): Plugin {
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
              title: `${datasetId} (real development release)`,
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
