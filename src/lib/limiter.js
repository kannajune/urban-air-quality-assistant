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
const MAX_TRACKED_VISITORS = 5000;

/**
 * Read limits from configuration, falling back to the defaults for anything missing or invalid.
 * @param {Record<string, unknown>} env
 * @returns {{perMinute: number, perDay: number, aiPerDay: number}}
 */
export function readLimits(env) {
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

  /** Reset the counters when the UTC day changes, and load the persisted AI total once. */
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
   * Count one request and say what is allowed.
   * @param {string} visitor
   * @param {boolean} wantsAi Whether this request would call the AI model.
   * @returns {Promise<{allowed: boolean, ai: boolean, reason: string|null, retryAfter: number}>}
   */
  async check(visitor, wantsAi) {
    const now = this.clock();
    await this.rollDay(now);

    if (!this.visitors.has(visitor) && this.visitors.size >= MAX_TRACKED_VISITORS) {
      // Memory guard: under a flood of new addresses, drop the oldest entry.
      this.visitors.delete(this.visitors.keys().next().value);
    }
    const entry = this.visitors.get(visitor) || { minuteStart: now, minute: 0, day: 0 };
    if (now - entry.minuteStart >= MINUTE_MS) {
      entry.minuteStart = now;
      entry.minute = 0;
    }

    if (entry.minute >= this.limits.perMinute) {
      this.visitors.set(visitor, entry);
      const retryAfter = Math.ceil((entry.minuteStart + MINUTE_MS - now) / 1000);
      return { allowed: false, ai: false, reason: 'minute', retryAfter: Math.max(1, retryAfter) };
    }
    if (entry.day >= this.limits.perDay) {
      this.visitors.set(visitor, entry);
      return { allowed: false, ai: false, reason: 'day', retryAfter: 3600 };
    }

    entry.minute += 1;
    entry.day += 1;
    this.visitors.set(visitor, entry);

    // Past the app wide AI ceiling the request still succeeds, but without a model call.
    let ai = false;
    if (wantsAi && this.aiToday < this.limits.aiPerDay) {
      this.aiToday += 1;
      await this.storage.put(`ai:${this.day}`, this.aiToday);
      ai = true;
    }
    return { allowed: true, ai, reason: null, retryAfter: 0 };
  }

  /**
   * Durable Object entry point. Only the Worker can reach it; it is not exposed to the internet.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const { visitor, wantsAi } = await request.json();
    const result = await this.check(String(visitor || 'unknown').slice(0, 64), wantsAi === true);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Ask the limiter from the Worker. With no binding (unit tests, local runs without it) everything is allowed.
 * If the limiter itself fails, the request is allowed but the AI call is not: fail safe for the key.
 * @param {Record<string, any>} env
 * @param {string} visitor
 * @param {boolean} wantsAi
 * @returns {Promise<{allowed: boolean, ai: boolean, reason: string|null, retryAfter: number}>}
 */
export async function checkLimit(env, visitor, wantsAi) {
  if (!env.LIMITER) return { allowed: true, ai: wantsAi, reason: null, retryAfter: 0 };
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName('global'));
    const response = await stub.fetch('https://limiter.internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor, wantsAi }),
    });
    return await response.json();
  } catch {
    return { allowed: true, ai: false, reason: null, retryAfter: 0 };
  }
}
