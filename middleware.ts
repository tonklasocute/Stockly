import { NextResponse, type NextRequest } from "next/server"
import { acceptsLocaleParam, LOCALE_HEADER, LOCALE_PARAM, toLocale } from "@/domain/locale"
import { isSupabaseConfigured } from "@/lib/env"
import { NONCE_HEADER, PATHNAME_HEADER, REQUEST_ID_HEADER, resolveRequestId } from "@/lib/log"
import { applySecurityHeaders, buildCsp, createNonce, cspMode, CSP_HEADER } from "@/lib/security-headers"
import { updateSession } from "@/lib/supabase/middleware"

/**
 * Everything that must happen on every request, in one place: a request id, the security headers,
 * the Content-Security-Policy nonce, and the session refresh.
 *
 * The headers are applied even when Supabase is unconfigured — a misconfigured deployment still
 * serves HTML to a browser, and that HTML should still be protected.
 */
export async function middleware(request: NextRequest) {
  const dev = process.env.NODE_ENV !== "production"
  const nonce = createNonce()
  const csp = buildCsp(nonce, { dev })
  const mode = cspMode()
  const requestId = resolveRequestId(
    request.headers.get(REQUEST_ID_HEADER) ?? request.headers.get("x-vercel-id"),
  )

  // Next reads the nonce back out of this request header and stamps it onto the script tags it
  // renders. Without it on the *request*, only the browser sees the policy and every Next bootstrap
  // script is blocked.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CSP_HEADER, csp)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname)
  // Next stamps its own script tags from the CSP header above, but a third-party library that
  // injects an inline script has to be handed the nonce explicitly. next-themes is one — see
  // app/layout.tsx.
  requestHeaders.set(NONCE_HEADER, nonce)

  /*
   * A shared page's language, taken from the URL and handed to the root layout.
   *
   * The layout renders `<html lang>` and serialises the client message payload, and it cannot see a
   * route's search parameters — so without this a `/p/acme?lang=en` document declared whatever the
   * *visitor's cookie* said. `toLocale` is the same closed-enum check every other read uses, so a
   * crafted `?lang=` sets nothing at all.
   */
  const requested =
    acceptsLocaleParam(request.nextUrl.pathname) &&
    toLocale(request.nextUrl.searchParams.get(LOCALE_PARAM))
  if (requested) requestHeaders.set(LOCALE_HEADER, requested)

  const decorate = (response: NextResponse) => {
    applySecurityHeaders(response.headers, csp, mode, { dev })
    response.headers.set(REQUEST_ID_HEADER, requestId)
    return response
  }

  // Without credentials the app renders a setup page rather than redirect-looping.
  if (!isSupabaseConfigured()) {
    return decorate(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  return decorate(await updateSession(request, requestHeaders, requestId))
}

export const config = {
  matcher: [
    /*
     * Static output is immutable and served without a session; it needs no policy and no session
     * refresh, and excluding it keeps the middleware off the hot path for every asset on the page.
     *
     * `robots.txt`, `sitemap.xml` and `opengraph-image` are excluded for a different reason, found
     * by the phase 21 smoke run: they were being sent through the session check, which redirected an
     * anonymous request to `/login`. A crawler could therefore never read the robots file — so
     * every `Disallow` in it, including the ones keeping crawlers away from share tokens, was
     * unenforceable. They are public by definition and carry nothing user-specific; the baseline
     * security headers still reach them from `next.config.ts`.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|opengraph-image|icons/|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
