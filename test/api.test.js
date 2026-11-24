// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, PLAN_TIMEOUT_MS, fetchPlan, lookUpPlace } from '../public/api.js';
import { planResponse, stubFetch } from './page.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchPlan', () => {
  it('posts the answers as JSON and returns the plan', async () => {
    const calls = stubFetch({ '/api/plan': { body: planResponse } });
    expect(await fetchPlan({ city: 'Delhi' })).toEqual(planResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ city: 'Delhi' });
  });

  it('passes on the message the server gives, with its status', async () => {
    stubFetch({ '/api/plan': { status: 429, body: { error: 'You are going a little fast.' } } });
    const error = await fetchPlan({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('You are going a little fast.');
    expect(error.status).toBe(429);
  });

  it('uses a plain message when the server gives none or the reply is not JSON', async () => {
    stubFetch({ '/api/plan': { status: 500, body: {} } });
    await expect(fetchPlan({})).rejects.toThrow('The plan could not be built. Please try again.');
    stubFetch({ '/api/plan': async () => new Response('<html>bad gateway</html>', { status: 502 }) });
    await expect(fetchPlan({})).rejects.toThrow('The plan could not be built. Please try again.');
  });

  it('reports a network failure without leaking its details', async () => {
    stubFetch({ '/api/plan': new Error('getaddrinfo ENOTFOUND internal-host') });
    const error = await fetchPlan({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).not.toContain('internal-host');
    expect(error.status).toBe(0);
  });

  /** A fetch that never answers until its signal aborts. */
  const hanging = (init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
    );

  it('gives up after the time limit with a clear message', async () => {
    vi.useFakeTimers();
    stubFetch({ '/api/plan': hanging });
    const pending = fetchPlan({}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(PLAN_TIMEOUT_MS + 10);
    expect((await pending).message).toBe('That took too long. Please try again.');
  });

  it('stops as soon as the caller cancels, and does not call that a timeout', async () => {
    stubFetch({ '/api/plan': hanging });
    const caller = new AbortController();
    const pending = fetchPlan({}, caller.signal).catch((e) => e);
    caller.abort();
    expect((await pending).message).toBe('The plan could not be built. Please try again.');
  });
});

describe('lookUpPlace', () => {
  it('returns the place name', async () => {
    const calls = stubFetch({ '/api/place': { body: { place: 'Adyar, Chennai' } } });
    expect(await lookUpPlace({ latitude: 13.01, longitude: 80.26 })).toBe('Adyar, Chennai');
    expect(calls[0].body).toEqual({ latitude: 13.01, longitude: 80.26 });
  });

  it.each([
    ['the server has no name', { body: { place: null } }],
    ['the server is rate limiting', { status: 429, body: { error: 'slow down' } }],
    ['the network fails', new Error('offline')],
  ])('returns an empty string when %s', async (_name, route) => {
    stubFetch({ '/api/place': route });
    expect(await lookUpPlace({ latitude: 1, longitude: 2 })).toBe('');
  });
});
