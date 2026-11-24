# Urban Air Quality Assistant

A GenAI assistant that helps families and communities get through winter smog. It reads the live air quality for a place, asks a few questions about the household, and returns a plan with three parts:

1. A low emission daily routine, timed around the worst hour of the day
2. Indoor air steps that fit the household budget
3. Sustainable alternatives for commute, cooking and heating

Every item carries an impact line that explains the direct effect of that choice on exposure or emissions.

Built for PromptWars Virtual, Challenge 6.

## Chosen vertical

PromptWars Virtual, Challenge 6: Urban Air Quality Assistant. The persona is a family or community living through winter smog in a city, who needs to know what to do today, not a chart to interpret.

## Approach and logic

The assistant makes its decisions from the user's context, in this order:

1. **How bad is the air?** The live US AQI is placed in one of six bands. The band sets the tone of the plan: a light touch on a good day, strict limits on a hazardous one.
2. **Who is at home?** Children, older adults, anyone with asthma, someone pregnant or an outdoor worker. The plan protects the most vulnerable person first.
3. **When is it worst and cleanest?** The 24 hour forecast gives the worst and the cleanest hour, and the daily routine is timed around them.
4. **How does this household live?** The commute, the cooking fuel and the time spent outdoors decide which swaps are suggested.
5. **What can they spend?** Every step is tagged free, low cost or some cost, and a household with no budget is not given costly steps.
6. **What does each step change?** Every step carries a plain explanation of its direct impact on exposure or emissions, and is tagged high, medium or small impact.

Google Gemma writes the plan from this context. Its reply must match a fixed schema and is checked before display. If the model cannot answer, the same decisions are applied by a built in rule set, so the user always gets a plan.

## Assumptions

- Air quality is reported as the US AQI, with readings and forecasts from Open-Meteo's model for the place, not from a sensor in the user's street.
- WHO 2021 guideline levels are used as the health reference for each pollutant.
- The cigarette comparison uses the Berkeley Earth rule of thumb (22 µg/m³ of PM2.5 over a day is about one cigarette) and is an illustration, not a medical measure.
- A shared location is rounded to about one kilometre, which is precise enough for air quality.
- Plans are general guidance for households, not medical advice.
- The service runs on free tiers, so the number of model written plans per day is capped; past the cap the rule based plan is served.

## How the solution works

```
Browser (public/)  ->  Cloudflare Worker (src/)  ->  Open-Meteo (geocoding + air quality)
                                                 ->  OpenStreetMap Nominatim (place name for a shared location)
                                                 ->  Google Gemma on Cloudflare Workers AI (structured plan)
```

1. The browser sends the city (or rounded coordinates) and the household answers to `POST /api/plan`.
2. The Worker validates every field against an allow list, then fetches live US AQI, PM2.5, PM10, NO2, ozone and the 24 hour forecast from Open-Meteo.
3. The Worker sends the readings and answers to Google Gemma as JSON data with a response schema, so the reply is structured.
4. The reply is validated and trimmed before it reaches the browser. If the model cannot answer, a rule based plan is returned and labelled as such.

## Where Gen AI is used

| Where                  | What                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/workersai.js` | Google Gemma 4, an open model on Cloudflare Workers AI, writes the tailored plan from live readings and household answers, using a JSON schema for the reply |
| Build                  | The project was built with an AI coding assistant                                                                                                            |

## Security

- There is no API key anywhere. The model is reached through a Cloudflare binding inside the same account, so there is no secret to store, rotate or leak.
- All input is validated on the server against allow lists. Unknown fields are dropped before anything reaches the model.
- User answers go to the model as JSON data, and the system instruction tells the model to treat them as data only.
- Model output is treated as untrusted: it is schema checked, length capped and stripped of markup, and the page renders it with text nodes only.
- Strict Content Security Policy, no inline scripts or styles, no third party scripts, no cookies, no tracking.
- Limits come in two layers. Cloudflare's edge rate limiter sheds heavy bursts, and a Durable Object keeps exact counts: per visitor per minute, per visitor per day, and a whole app daily ceiling on AI calls. Past that ceiling the app still answers, from its built in rules, so the free model allowance cannot be drained. Visitor addresses are counted in memory only and never stored.
- Request bodies are capped at 4 KB and every upstream call has a timeout.
- Coordinates are rounded to about one kilometre before they leave the Worker, and nothing is stored.

## Efficiency

- Static files never run the Worker. They are served straight from the edge, with security and caching headers from `public/_headers`. Only `/api/` calls execute code.
- Upstream answers are cached at the edge: place lookups for a day, air quality readings for ten minutes. A written plan is cached for ten minutes under a hash of the readings and answers, so a repeat request costs no model call and returns at once.
- Cached plans do not use the daily model allowance; a model call is reserved only when a plan really has to be written.
- Independent lookups run together: for a shared location, the place name and the air reading are fetched in parallel.
- Every upstream call has a timeout, and the model's long reasoning mode is switched off for this short structured task.
- In the browser: styles and scripts are cached and preloaded, a new request cancels the previous one, the page waits at most 45 seconds, page elements are looked up once, and the header animation pauses while it is scrolled out of view.

## Accessibility

- Semantic landmarks, one `h1`, ordered headings, a skip link
- Every control has a visible label; grouped options use `fieldset` and `legend`
- Status and errors are announced through live regions, and focus moves to the results
- AQI is shown as a number and a text label, never by colour alone
- Colour contrast meets WCAG AA in light and dark themes; touch targets are at least 44 px
- Works with keyboard only, at 200 percent zoom and on a phone; respects reduced motion

## Run it locally

Requires Node 20 or newer.

```bash
npm install
npx wrangler login   # the model runs on your Cloudflare account, even in local runs
npm run dev
```

Open http://localhost:8787. No keys or environment files are needed.

## Test

```bash
npm test             # 201 unit and integration tests, no network needed
npm run test:coverage
npm run lint
npm run typecheck     # type checks the JavaScript through its JSDoc types
npm run format:check
npm run check         # all of the above
```

Tests cover input validation, AQI banding, the upstream clients, the model call, the fallback plan, every Worker route, rate limiting and the view helpers. Coverage thresholds are enforced in `vitest.config.js` and in CI.

## Deploy

```bash
npx wrangler login
npm run deploy
```

## Project layout

```
public/        Static front end (HTML, CSS, ES modules)
src/index.js   Worker entry: routing and error handling
src/routes/    One file per endpoint: plan, place
src/lib/       Validation, air quality client, Workers AI client, prompt, fallback plan,
               edge cache, rate limits, HTTP helpers, shared types
test/          Vitest suites
```

## Data sources

- Air quality and geocoding: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Place names for shared locations: [OpenStreetMap Nominatim](https://nominatim.org/), data © OpenStreetMap contributors (ODbL)
- Guideline levels: WHO global air quality guidelines, 2021
- AQI bands: US EPA Air Quality Index

Plans are general guidance, not medical advice.

## License

MIT
