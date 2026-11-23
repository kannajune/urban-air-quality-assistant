import { HttpError, json, readJsonBody, withSecurityHeaders } from './lib/http.js';
import { validateCoordinates, validatePlanRequest } from './lib/validate.js';
import { fetchAirQuality, geocodeCity, reverseGeocode } from './lib/airquality.js';
import { buildPrompt, generatePlan } from './lib/gemini.js';
import { buildFallbackPlan } from './lib/fallback.js';

/**
 * Apply one rate limit binding. Missing bindings (local tests) are treated as open.
 * @param {{limit: (options: {key: string}) => Promise<{success: boolean}>}|undefined} limiter
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function allowed(limiter, key) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

/**
 * Apply both ceilings. Returns a 429 response when either is exceeded, otherwise null.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Response|null>}
 */
async function rateLimited(request, env) {
  const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
  if ((await allowed(env.VISITOR_LIMIT, visitor)) && (await allowed(env.APP_LIMIT, 'all'))) return null;
  return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'Retry-After': '60' });
}

/**
 * POST /api/place: the name of the place at a pair of coordinates.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Response>}
 */
export async function handlePlace(request, env) {
  const limited = await rateLimited(request, env);
  if (limited) return limited;
  const { latitude, longitude } = validateCoordinates(await readJsonBody(request, 512));
  const name = await reverseGeocode(latitude, longitude, env.fetchImpl || fetch);
  return json({ place: name, latitude, longitude });
}

/**
 * POST /api/plan: live air quality plus a tailored plan.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Response>}
 */
export async function handlePlan(request, env) {
  const limited = await rateLimited(request, env);
  if (limited) return limited;

  const answers = validatePlanRequest(await readJsonBody(request));
  const fetchImpl = env.fetchImpl || fetch;

  let place;
  if (answers.latitude !== null && answers.longitude !== null) {
    const name = answers.city || (await reverseGeocode(answers.latitude, answers.longitude, fetchImpl)) || 'your location';
    place = { name, latitude: answers.latitude, longitude: answers.longitude };
  } else {
    place = await geocodeCity(answers.city, fetchImpl);
  }

  const air = await fetchAirQuality(place.latitude, place.longitude, fetchImpl);
  const ai = await generatePlan(
    { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetchImpl },
    buildPrompt(answers, place.name, air),
  );

  return json({
    place: place.name,
    air,
    plan: ai ? ai.plan : buildFallbackPlan(answers, air, place.name),
    source: ai ? 'gemini' : 'fallback',
    model: ai ? ai.model : null,
  });
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/health') {
        return json({ ok: true });
      }
      if (pathname === '/api/plan' || pathname === '/api/place') {
        if (request.method !== 'POST') {
          return json({ error: 'Use POST for this endpoint.' }, 405, { Allow: 'POST' });
        }
        return pathname === '/api/plan' ? await handlePlan(request, env) : await handlePlace(request, env);
      }
      if (pathname.startsWith('/api/')) {
        return json({ error: 'Not found.' }, 404);
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }
      // Details stay in the server log; the client gets a generic message.
      console.error('Unhandled error', error);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
