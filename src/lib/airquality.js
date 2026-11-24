/**
 * Live air quality: the reading for a place, its band, and the hours ahead.
 */
import { HttpError, fetchWithTimeout } from './http.js';

const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
/** How far ahead the forecast looks. */
const FORECAST_HOURS = 24;

/** US AQI bands with plain language meaning. Upper bound is inclusive. */
export const AQI_BANDS = Object.freeze([
  { max: 50, level: 'good', label: 'Good', advice: 'Air is clean. Normal routines are fine.' },
  {
    max: 100,
    level: 'moderate',
    label: 'Moderate',
    advice: 'Fine for most people. Sensitive people should watch for symptoms.',
  },
  {
    max: 150,
    level: 'sensitive',
    label: 'Unhealthy for sensitive groups',
    advice: 'Children, older people and anyone with asthma should cut long outdoor effort.',
  },
  { max: 200, level: 'unhealthy', label: 'Unhealthy', advice: 'Everyone should reduce time and effort outdoors.' },
  {
    max: 300,
    level: 'very_unhealthy',
    label: 'Very unhealthy',
    advice: 'Stay indoors where possible and wear a fitted N95 mask outside.',
  },
  {
    max: Infinity,
    level: 'hazardous',
    label: 'Hazardous',
    advice: 'Avoid going out. Keep windows shut and filter indoor air.',
  },
]);

/**
 * Map a US AQI number to its band.
 * @param {number} aqi
 * @returns {{max: number, level: string, label: string, advice: string}}
 */
export function classifyAqi(aqi) {
  const value = Number.isFinite(aqi) ? Math.max(0, aqi) : 0;
  return AQI_BANDS.find((band) => value <= band.max) || AQI_BANDS[AQI_BANDS.length - 1];
}

/**
 * Pick the worst hour in the next 24 hours from the hourly forecast.
 * @param {{time?: string[], us_aqi?: (number|null)[]}|undefined} hourly
 * @param {string} nowIso
 * @returns {{time: string, aqi: number}|null}
 */
export function worstUpcomingHour(hourly, nowIso) {
  return extremeHour(upcomingReadings(hourly, nowIso), (candidate, best) => candidate.aqi > best.aqi);
}

/**
 * The next 24 hours of the forecast, in order, leaving out hours with no reading.
 * @param {{time?: string[], us_aqi?: (number|null)[]}|undefined} hourly
 * @param {string} nowIso
 * @returns {{time: string, aqi: number}[]}
 */
function upcomingReadings(hourly, nowIso) {
  const values = hourly?.us_aqi || [];
  return (hourly?.time || [])
    .map((time, index) => ({ time, aqi: values[index] }))
    .filter((hour) => hour.time >= nowIso)
    .slice(0, FORECAST_HOURS)
    .filter(/** @returns {hour is {time: string, aqi: number}} */ (hour) => isReading(hour.aqi));
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isReading(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The hour that beats every other under the given comparison, or null for an empty list.
 * @template {{aqi: number}} T
 * @param {T[]} hours
 * @param {(candidate: T, best: T) => boolean} beats
 * @returns {T|null}
 */
function extremeHour(hours, beats) {
  return hours.reduce((best, hour) => (best === null || beats(hour, best) ? hour : best), /** @type {T|null} */ (null));
}

/**
 * List the next 24 hourly readings, each with its band, for the forecast chart.
 * @param {{time?: string[], us_aqi?: (number|null)[]}|undefined} hourly
 * @param {string} nowIso
 * @returns {import('./types.js').ForecastHour[]}
 */
export function upcomingHours(hourly, nowIso) {
  return upcomingReadings(hourly, nowIso).map((hour) => ({
    time: hour.time,
    aqi: Math.round(hour.aqi),
    level: classifyAqi(hour.aqi).level,
  }));
}

/**
 * Fetch current air quality and the next day's peak for a location.
 * @param {number} latitude
 * @param {number} longitude
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<import('./types.js').AirReading>}
 */
export async function fetchAirQuality(latitude, longitude, fetchImpl) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
    hourly: 'us_aqi',
    forecast_days: '2',
    timezone: 'auto',
  });
  const response = await fetchWithTimeout(fetchImpl, `${AIR_URL}?${query}`);
  if (!response.ok) {
    throw new HttpError(502, 'The air quality service is not responding. Try again shortly.');
  }
  const data = await response.json();
  if (!isReading(data?.current?.us_aqi)) {
    throw new HttpError(502, 'No air quality reading is available for this place right now.');
  }
  return toReading(data);
}

/**
 * Shape the upstream reply into the reading the rest of the app uses.
 * @param {{current: Record<string, any>, hourly?: {time?: string[], us_aqi?: (number|null)[]}, timezone?: string}} data
 * @returns {import('./types.js').AirReading}
 */
function toReading(data) {
  const { current } = data;
  const now = current.time || '';
  const band = classifyAqi(current.us_aqi);
  const forecast = upcomingHours(data.hourly, now);
  return {
    aqi: Math.round(current.us_aqi),
    level: band.level,
    label: band.label,
    advice: band.advice,
    pm25: round1(current.pm2_5),
    pm10: round1(current.pm10),
    no2: round1(current.nitrogen_dioxide),
    ozone: round1(current.ozone),
    measuredAt: current.time || null,
    timezone: data.timezone || null,
    forecast,
    peak: labelled(worstUpcomingHour(data.hourly, now)),
    cleanest: labelled(extremeHour(forecast, (candidate, best) => candidate.aqi < best.aqi)),
  };
}

/**
 * An hour with its AQI rounded and its band named, ready to show.
 * @param {{time: string, aqi: number}|null} hour
 * @returns {{time: string, aqi: number, label: string}|null}
 */
function labelled(hour) {
  return hour ? { time: hour.time, aqi: Math.round(hour.aqi), label: classifyAqi(hour.aqi).label } : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function round1(value) {
  return Number.isFinite(value) ? Math.round(/** @type {number} */ (value) * 10) / 10 : null;
}
