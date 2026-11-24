/** Shared fixtures and a fake fetch for the tests. No test touches the network. */

export const validAnswers = Object.freeze({
  city: 'Delhi',
  commute: 'car',
  cookingFuel: 'lpg',
  outdoorTime: '1_to_3h',
  budget: 'low',
  household: ['children', 'asthma'],
  hasPurifier: false,
});

export const geocodeReply = {
  results: [{ name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.23 }],
};

export const airReply = {
  timezone: 'Asia/Kolkata',
  current: { time: '2026-11-23T09:00', us_aqi: 312.4, pm2_5: 210.44, pm10: 340.12, nitrogen_dioxide: 61.2, ozone: 12 },
  hourly: {
    time: ['2026-11-23T08:00', '2026-11-23T09:00', '2026-11-23T10:00', '2026-11-23T21:00'],
    us_aqi: [500, 312, 290, 365],
  },
};

export const modelPlan = {
  summary: 'Air is hazardous in Delhi today. Keep the children indoors until early afternoon.',
  routine: [
    {
      title: 'Shift the school run',
      detail: 'Leave after ten.',
      impact: 'Cuts peak exposure by about half.',
      cost: 'free',
      benefit: 'high',
    },
  ],
  indoor: [
    {
      title: 'Seal one room',
      detail: 'Tape the window gaps.',
      impact: 'Less smog leaks in overnight.',
      cost: 'low',
      benefit: 'medium',
    },
  ],
  alternatives: [
    {
      title: 'Share the car',
      detail: 'Pool with a neighbour.',
      impact: 'Halves emissions per person.',
      cost: 'free',
      benefit: 'high',
    },
  ],
};

/** A Workers AI binding that always answers with the given reply. */
export function fakeAi(reply) {
  const calls = [];
  return { calls, run: async (model, input) => (calls.push({ model, input }), reply) };
}

/**
 * Build a fake fetch that routes by URL substring and records every call.
 * @param {Record<string, {status?: number, body?: unknown}|Error>} routes
 */
export function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((part) => String(url).includes(part));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    const route = routes[key];
    if (route instanceof Error) throw route;
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  impl.calls = calls;
  return impl;
}

/** @param {unknown} body @param {Record<string, string>} [headers] */
export function planRequest(body, headers = { 'Content-Type': 'application/json' }) {
  return new Request('https://app.test/api/plan', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const reverseReply = {
  address: { suburb: 'Adyar', city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
};
