import { describe, expect, it } from 'vitest';
import { geocodeCity, reverseGeocode } from '../src/lib/geocode.js';
import { fakeFetch, geocodeReply, reverseReply } from './helpers.js';

describe('geocodeCity', () => {
  it('returns a readable place name and coordinates', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { body: geocodeReply } });
    expect(await geocodeCity('Delhi', fetchImpl)).toEqual({
      name: 'Delhi, Delhi, India',
      latitude: 28.65,
      longitude: 77.23,
    });
  });

  it('url encodes the city name', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { body: geocodeReply } });
    await geocodeCity('New Delhi&count=99', fetchImpl);
    expect(fetchImpl.calls[0].url).toContain('name=New+Delhi%26count%3D99');
  });

  it('reports an unknown place as 404', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { body: {} } });
    await expect(geocodeCity('Nowhereville', fetchImpl)).rejects.toMatchObject({ status: 404 });
  });

  it('reports an upstream failure as 502', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { status: 500 } });
    await expect(geocodeCity('Delhi', fetchImpl)).rejects.toMatchObject({ status: 502 });
  });
});

describe('reverseGeocode', () => {
  it('names the locality, city, state and country', async () => {
    const fetchImpl = fakeFetch({ nominatim: { body: reverseReply } });
    expect(await reverseGeocode(13.01, 80.26, fetchImpl)).toBe('Adyar, Chennai, Tamil Nadu, India');
    expect(fetchImpl.calls[0].url).toContain('lat=13.01&lon=80.26');
    expect(fetchImpl.calls[0].init.headers['User-Agent']).toContain('urban-air-quality-assistant');
  });

  it('does not repeat a name and strips markup', async () => {
    const fetchImpl = fakeFetch({
      nominatim: { body: { address: { town: 'Ooty', state: '<b>Tamil Nadu</b>', country: 'India' } } },
    });
    expect(await reverseGeocode(11.41, 76.7, fetchImpl)).toBe('Ooty,  b Tamil Nadu /b , India');
  });

  it.each([
    ['an upstream error', { status: 503 }],
    ['an empty address', { body: {} }],
    ['a network failure', new Error('offline')],
  ])('returns null on %s', async (_name, route) => {
    expect(await reverseGeocode(1, 2, fakeFetch({ nominatim: route }))).toBeNull();
  });
});
