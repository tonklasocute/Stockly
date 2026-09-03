/**
 * The insights engine: deterministic, explainable, and unable to give advice.
 *
 * **No model is involved.** Every insight is a threshold applied to a number the calculation engine
 * already produced, which means the same portfolio always yields the same insights, each one can be
 * traced to a rule and a figure, and there is nothing to hallucinate. AI, where it is enabled at
 * all, reads this output — it never produces it. See `docs/INTELLIGENCE.md`.
 *
 * Three constraints, in order of how much damage breaking them would do:
 *
 * 1. **Describe, never advise.** "One position is 41% of the portfolio" is a fact. "Reduce your
 *    technology exposure" is advice, and Stockly does not give it. `FORBIDDEN_INSIGHT_PATTERNS`
 *    below is checked by a test against every sentence this module can emit — a rule is a
 *    guarantee, a convention is a hope.
 * 2. **Never predict.** No insight refers to what a price, a portfolio or a market will do.
 * 3. **Never fire on a number that does not exist.** Every rule takes a nullable input and produces
 *    nothing when it is null. An insight generated from a missing figure is worse than silence,
 *    because it looks like knowledge.
 *
 * Pure: no clock beyond what is passed in, no database, no framework.
 */
import { staleAfterMinutes } from "./freshness"
import { roundTo } from "./money"
import type { Currency } from "./market"

// ---------------------------------------------------------------- thresholds

/**
 * Every number the engine branches on, in one place.
 *
 * They are here rather than inline so that each one can be read, argued with and changed without
 * hunting through rules — and so a test can assert an insight fires on one side of a threshold and
 * not the other. None is a recommendation: a threshold decides whether something is *worth
 * mentioning*, never whether it is good or bad.
 */
export const INSIGHT_THRESHOLDS = {
  concentration: {
    /** One position at or above this share of the portfolio is worth stating outright. */
    largestPositionWarningPct: 30,
    largestPositionNoticePct: 20,
    /** The top three together. Conventional shorthand for "is this really a diversified book". */
    topThreeNoticePct: 60,
    /** Below this many equally-weighted-equivalent positions (10000/HHI), concentration is the story. */
    effectivePositionsNotice: 4,
  },
  drawdown: {
    /** Distance below the running peak of the flow-adjusted return index. */
    currentWarningPct: 20,
    currentNoticePct: 10,
  },
  benchmark: {
    /** Percentage points of time-weighted return, portfolio minus benchmark. */
    underperformanceNoticePct: 5,
    outperformanceInfoPct: 5,
  },
  cash: {
    /** Cash as a share of total portfolio value. High cash is a position, and worth naming. */
    highSharePct: 25,
  },
  currency: {
    /** A single non-base currency at or above this share of translatable value. */
    exposureNoticePct: 30,
  },
  fees: {
    /** Fees as a share of everything bought and sold. */
    noticePct: 1,
  },
  winRate: {
    /** Below this many closed trades a win rate is noise, and no insight is emitted at all. */
    minTrades: 10,
    noticePct: 40,
  },
  dividend: {
    /** Change in trailing-twelve-month income against the twelve months before it. */
    changeInfoPct: 10,
  },
  staleness: {
    /**
     * Quotes older than this make every value-derived insight a statement about the past.
     * Deliberately looser than the alert engine's guard: see `domain/freshness.ts` for why an
     * insight is quieter than the badge beside the figure.
     */
    quoteMinutes: staleAfterMinutes("quoteNotice"),
  },
} as const

// ---------------------------------------------------------------- shape

export const INSIGHT_TYPES = [
  "CONCENTRATION",
  "PERFORMANCE",
  "DRAWDOWN",
  "DIVIDEND",
  "CASH",
  "CURRENCY",
  "BENCHMARK",
  "WIN_RATE",
  "FEES",
  "DATA",
] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/**
 * INFO   — worth knowing.
 * NOTICE — worth looking at.
 * WARNING— worth looking at now.
 *
 * None of the three means "act". The most severe insight this engine can emit still only says what
 * is true of the portfolio right now.
 */
export const INSIGHT_SEVERITIES = ["INFO", "NOTICE", "WARNING"] as const
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number]

export type Insight = {
  /** Stable identifier, so a test and a UI can refer to a rule without matching on prose. */
  code: string
  type: InsightType
  severity: InsightSeverity
  title: string
  detail: string
  /** The figure the rule fired on, so a user can check the arithmetic. */
  metric: { label: string; value: string } | null
}

/**
 * Everything the engine reads. All of it is computed elsewhere; nothing here recalculates a
 * financial figure, and every field is nullable because every one of them genuinely can be unknown.
 */
export type InsightFacts = {
  baseCurrency: Currency
  /** Concentration over base-currency position weights. Null for an empty portfolio. */
  concentration: {
    largestSymbol: string | null
    largestWeightPct: number | null
    topThreeWeightPct: number | null
    effectivePositions: number | null
    positions: number
  } | null
  /** Unrealised return on open positions, percent. Null when nothing is invested. */
  returnPct: number | null
  /** Distance below the running peak of the return index, percent. Null without enough history. */
  currentDrawdownPct: number | null
  maxDrawdownPct: number | null
  /** Time-weighted return over the compared window, and the benchmark's over the same window. */
  benchmark: { name: string; portfolioReturnPct: number; benchmarkReturnPct: number } | null
  cash: { balance: number; sharePct: number | null } | null
  /** Non-base currencies and their share of translatable value. */
  currencyExposure: Array<{ currency: Currency; weightPct: number | null }>
  /** Holdings that could not be translated into the base currency at all. */
  untranslatedHoldings: number
  dividends: { trailingTwelveMonths: number; previousTwelveMonths: number | null } | null
  fees: { total: number; percentOfTurnover: number | null } | null
  trades: { closed: number; winRatePct: number | null } | null
  /** Holdings priced from cost because no quote was available. */
  staleHoldings: number
  /** Age of the oldest quote behind the figures, in minutes. Null when nothing was priced. */
  quoteAgeMinutes: number | null
}

// ---------------------------------------------------------------- engine

const SEVERITY_ORDER: Record<InsightSeverity, number> = { WARNING: 0, NOTICE: 1, INFO: 2 }

/**
 * Every insight the facts support, most severe first.
 *
 * Order within a severity is the order the rules are written, which is deliberate: data quality
 * comes before conclusions drawn from that data, so a user reading top-down learns the figures are
 * stale before they read anything derived from them.
 */
export function buildInsights(facts: InsightFacts): Insight[] {
  const out: Insight[] = [
    ...dataInsights(facts),
    ...concentrationInsights(facts),
    ...drawdownInsights(facts),
    ...benchmarkInsights(facts),
    ...cashInsights(facts),
    ...currencyInsights(facts),
    ...performanceInsights(facts),
    ...feeInsights(facts),
    ...winRateInsights(facts),
    ...dividendInsights(facts),
  ]

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

const pct = (value: number) => `${roundTo(value, 1)}%`

function dataInsights(facts: InsightFacts): Insight[] {
  const out: Insight[] = []

  if (facts.untranslatedHoldings > 0) {
    out.push({
      code: "DATA_NO_FX",
      type: "DATA",
      severity: "WARNING",
      title: "Some holdings are missing from the totals",
      detail:
        `${facts.untranslatedHoldings} holding${facts.untranslatedHoldings === 1 ? "" : "s"} could not be ` +
        `converted into ${facts.baseCurrency} because no exchange rate was available, so ${facts.untranslatedHoldings === 1 ? "it is" : "they are"} ` +
        "excluded from every total and every figure below.",
      metric: { label: "Excluded holdings", value: String(facts.untranslatedHoldings) },
    })
  }

  if (facts.staleHoldings > 0) {
    out.push({
      code: "DATA_STALE_PRICES",
      type: "DATA",
      severity: "NOTICE",
      title: "Some holdings have no live price",
      detail:
        `${facts.staleHoldings} holding${facts.staleHoldings === 1 ? " is" : "s are"} valued at cost because ` +
        "no quote was available. Figures that depend on market value are affected.",
      metric: { label: "Valued at cost", value: String(facts.staleHoldings) },
    })
  }

  if (
    facts.quoteAgeMinutes !== null &&
    facts.quoteAgeMinutes >= INSIGHT_THRESHOLDS.staleness.quoteMinutes
  ) {
    out.push({
      code: "DATA_QUOTE_AGE",
      type: "DATA",
      severity: "INFO",
      title: "Prices are delayed",
      detail:
        `The prices behind these figures were last updated ${Math.round(facts.quoteAgeMinutes)} minutes ago.`,
      metric: { label: "Quote age", value: `${Math.round(facts.quoteAgeMinutes)} min` },
    })
  }

  return out
}

function concentrationInsights(facts: InsightFacts): Insight[] {
  const c = facts.concentration
  if (!c || c.largestWeightPct === null || !c.largestSymbol) return []
  const t = INSIGHT_THRESHOLDS.concentration
  const out: Insight[] = []

  if (c.largestWeightPct >= t.largestPositionNoticePct) {
    const severe = c.largestWeightPct >= t.largestPositionWarningPct
    out.push({
      code: "CONCENTRATION_LARGEST",
      type: "CONCENTRATION",
      severity: severe ? "WARNING" : "NOTICE",
      title: `${c.largestSymbol} is ${pct(c.largestWeightPct)} of the portfolio`,
      detail:
        `The largest position accounts for ${pct(c.largestWeightPct)} of portfolio value, across ` +
        `${c.positions} position${c.positions === 1 ? "" : "s"}.`,
      metric: { label: "Largest position", value: pct(c.largestWeightPct) },
    })
  }

  if (c.topThreeWeightPct !== null && c.topThreeWeightPct >= t.topThreeNoticePct && c.positions > 3) {
    out.push({
      code: "CONCENTRATION_TOP3",
      type: "CONCENTRATION",
      severity: "NOTICE",
      title: `The three largest positions are ${pct(c.topThreeWeightPct)} of the portfolio`,
      detail: `Measured on market value in ${facts.baseCurrency}, across ${c.positions} positions.`,
      metric: { label: "Top 3", value: pct(c.topThreeWeightPct) },
    })
  }

  if (
    c.effectivePositions !== null &&
    c.effectivePositions < t.effectivePositionsNotice &&
    c.positions > t.effectivePositionsNotice
  ) {
    out.push({
      code: "CONCENTRATION_EFFECTIVE",
      type: "CONCENTRATION",
      severity: "NOTICE",
      title: `${c.positions} positions behave like ${roundTo(c.effectivePositions, 1)}`,
      detail:
        "The Herfindahl index expresses how weight is spread: this portfolio has the same " +
        `concentration as ${roundTo(c.effectivePositions, 1)} equally-sized positions.`,
      metric: { label: "Effective positions", value: String(roundTo(c.effectivePositions, 1)) },
    })
  }

  return out
}

function drawdownInsights(facts: InsightFacts): Insight[] {
  if (facts.currentDrawdownPct === null) return []
  const t = INSIGHT_THRESHOLDS.drawdown
  if (facts.currentDrawdownPct < t.currentNoticePct) return []

  const severe = facts.currentDrawdownPct >= t.currentWarningPct
  return [
    {
      code: "DRAWDOWN_CURRENT",
      type: "DRAWDOWN",
      severity: severe ? "WARNING" : "NOTICE",
      title: `The portfolio is ${pct(facts.currentDrawdownPct)} below its peak`,
      detail:
        "Measured on the flow-adjusted return index, so deposits and withdrawals do not affect it." +
        (facts.maxDrawdownPct !== null
          ? ` The deepest fall recorded is ${pct(facts.maxDrawdownPct)}.`
          : ""),
      metric: { label: "Current drawdown", value: pct(facts.currentDrawdownPct) },
    },
  ]
}

function benchmarkInsights(facts: InsightFacts): Insight[] {
  const b = facts.benchmark
  if (!b) return []
  const difference = b.portfolioReturnPct - b.benchmarkReturnPct
  const t = INSIGHT_THRESHOLDS.benchmark

  if (difference <= -t.underperformanceNoticePct) {
    return [
      {
        code: "BENCHMARK_BEHIND",
        type: "BENCHMARK",
        severity: "NOTICE",
        title: `The portfolio trailed ${b.name} over this period`,
        detail:
          `Time-weighted return ${pct(b.portfolioReturnPct)} against ${pct(b.benchmarkReturnPct)} ` +
          `for ${b.name}, a difference of ${pct(difference)}. Time-weighted so deposits and ` +
          "withdrawals do not count as performance.",
        metric: { label: "Difference", value: pct(difference) },
      },
    ]
  }

  if (difference >= t.outperformanceInfoPct) {
    return [
      {
        code: "BENCHMARK_AHEAD",
        type: "BENCHMARK",
        severity: "INFO",
        title: `The portfolio was ahead of ${b.name} over this period`,
        detail:
          `Time-weighted return ${pct(b.portfolioReturnPct)} against ${pct(b.benchmarkReturnPct)} ` +
          `for ${b.name}, a difference of ${pct(difference)}.`,
        metric: { label: "Difference", value: pct(difference) },
      },
    ]
  }

  return []
}

function cashInsights(facts: InsightFacts): Insight[] {
  const cash = facts.cash
  if (!cash) return []
  const out: Insight[] = []

  if (cash.balance < 0) {
    out.push({
      code: "CASH_NEGATIVE",
      type: "CASH",
      severity: "NOTICE",
      title: "The recorded cash balance is negative",
      detail:
        "Trades have been recorded without the deposits that funded them. The balance is shown as " +
        "it stands rather than clamped to zero; adding the missing deposits corrects it.",
      metric: { label: "Cash balance", value: `${roundTo(cash.balance, 2)} ${facts.baseCurrency}` },
    })
  }

  if (cash.sharePct !== null && cash.sharePct >= INSIGHT_THRESHOLDS.cash.highSharePct) {
    out.push({
      code: "CASH_HIGH_SHARE",
      type: "CASH",
      severity: "INFO",
      title: `Cash is ${pct(cash.sharePct)} of the portfolio`,
      detail: `Cash is counted in total portfolio value, so it is part of every allocation figure.`,
      metric: { label: "Cash weight", value: pct(cash.sharePct) },
    })
  }

  return out
}

function currencyInsights(facts: InsightFacts): Insight[] {
  /*
   * A type predicate rather than a plain filter, so the `weightPct` below is genuinely a number.
   *
   * The two `?? 0` fallbacks this replaces were unreachable — the filter had already excluded
   * nulls — but an unreachable zero in an insight is exactly the pattern that becomes a reachable
   * one the day somebody edits the predicate. Phase 17.5 filed it as CQ-001; this closes it by
   * making the narrowing real instead of asserted.
   */
  const foreign = facts.currencyExposure.filter(
    (e): e is { currency: Currency; weightPct: number } =>
      e.currency !== facts.baseCurrency &&
      e.weightPct !== null &&
      e.weightPct >= INSIGHT_THRESHOLDS.currency.exposureNoticePct,
  )
  if (foreign.length === 0) return []

  return foreign.map((exposure) => ({
    code: `CURRENCY_EXPOSURE_${exposure.currency}`,
    type: "CURRENCY" as const,
    severity: "INFO" as const,
    title: `${pct(exposure.weightPct)} of the portfolio is held in ${exposure.currency}`,
    detail:
      `Reported in ${facts.baseCurrency} at today's exchange rate. Movement in ` +
      `${exposure.currency}/${facts.baseCurrency} changes that figure without any holding changing price.`,
    metric: { label: `${exposure.currency} exposure`, value: pct(exposure.weightPct) },
  }))
}

function performanceInsights(facts: InsightFacts): Insight[] {
  if (facts.returnPct === null) return []
  return [
    {
      code: "PERFORMANCE_UNREALISED",
      type: "PERFORMANCE",
      severity: "INFO",
      title: `Open positions are ${pct(Math.abs(facts.returnPct))} ${facts.returnPct >= 0 ? "above" : "below"} cost`,
      detail:
        `Unrealised return on the invested value of open positions, in ${facts.baseCurrency}. ` +
        "Realised results and dividends are counted separately.",
      metric: { label: "Unrealised return", value: pct(facts.returnPct) },
    },
  ]
}

function feeInsights(facts: InsightFacts): Insight[] {
  const fees = facts.fees
  if (!fees || fees.percentOfTurnover === null) return []
  if (fees.percentOfTurnover < INSIGHT_THRESHOLDS.fees.noticePct) return []

  return [
    {
      code: "FEES_SHARE_OF_TURNOVER",
      type: "FEES",
      severity: "NOTICE",
      title: `Fees are ${pct(fees.percentOfTurnover)} of everything traded`,
      detail:
        `${roundTo(fees.total, 2)} ${facts.baseCurrency} in fees against the total value bought and sold. ` +
        "Fees are already inside cost basis and proceeds, so they are reflected in every P&L figure.",
      metric: { label: "Fees / turnover", value: pct(fees.percentOfTurnover) },
    },
  ]
}

function winRateInsights(facts: InsightFacts): Insight[] {
  const trades = facts.trades
  if (!trades || trades.winRatePct === null) return []
  // Below the minimum a win rate is the outcome of a handful of decisions, and stating it as a
  // percentage would give it an authority the sample size cannot support.
  if (trades.closed < INSIGHT_THRESHOLDS.winRate.minTrades) return []
  if (trades.winRatePct >= INSIGHT_THRESHOLDS.winRate.noticePct) return []

  return [
    {
      code: "WIN_RATE_LOW",
      type: "WIN_RATE",
      severity: "NOTICE",
      title: `${pct(trades.winRatePct)} of closed trades were profitable`,
      detail:
        `Across ${trades.closed} closed trades. Win rate counts decisions, not amounts — a few large ` +
        "gains can outweigh many small losses, and the realised P&L figure is what reflects that.",
      metric: { label: "Win rate", value: pct(trades.winRatePct) },
    },
  ]
}

function dividendInsights(facts: InsightFacts): Insight[] {
  const d = facts.dividends
  if (!d || d.previousTwelveMonths === null || d.previousTwelveMonths <= 0) return []

  const changePct = ((d.trailingTwelveMonths - d.previousTwelveMonths) / d.previousTwelveMonths) * 100
  if (Math.abs(changePct) < INSIGHT_THRESHOLDS.dividend.changeInfoPct) return []

  const direction = changePct > 0 ? "higher" : "lower"
  return [
    {
      code: "DIVIDEND_CHANGE",
      type: "DIVIDEND",
      severity: "INFO",
      title: `Dividend income is ${pct(Math.abs(changePct))} ${direction} than the previous year`,
      detail:
        `${roundTo(d.trailingTwelveMonths, 2)} ${facts.baseCurrency} received in the last twelve months, ` +
        `against ${roundTo(d.previousTwelveMonths, 2)} in the twelve months before. Net of tax and fees.`,
      metric: { label: "Change", value: pct(changePct) },
    },
  ]
}

// ---------------------------------------------------------------- safety

/**
 * Vocabulary an insight may never contain.
 *
 * Checked by a test against every sentence `buildInsights` can produce, for the same reason the
 * technical-analysis module has one: a prompt is a request, a check is a guarantee — and this
 * engine writes prose that sits beside a user's money.
 *
 * The list covers instructions ("sell", "you should"), forecasts ("will rise", "expected to"), and
 * the ratings vocabulary that turns a description into a recommendation.
 */
export const FORBIDDEN_INSIGHT_PATTERNS: readonly RegExp[] = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bhold\b/i,
  /\bshould\b/i,
  /\brecommend/i,
  /\badvis(e|ory)/i,
  /\bconsider\s+(buying|selling|reducing|trimming|adding)/i,
  /\bstrong (buy|sell)\b/i,
  /\bovervalued\b/i,
  /\bundervalued\b/i,
  /\bprice target\b/i,
  /\bwill (rise|fall|increase|decrease|drop|climb|reach)\b/i,
  /\bexpected to\b/i,
  /\bforecast/i,
  /\bpredict/i,
  /\bguarantee/i,
  /\boutlook\b/i,
  /\btoo (much|risky|concentrated)\b/i,
]

/** The offending pattern, or null when the text is clean. Used by the test and available to callers. */
export function findForbiddenPattern(text: string): RegExp | null {
  return FORBIDDEN_INSIGHT_PATTERNS.find((pattern) => pattern.test(text)) ?? null
}
