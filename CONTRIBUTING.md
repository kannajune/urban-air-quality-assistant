# Contributing

## Setup

Requires Node 22 (see `.nvmrc`).

```bash
npm install
npx wrangler login   # the model runs on your own Cloudflare account, even locally
npm run dev
```

## Before you push

```bash
npm run check
```

This runs the linter, the type checker, the format check and the tests with coverage.
CI runs the same command on every push and pull request.

## Conventions

- **One job per module.** Routes orchestrate; libraries do one thing. See `docs/ARCHITECTURE.md`.
- **Small functions.** The linter limits complexity to 10 and functions to 60 lines.
- **Types through JSDoc.** Every exported function documents its parameters and return value,
  and `npm run typecheck` verifies them.
- **No magic numbers.** Limits, timeouts and thresholds are named constants at the top of their module.
- **Inject what touches the outside world.** `fetch`, the cache and the clock are parameters,
  so tests never need the network.
- **Every change comes with a test.** Coverage thresholds are enforced.
- **Text only in the page.** Never build markup from strings; use `el()` from `public/dom.js`.
- **Formatting is automatic.** Run `npm run format`.

## Adding an endpoint

1. Add a handler in `src/routes/`.
2. Register it in `POST_ROUTES` in `src/index.js`.
3. Validate every input field against an allow list in `src/lib/validate.js`.
4. Apply `limitVisitor` first.
5. Add route tests in `test/worker.test.js`.
