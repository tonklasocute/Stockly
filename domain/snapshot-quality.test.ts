import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { returnIndex, timeWeightedReturn, type ValuationPoint } from "./returns"
import { drawdownHistory } from "./drawdown-history"
import { volatility } from "./risk"

/**
 * FIN-001, as a regression test.
 *
 * Phase 17.5 found that phase 16's labelled-but-incomplete snapshots were reaching the return, risk
 * and drawdown engines. These assert the *reason* it mattered — that a carried-forward or partial
 * reading changes a financial figure — and then assert the fix at the point where it is made.
 *
 * The arithmetic here is deliberately explicit rather than mocked: it demonstrates the distortion
 * rather than asserting that a filter was called.
 */

const point = (date: string, value: number, flow = 0): ValuationPoint => ({ date, value, flow })

/** Six days of real movement. */
const COMPLETE: ValuationPoint[] = [
  point("2026-01-01", 1_000),
  point("2026-01-02", 1_050),
  point("2026-01-03", 980),
  point("2026-01-04", 1_020),
  point("2026-01-05", 1_100),
  point("2026-01-06", 1_060),
]

describe("why an incomplete reading must not reach a calculation", () => {
  it("a carried-forward value suppresses measured volatility", () => {
    /*
     * The end-of-day job writes the previous value again when it cannot reprice. In a return series
     * that is an interval of exactly 0%, and enough of them drag the standard deviation towards
     * zero — which flatters the Sharpe ratio that divides by it.
     */
    const withCarriedForward: ValuationPoint[] = []
    for (const p of COMPLETE) {
      withCarriedForward.push(p)
      // A stale duplicate of the day before, exactly as the job would write it.
      withCarriedForward.push(point(`${p.date}T-stale`, p.value))
    }

    const returnsOf = (points: ValuationPoint[]) => {
      const index = returnIndex(points)!
      return index.slice(1).map((p, i) => p.index / index[i].index - 1)
    }

    const clean = volatility(returnsOf(COMPLETE), { minObservations: 3 })
    const polluted = volatility(returnsOf(withCarriedForward), { minObservations: 3 })

    expect(clean).not.toBeNull()
    expect(polluted).not.toBeNull()
    // The distortion is real and in the flattering direction.
    expect(polluted!.periodPct).toBeLessThan(clean!.periodPct)
  })

  it("a partial total injects a fall and a recovery that never happened", () => {
    // A day whose total excluded an untranslated holding, followed by a complete day.
    const withPartial = [
      ...COMPLETE.slice(0, 3),
      point("2026-01-03T-partial", 700), // holdings missing from the total
      ...COMPLETE.slice(3),
    ]

    const cleanDrawdown = drawdownHistory(
      returnIndex(COMPLETE)!.map((p) => ({ date: p.date, index: p.index * 100 })),
    )
    const pollutedDrawdown = drawdownHistory(
      returnIndex(withPartial)!.map((p) => ({ date: p.date, index: p.index * 100 })),
    )

    // The fabricated round trip reads as a deeper fall than anything that actually happened.
    expect(pollutedDrawdown!.worst!.depthPct).toBeGreaterThan(cleanDrawdown!.worst!.depthPct)
  })

  it("leaves the time-weighted return alone, which is why this was easy to miss", () => {
    /*
     * Worth stating precisely rather than assuming: TWR chains sub-period returns, and a
     * carried-forward value contributes a factor of exactly 1.0. **TWR is immune.**
     *
     * That is exactly why FIN-001 survived phase 16 — the headline return figure looked right. The
     * damage was confined to the statistics that read the *shape* of the series rather than its
     * endpoints: volatility, Sharpe and drawdown, all asserted above.
     */
    const withCarriedForward = [...COMPLETE, point("2026-01-07", 1_060)]
    expect(timeWeightedReturn(withCarriedForward)).toBe(timeWeightedReturn(COMPLETE))
  })
})

describe("the fix: only COMPLETE readings reach a calculation", () => {
  const loader = readFileSync(
    join(process.cwd(), "features", "analytics", "portfolio-analytics.ts"),
    "utf8",
  )

  it("filters the series the return and risk engines read", () => {
    expect(loader).toContain('row.quality === "COMPLETE"')
    expect(loader).toContain("buildValuations(measurableSnapshots")
  })

  it("filters the performance chart too", () => {
    // A flat segment drawn from a carried-forward value says "nothing happened" where the truth is
    // "this was not measured".
    expect(loader).toContain("measurableSnapshots.map((s) => ({")
  })

  it("does not filter the rows the history page displays", () => {
    /*
     * The labelled rows are still shown, with their quality beside them — a hole in the history is
     * worse than a reading that admits what it is.
     *
     * Asserted by what the page builds its points from (`inPeriod`, filtered only by date) rather
     * than by the absence of the string: the loader legitimately mentions COMPLETE when counting
     * how much of the period is fully measured.
     */
    const history = readFileSync(join(process.cwd(), "features", "history", "loader.ts"), "utf8")
    expect(history).toContain("const points: ValuedPoint[] = inPeriod.map(")
    expect(history).toContain("qualityOf(")
    expect(history).toContain("completeSnapshots: points.filter")
  })

  it("still records incomplete days rather than leaving a gap", () => {
    // The phase 16 improvement stays: only a day priced entirely from fallback is refused.
    expect(loader).toContain("if (bundle.marketDataError) return")
    expect(loader).toContain('quality === "COMPLETE" ? 0 : missingHoldings')
  })
})
