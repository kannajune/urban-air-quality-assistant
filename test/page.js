/** Helpers for tests that run against the real page markup in jsdom. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { forgetElements } from '../public/dom.js';

// Tests run from the project root. In the jsdom environment import.meta.url is not a file path.
const html = readFileSync(join(process.cwd(), 'public/index.html'), 'utf8');

/** Load public/index.html into the test document, as a fresh page. */
export function loadPage() {
  document.open();
  document.write(html);
  document.close();
  forgetElements();
  // jsdom has no layout engine, so these browser features are stood in for.
  window.matchMedia = /** @type {any} */ (() => ({ matches: true }));
  Element.prototype.scrollIntoView = vi.fn();
}

/** A plan response shaped like the one the Worker returns. */
export const planResponse = {
  place: 'Delhi, Delhi, India',
  source: 'ai',
  model: '@cf/google/gemma-4-26b-a4b-it',
  air: {
    aqi: 182,
    level: 'unhealthy',
    label: 'Unhealthy',
    advice: 'Everyone should reduce time and effort outdoors.',
    pm25: 98,
    pm10: 100.1,
    no2: 16.1,
    ozone: 75,
    forecast: [
      { time: '2026-11-23T09:00', aqi: 182, level: 'unhealthy' },
      { time: '2026-11-23T10:00', aqi: 150, level: 'sensitive' },
      { time: '2026-11-23T21:00', aqi: 210, level: 'very_unhealthy' },
    ],
    cleanest: { time: '2026-11-23T10:00', aqi: 150, label: 'Unhealthy for sensitive groups' },
    peak: { time: '2026-11-23T21:00', aqi: 210, label: 'Very unhealthy' },
  },
  plan: {
    summary: 'Air is unhealthy in Delhi. Keep the children indoors until early afternoon.',
    routine: [
      {
        title: 'Shift the school run',
        detail: 'Leave after ten.',
        impact: 'Cuts peak exposure by about half.',
        cost: 'free',
        benefit: 'high',
      },
      {
        title: 'Wear a fitted mask',
        detail: 'Use an N95.',
        impact: 'Filters most fine particles.',
        cost: 'low',
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
        benefit: 'low',
      },
    ],
  },
};

/**
 * Replace fetch with one that answers from a table of path to reply.
 * @param {Record<string, {status?: number, body?: unknown}|Error|(() => Promise<Response>)>} routes
 */
export function stubFetch(routes) {
  const calls = [];
  const impl = vi.fn(async (path, init = {}) => {
    calls.push({ path: String(path), body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal });
    const route = routes[String(path)];
    if (route instanceof Error) throw route;
    if (typeof route === 'function') return route(init);
    return new Response(JSON.stringify(route?.body ?? {}), { status: route?.status ?? 200 });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

/** Let pending promises and timers settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
