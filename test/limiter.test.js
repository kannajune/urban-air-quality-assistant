import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, RateLimiter, checkLimit, readLimits } from '../src/lib/limiter.js';

function fakeStorage() {
  const data = new Map();
  return { data, get: async (key) => data.get(key), put: async (key, value) => void data.set(key, value) };
}

function limiter(env = {}, start = Date.UTC(2026, 10, 24, 10, 0, 0)) {
  const time = { now: start };
  const storage = fakeStorage();
  const make = () => new RateLimiter({ storage }, env, () => time.now);
  return { time, storage, make, instance: make() };
}

describe('readLimits', () => {
  it('reads limits from configuration', () => {
    expect(readLimits({ LIMIT_VISITOR_PER_MINUTE: '3', LIMIT_VISITOR_PER_DAY: '10', LIMIT_AI_PER_DAY: '50' })).toEqual({
      perMinute: 3,
      perDay: 10,
      aiPerDay: 50,
    });
  });

  it('falls back to the defaults for missing, zero, negative or non numeric values', () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS);
    expect(readLimits(undefined)).toEqual(DEFAULT_LIMITS);
    expect(
      readLimits({ LIMIT_VISITOR_PER_MINUTE: '0', LIMIT_VISITOR_PER_DAY: '-4', LIMIT_AI_PER_DAY: 'unlimited' }),
    ).toEqual(DEFAULT_LIMITS);
  });
});

describe('RateLimiter', () => {
  it('allows exactly the per minute limit and blocks the next request', async () => {
    const { instance } = limiter({ LIMIT_VISITOR_PER_MINUTE: '5' });
    const results = [];
    for (let i = 0; i < 8; i += 1) results.push((await instance.check('1.1.1.1', false)).allowed);
    expect(results).toEqual([true, true, true, true, true, false, false, false]);
  });

  it('tells a blocked visitor how long to wait and lets them back after the minute', async () => {
    const { instance, time } = limiter({ LIMIT_VISITOR_PER_MINUTE: '1' });
    await instance.check('1.1.1.1', false);
    time.now += 20_000;
    expect(await instance.check('1.1.1.1', false)).toMatchObject({ allowed: false, reason: 'minute', retryAfter: 40 });
    time.now += 40_000;
    expect((await instance.check('1.1.1.1', false)).allowed).toBe(true);
  });

  it('counts each visitor separately', async () => {
    const { instance } = limiter({ LIMIT_VISITOR_PER_MINUTE: '1' });
    expect((await instance.check('1.1.1.1', false)).allowed).toBe(true);
    expect((await instance.check('2.2.2.2', false)).allowed).toBe(true);
    expect((await instance.check('1.1.1.1', false)).allowed).toBe(false);
  });

  it('stops a visitor who stays under the minute limit but drains the day', async () => {
    const { instance, time } = limiter({ LIMIT_VISITOR_PER_MINUTE: '2', LIMIT_VISITOR_PER_DAY: '3' });
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await instance.check('1.1.1.1', false));
      time.now += 61_000;
    }
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3].reason).toBe('day');
  });

  it('caps AI calls for the whole app per day, across visitors, while still serving requests', async () => {
    const { instance } = limiter({ LIMIT_AI_PER_DAY: '2' });
    const results = [];
    for (const visitor of ['a', 'b', 'c', 'd']) results.push(await instance.check(visitor, true));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true]);
    expect(results.map((result) => result.ai)).toEqual([true, true, false, false]);
  });

  it('does not spend the AI allowance on requests that do not need the model or are blocked', async () => {
    const { instance, storage } = limiter({ LIMIT_AI_PER_DAY: '5', LIMIT_VISITOR_PER_MINUTE: '1' });
    await instance.check('a', false);
    await instance.check('a', true);
    expect(storage.data.size).toBe(0);
  });

  it('keeps the AI total when the object restarts, and stores no visitor address', async () => {
    const { instance, make, storage } = limiter({ LIMIT_AI_PER_DAY: '2' });
    await instance.check('203.0.113.9', true);
    await instance.check('203.0.113.10', true);
    const restarted = make();
    expect((await restarted.check('203.0.113.11', true)).ai).toBe(false);
    expect([...storage.data.keys()]).toEqual(['ai:2026-11-24']);
    expect(JSON.stringify([...storage.data.entries()])).not.toContain('203.0.113');
  });

  it('starts fresh on a new UTC day', async () => {
    const { instance, time } = limiter({ LIMIT_AI_PER_DAY: '1', LIMIT_VISITOR_PER_DAY: '1' });
    expect(await instance.check('a', true)).toMatchObject({ allowed: true, ai: true });
    time.now += 61_000;
    expect((await instance.check('a', true)).allowed).toBe(false);
    time.now += 24 * 60 * 60 * 1000;
    expect(await instance.check('a', true)).toMatchObject({ allowed: true, ai: true });
  });

  it('can reserve a model call without counting the visit again', async () => {
    const { instance } = limiter({ LIMIT_VISITOR_PER_MINUTE: '1', LIMIT_AI_PER_DAY: '1' });
    expect((await instance.check('a', false)).allowed).toBe(true);
    expect(await instance.check('a', true, false)).toMatchObject({ allowed: true, ai: true });
    expect(await instance.check('a', true, false)).toMatchObject({ allowed: true, ai: false });
  });

  it('answers over its fetch entry point', async () => {
    const { instance } = limiter({ LIMIT_VISITOR_PER_MINUTE: '1' });
    const ask = () =>
      instance.fetch(
        new Request('https://limiter.internal/check', {
          method: 'POST',
          body: JSON.stringify({ visitor: 'a', wantsAi: true }),
        }),
      );
    expect(await (await ask()).json()).toMatchObject({ allowed: true, ai: true });
    expect(await (await ask()).json()).toMatchObject({ allowed: false, ai: false });
  });
});

describe('checkLimit', () => {
  it('allows everything when no limiter is bound', async () => {
    expect(await checkLimit({}, 'a', { countVisit: true, wantsAi: true })).toMatchObject({ allowed: true, ai: true });
  });

  it('uses one shared limiter object and passes the visitor through', async () => {
    const { instance } = limiter({ LIMIT_VISITOR_PER_MINUTE: '1' });
    const names = [];
    const env = {
      LIMITER: {
        idFromName: (name) => (names.push(name), name),
        get: () => ({ fetch: (url, init) => instance.fetch(new Request(url, init)) }),
      },
    };
    expect((await checkLimit(env, 'a', { countVisit: true, wantsAi: false })).allowed).toBe(true);
    expect((await checkLimit(env, 'a', { countVisit: true, wantsAi: false })).allowed).toBe(false);
    expect(names).toEqual(['global', 'global']);
  });

  it('fails safe for the key: if the limiter breaks, serve the request without an AI call', async () => {
    const env = {
      LIMITER: {
        idFromName: () => 'x',
        get: () => ({
          fetch: async () => {
            throw new Error('down');
          },
        }),
      },
    };
    expect(await checkLimit(env, 'a', { countVisit: true, wantsAi: true })).toMatchObject({ allowed: true, ai: false });
  });
});
