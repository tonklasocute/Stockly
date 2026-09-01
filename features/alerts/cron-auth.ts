/**
 * Constant-time comparison of the cron secret.
 *
 * Extracted from the route so it can be tested without a request, and so the "no secret configured
 * means nobody gets in" rule is stated in exactly one place.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export function isAuthorizedCronRequest(headers: Headers, secret: string): boolean {
  // An unset secret must never mean "open to everyone" — that is how a scheduled job becomes a
  // public endpoint that anyone can hammer.
  if (!secret) return false

  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const custom = headers.get("x-cron-secret") ?? ""
  return timingSafeEqual(bearer, secret) || timingSafeEqual(custom, secret)
}
