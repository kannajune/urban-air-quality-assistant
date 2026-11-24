import { HttpError, json, withSecurityHeaders } from './lib/http.js';
import { RateLimiter } from './lib/limiter.js';
import { handlePlace } from './routes/place.js';
import { handlePlan } from './routes/plan.js';

/** @typedef {import('./lib/types.js').Env} Env */

// The Durable Object class must be exported from the Worker entry module.
export { RateLimiter };

const API_PREFIX = '/api/';

/** POST endpoints and the function that answers each. */
const POST_ROUTES = Object.freeze({
  '/api/plan': handlePlan,
  '/api/place': handlePlace,
});

/**
 * Send an API request to its handler.
 * @param {string} pathname
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
async function routeApi(pathname, request, env) {
  if (pathname === '/api/health') return json({ ok: true });
  const handler = Object.hasOwn(POST_ROUTES, pathname)
    ? POST_ROUTES[/** @type {keyof typeof POST_ROUTES} */ (pathname)]
    : null;
  if (!handler) return json({ error: 'Not found.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405, { Allow: 'POST' });
  return handler(request, env);
}

export default {
  /**
   * In production only /api/ requests reach this function; static files are served straight
   * from the edge with the headers in public/_headers. The static branch below covers local
   * runs and anything the edge does not match.
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith(API_PREFIX)) return await routeApi(pathname, request, env);
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Details stay in the server log; the client gets a generic message.
      console.error('Unhandled error', error);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
