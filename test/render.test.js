// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byId, el, forgetElements, prefersReducedMotion } from '../public/dom.js';
import { renderForecast, renderPollutants, renderResults, renderSmoke, showAqi } from '../public/render.js';
import { loadPage, planResponse } from './page.js';

beforeEach(loadPage);

describe('dom helpers', () => {
  it('finds an element once and reuses it', () => {
    const spy = vi.spyOn(document, 'getElementById');
    expect(byId('status')).toBe(byId('status'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('fails loudly when the page is missing an expected element', () => {
    expect(() => byId('no-such-element')).toThrow('no-such-element');
  });

  it('looks again after the page is replaced', () => {
    const before = byId('status');
    loadPage();
    forgetElements();
    expect(byId('status')).not.toBe(before);
  });

  it('builds elements from text, never from markup', () => {
    const node = el('p', 'note', '<img src=x onerror=alert(1)>');
    expect(node.className).toBe('note');
    expect(node.children).toHaveLength(0);
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el('span').className).toBe('');
  });

  it('reads the reduced motion preference and copes with browsers that lack it', () => {
    window.matchMedia = /** @type {any} */ (() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = /** @type {any} */ (undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('showAqi', () => {
  it('shows the number at once when reduced motion is preferred', () => {
    const node = el('p');
    showAqi(node, 182);
    expect(node.textContent).toBe('182');
  });

  it('counts up to the number otherwise', () => {
    window.matchMedia = /** @type {any} */ (() => ({ matches: false }));
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const node = el('p');
    showAqi(node, 200);
    frames.shift()(1350);
    const halfway = Number(node.textContent);
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(200);
    frames.shift()(1700);
    expect(node.textContent).toBe('200');
    expect(frames).toHaveLength(0);
    now.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('renderResults', () => {
  beforeEach(() => renderResults(planResponse));

  it('reveals the results and moves focus to them', () => {
    const results = byId('results');
    expect(results.hidden).toBe(false);
    expect(document.activeElement).toBe(results);
    expect(document.body.classList.contains('has-plan')).toBe(true);
  });

  it('shows the reading, its band and its place on the scale', () => {
    expect(byId('aqi-value').textContent).toBe('182');
    expect(byId('aqi-band').textContent).toBe('Unhealthy');
    expect(byId('place').textContent).toBe('Delhi, Delhi, India');
    expect(byId('meter-pin').style.getPropertyValue('--pos')).toBe('36%');
    expect(byId('meter-text').textContent).toContain('AQI 182');
    expect(byId('air-card').style.getPropertyValue('--band')).toBe('var(--aqi-unhealthy)');
  });

  it('marks the current band in the scale legend, for sighted and screen reader users', () => {
    const current = [...document.querySelectorAll('.scale .band.is-current')];
    expect(current).toHaveLength(1);
    expect(current[0].classList.contains('band-unhealthy')).toBe(true);
    expect(current[0].getAttribute('aria-current')).toBe('true');
    expect(document.querySelectorAll('.scale [aria-current]')).toHaveLength(1);
  });

  it('draws a card for every pollutant with its comparison to the guideline', () => {
    const cards = [...document.querySelectorAll('#pollutants .pollutant')];
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['PM2.5', 'PM10', 'NO2', 'Ozone']);
    expect(cards[0].classList.contains('is-over')).toBe(true);
    expect(cards[0].querySelector('.times').textContent).toBe('6.5 times the WHO guideline');
    expect(cards[3].classList.contains('is-over')).toBe(false);
  });

  it('draws the forecast chart with a text alternative and a data table', () => {
    const chart = byId('forecast');
    expect(chart.querySelectorAll('.bar')).toHaveLength(3);
    expect(chart.getAttribute('aria-label')).toContain('Cleanest: 10:00, AQI 150');
    expect(byId('cleanest').textContent).toBe('10:00, AQI 150 (Unhealthy for sensitive groups)');
    expect(byId('peak').textContent).toBe('21:00, AQI 210 (Very unhealthy)');
    const rows = [...document.querySelectorAll('#forecast-table tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual(['09:00182', '10:00150', '21:00210']);
    expect(document.querySelectorAll('#forecast-table th[scope="col"]')).toHaveLength(2);
    expect(document.querySelector('#forecast-table caption').textContent).toBe('Hourly AQI forecast');
  });

  it('writes the summary, the source and the plan totals', () => {
    expect(byId('summary').textContent).toContain('Keep the children indoors');
    expect(byId('source').textContent).toContain('Google Gemma');
    expect([...document.querySelectorAll('#plan-stats .stat-value')].map((node) => node.textContent)).toEqual([
      '4',
      '2',
      '2',
    ]);
  });

  it('draws every plan step with its tags, impact and how-to', () => {
    expect(byId('routine-count').textContent).toBe('2 steps');
    const steps = [...document.querySelectorAll('#routine li')];
    expect(steps).toHaveLength(2);
    expect(steps[0].querySelector('.title').textContent).toBe('Shift the school run');
    expect(steps[0].querySelector('.chip.cost').textContent).toBe('Free');
    expect(steps[0].querySelector('.chip.benefit').textContent).toBe('High impact');
    expect(steps[0].querySelectorAll('.dot.is-on')).toHaveLength(3);
    expect(steps[0].querySelector('.dots').getAttribute('aria-hidden')).toBe('true');
    expect(steps[0].querySelector('.impact-text').textContent).toBe('Cuts peak exposure by about half.');
    expect(steps[0].querySelector('details summary').textContent).toBe('How to do it');
    expect(document.querySelectorAll('#alternatives .dot.is-on')).toHaveLength(1);
  });

  it('replaces the old plan when a new one arrives', () => {
    renderResults({ ...planResponse, plan: { ...planResponse.plan, routine: planResponse.plan.routine.slice(0, 1) } });
    expect(document.querySelectorAll('#routine li')).toHaveLength(1);
    expect(byId('routine-count').textContent).toBe('1 steps');
  });

  it('never turns text from the model into markup', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    renderResults({
      ...planResponse,
      place: hostile,
      plan: { ...planResponse.plan, summary: hostile, routine: [{ title: hostile, detail: hostile, impact: hostile }] },
    });
    expect(document.querySelectorAll('#results img, #results script')).toHaveLength(0);
    expect(byId('summary').textContent).toBe(hostile);
  });
});

describe('renderSmoke', () => {
  it.each([
    [98, 'About 4.5 cigarettes', 'full day outdoors at this level'],
    [8, 'About 0.4 cigarettes', 'levels are low'],
    [1, 'Almost none', 'levels are low'],
    [null, 'No reading', 'no fine particle reading'],
  ])('describes a PM2.5 reading of %s', (pm25, value, text) => {
    renderSmoke(pm25);
    expect(byId('smoke-value').textContent).toBe(value);
    expect(byId('smoke-text').textContent).toContain(text);
  });
});

describe('partial data', () => {
  it('skips pollutants that have no reading', () => {
    renderPollutants({ pm25: 20, pm10: null, no2: null, ozone: null });
    expect(document.querySelectorAll('#pollutants .pollutant')).toHaveLength(1);
  });

  it('says so when there is no forecast', () => {
    renderForecast({ forecast: [], cleanest: null, peak: null });
    expect(byId('forecast').children).toHaveLength(0);
    expect(byId('cleanest').textContent).toBe('No forecast available');
  });
});
