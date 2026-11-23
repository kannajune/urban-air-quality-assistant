import { HttpError, fetchWithTimeout } from './http.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
// OpenStreetMap asks every client to identify itself.
const APP_USER_AGENT = 'urban-air-quality-assistant/1.0 (hackathon project)';

/** US AQI bands with plain language meaning. Upper bound is inclusive. */
export const AQI_BANDS = Object.freeze([
  { max: 50, level: 'good', label: 'Good', advice: 'Air is clean. Normal routines are fine.' },
  { max: 100, level: 'moderate', label: 'Moderate', advice: 'Fine for most people. Sensitive people should watch for symptoms.' },
  { max: 150, level: 'sensitive', label: 'Unhealthy for sensitive groups', advice: 'Children, older people and anyone with asthma should cut long outdoor effort.' },
  { max: 200, level: 'unhealthy', label: 'Unhealthy', advice: 'Everyone should reduce time and effort outdoors.' },
  { max: 300, level: 'very_unhealthy', label: 'Very unhealthy', advice: 'Stay indoors where possible and wear a fitted N95 mask outside.' },
  { max: Infinity, level: 'hazardous', label: 'Hazardous', advice: 'Avoid going out. Keep windows shut and filter indoor air.' },
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
 * Resolve a city name to coordinates.
 * @param {string} city
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{name: string, latitude: number, longitude: number}>}
 */
export async function geocodeCity(city, fetchImpl) {
  const url = `${GEOCODE_URL}?${new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' })}`;
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response.ok) {
    throw new HttpError(502, 'The location service is not responding. Try again shortly.');
  }
  const data = await response.json();
  const match = data?.results?.[0];
  if (!match || !Number.isFinite(match.latitude) || !Number.isFinite(match.longitude)) {
    throw new HttpError(404, 'That place was not found. Check the spelling or try a nearby city.');
  }
  const parts = [match.name, match.admin1, match.country].filter(Boolean);
  return { name: parts.join(', '), latitude: match.latitude, longitude: match.longitude };
}

/**
 * Turn coordinates into a readable place name with OpenStreetMap Nominatim.
 * This is a nicety, so any failure returns null instead of failing the request.
 * @param {number} latitude
 * @param {number} longitude
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string|null>}
 */
export async function reverseGeocode(latitude, longitude, fetchImpl) {
  const query = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '12',
    addressdetails: '1',
    'accept-language': 'en',
  });
  try {
    const response = await fetchWithTimeout(fetchImpl, `${REVERSE_URL}?${query}`, { headers: { 'User-Agent': APP_USER_AGENT } }, 5000);
    if (!response.ok) return null;
    const address = (await response.json())?.address || {};
    const locality = address.suburb || address.neighbourhood || address.village || address.town;
    const city = address.city || address.town || address.county || address.state_district;
    const parts = [...new Set([locality, city, address.state, address.country].filter((part) => typeof part === 'string' && part))];
    const name = parts.join(', ').replace(/[<>\u0000-\u001f]/g, ' ').slice(0, 120);
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Pick the worst hour in the next 24 hours from the hourly forecast.
 * @param {{time?: string[], us_aqi?: (number|null)[]}} hourly
 * @param {string} nowIso
 * @returns {{time: string, aqi: number}|null}
 */
export function worstUpcomingHour(hourly, nowIso) {
  const times = hourly?.time || [];
  const values = hourly?.us_aqi || [];
  let worst = null;
  let seen = 0;
  for (let i = 0; i < times.length && seen < 24; i += 1) {
    if (times[i] < nowIso) continue;
    seen += 1;
    const aqi = values[i];
    if (Number.isFinite(aqi) && (worst === null || aqi > worst.aqi)) {
      worst = { time: times[i], aqi };
    }
  }
  return worst;
}

/**
 * List the next 24 hourly readings, each with its band, for the forecast chart.
 * @param {{time?: string[], us_aqi?: (number|null)[]}} hourly
 * @param {string} nowIso
 * @returns {{time: string, aqi: number, level: string}[]}
 */
export function upcomingHours(hourly, nowIso) {
  const times = hourly?.time || [];
  const values = hourly?.us_aqi || [];
  const hours = [];
  for (let i = 0; i < times.length && hours.length < 24; i += 1) {
    if (times[i] < nowIso || !Number.isFinite(values[i])) continue;
    hours.push({ time: times[i], aqi: Math.round(values[i]), level: classifyAqi(values[i]).level });
  }
  return hours;
}

/**
 * Fetch current air quality and the next day's peak for a location.
 * @param {number} latitude
 * @param {number} longitude
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Object>}
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
  const current = data?.current;
  if (!current || !Number.isFinite(current.us_aqi)) {
    throw new HttpError(502, 'No air quality reading is available for this place right now.');
  }
  const band = classifyAqi(current.us_aqi);
  const peak = worstUpcomingHour(data.hourly, current.time || '');
  const forecast = upcomingHours(data.hourly, current.time || '');
  const cleanest = forecast.reduce((best, hour) => (best === null || hour.aqi < best.aqi ? hour : best), null);
  return {
    forecast,
    cleanest: cleanest ? { time: cleanest.time, aqi: cleanest.aqi, label: classifyAqi(cleanest.aqi).label } : null,
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
    peak: peak ? { time: peak.time, aqi: Math.round(peak.aqi), label: classifyAqi(peak.aqi).label } : null,
  };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function round1(value) {
  return Number.isFinite(value) ? Math.round(/** @type {number} */ (value) * 10) / 10 : null;
}
