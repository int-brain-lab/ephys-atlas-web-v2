const DEFAULT_CACHE_NAME = 'ibl-ephys-atlas-schema-v1-verified';
const CACHE_BYTES_HEADER = 'x-ibl-ephys-atlas-cache-bytes';
const CACHE_ADMISSION_HEADER = 'x-ibl-ephys-atlas-cache-admission';

export interface ResourceCachePolicy {
  maxBytes: number;
  maxEntries: number;
}

const DEFAULT_CACHE_POLICY: ResourceCachePolicy = {
  maxBytes: 64 * 1024 * 1024,
  maxEntries: 256,
};

const mutationQueues = new Map<string, Promise<void>>();

export interface ResourceIntegrity {
  bytes: number;
  sha256: string;
}

export interface FetchOptions {
  immutable?: boolean;
  signal?: AbortSignal;
  integrity?: ResourceIntegrity;
}

export class ResourceFetcher {
  private readonly inFlight = new Map<string, Promise<Response>>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    fetchImpl: typeof fetch = fetch,
    private readonly cacheName = DEFAULT_CACHE_NAME,
    private readonly cachePolicy: ResourceCachePolicy = DEFAULT_CACHE_POLICY,
  ) {
    this.fetchImpl = fetchImpl === fetch ? fetch.bind(globalThis) : fetchImpl;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const location = new URL(url, globalThis.location?.href ?? 'http://localhost/').toString();
    const integrityKey = options.integrity
      ? `${options.integrity.sha256}\u0000${options.integrity.bytes}`
      : 'unverified';
    const key = `${location}\u0000${integrityKey}`;
    if (options.signal) return (await this.load(location, options)).clone();

    const existing = this.inFlight.get(key);
    if (existing) return (await existing).clone();

    const request = this.load(location, options);
    this.inFlight.set(key, request);
    try {
      return (await request).clone();
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async load(url: string, options: FetchOptions): Promise<Response> {
    const canPersist = options.immutable === true && options.integrity !== undefined && 'caches' in globalThis;
    let cleanRetry = false;
    if (canPersist) {
      try {
        const cache = await caches.open(this.cacheName);
        const cached = await cache.match(url);
        if (cached) {
          try {
            const verified = await this.verify(cached, options.integrity!);
            const bytes = Number(cached.headers.get(CACHE_BYTES_HEADER));
            const admission = Number(cached.headers.get(CACHE_ADMISSION_HEADER));
            if (bytes !== options.integrity!.bytes || !Number.isSafeInteger(admission) || admission < 1) {
              await this.admit(url, verified, options.integrity!);
            }
            return verified;
          } catch {
            await this.mutateCache(async () => { await cache.delete(url); });
            cleanRetry = true;
          }
        }
      } catch {
        // Cache availability and eviction are optimizations; verified network
        // reads remain usable when browser storage is unavailable.
      }
    }

    const request = async (reload: boolean): Promise<Response> => {
      const init: RequestInit = {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(reload ? { cache: 'reload' as const } : {}),
      };
      const response = await this.fetchImpl(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
      return response;
    };

    const response = await request(cleanRetry);
    let verified: Response;
    if (!options.integrity) {
      verified = response;
    } else {
      try {
        verified = await this.verify(response, options.integrity);
      } catch (error) {
        if (cleanRetry) throw error;
        verified = await this.verify(await request(true), options.integrity);
      }
    }

    if (canPersist) {
      await this.admit(url, verified, options.integrity!);
    }
    return verified;
  }

  private async admit(url: string, response: Response, integrity: ResourceIntegrity): Promise<void> {
    if (integrity.bytes > this.cachePolicy.maxBytes || this.cachePolicy.maxEntries < 1) return;
    try {
      await this.mutateCache(async () => {
        const cache = await caches.open(this.cacheName);
        const requests = await cache.keys();
        const entries: Array<{ request: Request; bytes: number; admission: number; url: string }> = [];
        let nextAdmission = 1;
        for (const request of requests) {
          const cached = await cache.match(request);
          const bytes = Number(cached?.headers.get(CACHE_BYTES_HEADER));
          const admission = Number(cached?.headers.get(CACHE_ADMISSION_HEADER));
          if (!cached || !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(admission) || admission < 1) {
            await cache.delete(request);
            continue;
          }
          nextAdmission = Math.max(nextAdmission, admission + 1);
          if (request.url === url) {
            await cache.delete(request);
            continue;
          }
          entries.push({ request, bytes, admission, url: request.url });
        }
        entries.sort((left, right) => left.admission - right.admission || left.url.localeCompare(right.url));
        let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
        let count = entries.length;
        while (entries.length && (bytes + integrity.bytes > this.cachePolicy.maxBytes || count + 1 > this.cachePolicy.maxEntries)) {
          const oldest = entries.shift()!;
          if (!await cache.delete(oldest.request)) return;
          bytes -= oldest.bytes;
          count -= 1;
        }
        if (bytes + integrity.bytes > this.cachePolicy.maxBytes || count + 1 > this.cachePolicy.maxEntries) return;
        const headers = new Headers(response.headers);
        headers.set(CACHE_BYTES_HEADER, String(integrity.bytes));
        headers.set(CACHE_ADMISSION_HEADER, String(nextAdmission));
        const cached = new Response(await response.clone().arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        await cache.put(url, cached);
      });
    } catch {
      // Quota, Cache API, and private-mode failures never invalidate a verified
      // network response. A later request may retry admission.
    }
  }

  private async mutateCache(operation: () => Promise<void>): Promise<void> {
    const previous = mutationQueues.get(this.cacheName) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    mutationQueues.set(this.cacheName, current);
    try {
      await current;
    } finally {
      if (mutationQueues.get(this.cacheName) === current) mutationQueues.delete(this.cacheName);
    }
  }

  private async verify(response: Response, integrity: ResourceIntegrity): Promise<Response> {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== integrity.bytes) {
      throw new Error(`Resource byte length ${bytes.byteLength} does not match ${integrity.bytes}`);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (sha256 !== integrity.sha256) throw new Error('Resource SHA-256 mismatch');
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async clearPersistentCache(): Promise<void> {
    if ('caches' in globalThis) await this.mutateCache(async () => { await caches.delete(this.cacheName); });
  }
}
