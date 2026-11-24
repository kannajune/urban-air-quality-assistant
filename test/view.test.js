import { describe, expect, it } from 'vitest';
import {
  WHO_GUIDELINES,
  cigaretteEquivalent,
  collectAnswers,
  countUpValue,
  describeHour,
  forecastBars,
  hourOf,
  planStats,
  pollutantCards,
  scalePosition,
  sourceNote,
  stepTags,
} from '../public/view.js';

function formData(entries) {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

const base = [
  ['commute', 'metro'],
  ['cookingFuel', 'lpg'],
  ['outdoorTime', 'under_1h'],
  ['budget', 'none'],
];

describe('collectAnswers', () => {
  it('builds the request body from the form', () => {
    const answers = collectAnswers(formData([['city', ' Pune '], ...base, ['household', 'children'], ['household', 'elderly'], ['hasPurifier', 'on']]), null);
    expect(answers).toEqual({
      city: 'Pune',
      commute: 'metro',
      cookingFuel: 'lpg',
      outdoorTime: 'under_1h',
      budget: 'none',
      household: ['children', 'elderly'],
      hasPurifier: true,
    });
  });

  it('sends coordinates only when no city is typed', () => {
    const coordinates = { latitude: 12.97, longitude: 77.59 };
    expect(collectAnswers(formData([['city', ''], ...base]), coordinates)).toMatchObject(coordinates);
    expect(collectAnswers(formData([['city', 'Pune'], ...base]), coordinates)).not.toHaveProperty('latitude');
  });

  it('reports no purifier when the box is unticked', () => {
    expect(collectAnswers(formData([['city', 'Pune'], ...base]), null).hasPurifier).toBe(false);
  });
});

describe('hourOf and describeHour', () => {
  it('reads the hour from a local timestamp', () => {
    expect(hourOf('2026-11-23T21:00')).toBe('21:00');
    expect(hourOf('2026-11-23')).toBe('');
    expect(hourOf(undefined)).toBe('');
  });

  it('describes an hour in plain words', () => {
    expect(describeHour({ time: '2026-11-23T21:00', aqi: 365, label: 'Hazardous' })).toBe('21:00, AQI 365 (Hazardous)');
  });

  it('says so when there is no forecast', () => {
    expect(describeHour(null)).toBe('No forecast available');
    expect(describeHour({})).toBe('No forecast available');
  });
});

describe('pollutantCards', () => {
  it('compares each reading with the WHO guideline', () => {
    const cards = pollutantCards({ pm25: 75, pm10: 30, no2: 25, ozone: null });
    expect(cards.map((card) => card.key)).toEqual(['pm25', 'pm10', 'no2']);
    expect(cards[0]).toMatchObject({ name: 'PM2.5', value: '75 µg/m³', times: '5.0 times the WHO guideline', percent: 100, over: true });
    expect(cards[1]).toMatchObject({ times: 'Within the WHO guideline', percent: 22, over: false });
    expect(cards[2]).toMatchObject({ times: '1.0 times the WHO guideline', over: true });
  });

  it('explains what every pollutant is', () => {
    for (const card of pollutantCards({ pm25: 1, pm10: 1, no2: 1, ozone: 1 })) {
      expect(card.about.length).toBeGreaterThan(20);
    }
  });

  it('skips readings that are missing or not numbers', () => {
    expect(pollutantCards({ pm25: null, pm10: undefined, no2: Number.NaN, ozone: 'high' })).toEqual([]);
  });

  it('uses the published WHO 2021 guideline levels', () => {
    expect(WHO_GUIDELINES).toEqual({ pm25: 15, pm10: 45, no2: 25, ozone: 100 });
  });
});

describe('cigaretteEquivalent', () => {
  it('converts PM2.5 at 22 micrograms per cigarette', () => {
    expect(cigaretteEquivalent(22)).toBe(1);
    expect(cigaretteEquivalent(98)).toBe(4.5);
    expect(cigaretteEquivalent(0)).toBe(0);
  });

  it('returns null without a valid reading', () => {
    expect(cigaretteEquivalent(null)).toBeNull();
    expect(cigaretteEquivalent(-3)).toBeNull();
    expect(cigaretteEquivalent(Number.NaN)).toBeNull();
  });
});

describe('forecastBars', () => {
  const forecast = [
    { time: '2026-11-23T09:00', aqi: 300, level: 'very_unhealthy' },
    { time: '2026-11-23T10:00', aqi: 150, level: 'sensitive' },
    { time: '2026-11-23T11:00', aqi: 3, level: 'good' },
  ];

  it('scales bars to the worst hour and keeps a visible minimum', () => {
    expect(forecastBars(forecast)).toEqual([
      { hour: '09', aqi: 300, level: 'very_unhealthy', percent: 100 },
      { hour: '10', aqi: 150, level: 'sensitive', percent: 50 },
      { hour: '11', aqi: 3, level: 'good', percent: 6 },
    ]);
  });

  it('keeps differences visible when every hour is bad', () => {
    const bars = forecastBars([
      { time: '2026-11-23T09:00', aqi: 153, level: 'unhealthy' },
      { time: '2026-11-23T10:00', aqi: 179, level: 'unhealthy' },
    ]);
    expect(bars[1].percent).toBe(100);
    expect(bars[0].percent).toBeLessThan(75);
  });

  it('does not exaggerate a clean day', () => {
    expect(forecastBars([{ time: '2026-11-23T09:00', aqi: 25, level: 'good' }])[0].percent).toBe(25);
  });

  it('returns nothing for a missing forecast', () => {
    expect(forecastBars(undefined)).toEqual([]);
  });
});

describe('stepTags and planStats', () => {
  it('turns cost and benefit into readable tags', () => {
    expect(stepTags({ cost: 'free', benefit: 'high' })).toEqual({ cost: 'free', costLabel: 'Free', benefitLabel: 'High impact', level: 3 });
    expect(stepTags({ cost: 'medium', benefit: 'low' })).toMatchObject({ costLabel: 'Some cost', benefitLabel: 'Small impact', level: 1 });
  });

  it('falls back to the middle value for unknown or missing tags', () => {
    expect(stepTags({ cost: 'constructor', benefit: 'toString' })).toMatchObject({ cost: 'low', level: 2 });
    expect(stepTags(undefined)).toMatchObject({ costLabel: 'Low cost', benefitLabel: 'Medium impact' });
  });

  it('counts steps, free steps and high impact steps', () => {
    const plan = {
      routine: [{ cost: 'free', benefit: 'high' }, { cost: 'low', benefit: 'high' }],
      indoor: [{ cost: 'free', benefit: 'medium' }],
      alternatives: [{ cost: 'medium', benefit: 'low' }],
    };
    expect(planStats(plan).map((stat) => stat.value)).toEqual([4, 2, 2]);
    expect(planStats(undefined).map((stat) => stat.value)).toEqual([0, 0, 0]);
  });
});

describe('scalePosition', () => {
  it('places a reading along the 0 to 500 scale', () => {
    expect(scalePosition(0)).toBe(0);
    expect(scalePosition(182)).toBe(36);
    expect(scalePosition(500)).toBe(100);
  });

  it('clamps readings that are off the scale or invalid', () => {
    expect(scalePosition(900)).toBe(100);
    expect(scalePosition(-20)).toBe(0);
    expect(scalePosition(Number.NaN)).toBe(0);
  });
});

describe('countUpValue', () => {
  it('starts at zero, ends on the target and never overshoots', () => {
    expect(countUpValue(181, 0)).toBe(0);
    expect(countUpValue(181, 1)).toBe(181);
    expect(countUpValue(181, 0.5)).toBeGreaterThan(90);
    expect(countUpValue(181, 0.5)).toBeLessThan(181);
  });

  it('clamps progress outside the 0 to 1 range and bad input', () => {
    expect(countUpValue(181, -1)).toBe(0);
    expect(countUpValue(181, 7)).toBe(181);
    expect(countUpValue(181, Number.NaN)).toBe(181);
  });
});

describe('sourceNote', () => {
  it('names the AI model for a generated plan and explains the fallback', () => {
    expect(sourceNote('gemini')).toContain('Google Gemini');
    expect(sourceNote('workers-ai')).toContain('Google Gemma');
    expect(sourceNote('fallback')).toContain('standard plan');
  });
});
