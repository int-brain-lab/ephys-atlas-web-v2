import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const FIXTURE_ROOT = path.resolve(fileURLToPath(new URL('../../fixtures/mesh-pack-v1/pack/', import.meta.url)));
const PREFIX = '/__mesh-pack-fixture/';

/** Development/test-only access to the canonical fixture; it is never copied into public assets. */
export function meshPackFixturePlugin(): Plugin {
  return {
    name: 'canonical-mesh-pack-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (!pathname.startsWith(PREFIX)) return next();
        const target = path.resolve(FIXTURE_ROOT, decodeURIComponent(pathname.slice(PREFIX.length)));
        if (!target.startsWith(`${FIXTURE_ROOT}${path.sep}`)) { response.statusCode = 403; response.end('Forbidden'); return; }
        try {
          const bytes = await readFile(target);
          response.setHeader('Content-Type', target.endsWith('.json') ? 'application/json' : 'application/vnd.ibl.eam3');
          response.setHeader('Content-Length', bytes.byteLength);
          response.setHeader('Cache-Control', 'no-store');
          response.end(bytes);
        } catch { next(); }
      });
    },
  };
}
