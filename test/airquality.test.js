import { describe, expect, it } from 'vitest';
import { classifyAqi, fetchAirQuality, geocodeCity, reverseGeocode, upcomingHours, worstUpcomingHour } from '../src/lib/airquality.js';
import { airReply, fakeFetch, geocodeReply, reverseReply } from './helpers.js';

describe('classifyAqi', () => {
  it.each([
    [0, 'good'],
    [50, 'good'],
    [51, 'moderate'],
    [100, 'moderate'],
    [101, 'sensitive'],
    [150, 'sensitive'],
    [151, 'unhealthy'],
    [200, 'unhealthy'],
    [201, 'very_unhealthy'],
    [300, 'very_unhealthy'],
    [301, 'hazardous'],
    [999, 'hazardous'],
  ])('maps AQI %i to %s', (aqi, level) => {
    expect(classifyAqi(aqi).level).toBe(level);
  });

  it('treats negative and invalid readings as good rather than crashing', () => {
    expect(classifyAqi(-5).level).toBe('good');
    expect(classifyAqi(Number.NaN).level).toBe('good');
  });
});

describe('worstUpcomingHour', () => {
  it('ignores hours in the past and picks the highest upcoming one', () => {
    expect(worstUpcomingHour(airReply.hourly, '2026-11-23T09:00')).toEqual({ time: '2026-11-23T21:00', aqi: 365 });
  });

  it('looks no further than 24 hours ahead', () => {
    const time = Array.from({ length: 30 }, (_, i) => `2026-11-${String(23 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`);
    const us_aqi = time.map((_, i) => (i === 29 ? 900 : 100));
    expect(worstUpcomingHour({ time, us_aqi }, '2026-11-23T00:00').aqi).toBe(100);
  });

  it('skips missing readings and returns null when there is no data', () => {
    expect(worstUpcomingHour({ time: ['2026-11-23T10:00'], us_aqi: [null] }, '2026-11-23T09:00')).toBeNull();
    expect(worstUpcomingHour({}, '2026-11-23T09:00')).toBeNull();
  });
});

describe('upcomingHours', () => {
  it('lists upcoming hours with their band and skips the past', () => {
    expect(upcomingHours(airReply.hourly, '2026-11-23T09:00')).toEqual([
      { time: '2026-11-23T09:00', aqi: 312, level: 'hazardous' },
      { time: '2026-11-23T10:00', aqi: 290, level: 'very_unhealthy' },
      { time: '2026-11-23T21:00', aqi: 365, level: 'hazardous' },
    ]);
  });

  it('stops at 24 hours and skips missing readings', () => {
    const time = Array.from({ length: 40 }, (_, i) => `2026-11-${String(23 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`);
    const us_aqi = time.map((_, i) => (i === 0 ? null : 80));
    const hours = upcomingHours({ time, us_aqi }, '2026-11-23T00:00');
    expect(hours).toHaveLength(24);
    expect(hours[0].time).toBe('2026-11-23T01:00');
  });

  it('returns an empty list when there is no forecast', () => {
    expect(upcomingHours(undefined, '')).toEqual([]);
  });
});

describe('geocodeCity', () => {
  it('returns a readable place name and coordinates', async () => {
    const fetchImpl = fakeFetch({ 'geocoding-api': { body: geocodeReply } });
    expect(await geocodeCity('Delhi', fetchImpl)).toEqual({ name: 'Delhi, Delhi, India', latitude: 28.65, longitude: 77.23 });
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
    const fetchImpl = fakeFetch({ nominatim: { body: { address: { town: 'Ooty', state: '<b>Tamil Nadu</b>', country: 'India' } } } });
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

describe('fetchAirQuality', () => {
  it('summarises the current reading and the upcoming peak', async () => {
    const fetchImpl = fakeFetch({ 'air-quality-api': { body: airReply } });
    const air = await fetchAirQuality(28.65, 77.23, fetchImpl);
    expect(air).toMatchObject({
      aqi: 312,
      level: 'hazardous',
      label: 'Hazardous',
      pm25: 210.4,
      pm10: 340.1,
      no2: 61.2,
      ozone: 12,
      measuredAt: '2026-11-23T09:00',
      peak: { time: '2026-11-23T21:00', aqi: 365, label: 'Hazardous' },
      cleanest: { time: '2026-11-23T10:00', aqi: 290, label: 'Very unhealthy' },
    });
    expect(air.forecast).toHaveLength(3);
  });

  it('returns null for pollutants that are missing', async () => {
    const fetchImpl = fakeFetch({ 'air-quality-api': { body: { current: { us_aqi: 40 } } } });
    const air = await fetchAirQuality(1, 2, fetchImpl);
    expect(air.pm25).toBeNull();
    expect(air.peak).toBeNull();
    expect(air.cleanest).toBeNull();
    expect(air.forecast).toEqual([]);
    expect(air.level).toBe('good');
  });

  it('reports a missing reading as 502', async () => {
    const fetchImpl = fakeFetch({ 'air-quality-api': { body: { current: {} } } });
    await expect(fetchAirQuality(1, 2, fetchImpl)).rejects.toMatchObject({ status: 502 });
  });

  it('reports an upstream failure as 502', async () => {
    const fetchImpl = fakeFetch({ 'air-quality-api': { status: 503 } });
    await expect(fetchAirQuality(1, 2, fetchImpl)).rejects.toMatchObject({ status: 502 });
  });
});
