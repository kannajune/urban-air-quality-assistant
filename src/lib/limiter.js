/**
 * Strict request counter, run as a single Durable Object.
 *
 * A Durable Object handles one request at a time, so these counts are exact,
 * unlike the approximate edge rate limiter that sits in front of it.
 *
 * Three ceilings:
 *  - per visitor per minute: stops bursts
 *  - per visitor per day: stops one person draining the service slowly
 *  - whole app per day for AI calls: protects the model key's daily quota
 *
 * Visitor counts live in memory only, so no IP address is ever written to storage.
 * Only the day's total of AI calls is persisted.
 */

export const DEFAULT_LIMITS = Object.freeze({ perMinute: 5, perDay: 40, aiPerDay: 200 });

const MINUTE_MS = 60_000;
const DAY_RETRY_SECONDS = 3600;
const MAX_VISITOR_KEY_LENGTH = 64;
const MAX_TRACKED_VISITORS = 5000;

/**
 * Read limits from configuration, falling back to the defaults for anything missing or invalid.
 * @param {Record<string, unknown>} env
 * @returns {{perMinute: number, perDay: number, aiPerDay: number}}
 */
export function readLimits(env) {
  /** @param {unknown} value @param {number} fallback */
  const pick = (value, fallback) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= 100000 ? number : fallback;
  };
  return {
    perMinute: pick(env?.LIMIT_VISITOR_PER_MINUTE, DEFAULT_LIMITS.perMinute),
    perDay: pick(env?.LIMIT_VISITOR_PER_DAY, DEFAULT_LIMITS.perDay),
    aiPerDay: pick(env?.LIMIT_AI_PER_DAY, DEFAULT_LIMITS.aiPerDay),
  };
}

/** @param {number} now @returns {string} UTC day such as 2026-11-24 */
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

export class RateLimiter {
  /**
   * @param {{storage: {get: (key: string) => Promise<unknown>, put: (key: string, value: unknown) => Promise<void>}}} ctx
   * @param {Record<string, unknown>} env
   * @param {() => number} [clock] Injected in tests.
   */
  constructor(ctx, env, clock = Date.now) {
    this.storage = ctx.storage;
    this.limits = readLimits(env);
    this.clock = clock;
    this.day = '';
    /** @type {Map<string, {minuteStart: number, minute: number, day: number}>} */
    this.visitors = new Map();
    /** @type {number|null} */
    this.aiToday = null;
  }

  /**
   * Reset the counters when the UTC day changes, and load the persisted AI total once.
   * @param {number} now
   */
  async rollDay(now) {
    const today = dayOf(now);
    if (today !== this.day) {
      this.day = today;
      this.visitors.clear();
      this.aiToday = null;
    }
    if (this.aiToday === null) {
      const stored = await this.storage.get(`ai:${today}`);
      this.aiToday = Number.isInteger(stored) ? /** @type {number} */ (stored) : 0;
    }
  }

  /**
   * Count a visit against one visitor's per minute and per day limits.
   * @param {string} visitor
   * @param {number} now
   * @returns {{allowed: boolean, reason: string|null, retryAfter: number}}
   */
  countVisit(visitor, now) {
    if (!this.visitors.has(visitor) && this.visitors.size >= MAX_TRACKED_VISITORS) {
      // Memory guard: under a flood of new addresses, drop the oldest entry.
      const oldest = this.visitors.keys().next().value;
      if (oldest !== undefined) this.visitors.delete(oldest);
    }
    const entry = this.visitors.get(visitor) || { minuteStart: now, minute: 0, day: 0 };
    if (now - entry.minuteStart >= MINUTE_MS) {
      entry.minuteStart = now;
      entry.minute = 0;
    }
    this.visitors.set(visitor, entry);

    if (entry.minute >= this.limits.perMinute) {
      const retryAfter = Math.ceil((entry.minuteStart + MINUTE_MS - now) / 1000);
      return { allowed: false, reason: 'minute', retryAfter: Math.max(1, retryAfter) };
    }
    if (entry.day >= this.limits.perDay) {
      return { allowed: false, reason: 'day', retryAfter: DAY_RETRY_SECONDS };
    }
    entry.minute += 1;
    entry.day += 1;
    return { allowed: true, reason: null, retryAfter: 0 };
  }

  /**
   * Take one model call from the whole app's daily allowance, if any is left.
   * @returns {Promise<boolean>}
   */
  async reserveAi() {
    if (this.aiToday === null || this.aiToday >= this.limits.aiPerDay) return false;
    this.aiToday += 1;
    await this.storage.put(`ai:${this.day}`, this.aiToday);
    return true;
  }

  /**
   * Count one request and say what is allowed.
   * Past the app wide AI ceiling a request still succeeds, but without a model call.
   * @param {string} visitor
   * @param {boolean} wantsAi Whether this request would call the AI model.
   * @param {boolean} [countVisit] False when the visit was already counted and only a model call is being reserved.
   * @returns {Promise<{allowed: boolean, ai: boolean, reason: string|null, retryAfter: number}>}
   */
  async check(visitor, wantsAi, countVisit = true) {
    const now = this.clock();
    await this.rollDay(now);
    const visit = countVisit ? this.countVisit(visitor, now) : { allowed: true, reason: null, retryAfter: 0 };
    if (!visit.allowed) return { ...visit, ai: false };
    return { ...visit, ai: wantsAi ? await this.reserveAi() : false };
  }

  /**
   * Durable Object entry point. Only the Worker can reach it; it is not exposed to the internet.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const { visitor, wantsAi, countVisit } = await request.json();
    const key = String(visitor || 'unknown').slice(0, MAX_VISITOR_KEY_LENGTH);
    const result = await this.check(key, wantsAi === true, countVisit !== false);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Ask the limiter from the Worker. With no binding (unit tests, local runs without it) everything is allowed.
 * If the limiter itself fails, the request is allowed but the AI call is not: fail safe for the model allowance.
 * @param {import('./types.js').Env} env
 * @param {string} visitor
 * @param {{countVisit: boolean, wantsAi: boolean}} options
 * @returns {Promise<{allowed: boolean, ai: boolean, reason: string|null, retryAfter: number}>}
 */
export async function checkLimit(env, visitor, { countVisit, wantsAi }) {
  if (!env.LIMITER) return { allowed: true, ai: wantsAi, reason: null, retryAfter: 0 };
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName('global'));
    const response = await stub.fetch('https://limiter.internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor, wantsAi, countVisit }),
    });
    return await response.json();
  } catch {
    return { allowed: true, ai: false, reason: null, retryAfter: 0 };
  }
}
