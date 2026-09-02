import { describe, expect, it } from "vitest"
import { simpleReturn } from "@/domain/returns"
import { rebase } from "./types"
import { mockBenchmarkProvider } from "./mock-provider"

const SPX = {
  id: "b1",
  code: "SPX",
  name: "S&P 500",
  symbol: "^GSPC",
  market: "US" as const,
  currency: "USD" as const,
}
const SET = { ...SPX, id: "b2", code: "SET", name: "SET Index", symbol: "^SET", market: "SET" as const, currency: "THB" as const }

describe("mock benchmark provider", () => {
  it("serves a daily series long enough to compare a year against", async () => {
    const series = await mockBenchmarkProvider.getSeries(SPX, "1Y")
    expect(series.length).toBe(252)
    expect(series[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(series.every((c) => c.close > 0)).toBe(true)
  })

  it("is deterministic, so a comparison does not change on re-render", async () => {
    const [a, b] = await Promise.all([
      mockBenchmarkProvider.getSeries(SPX, "3M"),
      mockBenchmarkProvider.getSeries(SPX, "3M"),
    ])
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close))
  })

  it("gives each benchmark its own shape rather than one line under two names", async () => {
    const [spx, set] = await Promise.all([
      mockBenchmarkProvider.getSeries(SPX, "3M"),
      mockBenchmarkProvider.getSeries(SET, "3M"),
    ])
    expect(spx[0].close).not.toBeCloseTo(set[0].close, 4)
  })

  it("is ordered oldest first, which is what a return calculation assumes", async () => {
    const series = await mockBenchmarkProvider.getSeries(SPX, "1M")
    const dates = series.map((c) => c.date)
    expect(dates).toEqual([...dates].sort())
  })

  it("produces a series a simple return can be taken from", async () => {
    const series = await mockBenchmarkProvider.getSeries(SPX, "1Y")
    const change = simpleReturn(series[0].close, series.at(-1)!.close)
    expect(change).not.toBeNull()
    expect(Number.isFinite(change!)).toBe(true)
  })
})

describe("rebasing", () => {
  it("puts the benchmark on the portfolio's starting value so the two lines are comparable", async () => {
    const series = await mockBenchmarkProvider.getSeries(SPX, "3M")
    const rebased = rebase(series, 50_000)
    expect(rebased[0].value).toBeCloseTo(50_000, 6)
    // The shape is preserved: the same proportional move, on a different scale.
    expect(rebased.at(-1)!.value / rebased[0].value).toBeCloseTo(
      series.at(-1)!.close / series[0].close,
      9,
    )
  })

  it("returns nothing rather than dividing by a start value of zero", async () => {
    const series = await mockBenchmarkProvider.getSeries(SPX, "1M")
    expect(rebase(series, 0)).toEqual([])
    expect(rebase([], 50_000)).toEqual([])
  })
})
