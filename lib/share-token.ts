import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Share tokens: what they are made of, and what is stored.
 *
 * A share link carries no identity — holding the token *is* the authorization — so the token has
 * to be unguessable and the database must not be a source of working ones. Both follow from two
 * decisions:
 *
 * - **32 bytes from the OS CSPRNG**, base64url-encoded. Not a uuid (v4 carries only 122 bits and
 *   v7 leaks its creation time), not a portfolio id, not a timestamp, and nothing derived from the
 *   owner. 256 bits is far past the point where guessing is the attack anyone would choose.
 * - **Only the SHA-256 is stored.** A leaked backup discloses no usable link. The raw token exists
 *   in exactly two places: the response that created it, and the URL the owner then holds.
 *
 * A plain hash rather than a password KDF is the right call here and worth saying why: bcrypt and
 * friends exist to make *guessable* secrets expensive to attack. A 256-bit random token has no
 * guessable structure, so stretching it protects nothing and would add a per-request cost to every
 * page view of every shared portfolio.
 */

/** Bytes of entropy in a share token. */
const TOKEN_BYTES = 32

export type IssuedToken = {
  /** Shown once, to the owner. Never stored, never logged. */
  token: string
  /** What goes in the database. */
  hash: string
}

export function createShareToken(): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url")
  return { token, hash: hashShareToken(token) }
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * Shape check before a token is hashed and looked up.
 *
 * Not security — a wrong-shaped token would simply fail to match — but it keeps a 4 KB path
 * segment out of the hash function and out of the database round trip.
 */
export function looksLikeShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token)
}

/**
 * Constant-time comparison, for the one place a hash is compared in application code rather than
 * by an indexed equality in Postgres.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
