/**
 * Security headers, and the Content-Security-Policy in particular.
 *
 * The CSP is nonce-based rather than hash- or allowlist-based, because Next.js emits inline
 * bootstrap scripts on every server-rendered page: an allowlist cannot cover them and a hash list
 * changes every build. Next reads the nonce out of the `Content-Security-Policy` header on the
 * incoming request and stamps it onto its own script tags, which is why the middleware sets the
 * header on the request as well as the response.
 *
 * The static headers live here too, so there is one file to read when asking "what does the browser
 * enforce" rather than a header block in next.config.ts and a policy somewhere else.
 */

/** Where the browser is allowed to open a connection: this origin, plus Supabase for auth. */
function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return ""
  try {
    return new URL(url).origin
  } catch {
    return ""
  }
}

export type CspMode = "enforce" | "report-only" | "off"

/**
 * `enforce` in production, `report-only` anywhere it is explicitly asked for.
 *
 * A CSP that breaks the page is worse than no CSP, so the escape hatch exists — but the default is
 * to enforce, because a report-only policy that nobody ever promotes protects nobody.
 */
export function cspMode(): CspMode {
  const configured = process.env.CSP_MODE
  if (configured === "off" || configured === "report-only" || configured === "enforce") {
    return configured
  }
  return "enforce"
}

export function buildCsp(nonce: string, { dev = false } = {}): string {
  const supabase = supabaseOrigin()

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'strict-dynamic' lets Next's nonced bootstrap load the chunks it needs without naming each
    // one. The trailing 'unsafe-inline' and https: are ignored by every browser that understands
    // nonces — they exist only so an old browser degrades to something rather than nothing.
    // Development additionally needs 'unsafe-eval', which is what the dev-time HMR runtime uses.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https:",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],

    // 'unsafe-inline' is required and accepted here: React writes the `style` prop as a style
    // attribute, and Recharts and the Base UI primitives position themselves that way on every
    // render. Nonces do not apply to attributes, so the alternative is no charts. CSS injection is
    // a far smaller risk than script injection, which is what the policy above actually closes.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],

    // next/font self-hosts Google Fonts at build time, so no font CDN appears anywhere here.
    "connect-src": ["'self'", ...(supabase ? [supabase, supabase.replace(/^https/, "wss")] : [])],

    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],

    // Nothing in Stockly embeds or is embedded, loads a plugin, or posts a form off-origin.
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  }

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ")

  // Only in production: on http://localhost this would rewrite every request to https and the dev
  // server would answer none of them.
  return dev ? policy : `${policy}; upgrade-insecure-requests`
}

/**
 * Headers that do not depend on the request.
 *
 * HSTS is deliberately not sent in development, where the origin is http://localhost — a browser
 * that pins localhost to https keeps doing it for every other project on that port, for a year.
 */
export function staticSecurityHeaders({ dev = false } = {}): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Redundant beside frame-ancestors, and kept for browsers that predate it.
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    ...(dev
      ? {}
      : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }),
  }
}

/** A base64 nonce, fresh per request. A reused nonce is the same as no nonce. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

export const CSP_HEADER = "Content-Security-Policy"
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only"

/** Writes the policy and the static headers onto a response. */
export function applySecurityHeaders(
  headers: Headers,
  csp: string,
  mode: CspMode,
  { dev = false } = {},
): void {
  for (const [name, value] of Object.entries(staticSecurityHeaders({ dev }))) {
    headers.set(name, value)
  }
  if (mode === "enforce") headers.set(CSP_HEADER, csp)
  else if (mode === "report-only") headers.set(CSP_REPORT_ONLY_HEADER, csp)
}
