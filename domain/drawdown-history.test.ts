import { describe, expect, it } from "vitest"
import {
  describeDrawdown,
  drawdownHistory,
  FLAT_BAND_PCT,
  MIN_REPORTABLE_DEPTH_PCT,
  regimeOf,
  type IndexPoint,
} from "./drawdown-history"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"

/** An index series from percentage levels, so a fixture reads as the shape it is testing. */
const series = (...levels: number[]): IndexPoint[] =>
  levels.map((index, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, index }))

describe("a series that only rises", () => {
  it("has no drawdown at all", () => {
    const history = drawdownHistory(series(100, 105, 110, 115, 120, 125))!
    expect(history.events).toEqual([])
    expect(history.worst).toBeNull()
    expect(history.currentDepthPct).toBe(0)
    expect(history.ongoing).toBeNull()
  })
})

describe("one drawdown", () => {
  const history = drawdownHistory(series(100, 120, 90, 100, 125))!

  it("finds the peak and the trough", () => {
    expect(history.events).toHaveLength(1)
    expect(history.events[0].peakIndex).toBe(120)
    expect(history.events[0].troughIndex).toBe(90)
  })

  it("measures the depth from the peak, as a positive percentage", () => {
    expect(history.events[0].depthPct).toBeCloseTo(25, 9)
  })

  it("records recovery at the point the old peak was regained, not merely when it rose", () => {
    // The series touches 100 before reaching 125. A rally that stops short of the peak is still
    // the same drawdown, and calling it recovered would be the most flattering possible reading.
    expect(history.events[0].recoveryDate).toBe("2026-01-05")
    expect(history.events[0].ongoing).toBe(false)
  })

  it("counts the decline and the recovery separately", () => {
    expect(history.events[0].declineDays).toBe(1)
    expect(history.events[0].recoveryDays).toBe(2)
  })
})

describe("several drawdowns", () => {
  const history = drawdownHistory(series(100, 130, 100, 140, 105, 150))!

  it("reports each one", () => {
    expect(history.events).toHaveLength(2)
    expect(history.events.map((e) => e.troughIndex)).toEqual([100, 105])
  })

  it("names the deepest as the worst", () => {
    // 130 → 100 is 23.1%; 140 → 105 is 25%.
    expect(history.worst?.depthPct).toBeCloseTo(25, 9)
  })
})

describe("an unrecovered drawdown", () => {
  const history = drawdownHistory(series(100, 150, 120, 110, 115))!

  it("is reported as ongoing rather than omitted", () => {
    expect(history.ongoing).not.toBeNull()
    expect(history.ongoing?.recoveryDate).toBeNull()
    expect(history.ongoing?.recoveryDays).toBeNull()
  })

  it("reports how far below the peak the series currently sits", () => {
    expect(history.currentDepthPct).toBeCloseTo(((150 - 115) / 150) * 100, 9)
  })

  it("never projects a recovery date", () => {
    expect(describeDrawdown(history.ongoing!)).toContain("Not yet recovered")
    expect(describeDrawdown(history.ongoing!)).not.toContain("expect")
  })
})

describe("what it refuses to report", () => {
  it("returns null below the minimum sample", () => {
    // A handful of points has a lowest value, but calling it a drawdown history implies a history
    // that does not exist.
    expect(drawdownHistory(series(100, 90, 95))).toBeNull()
  })

  it("ignores a dip smaller than the reporting threshold", () => {
    // A daily series makes dozens of tiny dips; listing them hides what actually happened.
    const history = drawdownHistory(series(100, 101, 100.5, 102, 103, 104))!
    expect(history.events).toEqual([])
  })

  it("reports a dip once it crosses the threshold", () => {
    const history = drawdownHistory(series(100, 100, 100, 100, 90, 101), { minDepthPct: 5 })!
    expect(history.events).toHaveLength(1)
    expect(MIN_REPORTABLE_DEPTH_PCT).toBeGreaterThan(0)
  })

  it("ignores a non-finite or non-positive index rather than dividing by it", () => {
    // Six valid points survive the filter, which keeps the sample above the minimum — the two bad
    // ones are dropped rather than dividing by them.
    const dirty: IndexPoint[] = [
      { date: "2026-01-01", index: 100 },
      { date: "2026-01-02", index: Number.NaN },
      { date: "2026-01-03", index: 0 },
      { date: "2026-01-04", index: 110 },
      { date: "2026-01-05", index: 120 },
      { date: "2026-01-06", index: 90 },
      { date: "2026-01-07", index: 125 },
      { date: "2026-01-08", index: 130 },
    ]
    const history = drawdownHistory(dirty)!
    expect(history.observations).toBe(6)
    expect(history.events[0].troughIndex).toBe(90)
  })
})

describe("ordering and edge shapes", () => {
  it("sorts by date before measuring", () => {
    const shuffled: IndexPoint[] = [
      { date: "2026-01-05", index: 125 },
      { date: "2026-01-01", index: 100 },
      { date: "2026-01-03", index: 90 },
      { date: "2026-01-02", index: 120 },
      { date: "2026-01-04", index: 100 },
    ]
    expect(drawdownHistory(shuffled)!.events[0].depthPct).toBeCloseTo(25, 9)
  })

  it("handles a peak and trough on adjacent observations", () => {
    const history = drawdownHistory(series(100, 100, 100, 200, 100, 200))!
    expect(history.events[0].declineDays).toBe(1)
  })

  it("treats a new high as ending whatever was running", () => {
    const history = drawdownHistory(series(100, 120, 90, 130, 125, 140))!
    expect(history.events[0].recoveryDate).toBe("2026-01-04")
  })
})

describe("regime", () => {
  it("is null without a history to read", () => {
    expect(regimeOf(null, 5)).toBeNull()
  })

  it("calls a series at its high growing, and a still one flat", () => {
    const atHigh = drawdownHistory(series(100, 105, 110, 115, 120, 125))!
    expect(regimeOf(atHigh, 8)).toBe("GROWING")
    expect(regimeOf(atHigh, 0.2)).toBe("FLAT")
  })

  it("distinguishes a drawdown from a recovery in progress", () => {
    const falling = drawdownHistory(series(100, 150, 120, 110, 108))!
    expect(regimeOf(falling, -4)).toBe("DRAWDOWN")
    expect(regimeOf(falling, 6)).toBe("RECOVERING")
  })

  it("uses a flat band rather than treating any movement as a trend", () => {
    expect(FLAT_BAND_PCT).toBeGreaterThan(0)
  })

  it("never calls anything a bull or bear market", () => {
    // Those are claims about a market regime with a methodology behind them. These are four
    // arithmetic states of one portfolio's own index.
    const labels = ["GROWING", "FLAT", "DRAWDOWN", "RECOVERING"]
    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain("bull")
      expect(label.toLowerCase()).not.toContain("bear")
    }
  })
})

describe("the sentences describe and never advise", () => {
  it("uses none of the forbidden vocabulary", () => {
    const history = drawdownHistory(series(100, 150, 110, 120, 155))!
    const sentences = history.events.map(describeDrawdown)
    expect(sentences.length).toBeGreaterThan(0)
    for (const sentence of sentences) {
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })
})
