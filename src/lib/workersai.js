import { SYSTEM_INSTRUCTION } from './prompt.js';
import { PLAN_SCHEMA, normalisePlan } from './plan.js';

/**
 * The plan writer: Google's open Gemma model on Cloudflare Workers AI.
 * It runs inside the same Cloudflare account through a binding, so there is no API key to protect.
 */

export const DEFAULT_WORKERS_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

const MODEL_PATTERN = /^@cf\/[a-z0-9-]+\/[a-z0-9.-]{3,60}$/;
const TIMEOUT_MS = 30000;

/** Open models follow a described shape more reliably than a schema alone, so the shape is spelled out. */
const SHAPE_INSTRUCTION = [
  'Reply with one JSON object and nothing else: no markdown, no code fence, no commentary.',
  'Keys: "summary" (string), "routine", "indoor" and "alternatives" (arrays of 3 to 5 objects).',
  'Each object has "title", "detail" and "impact" (strings),',
  '"cost" (one of "free", "low", "medium") and "benefit" (one of "high", "medium", "low").',
].join(' ');

/**
 * Pull the reply text out of the shapes Workers AI models return.
 * @param {any} result
 * @returns {unknown} A string, or an already parsed object.
 */
export function replyOf(result) {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  if (result.response !== undefined && result.response !== null) return result.response;
  return result.choices?.[0]?.message?.content ?? '';
}

/**
 * Find the JSON object in a model reply, tolerating code fences or stray text around it.
 * @param {unknown} reply
 * @returns {unknown|null}
 */
export function extractJson(reply) {
  if (reply !== null && typeof reply === 'object') return reply;
  if (typeof reply !== 'string') return null;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Ask the Workers AI model for a plan. Returns null on any failure so the caller can fall back.
 * @param {{run: (model: string, input: object) => Promise<unknown>}|undefined} ai The Workers AI binding.
 * @param {string|undefined} model
 * @param {string} prompt
 * @returns {Promise<{plan: import('./types.js').Plan, model: string}|null>}
 */
export async function generateWithWorkersAi(ai, model, prompt) {
  if (!ai || typeof ai.run !== 'function') return null;
  const name = MODEL_PATTERN.test(model || '') ? /** @type {string} */ (model) : DEFAULT_WORKERS_AI_MODEL;
  let timer;
  try {
    const result = await Promise.race([
      ai.run(name, {
        messages: [
          { role: 'system', content: `${SYSTEM_INSTRUCTION} ${SHAPE_INSTRUCTION}` },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 2048,
        response_format: { type: 'json_schema', json_schema: PLAN_SCHEMA },
        // Gemma 4 reasons at length by default and can spend the whole reply budget on it.
        // A short structured plan does not need that, so thinking is switched off.
        chat_template_kwargs: { enable_thinking: false },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Workers AI timed out')), TIMEOUT_MS);
      }),
    ]);
    const plan = normalisePlan(extractJson(replyOf(result)));
    return plan ? { plan, model: name } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
