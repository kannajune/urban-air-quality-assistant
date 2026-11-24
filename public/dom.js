/**
 * Small DOM helpers shared by the page modules.
 */

/** Elements are looked up once and reused, instead of searching the page on every render. */
const found = new Map();

/**
 * Find an element by id, remembering it for next time.
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  if (!found.has(id)) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`The page has no element with id "${id}".`);
    found.set(id, element);
  }
  return found.get(id);
}

/** Forget remembered elements. Used when the document is replaced, as in tests. */
export function forgetElements() {
  found.clear();
}

/**
 * Create an element with a class and text. Text is always set as a text node,
 * so nothing from the server or the model can inject markup.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Whether the visitor has asked their device for less motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
