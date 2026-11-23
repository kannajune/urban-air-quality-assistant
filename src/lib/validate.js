import { HttpError } from './http.js';

/** Allowed values for each choice field. Anything else is rejected. */
export const OPTIONS = Object.freeze({
  commute: ['walk', 'cycle', 'bus', 'metro', 'two_wheeler', 'car', 'work_from_home'],
  cookingFuel: ['lpg', 'piped_gas', 'electric', 'biomass', 'kerosene'],
  outdoorTime: ['under_1h', '1_to_3h', 'over_3h'],
  household: ['children', 'elderly', 'asthma', 'pregnant', 'outdoor_worker'],
  budget: ['none', 'low', 'medium'],
});

const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'-]{1,59}$/u;

/**
 * @typedef {Object} PlanRequest
 * @property {string} city
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {string} commute
 * @property {string} cookingFuel
 * @property {string} outdoorTime
 * @property {string} budget
 * @property {string[]} household
 * @property {boolean} hasPurifier
 */

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} field
 * @returns {string}
 */
function pick(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new HttpError(400, `Choose a valid option for ${field}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function coordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, 'The location coordinates are not valid.');
  }
  // Two decimals is about one kilometre: enough for air quality, kinder to privacy.
  return Math.round(number * 100) / 100;
}

/**
 * Validate a request that carries only coordinates.
 * @param {unknown} input
 * @returns {{latitude: number, longitude: number}}
 */
export function validateCoordinates(input) {
  const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};
  const latitude = coordinate(body.latitude, -90, 90);
  const longitude = coordinate(body.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    throw new HttpError(400, 'Send both latitude and longitude.');
  }
  return { latitude, longitude };
}

/**
 * Validate and normalise the request for a plan.
 * Unknown fields are dropped, so nothing unexpected reaches the model.
 * @param {unknown} input
 * @returns {PlanRequest}
 */
export function validatePlanRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Send the answers as a JSON object.');
  }
  const body = /** @type {Record<string, unknown>} */ (input);

  const latitude = coordinate(body.latitude, -90, 90);
  const longitude = coordinate(body.longitude, -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    throw new HttpError(400, 'Send both latitude and longitude, or neither.');
  }

  const city = typeof body.city === 'string' ? body.city.trim().replace(/\s+/g, ' ') : '';
  if (latitude === null && !CITY_PATTERN.test(city)) {
    throw new HttpError(400, 'Enter a city or town name using letters only.');
  }
  if (city && !CITY_PATTERN.test(city)) {
    throw new HttpError(400, 'Enter a city or town name using letters only.');
  }

  const householdInput = body.household === undefined ? [] : body.household;
  if (!Array.isArray(householdInput) || householdInput.length > OPTIONS.household.length) {
    throw new HttpError(400, 'Choose valid household options.');
  }
  const household = [...new Set(householdInput.map((item) => pick(item, OPTIONS.household, 'household')))];

  return {
    city,
    latitude,
    longitude,
    commute: pick(body.commute, OPTIONS.commute, 'commute'),
    cookingFuel: pick(body.cookingFuel, OPTIONS.cookingFuel, 'cooking fuel'),
    outdoorTime: pick(body.outdoorTime, OPTIONS.outdoorTime, 'time outdoors'),
    budget: pick(body.budget, OPTIONS.budget, 'budget'),
    household,
    hasPurifier: body.hasPurifier === true,
  };
}
