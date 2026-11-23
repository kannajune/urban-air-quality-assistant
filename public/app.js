import {
  cigaretteEquivalent,
  collectAnswers,
  countUpValue,
  describeHour,
  forecastBars,
  planStats,
  pollutantCards,
  scalePosition,
  sourceNote,
  stepTags,
} from './view.js';

const form = document.getElementById('plan-form');
const cityInput = document.getElementById('city');
const cityError = document.getElementById('city-error');
const locateButton = document.getElementById('locate');
const submitButton = document.getElementById('submit');
const statusLine = document.getElementById('status');
const results = document.getElementById('results');
const locationChip = document.getElementById('location-chip');
const locationName = document.getElementById('location-name');

/** Coordinates from the browser, kept only in memory for this page view. */
let coordinates = null;

/**
 * Create an element with a class and text. Text is always set as a text node,
 * so nothing from the server or the model can inject markup.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('is-error', isError);
}

/** @param {string} message */
function setCityError(message) {
  cityError.textContent = message;
  cityError.hidden = !message;
  if (message) {
    cityInput.setAttribute('aria-invalid', 'true');
  } else {
    cityInput.removeAttribute('aria-invalid');
  }
}

/**
 * Show the AQI number, counting up to it unless the visitor prefers reduced motion.
 * The count finishes in under a second, before focus reaches the number.
 * @param {HTMLElement} element
 * @param {number} aqi
 */
function showAqi(element, aqi) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = String(aqi);
    return;
  }
  const duration = 700;
  const start = performance.now();
  const step = (now) => {
    const progress = (now - start) / duration;
    element.textContent = String(countUpValue(aqi, progress));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Small three dot meter. The text label beside it carries the meaning, so the dots are decorative.
 * @param {number} level 1 to 3
 * @returns {HTMLElement}
 */
function meter(level) {
  const dots = el('span', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 3; i += 1) dots.append(el('span', i <= level ? 'dot is-on' : 'dot'));
  return dots;
}

/**
 * @param {string} listId
 * @param {{title: string, detail: string, impact: string, cost?: string, benefit?: string}[]} items
 */
function renderList(listId, items) {
  document.getElementById(`${listId}-count`).textContent = `${items.length} steps`;
  document.getElementById(listId).replaceChildren(
    ...items.map((item) => {
      const tags = stepTags(item);
      const li = document.createElement('li');
      const body = el('div', 'step-body');
      const chips = el('p', 'chips');
      const benefit = el('span', `chip benefit level-${tags.level}`);
      benefit.append(meter(tags.level), tags.benefitLabel);
      chips.append(el('span', `chip cost cost-${tags.cost}`, tags.costLabel), benefit);
      const impact = el('p', 'impact');
      const label = document.createElement('strong');
      label.textContent = 'Impact';
      impact.append(label, el('span', 'impact-text', item.impact));
      const how = el('details', 'how');
      how.append(el('summary', 'how-toggle', 'How to do it'), el('p', 'detail', item.detail));
      body.append(el('p', 'title', item.title), chips, impact, how);
      li.append(body);
      return li;
    }),
  );
}

/** @param {any} plan */
function renderStats(plan) {
  document.getElementById('plan-stats').replaceChildren(
    ...planStats(plan).map((stat) => {
      const li = document.createElement('li');
      li.append(el('strong', 'stat-value', String(stat.value)), el('span', 'stat-label', stat.label));
      return li;
    }),
  );
}

/** @param {Record<string, number|null>} air */
function renderPollutants(air) {
  document.getElementById('pollutants').replaceChildren(
    ...pollutantCards(air).map((card) => {
      const section = el('section', `card pollutant${card.over ? ' is-over' : ''}`);
      const track = el('div', 'track');
      const fill = el('span', 'fill');
      fill.style.setProperty('--w', `${card.percent}%`);
      track.append(fill);
      section.append(
        el('p', 'name', card.name),
        el('p', 'value', card.value),
        track,
        el('p', 'times', card.times),
        el('p', 'about', card.about),
      );
      return section;
    }),
  );
}

/** @param {any} air */
function renderForecast(air) {
  const chart = document.getElementById('forecast');
  const bars = forecastBars(air.forecast);
  chart.replaceChildren(
    ...bars.map((bar, index) => {
      const node = el('span', `bar band-${bar.level}`);
      node.style.setProperty('--h', `${bar.percent}%`);
      node.style.setProperty('--i', String(index));
      node.title = `${bar.hour}:00, AQI ${bar.aqi}`;
      return node;
    }),
  );
  chart.setAttribute(
    'aria-label',
    `Hourly AQI for the next ${bars.length} hours. Cleanest: ${describeHour(air.cleanest)}. Worst: ${describeHour(air.peak)}.`,
  );
  document.getElementById('cleanest').textContent = describeHour(air.cleanest);
  document.getElementById('peak').textContent = describeHour(air.peak);
}

/** @param {number|null} pm25 */
function renderSmoke(pm25) {
  const cigarettes = cigaretteEquivalent(pm25);
  const value = document.getElementById('smoke-value');
  const text = document.getElementById('smoke-text');
  if (cigarettes === null) {
    value.textContent = 'No reading';
    text.textContent = 'There is no fine particle reading for this place right now.';
    return;
  }
  value.textContent = cigarettes < 0.1 ? 'Almost none' : `About ${cigarettes} cigarettes`;
  text.textContent =
    cigarettes < 0.5
      ? 'Fine particle levels are low. A full day outdoors adds very little.'
      : 'That is the rough fine particle dose from a full day outdoors at this level, for every person, children included.';
}

/** @param {any} data */
function render(data) {
  const { air, plan } = data;
  const card = document.getElementById('air-card');
  card.style.setProperty('--band', `var(--aqi-${air.level})`);
  showAqi(document.getElementById('aqi-value'), air.aqi);
  document.getElementById('aqi-band').textContent = air.label;
  document.getElementById('place').textContent = data.place;
  document.getElementById('air-advice').textContent = air.advice;

  const position = scalePosition(air.aqi);
  document.getElementById('meter-pin').style.setProperty('--pos', `${position}%`);
  document.getElementById('meter-text').textContent = `AQI ${air.aqi} on a scale of 0 to 500. Lower is cleaner.`;
  for (const band of document.querySelectorAll('.scale .band')) {
    band.classList.toggle('is-current', band.classList.contains(`band-${air.level}`));
  }

  renderPollutants(air);
  renderSmoke(air.pm25);
  renderForecast(air);

  document.getElementById('summary').textContent = plan.summary;
  document.getElementById('source').textContent = sourceNote(data.source);
  renderStats(plan);
  renderList('routine', plan.routine);
  renderList('indoor', plan.indoor);
  renderList('alternatives', plan.alternatives);

  // The plan is the moment the smog clears in the header scene.
  document.body.classList.add('has-plan');
  results.hidden = false;
  results.focus({ preventScroll: true });
  results.scrollIntoView({ block: 'start' });
}

/**
 * Ask the server for the name of the place at these coordinates.
 * @param {{latitude: number, longitude: number}} point
 * @returns {Promise<string>}
 */
async function lookUpPlace(point) {
  try {
    const response = await fetch('/api/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(point),
    });
    const data = await response.json();
    return response.ok && typeof data.place === 'string' ? data.place : '';
  } catch {
    return '';
  }
}

/**
 * Show which location is in use under the city field, or clear it.
 * @param {string} name
 */
function showLocation(name) {
  locationChip.hidden = !name;
  locationName.textContent = name;
  cityInput.placeholder = name ? 'Using your location' : 'For example Delhi';
}

locateButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setStatus('This browser cannot share a location. Type your city instead.', true);
    return;
  }
  setStatus('Finding your location.');
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      cityInput.value = '';
      setCityError('');
      const name = await lookUpPlace(coordinates);
      showLocation(name || 'your current location');
      setStatus(name ? `Location found: ${name}.` : 'Location found. Choose your options and get your plan.');
    },
    () => setStatus('Location was not shared. Type your city instead.', true),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
});

cityInput.addEventListener('input', () => {
  if (cityInput.value.trim()) {
    coordinates = null;
    showLocation('');
    setCityError('');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answers = collectAnswers(new FormData(form), coordinates);
  if (!answers.city && answers.latitude === undefined) {
    setCityError('Enter a city or town, or use your location.');
    cityInput.focus();
    return;
  }
  setCityError('');
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  setStatus('Reading the air and building your plan. This can take a few seconds.');

  try {
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'The plan could not be built. Please try again.');
    }
    render(data);
    setStatus('Your plan is ready.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Something went wrong. Please try again.', true);
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
  }
});
