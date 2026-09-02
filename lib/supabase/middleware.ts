import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { REQUEST_ID_HEADER } from "@/lib/log"

/**
 * Reachable without a session. Everything else redirects (pages) or 401s (API).
 *
 * The three sharing routes are here because a shared portfolio is, by definition, for someone who
 * has no account. What they can actually see is decided further down: `/p/<slug>` reads a published
 * document that anonymous RLS allows, and the two token routes read one through a definer function
 * that requires the token. Being listed here grants a *route*, never a portfolio.
 */
const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/auth",
  "/privacy",
  "/terms",
  "/disclaimer",
  "/offline",
  "/p",
  "/share",
  "/snapshot",
]

function isUnder(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
  requestId: string,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request: { headers: requestHeaders } })
        for (const { name, value, options } of cookiesToSet) {
          // Supabase sets its own cookie options; these are the ones that are not negotiable.
          // Secure is dropped in development, where the origin is http://localhost.
          response.cookies.set(name, value, {
            ...options,
            httpOnly: options?.httpOnly ?? true,
            sameSite: options?.sameSite ?? "lax",
            secure: process.env.NODE_ENV === "production",
            path: options?.path ?? "/",
          })
        }
      },
    },
  })

  // Do not put anything between createServerClient and getUser: it refreshes the session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isUnder(pathname, PUBLIC_ROUTES)) {
    // An API call is answered, never redirected. A 307 to /login means a fetch() client follows it,
    // receives HTML, and reports "the server returned an unreadable response" instead of "you are
    // signed out" — so /api/** falls through to its handler, where `guarded()` returns a proper 401
    // envelope. Pages still redirect, which is what a browser wants.
    if (!pathname.startsWith("/api/")) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("next", pathname)
      const redirect = NextResponse.redirect(url)
      redirect.headers.set(REQUEST_ID_HEADER, requestId)
      return redirect
    }
    return response
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    const redirect = NextResponse.redirect(url)
    redirect.headers.set(REQUEST_ID_HEADER, requestId)
    return redirect
  }

  return response
}
