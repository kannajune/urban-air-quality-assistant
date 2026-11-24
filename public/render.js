/**
 * Draws a plan response into the page. Every piece of text is set as a text node.
 */
import { byId, el, prefersReducedMotion } from './dom.js';
import {
  cigaretteEquivalent,
  countUpValue,
  describeHour,
  forecastBars,
  planStats,
  pollutantCards,
  scalePosition,
  sourceNote,
  stepTags,
} from './view.js';

const COUNT_UP_MS = 700;
const BENEFIT_DOTS = 3;
const PLAN_SECTIONS = /** @type {const} */ (['routine', 'indoor', 'alternatives']);

/**
 * Show the AQI number, counting up to it unless the visitor prefers reduced motion.
 * @param {HTMLElement} element
 * @param {number} aqi
 */
export function showAqi(element, aqi) {
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    element.textContent = String(aqi);
    return;
  }
  const start = performance.now();
  /** @param {number} now */
  const step = (now) => {
    const progress = (now - start) / COUNT_UP_MS;
    element.textContent = String(countUpValue(aqi, progress));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Small dot meter. The text label beside it carries the meaning, so the dots are decorative.
 * @param {number} level 1 to 3
 * @returns {HTMLElement}
 */
function benefitMeter(level) {
  const dots = el('span', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= BENEFIT_DOTS; i += 1) dots.append(el('span', i <= level ? 'dot is-on' : 'dot'));
  return dots;
}

/**
 * One step of the plan: title, cost and impact tags, the impact line, and the how-to behind a toggle.
 * @param {{title: string, detail: string, impact: string, cost?: string, benefit?: string}} item
 * @returns {HTMLElement}
 */
function planStep(item) {
  const tags = stepTags(item);
  const benefit = el('span', `chip benefit level-${tags.level}`);
  benefit.append(benefitMeter(tags.level), tags.benefitLabel);
  const chips = el('p', 'chips');
  chips.append(el('span', `chip cost cost-${tags.cost}`, tags.costLabel), benefit);

  const impact = el('p', 'impact');
  impact.append(el('strong', '', 'Impact'), el('span', 'impact-text', item.impact));

  const how = el('details', 'how');
  how.append(el('summary', 'how-toggle', 'How to do it'), el('p', 'detail', item.detail));

  const body = el('div', 'step-body');
  body.append(el('p', 'title', item.title), chips, impact, how);
  const li = el('li');
  li.append(body);
  return li;
}

/**
 * @param {string} listId
 * @param {{title: string, detail: string, impact: string, cost?: string, benefit?: string}[]} items
 */
export function renderList(listId, items) {
  byId(`${listId}-count`).textContent = `${items.length} steps`;
  byId(listId).replaceChildren(...items.map(planStep));
}

/** @param {any} plan */
export function renderStats(plan) {
  byId('plan-stats').replaceChildren(
    ...planStats(plan).map((stat) => {
      const li = el('li');
      li.append(el('strong', 'stat-value', String(stat.value)), el('span', 'stat-label', stat.label));
      return li;
    }),
  );
}

/** @param {Record<string, number|null>} air */
export function renderPollutants(air) {
  byId('pollutants').replaceChildren(
    ...pollutantCards(air).map((card) => {
      const fill = el('span', 'fill');
      fill.style.setProperty('--w', `${card.percent}%`);
      const track = el('div', 'track');
      track.append(fill);
      const section = el('section', `card pollutant${card.over ? ' is-over' : ''}`);
      section.setAttribute('aria-label', card.name);
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

/**
 * The forecast as a table, for anyone who cannot read the bar chart.
 * @param {{hour: string, aqi: number, level: string}[]} bars
 * @returns {HTMLElement}
 */
function forecastTable(bars) {
  const table = el('table', 'data-table');
  table.append(el('caption', '', 'Hourly AQI forecast'));
  const head = el('tr');
  for (const title of ['Hour', 'AQI']) {
    const cell = el('th', '', title);
    cell.setAttribute('scope', 'col');
    head.append(cell);
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const bar of bars) {
    const row = el('tr');
    const hour = el('th', '', `${bar.hour}:00`);
    hour.setAttribute('scope', 'row');
    row.append(hour, el('td', '', String(bar.aqi)));
    tbody.append(row);
  }
  table.append(thead, tbody);
  return table;
}

/** @param {any} air */
export function renderForecast(air) {
  const bars = forecastBars(air.forecast);
  const chart = byId('forecast');
  chart.replaceChildren(
    ...bars.map((bar, index) => {
      const node = el('span', `bar band-${bar.level}`);
      node.style.setProperty('--h', `${bar.percent}%`);
      node.style.setProperty('--i', String(index));
      node.title = `${bar.hour}:00, AQI ${bar.aqi}`;
      return node;
    }),
  );
  const cleanest = describeHour(air.cleanest);
  const worst = describeHour(air.peak);
  chart.setAttribute(
    'aria-label',
    `Hourly AQI for the next ${bars.length} hours. Cleanest: ${cleanest}. Worst: ${worst}.`,
  );
  byId('cleanest').textContent = cleanest;
  byId('peak').textContent = worst;
  byId('forecast-table').replaceChildren(forecastTable(bars));
}

/** @param {number|null} pm25 */
export function renderSmoke(pm25) {
  const cigarettes = cigaretteEquivalent(pm25);
  const value = byId('smoke-value');
  const text = byId('smoke-text');
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

/**
 * The reading at the top of the results: number, band, advice and its place on the scale.
 * @param {string} place
 * @param {any} air
 */
export function renderReading(place, air) {
  byId('air-card').style.setProperty('--band', `var(--aqi-${air.level})`);
  showAqi(byId('aqi-value'), air.aqi);
  byId('aqi-band').textContent = air.label;
  byId('place').textContent = place;
  byId('air-advice').textContent = air.advice;
  byId('meter-pin').style.setProperty('--pos', `${scalePosition(air.aqi)}%`);
  byId('meter-text').textContent = `AQI ${air.aqi} on a scale of 0 to 500. Lower is cleaner.`;
  for (const band of document.querySelectorAll('.scale .band')) {
    const current = band.classList.contains(`band-${air.level}`);
    band.classList.toggle('is-current', current);
    if (current) band.setAttribute('aria-current', 'true');
    else band.removeAttribute('aria-current');
  }
}

/**
 * Draw a whole plan response and move the visitor to it.
 * @param {{place: string, air: any, plan: any, source: string}} data
 */
export function renderResults(data) {
  const { air, plan } = data;
  renderReading(data.place, air);
  renderPollutants(air);
  renderSmoke(air.pm25);
  renderForecast(air);

  byId('summary').textContent = plan.summary;
  byId('source').textContent = sourceNote(data.source);
  renderStats(plan);
  for (const section of PLAN_SECTIONS) renderList(section, plan[section]);

  // The plan is the moment the smog clears in the header scene.
  document.body.classList.add('has-plan');
  const results = byId('results');
  results.hidden = false;
  results.focus({ preventScroll: true });
  results.scrollIntoView?.({ block: 'start' });
}
