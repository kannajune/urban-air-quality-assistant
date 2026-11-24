/**
 * Shared type definitions. This file has no runtime code; it exists so editors and the
 * type checker can follow data through the Worker.
 */

/**
 * @typedef {Object} RateLimitBinding
 * @property {(options: {key: string}) => Promise<{success: boolean}>} limit
 */

/**
 * @typedef {Object} JsonCache A minimal view of the Cloudflare Cache API.
 * @property {(key: string) => Promise<Response|undefined>} match
 * @property {(key: string, response: Response) => Promise<void>} put
 */

/**
 * @typedef {Object} Env Bindings and settings available to the Worker.
 * @property {{fetch: (request: Request) => Promise<Response>}} ASSETS Static files.
 * @property {{run: (model: string, input: object) => Promise<unknown>}} [AI] Workers AI.
 * @property {{idFromName: (name: string) => unknown, get: (id: unknown) => {fetch: (url: string, init?: RequestInit) => Promise<Response>}}} [LIMITER]
 * @property {RateLimitBinding} [VISITOR_LIMIT]
 * @property {RateLimitBinding} [APP_LIMIT]
 * @property {string} [WORKERS_AI_MODEL]
 * @property {string} [LIMIT_VISITOR_PER_MINUTE]
 * @property {string} [LIMIT_VISITOR_PER_DAY]
 * @property {string} [LIMIT_AI_PER_DAY]
 * @property {typeof fetch} [fetchImpl] Injected in tests.
 * @property {JsonCache} [cache] Injected in tests; production uses the edge cache.
 */

/**
 * @typedef {Object} Place
 * @property {string} name
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {Object} ForecastHour
 * @property {string} time Local ISO time, for example 2026-11-23T21:00.
 * @property {number} aqi
 * @property {string} level
 */

/**
 * @typedef {Object} AirReading
 * @property {number} aqi
 * @property {string} level
 * @property {string} label
 * @property {string} advice
 * @property {number|null} pm25
 * @property {number|null} pm10
 * @property {number|null} no2
 * @property {number|null} ozone
 * @property {string|null} measuredAt
 * @property {string|null} timezone
 * @property {ForecastHour[]} forecast
 * @property {{time: string, aqi: number, label: string}|null} peak
 * @property {{time: string, aqi: number, label: string}|null} cleanest
 */

/**
 * @typedef {Object} PlanItem
 * @property {string} title
 * @property {string} detail
 * @property {string} impact
 * @property {'free'|'low'|'medium'} cost
 * @property {'high'|'medium'|'low'} benefit
 */

/**
 * @typedef {Object} Plan
 * @property {string} summary
 * @property {PlanItem[]} routine
 * @property {PlanItem[]} indoor
 * @property {PlanItem[]} alternatives
 */

export {};
