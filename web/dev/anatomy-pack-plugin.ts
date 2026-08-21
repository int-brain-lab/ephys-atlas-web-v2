import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ANATOMY_PREFIX = '/atlas/anatomy/';
const PUBLIC_ROOT = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));

export function anatomyPackPlugin(): Plugin {
  const middleware = (cacheControl: string) => async (
    request: { url?: string },
    response: {
      statusCode: number;
      setHeader(name: string, value: string | number): void;
      end(body?: Uint8Array | string): void;
    },
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
