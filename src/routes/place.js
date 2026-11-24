import { reverseGeocode } from '../lib/geocode.js';
import { TTL, cacheOf, cached } from '../lib/cache.js';
import { json, readJsonBody } from '../lib/http.js';
import { limitVisitor } from '../lib/limits.js';
import { validateCoordinates } from '../lib/validate.js';

/** @typedef {import('../lib/types.js').Env} Env */

const MAX_BODY_BYTES = 512;

/**
 * POST /api/place: the name of the place at a pair of coordinates.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
export async function handlePlace(request, env) {
  const blocked = await limitVisitor(request, env);
  if (blocked) return blocked;

  const { latitude, longitude } = validateCoordinates(await readJsonBody(request, MAX_BODY_BYTES));
  const { value: place } = await cached(cacheOf(env), 'place-name', `${latitude},${longitude}`, TTL.place, () =>
    reverseGeocode(latitude, longitude, env.fetchImpl || fetch),
  );
  return json({ place, latitude, longitude });
}
