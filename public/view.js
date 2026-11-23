/**
 * Pure view helpers. They have no DOM access, so they are unit tested directly.
 */

/** WHO 2021 air quality guideline levels in µg/m³ (24 hour mean; ozone is the 8 hour mean). */
export const WHO_GUIDELINES = Object.freeze({ pm25: 15, pm10: 45, no2: 25, ozone: 100 });

const POLLUTANTS = Object.freeze([
  { key: 'pm25', name: 'PM2.5', about: 'Fine particles from smoke and exhaust. Small enough to reach the bloodstream.' },
  { key: 'pm10', name: 'PM10', about: 'Coarse dust from roads and construction. Irritates the nose and throat.' },
  { key: 'no2', name: 'NO2', about: 'Nitrogen dioxide from traffic and gas burners. Inflames the airways.' },
  { key: 'ozone', name: 'Ozone', about: 'Forms in sunlight from other pollutants. Makes breathing feel tight.' },
]);

/** Berkeley Earth rule of thumb: 22 µg/m³ of PM2.5 over a day is about one cigarette. */
const PM25_PER_CIGARETTE = 22;

/**
 * Turn form data into the request body for /api/plan.
 * @param {FormData} formData
 * @param {{latitude: number, longitude: number}|null} coordinates
 * @returns {Record<string, unknown>}
 */
export function collectAnswers(formData, coordinates) {
  const answers = {
    city: String(formData.get('city') || '').trim(),
    commute: formData.get('commute'),
    cookingFuel: formData.get('cookingFuel'),
    outdoorTime: formData.get('outdoorTime'),
    budget: formData.get('budget'),
    household: formData.getAll('household'),
    hasPurifier: formData.get('hasPurifier') !== null,
  };
  if (coordinates && !answers.city) {
    answers.latitude = coordinates.latitude;
    answers.longitude = coordinates.longitude;
  }
  return answers;
}

/**
 * Hour and minute from a local ISO timestamp such as 2026-11-23T21:00.
 * @param {unknown} iso
 * @returns {string}
 */
export function hourOf(iso) {
  return typeof iso === 'string' && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : '';
}

/**
 * One line describing an hour of the forecast.
 * @param {{time: string, aqi: number, label: string}|null} hour
 * @returns {string}
 */
export function describeHour(hour) {
  const time = hourOf(hour?.time);
  return time ? `${time}, AQI ${hour.aqi} (${hour.label})` : 'No forecast available';
}

/**
 * Detail cards for each pollutant, compared with the WHO guideline.
 * @param {Record<string, number|null>} air
 * @returns {{key: string, name: string, about: string, value: string, times: string, percent: number, over: boolean}[]}
 */
export function pollutantCards(air) {
  return POLLUTANTS.filter(({ key }) => typeof air[key] === 'number' && Number.isFinite(air[key])).map((pollutant) => {
    const reading = /** @type {number} */ (air[pollutant.key]);
    const ratio = reading / WHO_GUIDELINES[pollutant.key];
    return {
      ...pollutant,
      value: `${reading} µg/m³`,
      times: ratio >= 1 ? `${ratio.toFixed(1)} times the WHO guideline` : 'Within the WHO guideline',
      // The bar is full at three times the guideline, so everyday smog levels still show a difference.
      percent: Math.round(Math.min(1, ratio / 3) * 100),
      over: ratio >= 1,
    };
  });
}

/**
 * Rough cigarettes per day with the same fine particle dose.
 * @param {number|null} pm25
 * @returns {number|null}
 */
export function cigaretteEquivalent(pm25) {
  if (typeof pm25 !== 'number' || !Number.isFinite(pm25) || pm25 < 0) return null;
  return Math.round((pm25 / PM25_PER_CIGARETTE) * 10) / 10;
}

/**
 * Bars for the 24 hour forecast chart. Heights are relative to the worst hour shown.
 * @param {{time: string, aqi: number, level: string}[]} forecast
 * @returns {{hour: string, aqi: number, level: string, percent: number}[]}
 */
export function forecastBars(forecast) {
  const hours = Array.isArray(forecast) ? forecast : [];
  const readings = hours.map((hour) => hour.aqi);
  const top = Math.max(100, ...readings);
  // Start the axis a little below the cleanest hour, so differences between hours stay visible on a bad day.
  const floor = hours.length > 1 ? Math.min(...readings) * 0.6 : 0;
  return hours.map((hour) => ({
    hour: hourOf(hour.time).slice(0, 2),
    aqi: hour.aqi,
    level: hour.level,
    percent: Math.max(6, Math.round(((hour.aqi - floor) / (top - floor)) * 100)),
  }));
}

const COST_LABELS = Object.freeze({ free: 'Free', low: 'Low cost', medium: 'Some cost' });
const BENEFIT_LEVELS = Object.freeze({ high: 3, medium: 2, low: 1 });
const BENEFIT_LABELS = Object.freeze({ high: 'High impact', medium: 'Medium impact', low: 'Small impact' });

/**
 * Tags shown on a plan step: what it costs and how much it helps.
 * @param {{cost?: string, benefit?: string}} item
 * @returns {{cost: string, costLabel: string, benefitLabel: string, level: number}}
 */
export function stepTags(item) {
  const cost = Object.hasOwn(COST_LABELS, item?.cost) ? item.cost : 'low';
  const benefit = Object.hasOwn(BENEFIT_LEVELS, item?.benefit) ? item.benefit : 'medium';
  return { cost, costLabel: COST_LABELS[cost], benefitLabel: BENEFIT_LABELS[benefit], level: BENEFIT_LEVELS[benefit] };
}

/**
 * Headline numbers for the whole plan.
 * @param {{routine?: object[], indoor?: object[], alternatives?: object[]}} plan
 * @returns {{value: number, label: string}[]}
 */
export function planStats(plan) {
  const steps = [...(plan?.routine || []), ...(plan?.indoor || []), ...(plan?.alternatives || [])];
  return [
    { value: steps.length, label: 'steps in your plan' },
    { value: steps.filter((step) => stepTags(step).cost === 'free').length, label: 'cost nothing' },
    { value: steps.filter((step) => stepTags(step).level === 3).length, label: 'are high impact' },
  ];
}

/**
 * Position of a reading along the 0 to 500 AQI scale, as a percentage.
 * @param {number} aqi
 * @returns {number}
 */
export function scalePosition(aqi) {
  const value = Number.isFinite(aqi) ? aqi : 0;
  return Math.round(Math.min(500, Math.max(0, value)) / 5);
}

/**
 * Value to show while the AQI number counts up. Eases out so it settles gently.
 * @param {number} target Final AQI value.
 * @param {number} progress Animation progress from 0 to 1.
 * @returns {number}
 */
export function countUpValue(target, progress) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  return Math.round(target * (1 - (1 - p) ** 3));
}

/**
 * @param {string} source
 * @returns {string}
 */
export function sourceNote(source) {
  return source === 'gemini'
    ? 'Plan written by Google Gemini from the live readings and your answers.'
    : 'The AI model is busy, so this is the standard plan for these readings. Try again in a minute for a tailored one.';
}
