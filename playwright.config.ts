import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests, for the money paths only.
 *
 * These need a real database: a signed-in session, a portfolio and a transaction that survives a
 * page load. That is the point of them — the unit tests already cover the arithmetic, and what
 * cannot be covered without a browser is that the pieces are wired together at all.
 *
 * `E2E_BASE_URL` points them at an already-running server (a Vercel preview, say). Without it they
 * build and start the app themselves, which is what CI does.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

/**
 * Every spec starts in English.
 *
 * Phase 21 made Thai the default, and these specs find controls by their accessible name — `/sign
 * in/i`, `/add transaction/i`. Without this they would all fail in a way that reads like a product
 * bug rather than a language default, and rewriting each assertion into a two-language regex would
 * make them unreadable for the sake of a setting.
 *
 * So the *language* is pinned here and tested on its own, in `i18n.spec.ts`, which walks both. This
 * is the same cookie the switcher writes, so a spec is running the real path rather than a stub.
 */
const ENGLISH_LOCALE = {
  cookies: [
    {
      name: "stockly_locale",
      value: "en",
      domain: new URL(baseURL).hostname,
      path: "/",
      // Session-length: -1 is Playwright's "expires when the context closes".
      expires: -1,
      httpOnly: false,
      secure: new URL(baseURL).protocol === "https:",
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
}

export default defineConfig({
  testDir: "./tests/e2e",
  // Serial by default: the specs sign in as one account and mutate its portfolio, so running them
  // in parallel would have them delete each other's fixtures.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    storageState: ENGLISH_LOCALE,
    trace: "on-first-retry",
    // A trace is the useful artefact; a video of a failing headless run rarely is.
    video: "off",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The mobile pass exists because the layout genuinely differs below `lg`: tables become cards
    // and the navigation becomes a bottom tab bar. A desktop-only run would never see either.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
