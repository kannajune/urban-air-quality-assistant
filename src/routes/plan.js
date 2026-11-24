import { fetchAirQuality, geocodeCity, reverseGeocode } from '../lib/airquality.js';
import { TTL, cacheOf, cached, digest } from '../lib/cache.js';
import { buildFallbackPlan } from '../lib/fallback.js';
import { json, readJsonBody } from '../lib/http.js';
import { limitVisitor, reserveModelCall } from '../lib/limits.js';
import { buildPrompt } from '../lib/prompt.js';
import { validatePlanRequest } from '../lib/validate.js';
import { DEFAULT_WORKERS_AI_MODEL, generateWithWorkersAi } from '../lib/workersai.js';

/** @typedef {import('../lib/types.js').Env} Env */
/** @typedef {import('../lib/types.js').Place} Place */
/** @typedef {import('../lib/types.js').AirReading} AirReading */
/** @typedef {import('../lib/types.js').Plan} Plan */
/** @typedef {import('../lib/types.js').JsonCache} JsonCache */
/** @typedef {import('../lib/validate.js').PlanRequest} PlanRequest */

const UNKNOWN_PLACE = 'your location';

/**
 * Work out the place and its air quality.
 * With coordinates the name lookup and the reading are independent, so they run together.
 * A city name has to be resolved first, because the reading needs its coordinates.
 * @param {PlanRequest} answers
 * @param {JsonCache|null} cache
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{place: Place, air: AirReading}>}
 */
async function locate(answers, cache, fetchImpl) {
  /** @param {number} latitude @param {number} longitude */
  const airAt = (latitude, longitude) =>
    cached(cache, 'air', `${latitude},${longitude}`, TTL.air, () => fetchAirQuality(latitude, longitude, fetchImpl));

  if (answers.latitude !== null && answers.longitude !== null) {
    const { latitude, longitude } = answers;
    const nameLookup = answers.city
      ? Promise.resolve({ value: answers.city })
      : cached(cache, 'place-name', `${latitude},${longitude}`, TTL.place, () =>
          reverseGeocode(latitude, longitude, fetchImpl),
        );
    const [name, air] = await Promise.all([nameLookup, airAt(latitude, longitude)]);
    return { place: { name: name.value || UNKNOWN_PLACE, latitude, longitude }, air: air.value };
  }

  const { value: place } = await cached(cache, 'place', answers.city.toLowerCase(), TTL.place, () =>
    geocodeCity(answers.city, fetchImpl),
  );
  const air = await airAt(place.latitude, place.longitude);
  return { place, air: air.value };
}

/**
 * Get a plan written by the model, reusing a recent one for the same readings and answers.
 * Returns null when no model is bound, the daily allowance is spent, or the model fails.
 * @param {Request} request
 * @param {Env} env
 * @param {JsonCache|null} cache
 * @param {string} prompt
 * @returns {Promise<{plan: Plan, model: string}|null>}
 */
async function writtenPlan(request, env, cache, prompt) {
  if (!env.AI) return null;
  const model = env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  const key = await digest(`${model}\n${prompt}`);
  const { value } = await cached(cache, 'plan', key, TTL.plan, async () =>
    (await reserveModelCall(request, env)) ? generateWithWorkersAi(env.AI, model, prompt) : null,
  );
  return value;
}

/**
 * POST /api/plan: live air quality plus a tailored plan.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
export async function handlePlan(request, env) {
  const blocked = await limitVisitor(request, env);
  if (blocked) return blocked;

  const answers = validatePlanRequest(await readJsonBody(request));
  const cache = cacheOf(env);
  const { place, air } = await locate(answers, cache, env.fetchImpl || fetch);

  // The model writes the plan; if it cannot, the built in rules do, so there is always an answer.
  const written = await writtenPlan(request, env, cache, buildPrompt(answers, place.name, air));

  return json({
    place: place.name,
    air,
    plan: written ? written.plan : buildFallbackPlan(answers, air, place.name),
    source: written ? 'ai' : 'fallback',
    model: written ? written.model : null,
  });
}
