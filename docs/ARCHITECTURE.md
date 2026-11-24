# Architecture

## Request flow

```
Browser
  |  static files (HTML, CSS, JS)        -> served from the edge, no code runs
  |  POST /api/place, POST /api/plan     -> Cloudflare Worker
  v
Worker (src/index.js)
  routes/place.js   limits -> validate -> place name (cached)
  routes/plan.js    limits -> validate -> place + air reading (cached, in parallel)
                    -> prompt -> written plan (cached) or rule based plan
```

## Modules

| Module                  | Responsibility                                           | Depends on             |
| ----------------------- | -------------------------------------------------------- | ---------------------- |
| `src/index.js`          | Routing and the single error boundary                    | routes, http           |
| `src/routes/plan.js`    | Orchestrates one plan request                            | everything in `lib`    |
| `src/routes/place.js`   | Names the place at a pair of coordinates                 | geocode, cache, limits |
| `src/lib/validate.js`   | Allow list validation of every input field               | http                   |
| `src/lib/geocode.js`    | City to coordinates, coordinates to name                 | http                   |
| `src/lib/airquality.js` | Live reading, AQI bands, 24 hour forecast                | http                   |
| `src/lib/prompt.js`     | The instruction and the data message for the model       | none                   |
| `src/lib/workersai.js`  | Calls Google Gemma on Workers AI                         | prompt, plan           |
| `src/lib/plan.js`       | The plan schema, and checking of model output            | none                   |
| `src/lib/fallback.js`   | Rule based plan, used when the model cannot answer       | none                   |
| `src/lib/cache.js`      | Read through cache on the edge cache                     | none                   |
| `src/lib/limits.js`     | Applies the rate limits to a request                     | limiter, http          |
| `src/lib/limiter.js`    | Exact counters, as a Durable Object                      | none                   |
| `src/lib/http.js`       | JSON responses, security headers, body reading, timeouts | none                   |
| `src/lib/types.js`      | Shared type definitions                                  | none                   |
| `public/app.js`         | Wires the form, the location button and the results      | api, dom, render, view |
| `public/api.js`         | Calls to the Worker, with timeout and cancellation       | none                   |
| `public/render.js`      | Draws a plan response into the page                      | dom, view              |
| `public/view.js`        | Pure functions that turn data into what is shown         | none                   |
| `public/dom.js`         | Element lookup and safe element creation                 | none                   |

Dependencies point one way: routes use libraries, libraries do not use routes, and the pure
modules (`view.js`, `plan.js`, `prompt.js`, `fallback.js`) use nothing with side effects.
That is what lets each be tested on its own.

## Design decisions

**The model is never trusted.** Its reply must match a JSON schema, and is then checked,
length capped and stripped of markup in `plan.js`. The page sets every string as a text node.
A hostile or broken reply can at worst cause the rule based plan to be served.

**There is always an answer.** Each step that can fail has a defined fallback: no place name
means the plan still builds, a busy model means the rule based plan, an exhausted daily
allowance means the rule based plan.

**No secrets.** The model is reached through a Cloudflare binding, so there is no API key to
store, rotate or leak. Tests fail the build if a key shaped string or a secret setting appears.

**Limits in two layers.** The edge rate limiter is cheap and approximate, so it sheds bursts.
A Durable Object behind it counts exactly: per visitor per minute, per visitor per day, and
model calls per day for the whole app. Visitor addresses are held in memory only.

**Cache what repeats.** Places do not move and readings are hourly, so both are cached at
the edge. A written plan is cached under a hash of the readings and the answers, which
removes the slowest and most limited step for repeat requests.

**Injected dependencies.** `fetch`, the cache and the clock are passed in, so the whole
Worker runs in unit tests with no network and no real time.

## Testing strategy

| Layer         | What it covers                                                                 | Where                                                         |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Unit          | Validation, AQI bands, forecast, cache, limiter, plan checking, view helpers   | `test/*.test.js`                                              |
| Integration   | Every Worker route end to end with faked upstream services                     | `test/worker.test.js`, `test/cache.test.js`                   |
| Browser       | The real page markup in jsdom: form, location, rendering, errors, cancellation | `test/app.test.js`, `test/render.test.js`, `test/api.test.js` |
| Accessibility | The axe engine over four states of the page, WCAG 2.2 AA                       | `test/accessibility.test.js`                                  |
| Repository    | No secrets, strict content security policy, header parity, repository size     | `test/hygiene.test.js`                                        |
