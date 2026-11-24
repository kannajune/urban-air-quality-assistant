/**
 * Read through cache for JSON values, on top of the Cloudflare edge cache.
 *
 * Upstream data changes slowly compared with how often it is asked for: a city's coordinates
 * never move, and an air quality reading is refreshed hourly. Caching them removes most
 * upstream calls, and caching a written plan removes most model calls, which are the slowest
 * and most limited step.
 */

/** @typedef {import('./types.js').Env} Env */
/** @typedef {import('./types.js').JsonCache} JsonCache */

export const TTL = Object.freeze({
  /** Coordinates and names of places do not change. */
  place: 24 * 60 * 60,
  /** Readings are hourly; ten minutes keeps them fresh without repeat calls. */
  air: 10 * 60,
  /** The same readings and answers give the same plan. */
  plan: 10 * 60,
});

const KEY_BASE = 'https://cache.internal/';

/**
 * The cache to use: an injected one in tests, the edge cache in production, none elsewhere.
 * @param {Env} env
 * @returns {JsonCache|null}
 */
export function cacheOf(env) {
  if (env.cache) return env.cache;
  const edge = /** @type {{default?: JsonCache}|undefined} */ (/** @type {any} */ (globalThis).caches);
  return edge?.default ?? null;
}

/**
 * SHA-256 of a string as hex. Used to turn long or sensitive inputs into fixed size cache keys.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Return the cached value for a key, or load it, cache it and return it.
 * A failing cache never fails the request, and null results are not cached.
 * @template T
 * @param {JsonCache|null} cache
 * @param {string} group Short name for the kind of value, for example "air".
 * @param {string} id Identifies the value within its group.
 * @param {number} ttlSeconds
 * @param {() => Promise<T>} load
 * @returns {Promise<{value: T, hit: boolean}>}
 */
export async function cached(cache, group, id, ttlSeconds, load) {
  if (!cache) return { value: await load(), hit: false };
  const key = `${KEY_BASE}${group}/${encodeURIComponent(id)}`;
  try {
    const found = await cache.match(key);
    if (found) return { value: /** @type {T} */ (await found.json()), hit: true };
  } catch {
    // Fall through and load the value.
  }
  const value = await load();
  if (value !== null && value !== undefined) {
    try {
      await cache.put(
        key,
        new Response(JSON.stringify(value), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` },
        }),
      );
    } catch {
      // A value that could not be cached is still a valid answer.
    }
  }
  return { value, hit: false };
}
