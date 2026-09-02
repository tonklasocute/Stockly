import { expect, test, type APIRequestContext } from "@playwright/test"

/**
 * Post-deployment smoke test. Needs no account, so it can be run against any environment the
 * moment it finishes deploying.
 *
 * It asserts the things that are cheap to check and catastrophic to get wrong: the app answers, the
 * probes answer, the security headers are actually being sent, and no private page is reachable
 * without a session.
 */

/**
 * Whether the target has a working database.
 *
 * The header, nonce and robots assertions hold for any deployment. The ones that need a session or
 * a redirect do not, and a smoke test pointed at an unconfigured environment should say so rather
 * than fail with an assertion that reads like a product bug.
 */
async function databaseReady(request: APIRequestContext): Promise<boolean> {
  const response = await request.get("/api/ready")
  return response.status() === 200
}

test("the liveness probe answers without touching anything", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(body.status).toBe("ok")
  expect(body.version).toBeTruthy()
  // A probe must never disclose configuration.
  expect(JSON.stringify(body)).not.toMatch(/key|secret|provider/i)
})

test("the readiness probe reports the database", async ({ request }) => {
  const response = await request.get("/api/ready")
  const body = await response.json()
  // 503 is a legitimate answer — it means the probe works and the database does not.
  expect([200, 503]).toContain(response.status())
  if (response.status() === 200) expect(body.checks.database.ok).toBe(true)
})

test("security headers are present on a real page response", async ({ request }) => {
  const response = await request.get("/login")
  const headers = response.headers()

  expect(headers["content-security-policy"]).toContain("default-src 'self'")
  expect(headers["content-security-policy"]).toContain("object-src 'none'")
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
  expect(headers["x-request-id"]).toBeTruthy()
  // Next.js should not be announcing itself.
  expect(headers["x-powered-by"]).toBeUndefined()
})

test("every inline script carries the CSP nonce", async ({ request }) => {
  // The failure this catches is a page becoming statically prerendered again: build-time HTML has
  // no nonce, the header does, and the page silently stops hydrating in production only.
  for (const path of ["/login", "/register", "/offline"]) {
    const html = await (await request.get(path)).text()
    const scripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []
    for (const tag of scripts) {
      expect(tag, `${path} has an inline script with no nonce`).toContain("nonce=")
    }
  }
})

test("an unauthenticated API call is answered with JSON, not a login page", async ({ request }) => {
  const response = await request.get("/api/portfolios", { maxRedirects: 0 })

  expect(response.headers()["content-type"]).toContain("application/json")
  // The property under test is that it is not a redirect. A fetch() client would follow a 307 to
  // /login, receive HTML, and report "the server returned an unreadable response".
  const status = response.status()
  expect(status >= 300 && status < 400, `an API call must never redirect (got ${status})`).toBe(false)
})

test("private pages redirect a signed-out visitor to sign in", async ({ page, request }) => {
  test.skip(!(await databaseReady(request)), "Needs a configured database to resolve a session.")

  // The journal and theses hold the user's own reasoning; a signed-out visitor reaching one would
  // be the most damaging authorisation failure in the application.
  for (const path of ["/dashboard", "/portfolio", "/ai", "/screener", "/review", "/goals", "/journal", "/simulations"]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
  }
})

test("the public pages render for a signed-out visitor", async ({ page }) => {
  for (const [path, heading] of [
    ["/privacy", "Privacy"],
    ["/terms", "Terms of use"],
    ["/disclaimer", "Disclaimer"],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible()
  }
})

test("robots.txt keeps crawlers out of the private area", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text()
  expect(body).toContain("Disallow: /api/")
  expect(body).toContain("Disallow: /dashboard")
  expect(body).toContain("Disallow: /journal")
  expect(body).toContain("Sitemap:")
})
