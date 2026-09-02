import { describe, expect, it } from "vitest"
import {
  applyTemplateSchema,
  createLinkSchema,
  createSnapshotSchema,
  MAX_LINKS_PER_PORTFOLIO,
  MAX_SNAPSHOTS_PER_PORTFOLIO,
  shareConfigSchema,
} from "./schema"

const PORTFOLIO = "11111111-1111-4111-8111-111111111111"
const base = { portfolioId: PORTFOLIO, visibility: "PRIVATE" as const }

describe("the share configuration a request may send", () => {
  it("defaults every switch to off when the body omits it", () => {
    const parsed = shareConfigSchema.parse(base)
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("show") || key === "allowSearchIndexing") expect(value, key).toBe(false)
    }
  })

  it("never accepts a user id, whatever the body claims", () => {
    // Ownership comes from the session and the composite foreign key. A body that could name a
    // user would be the whole IDOR surface in one field.
    const parsed = shareConfigSchema.parse({ ...base, userId: "22222222-2222-4222-8222-222222222222" })
    expect("userId" in parsed).toBe(false)
  })

  it("never accepts a figure", () => {
    const parsed = shareConfigSchema.parse({ ...base, totalValue: 999_999, returnPct: 42 })
    expect("totalValue" in parsed).toBe(false)
    expect("returnPct" in parsed).toBe(false)
  })

  it("requires a public portfolio to have an address", () => {
    const result = shareConfigSchema.safeParse({ ...base, visibility: "PUBLIC", slug: null })
    expect(result.success).toBe(false)
  })

  it("refuses indexing for anything that is not public", () => {
    expect(
      shareConfigSchema.safeParse({ ...base, visibility: "LINK_ONLY", slug: "mine", allowSearchIndexing: true })
        .success,
    ).toBe(false)
    expect(
      shareConfigSchema.safeParse({ ...base, visibility: "PUBLIC", slug: "mine", allowSearchIndexing: true })
        .success,
    ).toBe(true)
  })

  it("rejects a reserved address", () => {
    for (const reserved of ["api", "admin", "login", "settings"]) {
      expect(shareConfigSchema.safeParse({ ...base, slug: reserved }).success, reserved).toBe(false)
    }
  })

  it("rejects an address that is not a URL segment", () => {
    // "UPPER" is absent deliberately: the schema lowercases first, so it becomes a valid address
    // rather than an error. The test below covers that.
    for (const bad of ["Has Spaces", "../escape", "-lead", "trail-", "a", "double--hyphen"]) {
      expect(shareConfigSchema.safeParse({ ...base, slug: bad }).success, bad).toBe(false)
    }
  })

  it("normalizes the case of an address rather than rejecting it outright", () => {
    expect(shareConfigSchema.parse({ ...base, slug: "MyPortfolio" }).slug).toBe("myportfolio")
  })

  it("rejects an unknown visibility", () => {
    expect(shareConfigSchema.safeParse({ ...base, visibility: "SEMI_PUBLIC" }).success).toBe(false)
  })

  it("bounds the free text a page can carry", () => {
    expect(shareConfigSchema.safeParse({ ...base, displayName: "a".repeat(61) }).success).toBe(false)
    expect(shareConfigSchema.safeParse({ ...base, description: "a".repeat(281) }).success).toBe(false)
    expect(shareConfigSchema.safeParse({ ...base, ownerDisplayName: "a".repeat(41) }).success).toBe(false)
  })

  it("requires a real portfolio id", () => {
    expect(shareConfigSchema.safeParse({ ...base, portfolioId: "not-a-uuid" }).success).toBe(false)
  })
})

describe("links and snapshots", () => {
  it("defaults a link to a bounded lifetime rather than to forever", () => {
    expect(createLinkSchema.parse({ portfolioId: PORTFOLIO }).duration).toBe("30D")
  })

  it("accepts only the offered durations", () => {
    expect(createLinkSchema.safeParse({ portfolioId: PORTFOLIO, duration: "1D" }).success).toBe(true)
    expect(createLinkSchema.safeParse({ portfolioId: PORTFOLIO, duration: "NEVER" }).success).toBe(true)
    expect(createLinkSchema.safeParse({ portfolioId: PORTFOLIO, duration: "100Y" }).success).toBe(false)
  })

  it("never lets a request choose its own token", () => {
    const parsed = createLinkSchema.parse({ portfolioId: PORTFOLIO, token: "chosen-by-me" })
    expect("token" in parsed).toBe(false)
  })

  it("never lets a request supply a snapshot payload", () => {
    // A snapshot is produced by the engine. A client-supplied one would be a financial record
    // written by whoever asked for it.
    const parsed = createSnapshotSchema.parse({ portfolioId: PORTFOLIO, payload: { totalValue: 1 } })
    expect("payload" in parsed).toBe(false)
  })

  it("accepts only the known presets", () => {
    expect(applyTemplateSchema.safeParse({ portfolioId: PORTFOLIO, template: "FULL" }).success).toBe(true)
    expect(applyTemplateSchema.safeParse({ portfolioId: PORTFOLIO, template: "EVERYTHING" }).success).toBe(false)
  })

  it("caps both, at numbers a database count can enforce", () => {
    expect(MAX_LINKS_PER_PORTFOLIO).toBeGreaterThan(0)
    expect(MAX_LINKS_PER_PORTFOLIO).toBeLessThanOrEqual(50)
    expect(MAX_SNAPSHOTS_PER_PORTFOLIO).toBeGreaterThan(0)
    expect(MAX_SNAPSHOTS_PER_PORTFOLIO).toBeLessThanOrEqual(100)
  })
})
