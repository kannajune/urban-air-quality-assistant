import { json } from './http.js';
import { checkLimit } from './limiter.js';

/** @typedef {import('./types.js').Env} Env */
/** @typedef {import('./types.js').RateLimitBinding} RateLimitBinding */

const BUSY_RETRY_SECONDS = 60;

/**
 * The address a request is counted against.
 * @param {Request} request
 * @returns {string}
 */
export function visitorOf(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * Apply one edge rate limit binding. A missing binding (unit tests) is treated as open.
 * @param {RateLimitBinding|undefined} limiter
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function allowed(limiter, key) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

/**
 * @param {number} retryAfter Seconds until the visitor may try again.
 * @param {string} message
 * @returns {Response}
 */
function tooMany(retryAfter, message) {
  return json({ error: message }, 429, { 'Retry-After': String(retryAfter) });
}

/**
 * Count this request against the visitor, in two layers: the cheap approximate edge limiter
 * first, then the exact counter. Returns a 429 response when a limit is hit, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response|null>}
 */
export async function limitVisitor(request, env) {
  const visitor = visitorOf(request);
  const [visitorOk, appOk] = await Promise.all([allowed(env.VISITOR_LIMIT, visitor), allowed(env.APP_LIMIT, 'all')]);
  if (!visitorOk || !appOk) {
    return tooMany(BUSY_RETRY_SECONDS, 'The service is busy right now. Please try again in a minute.');
  }
  const verdict = await checkLimit(env, visitor, { countVisit: true, wantsAi: false });
  if (verdict.allowed) return null;
  const seconds = Math.max(1, Math.round(verdict.retryAfter));
  return verdict.reason === 'day'
    ? tooMany(seconds, 'You have reached the limit of plans for today. Please come back tomorrow.')
    : tooMany(seconds, `You are going a little fast. Please try again in ${seconds} seconds.`);
}

/**
 * Take one model call from the whole app's daily allowance.
 * Called only when a plan really has to be written, so cached plans cost nothing.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<boolean>} Whether the model may be called.
 */
export async function reserveModelCall(request, env) {
  const verdict = await checkLimit(env, visitorOf(request), { countVisit: false, wantsAi: true });
  return verdict.ai;
}
