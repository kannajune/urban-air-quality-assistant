/**
 * The shape of a plan, shared by the Gemini path and the built in fallback.
 */

export const SECTIONS = Object.freeze(['routine', 'indoor', 'alternatives']);

/** What a step costs the household, and how much it helps. */
export const COSTS = Object.freeze(['free', 'low', 'medium']);
export const BENEFITS = Object.freeze(['high', 'medium', 'low']);

const MAX_ITEMS = 5;
const MAX_TEXT = 320;

/** JSON schema sent to Gemini so the reply is structured, not free text. */
export const PLAN_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    routine: { type: 'ARRAY', items: itemSchema() },
    indoor: { type: 'ARRAY', items: itemSchema() },
    alternatives: { type: 'ARRAY', items: itemSchema() },
  },
  required: ['summary', 'routine', 'indoor', 'alternatives'],
});

function itemSchema() {
  return {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      detail: { type: 'STRING' },
      impact: { type: 'STRING' },
      cost: { type: 'STRING', enum: COSTS },
      benefit: { type: 'STRING', enum: BENEFITS },
    },
    required: ['title', 'detail', 'impact', 'cost', 'benefit'],
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanText(value) {
  if (typeof value !== 'string') return '';
  // Strip control characters and markup brackets; the UI renders text only.
  return value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/**
 * Check and trim a plan produced by the model. Returns null when it is unusable.
 * Model output is untrusted input, so it is validated like any other.
 * @param {unknown} raw
 * @returns {{summary: string, routine: object[], indoor: object[], alternatives: object[]}|null}
 */
export function normalisePlan(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = /** @type {Record<string, unknown>} */ (raw);
  const summary = cleanText(source.summary);
  if (!summary) return null;

  const plan = { summary, routine: [], indoor: [], alternatives: [] };
  for (const section of SECTIONS) {
    const items = Array.isArray(source[section]) ? source[section] : [];
    plan[section] = items
      .slice(0, MAX_ITEMS)
      .map((item) => ({
        title: cleanText(item?.title),
        detail: cleanText(item?.detail),
        impact: cleanText(item?.impact),
        // Tags outside the allowed set fall back to the middle value rather than failing the plan.
        cost: COSTS.includes(item?.cost) ? item.cost : 'low',
        benefit: BENEFITS.includes(item?.benefit) ? item.benefit : 'medium',
      }))
      .filter((item) => item.title && item.detail && item.impact);
    if (plan[section].length === 0) return null;
  }
  return plan;
}
