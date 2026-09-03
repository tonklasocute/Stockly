import { describe, expect, it } from "vitest"
import { toDomain } from "./queries"
import { dedupeInstruments } from "@/features/portfolios/portfolio-view"
import { computePositions } from "@/domain/holdings"
import { symbolKey } from "@/domain/market"
import type { TransactionRow } from "@/types/database"

const row = (over: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: "00000000-0000-0000-0000-000000000001",
    portfolio_id: "00000000-0000-0000-0000-0000000000p1",
    user_id: "00000000-0000-0000-0000-0000000000u1",
    symbol: "PTT",
    market: "SET",
    side: "buy",
    trade_date: "2026-01-05",
    quantity: 100,
    price: 35,
    fee: 0,
    notes: null,
    created_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
    ...over,
  }) as TransactionRow

/**
 * A regression test for a whole market being silently mispriced.
 *
 * Before phase 19 `toDomain` did not map `market`, so every row reached the engine as `US`. A Thai
 * position keyed as `US:PTT` while its quote arrived keyed `SET:PTT`: no price was ever found, the
 * holding fell back to cost, and it was valued in dollars. Nothing threw and nothing looked wrong.
 */
describe("toDomain", () => {
  it("carries the market through to the engine", () => {
    expect(toDomain([row()])[0].market).toBe("SET")
  })

  it("keys the derived position by its real market", () => {
    const [position] = computePositions(toDomain([row()]))
    expect(symbolKey(position.symbol, position.market)).toBe("SET:PTT")
  })

  it("gives a Thai holding its market's currency, not the default", () => {
    expect(computePositions(toDomain([row()]))[0].currency).toBe("THB")
  })

  it("still defaults a row with an unknown market to US", () => {
    expect(toDomain([row({ market: "" })])[0].market).toBe("US")
  })

  it("does not merge two listings that spell the same letters", () => {
    const positions = computePositions(
      toDomain([row(), row({ id: "2", market: "US", price: 8, quantity: 10 })]),
    )
    expect(positions).toHaveLength(2)
    expect(positions.map((p) => symbolKey(p.symbol, p.market)).sort()).toEqual(["SET:PTT", "US:PTT"])
  })
})

/**
 * The two mappers must resolve a market the same way or nothing works: quotes are keyed by the one
 * `dedupeInstruments` produces, and positions by the one `toDomain` produces.
 */
describe("dedupeInstruments agrees with toDomain", () => {
  it("keys a quote and a position identically", () => {
    const rows = [row(), row({ id: "2", market: "US", symbol: "AAPL" })]
    const quoteKeys = dedupeInstruments(rows).map((i) => symbolKey(i.symbol, i.market)).sort()
    const positionKeys = computePositions(toDomain(rows))
      .map((p) => symbolKey(p.symbol, p.market))
      .sort()
    expect(quoteKeys).toEqual(positionKeys)
  })

  it("resolves an empty market the same way on both sides", () => {
    const rows = [row({ market: "" })]
    expect(dedupeInstruments(rows)[0].market).toBe(toDomain(rows)[0].market)
  })
})
