const DEFAULT_CACHE_NAME = 'ibl-ephys-atlas-v2-immutable-v1';

export interface FetchOptions {
  immutable?: boolean;
  signal?: AbortSignal;
}

export class ResourceFetcher {
  private readonly inFlight = new Map<string, Promise<Response>>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    fetchImpl: typeof fetch = fetch,
    private readonly cacheName = DEFAULT_CACHE_NAME,
  ) {
    this.fetchImpl = fetchImpl === fetch ? fetch.bind(globalThis) : fetchImpl;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const key = new URL(url, globalThis.location?.href ?? 'http://localhost/').toString();
    const existing = this.inFlight.get(key);
    if (existing) return (await existing).clone();

    const request = this.load(key, options);
    this.inFlight.set(key, request);
    try {
      return (await request).clone();
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async load(url: string, options: FetchOptions): Promise<Response> {
    const canPersist = options.immutable === true && 'caches' in globalThis;
    if (canPersist) {
      const cache = await caches.open(this.cacheName);
      const cached = await cache.match(url);
      if (cached) return cached;
    }

    const init: RequestInit = options.signal ? { signal: options.signal } : {};
    const response = await this.fetchImpl(url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);

    if (canPersist) {
      const cache = await caches.open(this.cacheName);
      await cache.put(url, response.clone());
    }
    return response;
  }

  async clearPersistentCache(): Promise<void> {
    if ('caches' in globalThis) await caches.delete(this.cacheName);
  }
}
