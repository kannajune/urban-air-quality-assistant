// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byId } from '../public/dom.js';
import { loadPage, planResponse, settle, stubFetch } from './page.js';

/** Load the page, then attach the page script to it, as a browser would. */
async function startPage() {
  loadPage();
  const app = await import('../public/app.js');
  app.init();
  return app;
}

const field = (id) => /** @type {HTMLInputElement} */ (byId(id));
const submit = () => byId('plan-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
function typeCity(name) {
  field('city').value = name;
  field('city').dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(startPage);
afterEach(() => vi.unstubAllGlobals());

describe('asking for a plan', () => {
  it('sends the form answers and shows the plan', async () => {
    const calls = stubFetch({ '/api/plan': { body: planResponse } });
    typeCity('Delhi');
    document.querySelector('input[value="asthma"]').checked = true;
    field('commute').value = 'car';
    submit();
    await settle();

    expect(calls[0].path).toBe('/api/plan');
    expect(calls[0].body).toMatchObject({ city: 'Delhi', commute: 'car', household: ['asthma'], hasPurifier: false });
    expect(byId('results').hidden).toBe(false);
    expect(byId('status').textContent).toBe('Your plan is ready.');
    expect(byId('status').getAttribute('role')).toBe('status');
  });

  it('shows progress and blocks a double submit while waiting', async () => {
    let release;
    stubFetch({
      '/api/plan': () =>
        new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify(planResponse))))),
    });
    typeCity('Delhi');
    submit();
    await settle();
    expect(field('submit').disabled).toBe(true);
    expect(byId('submit').getAttribute('aria-busy')).toBe('true');
    expect(byId('status').textContent).toContain('writing your plan');
    release();
    await settle();
    expect(field('submit').disabled).toBe(false);
    expect(byId('submit').hasAttribute('aria-busy')).toBe(false);
  });

  it('asks for a place before calling the server, and points at the field', async () => {
    const calls = stubFetch({});
    submit();
    await settle();
    expect(calls).toHaveLength(0);
    expect(byId('city-error').hidden).toBe(false);
    expect(byId('city-error').textContent).toBe('Enter a city or town, or use your location.');
    expect(byId('city').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(byId('city'));
  });

  it('clears the field error once a city is typed', async () => {
    stubFetch({});
    submit();
    typeCity('Pune');
    expect(byId('city-error').hidden).toBe(true);
    expect(byId('city').hasAttribute('aria-invalid')).toBe(false);
  });

  it('announces a server error as an alert and lets the visitor try again', async () => {
    stubFetch({
      '/api/plan': { status: 429, body: { error: 'You are going a little fast. Please try again in 40 seconds.' } },
    });
    typeCity('Delhi');
    submit();
    await settle();
    const status = byId('status');
    expect(status.textContent).toBe('You are going a little fast. Please try again in 40 seconds.');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.classList.contains('is-error')).toBe(true);
    expect(field('submit').disabled).toBe(false);
    expect(byId('results').hidden).toBe(true);
  });

  it('lets a newer request replace an older one that has not answered', async () => {
    const signals = [];
    const replies = [];
    stubFetch({
      '/api/plan': (init) => {
        signals.push(init.signal);
        return new Promise((resolve, reject) => {
          replies.push(resolve);
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      },
    });
    typeCity('Delhi');
    submit();
    await settle();
    typeCity('Pune');
    submit();
    await settle();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    // The cancelled first request must not put an error over the second one's progress.
    expect(byId('status').classList.contains('is-error')).toBe(false);
    replies[1](new Response(JSON.stringify({ ...planResponse, place: 'Pune, India' })));
    await settle();
    expect(byId('place').textContent).toBe('Pune, India');
    expect(field('submit').disabled).toBe(false);
  });
});

describe('using the current location', () => {
  /** @param {(ok: Function, fail: Function) => void} behaviour */
  const stubLocation = (behaviour) =>
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn(behaviour) } });

  it('shows the place name and sends coordinates instead of a city', async () => {
    const calls = stubFetch({
      '/api/place': { body: { place: 'Adyar, Chennai' } },
      '/api/plan': { body: planResponse },
    });
    stubLocation((ok) => ok({ coords: { latitude: 13.0067, longitude: 80.2578 } }));
    typeCity('Delhi');
    byId('locate').click();
    await settle();

    expect(byId('location-chip').hidden).toBe(false);
    expect(byId('location-name').textContent).toBe('Adyar, Chennai');
    expect(field('city').value).toBe('');
    expect(field('city').placeholder).toBe('Using your location');
    expect(byId('status').textContent).toBe('Location found: Adyar, Chennai.');

    submit();
    await settle();
    expect(calls[1].body).toMatchObject({ city: '', latitude: 13.0067, longitude: 80.2578 });
  });

  it('still works when the place has no name', async () => {
    stubFetch({ '/api/place': { body: { place: null } } });
    stubLocation((ok) => ok({ coords: { latitude: 1, longitude: 2 } }));
    byId('locate').click();
    await settle();
    expect(byId('location-name').textContent).toBe('your current location');
    expect(byId('status').textContent).toContain('Location found.');
  });

  it('drops the shared location when a city is typed afterwards', async () => {
    const calls = stubFetch({
      '/api/place': { body: { place: 'Adyar, Chennai' } },
      '/api/plan': { body: planResponse },
    });
    stubLocation((ok) => ok({ coords: { latitude: 13.0067, longitude: 80.2578 } }));
    byId('locate').click();
    await settle();
    typeCity('Pune');
    expect(byId('location-chip').hidden).toBe(true);
    expect(field('city').placeholder).toBe('For example Delhi');
    submit();
    await settle();
    expect(calls[1].body).not.toHaveProperty('latitude');
  });

  it('explains what to do when the visitor declines to share', async () => {
    stubLocation((_ok, fail) => fail(new Error('denied')));
    byId('locate').click();
    await settle();
    expect(byId('status').textContent).toBe('Location was not shared. Type your city instead.');
    expect(byId('status').getAttribute('role')).toBe('alert');
  });

  it('explains what to do in a browser without location support', () => {
    vi.stubGlobal('navigator', {});
    byId('locate').click();
    expect(byId('status').textContent).toBe('This browser cannot share a location. Type your city instead.');
  });
});

describe('header animation', () => {
  it('pauses while the header is scrolled out of view and resumes when it returns', async () => {
    let notify;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          notify = callback;
        }
        observe() {}
      },
    );
    await startPage();
    notify([{ isIntersecting: false }]);
    expect(byId('hero').classList.contains('is-offscreen')).toBe(true);
    notify([{ isIntersecting: true }]);
    expect(byId('hero').classList.contains('is-offscreen')).toBe(false);
  });
});
