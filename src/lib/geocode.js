/**
 * Places: turning a city name into coordinates, and coordinates into a readable name.
 */
import { HttpError, fetchWithTimeout } from './http.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
// OpenStreetMap asks every client to identify itself.
const APP_USER_AGENT = 'urban-air-quality-assistant/1.0 (hackathon project)';
const REVERSE_TIMEOUT_MS = 5000;
const MAX_NAME_LENGTH = 120;

/**
 * Resolve a city name to coordinates.
 * @param {string} city
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<import('./types.js').Place>}
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
    const response = await fetchWithTimeout(
      fetchImpl,
      `${REVERSE_URL}?${query}`,
      { headers: { 'User-Agent': APP_USER_AGENT } },
      REVERSE_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    return nameOf((await response.json())?.address) || null;
  } catch {
    return null;
  }
}

/** Address parts, most local first. The first one present at each level is used. */
const LOCALITY_KEYS = Object.freeze(['suburb', 'neighbourhood', 'village', 'town']);
const CITY_KEYS = Object.freeze(['city', 'town', 'county', 'state_district']);

/**
 * The first of the given keys that holds a non empty string.
 * @param {Record<string, unknown>} address
 * @param {readonly string[]} keys
 * @returns {string|undefined}
 */
function firstOf(address, keys) {
  const key = keys.find((name) => typeof address[name] === 'string' && address[name]);
  return key ? /** @type {string} */ (address[key]) : undefined;
}

/**
 * Build a short readable name, such as "Adyar, Chennai, Tamil Nadu, India", from an address.
 * Markup characters are removed, because the name is shown on the page and sent to the model.
 * @param {Record<string, unknown>|undefined} address
 * @returns {string}
 */
function nameOf(address) {
  if (!address) return '';
  const parts = [
    firstOf(address, LOCALITY_KEYS),
    firstOf(address, CITY_KEYS),
    firstOf(address, ['state']),
    firstOf(address, ['country']),
  ];
  return [...new Set(parts.filter(Boolean))]
    .join(', ')
    .replace(/[<>\u0000-\u001f]/g, ' ')
    .slice(0, MAX_NAME_LENGTH);
}
