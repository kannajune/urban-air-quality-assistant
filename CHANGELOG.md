# Changelog

## 1.3.0

- Page script split into `app`, `api`, `render` and `dom` modules, each with browser level tests.
- Automated accessibility checks with the axe engine across four page states.
- Forecast chart gained a data table alternative; the header effect now also responds to keyboard focus.
- Support for forced colour modes, and a message for browsers without JavaScript.
- Place lookups moved to their own module; the rule based plan and the validator split into small functions.
- Lint limits on complexity and function length. Architecture, contributing and security documents.

## 1.2.0

- Edge caching of place lookups, air readings and written plans.
- Static files served from the edge without running the Worker.
- Worker split into one file per route, with shared types and type checking in CI.

## 1.1.0

- Exact rate limiter with daily ceilings, as a Durable Object.
- Google Gemma on Workers AI writes the plan; no API key is needed.

## 1.0.0

- First release: live air quality, a three part household plan, and the impact of every step.
