import { expect, test, type Page } from "@playwright/test"

/**
 * The one journey that has to work.
 *
 * Sign in, record a buy, see it priced, open the stock, watch it, screen, alert, ask the assistant.
 * Deliberately one long test rather than eight short ones: each step depends on the state the last
 * one left behind, and splitting them would mean either re-creating that state eight times or
 * pretending the steps are independent when they are not.
 */

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

// A missing credential is a missing environment, not a broken application.
test.skip(
  !EMAIL || !PASSWORD,
  "Set E2E_EMAIL and E2E_PASSWORD to a test account in the target database.",
)

const SYMBOL = "NVDA"
/** Distinctive enough that a leftover fixture is obvious in a database. */
const PORTFOLIO = `E2E ${Date.now()}`

async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(EMAIL!)
  await page.getByLabel(/password/i).fill(PASSWORD!)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
}

test("sign in, record a trade, research it, and ask about it", async ({ page }) => {
  await test.step("sign in", async () => {
    await signIn(page)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })

  await test.step("create a portfolio to work in", async () => {
    await page.goto("/settings")
    await page.getByRole("button", { name: /new portfolio|add portfolio|create/i }).first().click()
    await page.getByLabel(/name/i).fill(PORTFOLIO)
    await page.getByRole("button", { name: /^(create|save)$/i }).click()
    await expect(page.getByText(PORTFOLIO).first()).toBeVisible()
  })

  await test.step("record a buy", async () => {
    await page.goto("/transactions")
    await page.getByRole("button", { name: /add transaction|record/i }).first().click()

    await page.getByLabel(/symbol/i).fill(SYMBOL)
    await page.getByLabel(/quantity|shares/i).fill("10")
    await page.getByLabel(/^price/i).fill("100")
    await page.getByRole("button", { name: /^(save|add|create)$/i }).click()

    await expect(page.getByText(SYMBOL).first()).toBeVisible()
  })

  await test.step("the portfolio derives a holding from it", async () => {
    await page.goto("/portfolio")
    await expect(page.getByText(SYMBOL).first()).toBeVisible()
    // The engine ran: something priced the position rather than showing a blank row.
    await expect(page.getByText(/\$/).first()).toBeVisible()
  })

  await test.step("the dashboard agrees with the portfolio", async () => {
    await page.goto("/dashboard")
    await expect(page.getByText(SYMBOL).first()).toBeVisible()
  })

  await test.step("open the stock and add it to the watchlist", async () => {
    await page.goto(`/stocks/${SYMBOL}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/\w/)

    const watch = page.getByRole("button", { name: /watch/i }).first()
    if (await watch.isVisible()) await watch.click()

    await page.goto("/watchlist")
    await expect(page.getByText(SYMBOL).first()).toBeVisible()
  })

  await test.step("run a screen", async () => {
    await page.goto("/screener")
    await page.getByRole("button", { name: /run screener/i }).first().click()
    // Either matches or an honest "no matches" — both prove the engine ran without an error page.
    await expect(
      page.getByText(/match|no matches|screened/i).first(),
    ).toBeVisible({ timeout: 30_000 })
  })

  await test.step("create a price alert", async () => {
    await page.goto("/alerts")
    await page.getByRole("button", { name: /new alert|add alert|create/i }).first().click()
    await page.getByLabel(/symbol/i).fill(SYMBOL)
    await page.getByLabel(/target|value|price/i).first().fill("1000")
    await page.getByRole("button", { name: /^(save|create|add)$/i }).click()
    await expect(page.getByText(SYMBOL).first()).toBeVisible()
  })

  await test.step("ask the assistant, or be told plainly that it is off", async () => {
    await page.goto("/ai")
    const input = page.getByLabel(/ask stockly ai/i)

    if (await input.isDisabled()) {
      // AI_ENABLED=false is a valid production configuration, and the page has to say so.
      await expect(page.getByText(/turned off/i)).toBeVisible()
      return
    }

    await input.fill(`Analyse ${SYMBOL}`)
    await page.getByRole("button", { name: /ask stockly ai/i }).click()

    // Whatever comes back, the data section is Stockly's and must appear.
    await expect(page.getByText(/Data — from Stockly|temporarily unavailable|limit/i).first()).toBeVisible({
      timeout: 60_000,
    })
  })

  await test.step("clean up the fixture", async () => {
    page.on("dialog", (dialog) => dialog.accept())
    await page.goto("/settings")
    const row = page.locator("li, tr, div").filter({ hasText: PORTFOLIO }).last()
    const remove = row.getByRole("button", { name: /delete/i }).first()
    if (await remove.isVisible()) await remove.click()
  })
})

test("the mobile layout keeps the journey usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Runs in the mobile project only.")

  await signIn(page)

  // The bottom tab bar is the mobile navigation; without it there is no way around the app.
  await expect(page.getByRole("navigation", { name: /main/i }).last()).toBeVisible()

  for (const path of ["/dashboard", "/portfolio", "/ai"]) {
    await page.goto(path)
    // No horizontal scrolling at phone width — the rule the whole responsive pass exists to keep.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, `${path} scrolls horizontally on a phone`).toBe(false)
  }
})
