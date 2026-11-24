/**
 * Wires the page together: the location button, the form and the results.
 */
import { ApiError, fetchPlan, lookUpPlace } from './api.js';
import { byId } from './dom.js';
import { renderResults } from './render.js';
import { collectAnswers } from './view.js';

const LOCATION_OPTIONS = Object.freeze({ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
const DEFAULT_PLACEHOLDER = 'For example Delhi';

/**
 * State that lives for one page view. Nothing here is stored.
 * @type {{coordinates: {latitude: number, longitude: number}|null, request: AbortController|null}}
 */
const state = { coordinates: null, request: null };

/**
 * Show a status line. Errors are announced at once; progress is announced politely.
 * @param {string} message
 * @param {boolean} [isError]
 */
export function setStatus(message, isError = false) {
  const line = byId('status');
  line.setAttribute('role', isError ? 'alert' : 'status');
  line.classList.toggle('is-error', isError);
  line.textContent = message;
}

/** @param {string} message An empty string clears the error. */
function setCityError(message) {
  const error = byId('city-error');
  const input = byId('city');
  error.textContent = message;
  error.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/**
 * Show which location is in use under the city field, or clear it.
 * @param {string} name
 */
function showLocation(name) {
  byId('location-chip').hidden = !name;
  byId('location-name').textContent = name;
  /** @type {HTMLInputElement} */ (byId('city')).placeholder = name ? 'Using your location' : DEFAULT_PLACEHOLDER;
}

/** @param {boolean} busy */
function setBusy(busy) {
  const button = /** @type {HTMLButtonElement} */ (byId('submit'));
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/** @param {GeolocationPosition} position */
async function onLocated(position) {
  state.coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
  /** @type {HTMLInputElement} */ (byId('city')).value = '';
  setCityError('');
  const name = await lookUpPlace(state.coordinates);
  showLocation(name || 'your current location');
  setStatus(name ? `Location found: ${name}.` : 'Location found. Choose your options and get your plan.');
}

function onLocateClick() {
  if (!('geolocation' in navigator)) {
    setStatus('This browser cannot share a location. Type your city instead.', true);
    return;
  }
  setStatus('Finding your location.');
  navigator.geolocation.getCurrentPosition(
    onLocated,
    () => setStatus('Location was not shared. Type your city instead.', true),
    LOCATION_OPTIONS,
  );
}

/** Typing a city replaces a shared location. */
function onCityInput() {
  if (!(/** @type {HTMLInputElement} */ (byId('city')).value.trim())) return;
  state.coordinates = null;
  showLocation('');
  setCityError('');
}

/** @param {Event} event */
async function onSubmit(event) {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (byId('plan-form'));
  const answers = collectAnswers(new FormData(form), state.coordinates);
  if (!answers.city && answers.latitude === undefined) {
    setCityError('Enter a city or town, or use your location.');
    byId('city').focus();
    return;
  }
  setCityError('');

  // A newer request replaces an older one.
  state.request?.abort();
  const request = new AbortController();
  state.request = request;
  setBusy(true);
  setStatus('Reading the air and writing your plan. This can take up to half a minute.');

  try {
    renderResults(await fetchPlan(answers, request.signal));
    setStatus('Your plan is ready.');
  } catch (error) {
    if (state.request !== request) return;
    setStatus(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.', true);
  } finally {
    if (state.request === request) {
      state.request = null;
      setBusy(false);
    }
  }
}

/** The header scene animates continuously; stop it while it is scrolled out of view to save battery. */
function pauseHeroOffscreen() {
  if (!('IntersectionObserver' in window)) return;
  const hero = byId('hero');
  new IntersectionObserver(([entry]) => hero.classList.toggle('is-offscreen', !entry.isIntersecting)).observe(hero);
}

/** Attach the page's behaviour. Called once when the script loads. */
export function init() {
  state.coordinates = null;
  state.request = null;
  byId('locate').addEventListener('click', onLocateClick);
  byId('city').addEventListener('input', onCityInput);
  byId('plan-form').addEventListener('submit', onSubmit);
  pauseHeroOffscreen();
}

init();
