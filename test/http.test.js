import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  SECURITY_HEADERS,
  fetchWithTimeout,
  json,
  readJsonBody,
  withSecurityHeaders,
} from '../src/lib/http.js';

afterEach(() => vi.useRealTimers());

const post = (body, type = 'application/json') =>
  new Request('https://app.test/api/plan', { method: 'POST', headers: { 'Content-Type': type }, body });

describe('json', () => {
  it('answers with JSON, no caching and every security header', async () => {
    const response = json({ ok: true }, 201, { 'Retry-After': '5' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('5');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name)).toBe(value);
  });

  it('defaults to 200', () => {
    expect(json({}).status).toBe(200);
  });
});

describe('withSecurityHeaders', () => {
  it('adds the security headers and keeps the status, body and existing headers', async () => {
    const original = new Response('<!doctype html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html', ETag: '"abc"' },
    });
    const secured = withSecurityHeaders(original);
    expect(secured.status).toBe(404);
    expect(await secured.text()).toBe('<!doctype html>');
    expect(secured.headers.get('ETag')).toBe('"abc"');
    expect(secured.headers.get('X-Frame-Options')).toBe('DENY');
    expect(secured.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});

describe('security headers', () => {
  it('allow nothing from other origins and forbid framing', () => {
    const policy = SECURITY_HEADERS['Content-Security-Policy'];
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/https?:/);
  });
});

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    expect(await readJsonBody(post('{"city":"Delhi"}'))).toEqual({ city: 'Delhi' });
    expect(await readJsonBody(post('{"a":1}', 'application/json; charset=utf-8'))).toEqual({ a: 1 });
  });

  it.each([
    ['a body that is not JSON', post('{oops'), 400],
    ['the wrong content type', post('{}', 'text/plain'), 415],
    ['a body over the size limit', post(JSON.stringify({ pad: 'x'.repeat(5000) })), 413],
  ])('rejects %s', async (_name, request, status) => {
    const error = await readJsonBody(request).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(status);
  });

  it('counts bytes, not characters, against the limit', async () => {
    const body = JSON.stringify({ text: 'ஃ'.repeat(40) });
    expect(body.length).toBeLessThan(100);
    await expect(readJsonBody(post(body), 100)).rejects.toMatchObject({ status: 413 });
  });

  it('rejects a request with no content type at all', async () => {
    const request = new Request('https://app.test/api/plan', { method: 'POST', body: new Uint8Array([123, 125]) });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 415 });
  });
});

describe('fetchWithTimeout', () => {
  it('passes the request through and returns the response', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const response = await fetchWithTimeout(fetchImpl, 'https://example.test/x', { headers: { A: 'b' } });
    expect(await response.text()).toBe('ok');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.test/x');
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ A: 'b' });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a call that takes longer than the limit', async () => {
    vi.useFakeTimers();
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const pending = fetchWithTimeout(fetchImpl, 'https://slow.test/', {}, 1000).catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toBe('aborted');
  });

  it('clears its timer once the call finishes, so nothing is left running', async () => {
    vi.useFakeTimers();
    await fetchWithTimeout(async () => new Response('ok'), 'https://fast.test/');
    expect(vi.getTimerCount()).toBe(0);
  });
});
