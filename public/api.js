/**
 * Calls from the page to the Worker.
 */

/** How long the browser waits for a plan before giving up. The model can take up to half a minute. */
export const PLAN_TIMEOUT_MS = 45000;

const GENERIC_ERROR = 'The plan could not be built. Please try again.';
const TIMEOUT_ERROR = 'That took too long. Please try again.';

/** An error whose message is safe and useful to show to the visitor. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status] HTTP status, or 0 when no response arrived.
   */
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * POST JSON and read a JSON reply.
 * @param {string} path
 * @param {unknown} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
async function postJson(path, body, signal) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/**
 * Ask for a plan. Gives up after PLAN_TIMEOUT_MS, and stops early if the caller's signal aborts.
 * @param {Record<string, unknown>} answers
 * @param {AbortSignal} [signal] Aborted by the caller when a newer request replaces this one.
 * @returns {Promise<any>} The plan response.
 * @throws {ApiError} With a message that can be shown to the visitor.
 */
export async function fetchPlan(answers, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PLAN_TIMEOUT_MS);
  const cancel = () => timeout.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const { ok, status, data } = await postJson('/api/plan', answers, timeout.signal);
    if (!ok) throw new ApiError(typeof data.error === 'string' ? data.error : GENERIC_ERROR, status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(timeout.signal.aborted && !signal?.aborted ? TIMEOUT_ERROR : GENERIC_ERROR);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Ask for the name of the place at a pair of coordinates. Never throws: a name is a nicety.
 * @param {{latitude: number, longitude: number}} point
 * @returns {Promise<string>} The name, or an empty string.
 */
export async function lookUpPlace(point) {
  try {
    const { ok, data } = await postJson('/api/place', point);
    return ok && typeof data.place === 'string' ? data.place : '';
  } catch {
    return '';
  }
}
