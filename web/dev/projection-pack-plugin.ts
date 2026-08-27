import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const PROJECTION_PREFIX = '/__projection-pack/';

interface LocalProjectionPack {
  root: string;
  manifestUrl: string;
}

export async function loadLocalProjectionPack(packPath: string): Promise<LocalProjectionPack> {
  const root = path.resolve(packPath);
  const manifestPath = path.join(root, 'manifest.json');
  let document: unknown;
  try {
    document = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Cannot read local projection-pack manifest at ${manifestPath}`, { cause: error });
  }
  if (!document || typeof document !== 'object') {
    throw new Error(`Invalid local projection-pack manifest at ${manifestPath}`);
  }
  const manifest = document as { format?: unknown; immutable?: unknown; projections?: unknown };
  if (manifest.format !== 'atlas-projection-pack-v1'
    || manifest.immutable !== true
    || !Array.isArray(manifest.projections)
    || manifest.projections.length !== 5) {
    throw new Error(`Local projection pack must be one immutable five-view schema-v1 pack: ${manifestPath}`);
  }
  return { root, manifestUrl: `${PROJECTION_PREFIX}manifest.json` };
}

export function localProjectionPackPlugin(pack: LocalProjectionPack): Plugin {
  return {
    name: 'ephys-atlas-local-projection-pack',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (!pathname.startsWith(PROJECTION_PREFIX)) return next();
        const relative = decodeURIComponent(pathname.slice(PROJECTION_PREFIX.length));
        const target = path.resolve(pack.root, relative);
        if (target === pack.root || !target.startsWith(`${pack.root}${path.sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        try {
          const metadata = await stat(target);
          if (!metadata.isFile()) return next();
          response.setHeader(
            'Content-Type',
            target.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/gzip',
          );
          response.setHeader('Content-Length', metadata.size);
          response.setHeader('Cache-Control', 'no-store');
          response.end(await readFile(target));
        } catch {
          next();
        }
      });
    },
  };
}
