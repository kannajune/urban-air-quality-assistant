import { describe, expect, it, vi } from 'vitest';
import { TTL, cacheOf, cached, digest } from '../src/lib/cache.js';
import worker from '../src/index.js';
import {
  airReply,
  fakeAi,
  fakeFetch,
  geocodeReply,
  modelPlan,
  planRequest,
  reverseReply,
  validAnswers,
} from './helpers.js';

/** A stand in for the edge cache that records what it was asked. */
export function fakeCache() {
  const store = new Map();
  return {
    store,
    match: async (key) => (store.has(key) ? new Response(store.get(key).body) : undefined),
    put: async (key, response) =>
      void store.set(key, { body: await response.text(), control: response.headers.get('Cache-Control') }),
  };
}

describe('cached', () => {
  it('loads once, then answers from the cache', async () => {
    const cache = fakeCache();
    const load = vi.fn(async () => ({ aqi: 150 }));
    expect(await cached(cache, 'air', '28.6,77.2', 600, load)).toEqual({ value: { aqi: 150 }, hit: false });
    expect(await cached(cache, 'air', '28.6,77.2', 600, load)).toEqual({ value: { aqi: 150 }, hit: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stores the value with its time to live and a safely encoded key', async () => {
    const cache = fakeCache();
    await cached(cache, 'place', 'new delhi/../x', 86400, async () => ({ name: 'Delhi' }));
    const [[key, entry]] = [...cache.store.entries()];
    expect(key).toBe('https://cache.internal/place/new%20delhi%2F..%2Fx');
    expect(entry.control).toBe('max-age=86400');
  });

  it('keeps groups apart', async () => {
    const cache = fakeCache();
    await cached(cache, 'place', 'x', 60, async () => 'a place');
    expect((await cached(cache, 'air', 'x', 60, async () => 'a reading')).value).toBe('a reading');
  });

  it('does not cache an empty result, so a failed lookup is tried again', async () => {
    const cache = fakeCache();
    const load = vi.fn(async () => null);
    await cached(cache, 'plan', 'k', 60, load);
    await cached(cache, 'plan', 'k', 60, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(0);
  });

  it('does not cache a failure', async () => {
    const cache = fakeCache();
    await expect(
      cached(cache, 'air', 'k', 60, async () => {
        throw new Error('upstream down');
      }),
    ).rejects.toThrow('upstream down');
    expect(cache.store.size).toBe(0);
  });

  it('still answers when the cache itself is broken', async () => {
    const broken = {
      match: async () => {
        throw new Error('cache down');
      },
      put: async () => {
        throw new Error('cache down');
      },
    };
    expect(await cached(broken, 'air', 'k', 60, async () => 7)).toEqual({ value: 7, hit: false });
  });

  it('simply loads when there is no cache', async () => {
    expect(await cached(null, 'air', 'k', 60, async () => 7)).toEqual({ value: 7, hit: false });
  });
});

describe('cacheOf and digest', () => {
  it('prefers an injected cache and returns null when none exists', () => {
    const cache = fakeCache();
    expect(cacheOf({ cache })).toBe(cache);
    expect(cacheOf({})).toBeNull();
  });

  it('hashes text to a fixed length key', async () => {
    const key = await digest('prompt text');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await digest('prompt text')).toBe(key);
    expect(await digest('other text')).not.toBe(key);
  });

  it('keeps readings fresher than places', () => {
    expect(TTL.air).toBeLessThan(TTL.place);
    expect(TTL.plan).toBeLessThanOrEqual(TTL.air);
  });
});

describe('caching in the plan route', () => {
  const assets = { fetch: async () => new Response('') };
  const makeEnv = (extra = {}) => ({
    ASSETS: assets,
    AI: fakeAi({ response: JSON.stringify(modelPlan) }),
    cache: fakeCache(),
    fetchImpl: fakeFetch({
      'geocoding-api': { body: geocodeReply },
      'air-quality-api': { body: airReply },
      nominatim: { body: reverseReply },
    }),
    ...extra,
  });

  it('answers a repeat request without calling the upstream services or the model again', async () => {
    const env = makeEnv();
    const first = await (await worker.fetch(planRequest(validAnswers), env)).json();
    const second = await (await worker.fetch(planRequest(validAnswers), env)).json();
    expect(second).toEqual(first);
    expect(second.source).toBe('ai');
    expect(env.fetchImpl.calls).toHaveLength(2);
    expect(env.AI.calls).toHaveLength(1);
  });

  it('writes a new plan when the household answers change, while reusing the reading', async () => {
    const env = makeEnv();
    await worker.fetch(planRequest(validAnswers), env);
    await worker.fetch(planRequest({ ...validAnswers, commute: 'bus' }), env);
    expect(env.AI.calls).toHaveLength(2);
    expect(env.fetchImpl.calls).toHaveLength(2);
  });

  it('does not spend the daily model allowance on a cached plan', async () => {
    const reserved = [];
    const LIMITER = {
      idFromName: () => 'global',
      get: () => ({
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          if (body.wantsAi) reserved.push(body);
          return new Response(JSON.stringify({ allowed: true, ai: body.wantsAi, reason: null, retryAfter: 0 }));
        },
      }),
    };
    const env = makeEnv({ LIMITER });
    await worker.fetch(planRequest(validAnswers), env);
    await worker.fetch(planRequest(validAnswers), env);
    expect(reserved).toHaveLength(1);
    expect(reserved[0].countVisit).toBe(false);
  });

  it('does not cache a failed model call, so the next request tries again', async () => {
    let fail = true;
    const AI = {
      run: vi.fn(async () => {
        if (fail) throw new Error('busy');
        return { response: JSON.stringify(modelPlan) };
      }),
    };
    const env = makeEnv({ AI });
    expect((await (await worker.fetch(planRequest(validAnswers), env)).json()).source).toBe('fallback');
    fail = false;
    expect((await (await worker.fetch(planRequest(validAnswers), env)).json()).source).toBe('ai');
  });

  it('looks up the place name and the reading together for a shared location', async () => {
    const order = [];
    const fetchImpl = async (url) => {
      order.push(`start ${String(url).includes('nominatim') ? 'name' : 'air'}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${String(url).includes('nominatim') ? 'name' : 'air'}`);
      return new Response(JSON.stringify(String(url).includes('nominatim') ? reverseReply : airReply));
    };
    await worker.fetch(
      planRequest({ ...validAnswers, city: '', latitude: 13.08, longitude: 80.27 }),
      makeEnv({ fetchImpl }),
    );
    expect(order.slice(0, 2).map((step) => step.split(' ')[0])).toEqual(['start', 'start']);
  });
});
