import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { airReply, fakeFetch, geminiReply, geocodeReply, modelPlan, planRequest, reverseReply, validAnswers } from './helpers.js';

const assets = { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) };

function env(overrides = {}) {
  return {
    ASSETS: assets,
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-3.5-flash',
    fetchImpl: fakeFetch({
      'geocoding-api': { body: geocodeReply },
      'air-quality-api': { body: airReply },
      nominatim: { body: reverseReply },
      generativelanguage: { body: geminiReply(modelPlan) },
    }),
    ...overrides,
  };
}

describe('worker routes', () => {
  it('serves static assets with security headers', async () => {
    const response = await worker.fetch(new Request('https://app.test/'), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('answers the health check', async () => {
    const response = await worker.fetch(new Request('https://app.test/api/health'), env());
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 404 for unknown API paths', async () => {
    const response = await worker.fetch(new Request('https://app.test/api/secrets'), env());
    expect(response.status).toBe(404);
  });

  it('rejects GET on the plan endpoint', async () => {
    const response = await worker.fetch(new Request('https://app.test/api/plan'), env());
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

describe('POST /api/plan', () => {
  it('returns live air quality and a Gemini plan', async () => {
    const response = await worker.fetch(planRequest(validAnswers), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json();
    expect(data.place).toBe('Delhi, Delhi, India');
    expect(data.air.aqi).toBe(312);
    expect(data.source).toBe('gemini');
    expect(data.model).toBe('gemini-3.5-flash');
    expect(data.plan).toEqual(modelPlan);
  });

  it('never returns the API key to the client', async () => {
    const response = await worker.fetch(planRequest(validAnswers), env());
    expect(await response.text()).not.toContain('test-key');
  });

  it('skips geocoding when coordinates are sent', async () => {
    const testEnv = env();
    const response = await worker.fetch(planRequest({ ...validAnswers, city: '', latitude: 13.08, longitude: 80.27 }), testEnv);
    const data = await response.json();
    expect(data.place).toBe('Adyar, Chennai, Tamil Nadu, India');
    expect(testEnv.fetchImpl.calls.some((call) => call.url.includes('geocoding-api'))).toBe(false);
  });

  it('still builds a plan when the place name lookup fails', async () => {
    const fetchImpl = fakeFetch({
      'air-quality-api': { body: airReply },
      nominatim: { status: 500 },
      generativelanguage: { body: geminiReply(modelPlan) },
    });
    const response = await worker.fetch(planRequest({ ...validAnswers, city: '', latitude: 13.08, longitude: 80.27 }), env({ fetchImpl }));
    expect(response.status).toBe(200);
    expect((await response.json()).place).toBe('your location');
  });

  it('falls back to the built in plan when Gemini fails', async () => {
    const fetchImpl = fakeFetch({
      'geocoding-api': { body: geocodeReply },
      'air-quality-api': { body: airReply },
      generativelanguage: { status: 500 },
    });
    const data = await (await worker.fetch(planRequest(validAnswers), env({ fetchImpl }))).json();
    expect(data.source).toBe('fallback');
    expect(data.plan.routine.length).toBeGreaterThan(0);
  });

  it('falls back when no key is configured', async () => {
    const data = await (await worker.fetch(planRequest(validAnswers), env({ GEMINI_API_KEY: undefined }))).json();
    expect(data.source).toBe('fallback');
  });

  it('rejects invalid answers with 400', async () => {
    const response = await worker.fetch(planRequest({ ...validAnswers, commute: 'rocket' }), env());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('commute');
  });

  it('rejects a body that is not JSON', async () => {
    expect((await worker.fetch(planRequest('{oops'), env())).status).toBe(400);
  });

  it('rejects the wrong content type', async () => {
    const response = await worker.fetch(planRequest(validAnswers, { 'Content-Type': 'text/plain' }), env());
    expect(response.status).toBe(415);
  });

  it('rejects an oversized body', async () => {
    const response = await worker.fetch(planRequest({ ...validAnswers, padding: 'x'.repeat(5000) }), env());
    expect(response.status).toBe(413);
  });

  it('passes upstream errors through with a safe message', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { body: {} } });
    const response = await worker.fetch(planRequest(validAnswers), env({ fetchImpl }));
    expect(response.status).toBe(404);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = fakeFetch({ 'geocoding-api': new Error('db password is hunter2') });
    const response = await worker.fetch(planRequest(validAnswers), env({ fetchImpl }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
    log.mockRestore();
  });
});

describe('POST /api/place', () => {
  const placeRequest = (body) =>
    new Request('https://app.test/api/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('returns the place name and the rounded coordinates', async () => {
    const response = await worker.fetch(placeRequest({ latitude: 13.006712, longitude: 80.257891 }), env());
    expect(await response.json()).toEqual({ place: 'Adyar, Chennai, Tamil Nadu, India', latitude: 13.01, longitude: 80.26 });
  });

  it('sends only rounded coordinates to the lookup service', async () => {
    const testEnv = env();
    await worker.fetch(placeRequest({ latitude: 13.006712, longitude: 80.257891 }), testEnv);
    expect(testEnv.fetchImpl.calls[0].url).toContain('lat=13.01&lon=80.26');
  });

  it('returns a null name when the lookup fails', async () => {
    const response = await worker.fetch(placeRequest({ latitude: 1, longitude: 2 }), env({ fetchImpl: fakeFetch({ nominatim: { status: 500 } }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).place).toBeNull();
  });

  it.each([
    ['missing coordinates', {}],
    ['a latitude out of range', { latitude: 200, longitude: 10 }],
    ['a body that is not an object', []],
  ])('rejects %s with 400', async (_name, body) => {
    expect((await worker.fetch(placeRequest(body), env())).status).toBe(400);
  });

  it('rejects GET and is rate limited like the plan endpoint', async () => {
    expect((await worker.fetch(new Request('https://app.test/api/place'), env())).status).toBe(405);
    const blocked = env({ VISITOR_LIMIT: { limit: async () => ({ success: false }) } });
    expect((await worker.fetch(placeRequest({ latitude: 1, longitude: 2 }), blocked)).status).toBe(429);
  });
});

describe('rate limits', () => {
  const limiter = (success) => ({ limit: vi.fn(async () => ({ success })) });

  it('limits each visitor by IP address', async () => {
    const VISITOR_LIMIT = limiter(false);
    const request = planRequest(validAnswers, { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' });
    const testEnv = env({ VISITOR_LIMIT, APP_LIMIT: limiter(true) });
    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(VISITOR_LIMIT.limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(testEnv.fetchImpl.calls).toHaveLength(0);
  });

  it('applies a ceiling to the whole app', async () => {
    const APP_LIMIT = limiter(false);
    const response = await worker.fetch(planRequest(validAnswers), env({ VISITOR_LIMIT: limiter(true), APP_LIMIT }));
    expect(response.status).toBe(429);
    expect(APP_LIMIT.limit).toHaveBeenCalledWith({ key: 'all' });
  });

  it('lets requests through when both limits allow', async () => {
    const response = await worker.fetch(planRequest(validAnswers), env({ VISITOR_LIMIT: limiter(true), APP_LIMIT: limiter(true) }));
    expect(response.status).toBe(200);
  });
});
