import { describe, expect, it } from "vitest"
import {
  MIN_RETURN_OBSERVATIONS,
  beta,
  concentrationDetail,
  maxDrawdown,
  sharpeRatio,
  standardDeviation,
  volatility,
} from "./risk"
import { returnIndex, subPeriodReturns, type ValuationPoint } from "./returns"

/** A deterministic series of `n` returns alternating around a mean, so σ is exactly `spread`. */
const alternating = (n: number, mean: number, spread: number) =>
  Array.from({ length: n }, (_, i) => mean + (i % 2 === 0 ? spread : -spread))

const point = (date: string, value: number, flow = 0): ValuationPoint => ({ date, value, flow })

/** `n` daily valuations following `factors`, so the drawdown shape is known exactly. */
function series(factors: readonly number[]): Array<{ date: string; index: number }> {
  let level = 1
  return factors.map((f, i) => {
    level *= f
    return { date: `2026-01-${String(i + 1).padStart(2, "0")}`, index: level }
  })
}

describe("standard deviation", () => {
  it("is the sample deviation, not the population one", () => {
    // [1,2,3,4] → sample σ = 1.2909944…, population σ = 1.118…
    expect(standardDeviation([1, 2, 3, 4], 2)).toBeCloseTo(1.2909944, 6)
  })

  it("is null below the minimum sample — a statistic from four points is a made-up one", () => {
    expect(standardDeviation([1, 2, 3, 4])).toBeNull()
    expect(standardDeviation(alternating(MIN_RETURN_OBSERVATIONS - 1, 0, 0.01))).toBeNull()
    expect(standardDeviation(alternating(MIN_RETURN_OBSERVATIONS, 0, 0.01))).not.toBeNull()
  })
})

describe("volatility", () => {
  it("annualises by the square root of the period count", () => {
    const returns = alternating(60, 0, 0.01) // σ ≈ 1% per period
    const vol = volatility(returns, { periodsPerYear: 252 })
    expect(vol!.periodPct).toBeCloseTo(1, 1)
    expect(vol!.annualisedPct).toBeCloseTo(1 * Math.sqrt(252), 0)
  })

  it("carries the observation count and the annualisation it used", () => {
    const vol = volatility(alternating(40, 0.001, 0.02), { periodsPerYear: 12 })
    expect(vol).toMatchObject({ observations: 40, periodsPerYear: 12 })
  })

  it("is null below the minimum sample, never 0", () => {
    expect(volatility(alternating(10, 0, 0.01))).toBeNull()
  })

  it("is zero for a series that genuinely never moved", () => {
    // Distinct from null: this portfolio has 40 observations and did not move.
    expect(volatility(new Array(40).fill(0))!.annualisedPct).toBe(0)
  })
})

describe("Sharpe ratio", () => {
  it("is return over volatility at the default zero risk-free rate", () => {
    const sharpe = sharpeRatio(alternating(60, 0.002, 0.005), { periodsPerYear: 252 })
    expect(sharpe).not.toBeNull()
    expect(sharpe!.riskFreeRatePct).toBe(0)
    expect(sharpe!.ratio).toBeGreaterThan(0)
  })

  it("falls when the risk-free assumption rises — the assumption is a real input", () => {
    const returns = alternating(60, 0.002, 0.005)
    const atZero = sharpeRatio(returns, { periodsPerYear: 252 })!
    const atFive = sharpeRatio(returns, { periodsPerYear: 252, riskFreeRate: 0.05 })!
    expect(atFive.ratio).toBeLessThan(atZero.ratio)
    expect(atFive.riskFreeRatePct).toBe(5)
  })

  it("is negative when the portfolio lost money", () => {
    expect(sharpeRatio(alternating(60, -0.002, 0.005), { periodsPerYear: 252 })!.ratio).toBeLessThan(0)
  })

  it("is null for a portfolio that never moved — undefined, not infinite", () => {
    expect(sharpeRatio(new Array(60).fill(0))).toBeNull()
  })

  it("is null below the minimum sample", () => {
    expect(sharpeRatio(alternating(10, 0.002, 0.005))).toBeNull()
  })
})

describe("maximum drawdown", () => {
  it("measures peak to trough across the whole decline, not one step of it", () => {
    // Index: 1.10 → 0.77 → 0.8085 → 0.7277. The peak is 1.10 and the trough is 0.7277, so the
    // drawdown is 33.85% — the cumulative fall, not the single worst −30% step.
    const drawdown = maxDrawdown(series([1.1, 0.7, 1.05, 0.9, 1.02, 1.02]))
    expect(drawdown!.maxDrawdownPct).toBeCloseTo(33.85, 2)
  })

  it("reports the peak and trough dates, and the days between them", () => {
    // Index: 1.00 → 1.20 → 0.96 → 0.864 → 0.864. Peak on the 2nd, trough on the 4th.
    const drawdown = maxDrawdown(series([1, 1.2, 0.8, 0.9, 1.0]))
    expect(drawdown!.peakDate).toBe("2026-01-02")
    expect(drawdown!.troughDate).toBe("2026-01-04")
    expect(drawdown!.declineDays).toBe(2)
  })

  it("reports the recovery date once the old peak is regained", () => {
    // 1 → 1.2 → 0.96 → 1.25: recovered on the fourth point.
    const drawdown = maxDrawdown(series([1, 1.2, 0.8, 1.3021, 1.0]))
    expect(drawdown!.recoveredOn).toBe("2026-01-04")
  })

  it("reports null recovery while still under water", () => {
    const drawdown = maxDrawdown(series([1, 1.5, 0.6, 1.01, 1.01]))
    expect(drawdown!.recoveredOn).toBeNull()
    expect(drawdown!.currentDrawdownPct).toBeGreaterThan(0)
  })

  it("has no current drawdown at a new high", () => {
    expect(maxDrawdown(series([1, 1.1, 1.1, 1.1, 1.1]))!.currentDrawdownPct).toBe(0)
  })

  it("is null with too little history to have had a peak and a trough", () => {
    expect(maxDrawdown(series([1, 0.9]))).toBeNull()
  })

  it("ignores a deposit, which is the whole reason it reads an index and not a value", () => {
    // Value falls 100 → 80, then 100 is deposited and it sits at 180. On raw values that looks
    // like a full recovery and a new high. It is neither: the market fall of 20% still stands.
    const index = returnIndex([
      point("2026-01-01", 100),
      point("2026-01-02", 80),
      point("2026-01-03", 180, 100),
      point("2026-01-04", 180),
      point("2026-01-05", 180),
    ])!
    const drawdown = maxDrawdown(index)
    expect(drawdown!.maxDrawdownPct).toBeCloseTo(20, 6)
    expect(drawdown!.currentDrawdownPct).toBeCloseTo(20, 6)
    // A raw-value drawdown would have shown a full recovery on the deposit day. This does not.
    expect(drawdown!.recoveredOn).toBeNull()
  })
})

describe("beta", () => {
  const benchmark = alternating(40, 0.001, 0.01)

  it("is 1 for a portfolio that moves exactly with the benchmark", () => {
    expect(beta(benchmark, benchmark)!.beta).toBeCloseTo(1, 2)
    expect(beta(benchmark, benchmark)!.rSquared).toBeCloseTo(1, 2)
  })

  it("is 2 for a portfolio that moves twice as hard", () => {
    const doubled = benchmark.map((r) => r * 2)
    expect(beta(doubled, benchmark)!.beta).toBeCloseTo(2, 2)
  })

  it("is negative for a portfolio that moves against the benchmark", () => {
    expect(beta(benchmark.map((r) => -r), benchmark)!.beta).toBeLessThan(0)
  })

  it("is null when the series are not paired", () => {
    expect(beta(benchmark.slice(0, 20), benchmark)).toBeNull()
  })

  it("is null against a benchmark that never moved — a division by zero, not infinity", () => {
    expect(beta(benchmark, new Array(40).fill(0.001))).toBeNull()
  })

  it("is null below the minimum paired sample", () => {
    expect(beta(benchmark.slice(0, 10), benchmark.slice(0, 10))).toBeNull()
  })
})

describe("concentration", () => {
  it("reports HHI and the equivalent number of equal positions", () => {
    // Four equal positions: HHI = 4 × 25² = 2500, effective = 10000/2500 = 4.
    const detail = concentrationDetail([25, 25, 25, 25])
    expect(detail!.hhi).toBe(2500)
    expect(detail!.effectivePositions).toBe(4)
  })

  it("shows a dominated portfolio as behaving like far fewer positions than it holds", () => {
    const detail = concentrationDetail([70, 10, 10, 5, 5])
    expect(detail!.positions).toBe(5)
    expect(detail!.effectivePositions).toBeLessThan(2.5)
    expect(detail!.largestWeightPct).toBe(70)
  })

  it("ranks before slicing, so top-3 is the largest three however they arrived", () => {
    const detail = concentrationDetail([5, 40, 10, 30, 15])
    expect(detail!.top3WeightPct).toBe(85)
    expect(detail!.top5WeightPct).toBe(100)
  })

  it("is null for an empty portfolio — no positions is not zero concentration", () => {
    expect(concentrationDetail([])).toBeNull()
    expect(concentrationDetail([0, 0])).toBeNull()
  })
})

describe("risk reads the flow-adjusted series end to end", () => {
  it("computes volatility from sub-period returns, not from value changes", () => {
    // Thirty-one valuations alternating ±2%, with a large deposit in the middle.
    const points: ValuationPoint[] = [point("2026-01-01", 1000)]
    let value = 1000
    for (let i = 1; i <= 30; i += 1) {
      const factor = i % 2 === 0 ? 1.02 : 0.98
      value *= factor
      const flow = i === 15 ? 5000 : 0
      value += flow
      points.push({ date: `2026-02-${String(i).padStart(2, "0")}`, value, flow })
    }

    const returns = subPeriodReturns(points)!.map((r) => r.ratio)
    const vol = volatility(returns, { periodsPerYear: 252 })
    expect(vol).not.toBeNull()
    // σ of a ±2% alternation is 2%; the deposit must not inflate it.
    expect(vol!.periodPct).toBeCloseTo(2, 1)
  })
})
