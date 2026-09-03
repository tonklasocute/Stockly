import { expect, test, type Page } from "@playwright/test"

/**
 * The application in both languages.
 *
 * Everything else in this folder pins English so its assertions can read like sentences. This is
 * the spec that does not: it walks every major page in Thai *and* in English and asserts three
 * things per page, which is what "supports two languages" actually means in practice.
 *
 *   1. The page renders and has a heading — a missing namespace throws, so this catches it.
 *   2. No key path leaked onto the screen. `lib/i18n/request.ts` renders `dashboard.sections.goals`
 *      when a key is missing, and it is the one failure a screenshot review would miss on a page
 *      full of real text.
 *   3. `<html lang>` matches the language asked for, so a screen reader picks the right voice.
 *
 * And, separately and most importantly: **switching language must not change a figure.** That is
 * asserted at the end against the dashboard's own numbers.
 */

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

/**
 * Scoped to the tests that need an account, not to the file.
 *
 * The public pages and a shared address are readable by anybody, so they are exactly the part of
 * this spec that can run against any deployment with no fixture — skipping the whole file for a
 * missing password would have thrown that away.
 */
const needsAccount = { condition: !EMAIL || !PASSWORD, reason: "Set E2E_EMAIL and E2E_PASSWORD." }

/** Every page a signed-in user can reach that needs no id in its path. */
const PAGES = [
  "/dashboard",
  "/portfolio",
  "/portfolio/history",
  "/transactions",
  "/analytics",
  "/review",
  "/goals",
  "/simulations",
  "/journal",
  "/imports",
  "/data-quality",
  "/operations",
  "/sharing",
  "/alerts",
  "/screener",
  "/dividends",
  "/cash",
  "/news",
  "/watchlist",
  "/notifications",
  "/settings",
  "/settings/preferences",
  "/settings/notifications",
] as const

const PUBLIC_PAGES = ["/login", "/register", "/privacy", "/terms", "/disclaimer"] as const

/**
 * A key path that reached the screen.
 *
 * `namespace.some.key` with no spaces, which no real sentence in either language looks like. The
 * namespaces are named explicitly rather than matched loosely, because a stock symbol with a dot in
 * it ("BRK.B") would otherwise read as a missing key.
 */
const LEAKED_KEY =
  /\b(common|navigation|enums|errors|validation|metadata|settings|legal|dashboard|portfolios|transactions|analytics|history|intelligence|goals|theses|journal|simulations|screener|alerts|watchlist|stocks|news|notifications|technical|fundamentals|imports|operations|dataQuality|sharing|cash|dividends|personalization|ai|pwa|auth|automation)\.[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+\b/

/**
 * The base URL, resolved the same way `playwright.config.ts` resolves it.
 *
 * A cookie needs an origin, and `page.url()` is `about:blank` before the first navigation — which
 * is exactly when a test wants to choose a language. Using the configured base URL instead means
 * `setLocale` works before the page has been anywhere.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

async function setLocale(page: Page, locale: "th" | "en") {
  await page.context().addCookies([{ name: "stockly_locale", value: locale, url: BASE_URL }])
}

async function signIn(page: Page) {
  // Signed in in English, because that is the language this helper's selectors are written in.
  await setLocale(page, "en")
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(EMAIL!)
  await page.getByLabel(/password/i).fill(PASSWORD!)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
}

for (const locale of ["th", "en"] as const) {
  test(`every signed-in page renders in ${locale} with no missing keys`, async ({ page }) => {
    test.skip(needsAccount.condition, needsAccount.reason)
    await signIn(page)
    await setLocale(page, locale)

    for (const path of PAGES) {
      await test.step(path, async () => {
        await page.goto(path)

        // The document declares the language it is in — a screen reader reads `lang`, not a cookie.
        await expect(page.locator("html")).toHaveAttribute("lang", locale)

        // Something rendered. A page that threw shows the error boundary, which has no h1.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ")
        expect(body, `${path} rendered a translation key`).not.toMatch(LEAKED_KEY)
      })
    }
  })

  test(`every public page renders in ${locale} with no missing keys`, async ({ page }) => {
    for (const path of PUBLIC_PAGES) {
      await test.step(path, async () => {
        await page.goto(path)
        await setLocale(page, locale)
        await page.reload()

        await expect(page.locator("html")).toHaveAttribute("lang", locale)
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ")
        expect(body, `${path} rendered a translation key`).not.toMatch(LEAKED_KEY)
      })
    }
  })
}

/**
 * The invariant, in a browser.
 *
 * `domain/locale-boundary.test.ts` proves the engines cannot move; this proves the *rendered* page
 * does not either. Every number on the dashboard is collected in one language and compared against
 * the same page in the other — if a formatter ever starts varying by locale, this is what says so.
 */
test("switching language changes no figure on the dashboard", async ({ page }) => {
  test.skip(needsAccount.condition, needsAccount.reason)
  await signIn(page)

  const figures = async () => {
    await page.goto("/dashboard")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const text = await page.locator("main").innerText()
    // Every money, percentage and quantity-shaped run of characters, in order.
    return (text.match(/[−+]?[$฿]?\d[\d,]*(\.\d+)?%?/g) ?? []).join("|")
  }

  await setLocale(page, "en")
  const english = await figures()

  await setLocale(page, "th")
  const thai = await figures()

  expect(thai, "a figure changed with the language").toBe(english)
  expect(english.length, "no figures were found — did the dashboard render?").toBeGreaterThan(0)
})

/**
 * Switching back and forth, repeatedly, without losing the page.
 *
 * The switcher calls `router.refresh()` rather than reloading, so the URL, its query string and the
 * React tree survive. This is the regression that would appear as "my filters reset when I changed
 * language" — and the query string is the cheapest observable proof of it.
 */
test("switching language repeatedly keeps the URL and its query intact", async ({ page }) => {
  test.skip(needsAccount.condition, needsAccount.reason)
  await signIn(page)
  await page.goto("/transactions?page=1")

  for (const locale of ["th", "en", "th", "en"] as const) {
    await setLocale(page, locale)
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", locale)
    expect(new URL(page.url()).searchParams.get("page")).toBe("1")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  }
})

/** A shared page takes its language from the URL, never from whoever happens to be signed in. */
test("a public share page honours ?lang= over the visitor's cookie", async ({ page }) => {
  await setLocale(page, "th")
  // A slug that does not exist: the unavailable page is still a rendered, translated page, and it
  // is the one shared-page response that needs no fixture in the database.
  await page.goto("/p/e2e-does-not-exist?lang=en")

  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ")
  expect(body).not.toMatch(LEAKED_KEY)
  expect(body).toMatch(/private|not available/i)
})
