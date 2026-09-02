import { describe, expect, it } from "vitest"
import { createShareToken, hashShareToken, looksLikeShareToken, tokensMatch } from "./share-token"

/**
 * The token is the whole authorization for a share link, so these are the properties that decide
 * whether the feature is safe at all.
 */

describe("tokens are unguessable", () => {
  it("carries 256 bits of entropy", () => {
    // base64url of 32 bytes is 43 characters. Not a uuid: v4 carries 122 bits and v7 encodes the
    // time it was made, which is a hint an attacker does not need to be given.
    const { token } = createShareToken()
    expect(token).toHaveLength(43)
  })

  it("is different every time", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => createShareToken().token))
    expect(tokens.size).toBe(500)
  })

  it("contains no sequence, timestamp or identifier", () => {
    const tokens = Array.from({ length: 50 }, () => createShareToken().token)
    // Consecutive tokens share no leading run, which a counter or a timestamp prefix would produce.
    for (let i = 1; i < tokens.length; i += 1) {
      expect(tokens[i].slice(0, 8)).not.toBe(tokens[i - 1].slice(0, 8))
    }
  })

  it("is URL-safe, so it survives being pasted into a chat", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(createShareToken().token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe("only the hash is stored", () => {
  it("hashes to 64 hex characters, matching the database's check constraint", () => {
    const { hash } = createShareToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is a real SHA-256, verifiable against a known vector", () => {
    expect(hashShareToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("cannot be reversed to the token, which is the whole point of storing it", () => {
    const { token, hash } = createShareToken()
    expect(hash).not.toContain(token)
    expect(hash).not.toBe(token)
  })

  it("is stable, so a link keeps working across deployments", () => {
    const { token, hash } = createShareToken()
    expect(hashShareToken(token)).toBe(hash)
  })

  it("changes completely for a one-character difference", () => {
    const a = hashShareToken("token-a")
    const b = hashShareToken("token-b")
    let shared = 0
    for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) shared += 1
    // Two independent hex strings agree on roughly 1/16 of their characters by chance.
    expect(shared).toBeLessThan(20)
  })
})

describe("shape checking", () => {
  it("accepts a token this module produced", () => {
    expect(looksLikeShareToken(createShareToken().token)).toBe(true)
  })

  it("rejects something that could not be one, before it costs a database round trip", () => {
    expect(looksLikeShareToken("")).toBe(false)
    expect(looksLikeShareToken("short")).toBe(false)
    expect(looksLikeShareToken("a".repeat(4096))).toBe(false)
    expect(looksLikeShareToken("../../etc/passwd")).toBe(false)
    expect(looksLikeShareToken("has spaces in it and is quite long indeed")).toBe(false)
  })
})

describe("comparison", () => {
  it("matches identical values and rejects everything else", () => {
    expect(tokensMatch("abc", "abc")).toBe(true)
    expect(tokensMatch("abc", "abd")).toBe(false)
    expect(tokensMatch("abc", "abcd")).toBe(false)
    expect(tokensMatch("", "")).toBe(true)
  })
})
