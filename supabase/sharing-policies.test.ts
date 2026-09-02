import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The security properties of the phase 13 migration, asserted against its text.
 *
 * A migration cannot be unit-tested against a real database here, but the properties that matter
 * are all *structural* — which role can select what, which table has no update policy, whether a
 * definer function pins its search path. Reading the SQL catches the change that quietly removes
 * one of them, which is the failure mode worth guarding: nobody deletes a policy on purpose, but a
 * later migration that rewrites this table might not bring it along.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260906000000_sharing.sql"),
  "utf8",
)

/** The file aligns its columns for readability; assertions should not depend on that alignment. */
const FLAT = SQL.replace(/[ \t]+/g, " ")

const NEW_TABLES = [
  "portfolio_shares",
  "published_shares",
  "portfolio_share_links",
  "share_snapshots",
  "share_events",
]

describe("row level security", () => {
  for (const table of NEW_TABLES) {
    it(`is enabled on ${table}`, () => {
      expect(FLAT).toContain(`alter table public.${table} enable row level security`)
    })
  }

  it("scopes every owner-facing table to the session's own user", () => {
    for (const table of ["portfolio_shares", "portfolio_share_links", "share_snapshots", "share_events"]) {
      const policies = SQL.split("\n").filter((line) => line.includes(`on public.${table}`))
      expect(policies.length, table).toBeGreaterThan(0)
    }
    // The predicate every one of them uses.
    expect(SQL).toContain("(select auth.uid()) = user_id")
  })

  it("ties every child row to a portfolio the same user owns", () => {
    // The composite foreign key is the ownership guarantee: a request body naming somebody else's
    // portfolio cannot produce a row, whatever the handler does.
    const composite = SQL.match(
      /foreign key \(portfolio_id, user_id\) references public\.portfolios \(id, user_id\)/g,
    )
    expect(composite?.length).toBe(4)
  })
})

describe("what an anonymous visitor can read", () => {
  it("grants select on exactly one table", () => {
    // If this count ever rises, the question to answer is which new table an anonymous role can
    // read and why — not how to update this number.
    const anonymousPolicies = SQL.match(/create policy[\s\S]*?using \(visibility = 'PUBLIC'\)/g)
    expect(anonymousPolicies?.length).toBe(1)
    expect(SQL).toContain("create policy \"public shares are world-readable\" on public.published_shares")
  })

  it("restricts that grant to portfolios their owner made public", () => {
    expect(SQL).toContain("using (visibility = 'PUBLIC')")
  })

  it("never grants an anonymous select on a table holding portfolio data", () => {
    for (const table of ["transactions", "portfolios", "dividends", "cash_transactions", "portfolio_shares"]) {
      expect(SQL.includes(`on public.${table}\n  for select\n  using (true)`)).toBe(false)
      expect(SQL.includes(`to anon`) && SQL.includes(`on public.${table} for select to anon`)).toBe(false)
    }
  })

  it("stores a projection rather than a portfolio in the readable table", () => {
    expect(FLAT).toContain("payload jsonb not null")
    // No user id and no transaction reachable from the row a stranger can read.
    const table = SQL.slice(
      SQL.indexOf("create table public.published_shares"),
      SQL.indexOf("create index published_shares_public_idx"),
    )
    expect(table.includes("user_id")).toBe(false)
  })
})

describe("token-gated reads", () => {
  it("resolves a link through a definer function rather than a table grant", () => {
    // The alternative — letting an anonymous role select from the link table — turns "guess a
    // 256-bit token" into "read a column".
    expect(SQL).toContain("create function public.share_by_token(p_token_hash text)")
    expect(SQL).toContain("security definer")
  })

  it("pins the search path on every definer function", () => {
    // Line-initial only: the phrase also appears in the comments explaining why these exist.
    const definers = SQL.match(/^security definer$/gm)?.length ?? 0
    const pinned = SQL.match(/^set search_path = public, pg_temp$/gm)?.length ?? 0
    expect(definers).toBe(2)
    expect(pinned).toBe(definers)
  })

  it("refuses an expired or revoked link inside the same statement that reads it", () => {
    expect(SQL).toContain("and revoked_at is null")
    expect(SQL).toContain("and (expires_at is null or expires_at > now())")
  })

  it("stores only a hash of a token, and constrains its shape", () => {
    expect(FLAT).toContain("token_hash text not null")
    const constraints = SQL.match(/token_shape check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/g)
    expect(constraints?.length).toBe(2)
  })

  it("grants execute deliberately rather than relying on the default", () => {
    expect(SQL).toContain("revoke all on function public.share_by_token(text) from public")
    expect(SQL).toContain("grant execute on function public.share_by_token(text) to anon, authenticated")
  })
})

describe("snapshots are immutable", () => {
  it("has no update policy at all", () => {
    const policies = SQL.split(";").filter((statement) =>
      statement.includes("on public.share_snapshots") && statement.includes("for update"),
    )
    expect(policies).toEqual([])
  })

  it("has select, insert and delete policies, so the absence above is deliberate", () => {
    expect(SQL).toContain('"snapshots are self-readable"')
    expect(SQL).toContain('"snapshots are self-insertable"')
    expect(SQL).toContain('"snapshots are self-deletable"')
  })
})

describe("sharing cannot delete money", () => {
  it("cascades from the portfolio, never towards a transaction", () => {
    // Every sharing table hangs off a portfolio. Nothing in this migration references transactions
    // at all, so no share operation can reach one.
    expect(SQL.includes("public.transactions")).toBe(false)
  })
})

describe("constraints the application also checks", () => {
  it("refuses a public portfolio with no address", () => {
    expect(SQL).toContain("visibility <> 'PUBLIC' or slug is not null")
  })

  it("refuses indexing on anything that is not public, in both tables", () => {
    const guards = SQL.match(/allow_search_indexing = false or visibility = 'PUBLIC'/g)
    expect(guards?.length).toBe(2)
  })

  it("bounds a published document, so a public read stays cheap", () => {
    expect(SQL).toContain("length(payload::text) <= 256000")
  })

  it("keeps an address unique across the deployment", () => {
    expect(SQL).toContain("constraint portfolio_shares_slug_unique unique (slug)")
    expect(SQL).toContain("constraint published_shares_slug_unique unique (slug)")
  })
})
