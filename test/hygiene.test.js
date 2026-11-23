import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'coverage', '.dev.vars', 'package-lock.json']);

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(root);
const read = (path) => readFileSync(path, 'utf8');
const html = read(join(root, 'public/index.html'));

describe('secrets stay out of the repository', () => {
  const patterns = [
    ['a Google API key', /AIza[0-9A-Za-z_-]{30,}/],
    ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a bearer token', /Bearer\s+[A-Za-z0-9._-]{30,}/],
    ['a Cloudflare API token assignment', /CLOUDFLARE_API_TOKEN\s*=\s*\S{20,}/],
  ];

  it.each(patterns)('no file contains %s', (_name, pattern) => {
    const hits = files.filter((path) => pattern.test(read(path)));
    expect(hits).toEqual([]);
  });

  it('git ignores local secret files', () => {
    const ignored = read(join(root, '.gitignore')).split('\n');
    expect(ignored).toEqual(expect.arrayContaining(['.dev.vars', '.env', '.env.*', 'node_modules/']));
  });

  it('the example secrets file holds a placeholder only', () => {
    expect(read(join(root, '.dev.vars.example'))).toContain('GEMINI_API_KEY=your-key-here');
  });

  it('the Worker config declares no secret values', () => {
    expect(read(join(root, 'wrangler.jsonc'))).not.toMatch(/"GEMINI_API_KEY"\s*:/);
  });
});

describe('the page is compatible with a strict content security policy', () => {
  it('has no inline scripts, inline styles or inline event handlers', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('loads no third party resources', () => {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(urls.filter((url) => /^(https?:)?\/\//.test(url))).toEqual([]);
  });

  it('client code never writes HTML strings into the page', () => {
    const client = read(join(root, 'public/app.js'));
    expect(client).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('accessibility basics in the markup', () => {
  it('declares the language and has exactly one h1', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('gives every text input and select a label', () => {
    const ids = [...html.matchAll(/<(?:input type="text"|select)[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
    const idsFromInputs = [...html.matchAll(/<input id="([^"]+)"[^>]*type="text"/g)].map((match) => match[1]);
    for (const id of new Set([...ids, ...idsFromInputs])) {
      expect(html).toContain(`<label for="${id}">`);
    }
    expect(new Set([...ids, ...idsFromInputs]).size).toBeGreaterThanOrEqual(5);
  });

  it('wraps every checkbox in a label', () => {
    const boxes = html.match(/<input type="checkbox"/g) || [];
    const labelled = html.match(/<label class="choice"><input type="checkbox"/g) || [];
    expect(boxes.length).toBe(labelled.length);
  });

  it('has a skip link, a main landmark and live regions for status and errors', () => {
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main id="main"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('role="alert"');
  });

  it('hides decoration from assistive technology and gates motion on user preference', () => {
    const drawings = html.match(/<svg /g) || [];
    const hidden = html.match(/<svg [^>]*aria-hidden="true" focusable="false"/g) || [];
    expect(drawings.length).toBeGreaterThan(0);
    expect(hidden.length).toBe(drawings.length);
    const css = read(join(root, 'public/styles.css'));
    const animated = css.match(/animation:/g) || [];
    const outside = css.split('@media (prefers-reduced-motion: no-preference)')[0].match(/animation:/g) || [];
    expect(animated.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });
});

describe('the repository stays small', () => {
  it('ships well under the 10 MB limit', () => {
    const bytes = files.reduce((total, path) => total + statSync(path).size, 0);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
