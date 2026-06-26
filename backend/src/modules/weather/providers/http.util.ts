/**
 * Minimal HTTP helper for external providers using Node's global `fetch`
 * (Node 18+). Adds a per-attempt timeout via AbortController and bounded retry
 * with linear backoff. 5xx / network errors / timeouts are retried; 4xx are
 * treated as permanent (bad key, bad request) and fail fast so the ingestion
 * fallback chain can move to the next provider immediately.
 *
 * Optional egress proxy: if `WEATHER_PROXY_URL` (or `HTTPS_PROXY`) is set, every
 * request routes through that forward proxy via an undici ProxyAgent dispatcher.
 * This is how a network-blocked source (e.g. GDACS from some networks) becomes
 * reachable without touching provider code.
 */
import { ProxyAgent, type Dispatcher } from 'undici';

export interface HttpOptions {
  timeoutMs: number;
  /** Number of *additional* attempts after the first (0 = no retry). */
  retries: number;
  backoffMs?: number;
}

/** fetch() init plus undici's `dispatcher` (not in the lib DOM types). */
type FetchInit = RequestInit & { dispatcher?: Dispatcher };

class PermanentHttpError extends Error {
  readonly permanent = true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Cache one ProxyAgent per proxy URL (creating one per request leaks sockets).
const dispatcherCache = new Map<string, Dispatcher>();

/** Resolve the configured egress proxy dispatcher, if any. */
function proxyDispatcher(): Dispatcher | undefined {
  const url =
    process.env.WEATHER_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;
  if (!url) return undefined;
  let dispatcher = dispatcherCache.get(url);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(url);
    dispatcherCache.set(url, dispatcher);
  }
  return dispatcher;
}

/** Fetch JSON with timeout + retry. Throws on the final failure. */
export async function fetchJson<T>(
  url: string,
  opts: HttpOptions,
  init?: RequestInit,
): Promise<T> {
  let lastErr: unknown;

  const dispatcher = proxyDispatcher();

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const fetchInit: FetchInit = { ...init, signal: controller.signal };
      if (dispatcher) fetchInit.dispatcher = dispatcher;
      const res = await fetch(url, fetchInit);
      if (res.status >= 500) {
        throw new Error(`upstream ${res.status}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new PermanentHttpError(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof PermanentHttpError) break;
      if (attempt < opts.retries) {
        await sleep((opts.backoffMs ?? 300) * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`request failed: ${url}`);
}

/** Like {@link fetchJson} but returns latency (ms); used for healthchecks. */
export async function pingUrl(url: string, opts: HttpOptions): Promise<number> {
  const started = Date.now();
  await fetchJson<unknown>(url, opts);
  return Date.now() - started;
}
