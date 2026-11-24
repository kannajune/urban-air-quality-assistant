# Urban Air Quality Assistant

A GenAI assistant that helps families and communities get through winter smog. It reads the live air quality for a place, asks a few questions about the household, and returns a plan with three parts:

1. A low emission daily routine, timed around the worst hour of the day
2. Indoor air steps that fit the household budget
3. Sustainable alternatives for commute, cooking and heating

Every item carries an impact line that explains the direct effect of that choice on exposure or emissions.

Built for PromptWars Virtual, Challenge 6.

## How it works

```
Browser (public/)  ->  Cloudflare Worker (src/)  ->  Open-Meteo (geocoding + air quality)
                                                 ->  OpenStreetMap Nominatim (place name for a shared location)
                                                 ->  Google Gemini (structured plan, when a key is set)
                                                 ->  Google Gemma on Cloudflare Workers AI (keyless backup)
```

1. The browser sends the city (or rounded coordinates) and the household answers to `POST /api/plan`.
2. The Worker validates every field against an allow list, then fetches live US AQI, PM2.5, PM10, NO2, ozone and the 24 hour forecast from Open-Meteo.
3. The Worker sends the readings and answers to Gemini as JSON data with a response schema, so the reply is structured.
4. The reply is validated and trimmed before it reaches the browser. If a Gemini model is busy the Worker tries the next one in its list, then the keyless Gemma model, and if none answers a rule based plan is returned and labelled as such.

## Where Gen AI is used

| Where | What |
|---|---|
| `src/lib/gemini.js` | Google Gemini (`generateContent` with a JSON response schema) writes the tailored plan from live readings and household answers |
| `src/lib/workersai.js` | Google Gemma 4, an open model on Cloudflare Workers AI, writes the plan when no Gemini key is set or Gemini is busy. It needs no API key |
| Build | The project was built with an AI coding assistant |

## Security

- The Gemini key is a Worker secret. It is never in this repository, never sent to the browser, and travels to Google in a header, not a URL.
- All input is validated on the server against allow lists. Unknown fields are dropped before anything reaches the model.
- User answers go to the model as JSON data, and the system instruction tells the model to treat them as data only.
- Model output is treated as untrusted: it is schema checked, length capped and stripped of markup, and the page renders it with text nodes only.
- Strict Content Security Policy, no inline scripts or styles, no third party scripts, no cookies, no tracking.
- Limits come in two layers. Cloudflare's edge rate limiter sheds heavy bursts, and a Durable Object keeps exact counts: per visitor per minute, per visitor per day, and a whole app daily ceiling on AI calls. Past that ceiling the app still answers, from its built in rules, so the model key cannot be drained. Visitor addresses are counted in memory only and never stored.
- Request bodies are capped at 4 KB and every upstream call has a timeout.
- Coordinates are rounded to about one kilometre before they leave the Worker, and nothing is stored.

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
cp .dev.vars.example .dev.vars   # then put your Gemini key in .dev.vars
npm run dev
```

Open http://localhost:8787. Without a Gemini key the app still runs: plans come from Gemma on Workers AI, or from the standard rules if that is unavailable.

## Test

```bash
npm test             # 196 unit and integration tests, no network needed
npm run test:coverage
npm run lint
```

Tests cover input validation, AQI banding, the upstream clients, the Gemini call, the fallback plan, every Worker route, rate limiting and the view helpers. Coverage thresholds are enforced in `vitest.config.js` and in CI.

## Deploy

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

## Project layout

```
public/        Static front end (HTML, CSS, ES modules)
src/index.js   Worker entry: routing, rate limits, error handling
src/lib/       Validation, air quality client, Gemini and Workers AI clients, fallback plan, rate limiter, HTTP helpers
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
