// Shared helpers for the post-deploy scripts in this directory.

export const CANONICAL_HOST = "ukehoot.net";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Parse the BASE_URL env (default: canonical apex) into the bits the scripts
 * actually need. `isCanonicalApex` says whether it's safe to probe www→apex
 * canonicalisation, which only makes sense against the production apex.
 */
export function resolveBaseUrl(envBaseUrl = process.env.BASE_URL) {
  const baseUrl = (envBaseUrl ?? `https://${CANONICAL_HOST}`).replace(/\/$/, "");
  const apex = new URL(baseUrl).host;
  return {
    baseUrl,
    apex,
    wwwHost: `www.${apex}`,
    isCanonicalApex: apex === CANONICAL_HOST,
  };
}

/**
 * fetch() with a 10s timeout. Caller sets `redirect:` — defaults to fetch's
 * "follow" so this also covers callers that don't care about redirects.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 */
export function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    ...init,
  });
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 */
export async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
