import { HttpError, json, readJsonBody, withSecurityHeaders } from './lib/http.js';
import { validateCoordinates, validatePlanRequest } from './lib/validate.js';
import { fetchAirQuality, geocodeCity, reverseGeocode } from './lib/airquality.js';
import { buildPrompt, generatePlan } from './lib/gemini.js';
import { buildFallbackPlan } from './lib/fallback.js';
import { RateLimiter, checkLimit } from './lib/limiter.js';
import { generateWithWorkersAi } from './lib/workersai.js';

// The Durable Object class must be exported from the Worker entry module.
export { RateLimiter };

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
 * Apply the limits in two layers: the cheap approximate edge limiter first, then the exact counter.
 * Returns a 429 response when a limit is hit, otherwise whether an AI call is allowed.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {boolean} wantsAi
 * @returns {Promise<{blocked: Response|null, ai: boolean}>}
 */
async function applyLimits(request, env, wantsAi) {
  const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
  const tooMany = (retryAfter, message) => ({
    blocked: json({ error: message }, 429, { 'Retry-After': String(retryAfter) }),
    ai: false,
  });
  if (!(await allowed(env.VISITOR_LIMIT, visitor)) || !(await allowed(env.APP_LIMIT, 'all'))) {
    return tooMany(60, 'The service is busy right now. Please try again in a minute.');
  }
  const verdict = await checkLimit(env, visitor, wantsAi);
  if (!verdict.allowed) {
    const seconds = Math.max(1, Math.round(verdict.retryAfter));
    return verdict.reason === 'day'
      ? tooMany(seconds, 'You have reached the limit of plans for today. Please come back tomorrow.')
      : tooMany(seconds, `You are going a little fast. Please try again in ${seconds} seconds.`);
  }
  return { blocked: null, ai: verdict.ai };
}

/**
 * POST /api/place: the name of the place at a pair of coordinates.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Response>}
 */
export async function handlePlace(request, env) {
  const { blocked } = await applyLimits(request, env, false);
  if (blocked) return blocked;
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
  const { blocked, ai: aiAllowed } = await applyLimits(request, env, Boolean(env.GEMINI_API_KEY || env.AI));
  if (blocked) return blocked;

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
  // Model chain: Gemini when a key is set, then the keyless open model, then the built in rules.
  // Past the app wide daily ceiling no model is called at all.
  let written = null;
  if (aiAllowed) {
    const prompt = buildPrompt(answers, place.name, air);
    const gemini = await generatePlan({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetchImpl }, prompt);
    if (gemini) {
      written = { ...gemini, source: 'gemini' };
    } else {
      const open = await generateWithWorkersAi(env.AI, env.WORKERS_AI_MODEL, prompt);
      if (open) written = { ...open, source: 'workers-ai' };
    }
  }

  return json({
    place: place.name,
    air,
    plan: written ? written.plan : buildFallbackPlan(answers, air, place.name),
    source: written ? written.source : 'fallback',
    model: written ? written.model : null,
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
