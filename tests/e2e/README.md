# End-to-end tests

These are the only tests that need a running application and a real database. Everything else —
the cost-basis engine, the indicators, the screener, the AI grounding rules — is covered by unit
tests that need neither.

## What they cover

`critical-journey.spec.ts` walks the path that has to work or the product does not exist:

```
sign in → dashboard → record a buy → see it in the portfolio → open the stock
       → add it to the watchlist → run a screen → create an alert → ask the assistant
```

`smoke.spec.ts` is what to run against a deployment after shipping: does every page load, does the
health probe answer, are the security headers present.

## Running them

They need an account that already exists in the target database:

```bash
export E2E_EMAIL=you@example.com
export E2E_PASSWORD=...
npm run test:e2e:install        # once — downloads the browser
npm run build
npm run test:e2e
```

Against a deployed environment instead of a local build:

```bash
E2E_BASE_URL=https://your-preview.vercel.app npm run test:e2e
```

**Never point these at production.** They create and delete portfolio records.

Without `E2E_EMAIL` and `E2E_PASSWORD` the journey spec skips itself and says so, rather than
failing — a missing credential is a missing environment, not a broken application. The smoke spec
runs regardless, because none of it needs a session.
