import { describe, expect, it } from 'vitest';
import { classifyAqi, fetchAirQuality, upcomingHours, worstUpcomingHour } from '../src/lib/airquality.js';
import { airReply, fakeFetch } from './helpers.js';

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
    const time = Array.from(
      { length: 30 },
      (_, i) => `2026-11-${String(23 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`,
    );
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

  it('covers a 24 hour window and leaves out hours with no reading', () => {
    const time = Array.from(
      { length: 40 },
      (_, i) => `2026-11-${String(23 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`,
    );
    const us_aqi = time.map((_, i) => (i === 0 ? null : 80));
    const hours = upcomingHours({ time, us_aqi }, '2026-11-23T00:00');
    expect(hours).toHaveLength(23);
    expect(hours[0].time).toBe('2026-11-23T01:00');
    expect(hours.at(-1).time).toBe('2026-11-23T23:00');
  });

  it('returns an empty list when there is no forecast', () => {
    expect(upcomingHours(undefined, '')).toEqual([]);
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
