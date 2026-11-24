// @vitest-environment jsdom
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderResults } from '../public/render.js';
import { loadPage, planResponse } from './page.js';

/**
 * Run the axe accessibility engine over the current document.
 * Colour contrast needs a real layout engine, so it is checked by hand and left out here.
 * @returns {Promise<string[]>} One line per failed rule.
 */
async function violations() {
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

beforeEach(loadPage);

describe('automated accessibility checks (axe, WCAG 2.2 AA and best practices)', () => {
  it('the checker itself catches real problems', async () => {
    const image = document.createElement('img');
    image.src = '/picture.png';
    const unlabelled = document.createElement('input');
    document.querySelector('main').append(image, unlabelled);
    const found = (await violations()).join(' ');
    expect(found).toContain('image-alt');
    expect(found).toContain('label');
  });

  it('the page as first loaded has no violations', async () => {
    expect(await violations()).toEqual([]);
  });

  it('the page with a full plan has no violations', async () => {
    renderResults(planResponse);
    expect(await violations()).toEqual([]);
  });

  it('the page with an open how-to and the forecast table has no violations', async () => {
    renderResults(planResponse);
    for (const details of document.querySelectorAll('details')) details.open = true;
    expect(await violations()).toEqual([]);
  });

  it('the page showing a field error has no violations', async () => {
    const error = document.getElementById('city-error');
    error.hidden = false;
    error.textContent = 'Enter a city or town, or use your location.';
    document.getElementById('city').setAttribute('aria-invalid', 'true');
    expect(await violations()).toEqual([]);
  });
});
