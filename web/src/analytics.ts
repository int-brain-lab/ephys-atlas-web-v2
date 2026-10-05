export type AnalyticsEvent =
  | 'data_loaded'
  | 'exploration_started'
  | 'comparison_used'
  | 'share_copied'
  | 'download_started'
  | 'local_imported';

const WEBSITE_ID = 'e0c4d44e-c85c-4f15-abbb-32091b6b8a7c';
const SCRIPT_URL = 'https://cloud.umami.is/script.js';
const SITE_HOST = 'ephys-atlas.iblcore.org';
const SITE_ORIGIN = `https://${SITE_HOST}`;
const MAX_QUEUE = 7; // one pageview and at most six distinct events
const LOAD_DEADLINE_MS = 10_000;
const SEND_DEADLINE_MS = 5_000;
const ROUTES = new Set(['/', '/app', '/app/']);
const EVENTS = new Set<AnalyticsEvent>([
  'data_loaded', 'exploration_started', 'comparison_used', 'share_copied', 'download_started', 'local_imported',
]);

interface UmamiClient {
  track: (payload: AnalyticsPayload) => unknown;
}

interface AnalyticsPayload {
  website: string;
  hostname: string;
  screen: string;
  language: string;
  title: string;
  url: string;
  referrer: string;
  name?: AnalyticsEvent;
}

interface AnalyticsEnvironment {
  document: Document;
  location: Location;
  navigator: Navigator;
  screen: Screen;
  umami?: UmamiClient;
  umamiDisabled?: boolean;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

interface AnalyticsState {
  env: AnalyticsEnvironment;
  payload: AnalyticsPayload;
  queue: AnalyticsPayload[];
  seen: Set<AnalyticsEvent>;
  ready: boolean;
  failed: boolean;
  sending: boolean;
  loadTimer: ReturnType<typeof setTimeout> | undefined;
}

const states = new WeakMap<Document, AnalyticsState>();
let activeState: AnalyticsState | undefined;

function browserEnvironment(): AnalyticsEnvironment | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined' || typeof navigator === 'undefined') return undefined;
  const umami = (window as Window & { umami?: UmamiClient }).umami;
  let umamiDisabled = false;
  try {
    umamiDisabled = window.localStorage.getItem('umami.disabled') === '1';
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return {
    document,
    location: window.location,
    navigator,
    screen: window.screen,
    ...(umami ? { umami } : {}),
    umamiDisabled,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

function isOptedOut(env: AnalyticsEnvironment): boolean {
  const dnt = env.navigator.doNotTrack;
  return env.umamiDisabled === true || dnt === '1' || dnt === 'yes';
}

function safeRoute(pathname: string): string | undefined {
  if (!ROUTES.has(pathname)) return undefined;
  return pathname === '/app' ? '/app/' : pathname;
}

function safeReferrer(raw: string, currentOrigin: string): string {
  if (!raw) return '';
  try {
    const referrer = new URL(raw);
    if (referrer.protocol !== 'https:' && referrer.protocol !== 'http:') return '';
    if (referrer.hostname === SITE_HOST && referrer.protocol === 'https:') {
      return safeRoute(referrer.pathname) ?? currentOrigin;
    }
    return referrer.origin;
  } catch {
    return '';
  }
}

function payloadFor(env: AnalyticsEnvironment, route: string): AnalyticsPayload {
  return {
    website: WEBSITE_ID,
    hostname: SITE_HOST,
    screen: `${Math.max(0, env.screen.width)}x${Math.max(0, env.screen.height)}`,
    language: env.navigator.language || '',
    title: 'IBL Ephys Atlas',
    url: route,
    referrer: safeReferrer(env.document.referrer, SITE_ORIGIN),
  };
}

function enqueue(state: AnalyticsState, payload: AnalyticsPayload): void {
  if (state.failed || state.queue.length >= MAX_QUEUE) return;
  state.queue.push(payload);
  if (state.ready) void drain(state);
}

async function drain(state: AnalyticsState): Promise<void> {
  if (state.sending || state.failed || !state.ready) return;
  state.sending = true;
  try {
    while (state.queue.length && !state.failed) {
      const next = state.queue.shift();
      if (!next) break;
      const client = state.env.umami ?? (typeof window === 'undefined' ? undefined : (window as Window & { umami?: UmamiClient }).umami);
      if (!client) {
        state.failed = true;
        state.queue.length = 0;
        break;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const send = Promise.resolve(client.track(next));
        const deadline = new Promise<never>((_, reject) => {
          timer = state.env.setTimeout(() => reject(new Error('Analytics send timed out')), SEND_DEADLINE_MS);
        });
        await Promise.race([send, deadline]);
      } catch {
        // Analytics is best-effort; a rejected send must not affect the application.
      } finally {
        if (timer !== undefined) state.env.clearTimeout(timer);
      }
    }
  } catch {
    // Protect callers from unexpected analytics implementation errors.
  } finally {
    state.sending = false;
  }
}

export function initializeAnalytics(production: boolean, environment?: AnalyticsEnvironment): void {
  try {
    const env = environment ?? browserEnvironment();
    const route = env ? safeRoute(env.location.pathname) : undefined;
    if (!production || !env || env.location.origin !== SITE_ORIGIN || !route || isOptedOut(env)) return;
    const existing = states.get(env.document);
    if (existing) {
      activeState = existing;
      return;
    }

    const state: AnalyticsState = {
      env, payload: payloadFor(env, route), queue: [], seen: new Set(), ready: false, failed: false, sending: false, loadTimer: undefined,
    };
    states.set(env.document, state);
    activeState = state;
    enqueue(state, state.payload);

    const script = env.document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.websiteId = WEBSITE_ID;
    script.dataset.autoTrack = 'false';
    script.dataset.domains = SITE_HOST;
    script.dataset.excludeSearch = 'true';
    script.dataset.excludeHash = 'true';
    script.dataset.doNotTrack = 'true';
    script.addEventListener('load', () => {
      if (state.failed) return;
      if (state.loadTimer !== undefined) env.clearTimeout(state.loadTimer);
      state.ready = true;
      void drain(state);
    }, { once: true });
    script.addEventListener('error', () => {
      state.failed = true;
      state.queue.length = 0;
      if (state.loadTimer !== undefined) env.clearTimeout(state.loadTimer);
    }, { once: true });
    state.loadTimer = env.setTimeout(() => {
      state.failed = true;
      state.queue.length = 0;
    }, LOAD_DEADLINE_MS);
    (env.document.head ?? env.document.documentElement).append(script);
  } catch {
    // Analytics must never throw into application startup.
  }
}

export function trackOnce(event: AnalyticsEvent): void {
  try {
    const state = activeState;
    if (!state || state.failed || !EVENTS.has(event) || state.seen.has(event) || state.queue.length >= MAX_QUEUE) return;
    state.seen.add(event);
    enqueue(state, { ...state.payload, name: event });
  } catch {
    // Analytics must never throw into application code.
  }
}
