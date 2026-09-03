import type { Currency, MarketId } from "./market"

/**
 * Company fundamentals: what a business reported, and what can be derived from it.
 *
 * Two rules govern everything in this file, and they are the same two the rest of the codebase
 * lives by:
 *
 * 1. **A figure that cannot be computed honestly is `null`.** Every metric here divides one
 *    reported number by another, and a missing numerator, a missing denominator or a zero
 *    denominator all produce `null` — never `0`. A gross margin of 0% and an unknown gross margin
 *    look identical on a screen and mean opposite things.
 * 2. **A period is part of a figure, not context around it.** Q1 revenue and full-year revenue are
 *    not comparable, and this module refuses to compare them rather than producing a number that
 *    looks like growth. `comparablePeriods` is where that refusal lives.
 *
 * Nothing here changes a portfolio. Fundamentals are reference data about a *company*; a holding is
 * a fact about a *user*. `fundamentals-invariants.test.ts` asserts the separation.
 *
 * Pure: no client, no network, no framework import.
 */

// ---------------------------------------------------------------- periods

export const PERIOD_TYPES = ["ANNUAL", "QUARTERLY", "TTM"] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

export type FiscalPeriod = {
  type: PeriodType
  fiscalYear: number
  /** 1–4 for a quarter. Null for annual and TTM, which are not a quarter of anything. */
  fiscalQuarter: number | null
  /** When the company reported it. Null when the provider did not say. */
  reportDate: string | null
  /** The period's own end date, which is what a figure is "as of". */
  periodEnd: string
}

/** A period's name, as a user should see it: "FY2025", "Q3 2026", "TTM". */
export function periodLabel(period: FiscalPeriod): string {
  switch (period.type) {
    case "ANNUAL":
      return `FY${period.fiscalYear}`
    case "QUARTERLY":
      return `Q${period.fiscalQuarter ?? "?"} ${period.fiscalYear}`
    case "TTM":
      return "TTM"
  }
}

/**
 * Whether two periods may be compared directly.
 *
 * The rule that stops the most common fundamental-analysis error: **a quarter is not a year.**
 * Comparing Q1 revenue against full-year revenue produces a −75% "decline" that is an artefact of
 * the periods, not of the business. Two quarters are comparable, two years are comparable, and TTM
 * is comparable only with TTM.
 */
export function comparablePeriods(a: FiscalPeriod, b: FiscalPeriod): boolean {
  return a.type === b.type
}

/** The same quarter a year earlier, or the previous year — what a year-on-year comparison needs. */
export function priorYearOf(period: FiscalPeriod): { fiscalYear: number; fiscalQuarter: number | null } {
  return { fiscalYear: period.fiscalYear - 1, fiscalQuarter: period.fiscalQuarter }
}

// ---------------------------------------------------------------- statements

/**
 * One period's reported figures.
 *
 * **Every field is nullable, deliberately.** A provider that covers US large caps well may return
 * nothing at all for a SET small cap, and a partial statement is the normal case rather than an
 * error. A field that is null means "not reported to us", which is different from zero — a company
 * with no debt reports 0, and a provider that does not cover its balance sheet reports nothing.
 *
 * Negative values are legitimate and must never be rejected: a loss-making company has a negative
 * net income, and a business investing heavily has negative free cash flow.
 */
export type IncomeStatement = {
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  ebitda: number | null
  netIncome: number | null
  eps: number | null
  epsDiluted: number | null
  /** Weighted average shares, for per-share derivations and buyback trends. */
  sharesDiluted: number | null
}

export type BalanceSheet = {
  totalAssets: number | null
  totalLiabilities: number | null
  totalEquity: number | null
  cashAndEquivalents: number | null
  totalDebt: number | null
  currentAssets: number | null
  currentLiabilities: number | null
}

export type CashFlowStatement = {
  operatingCashFlow: number | null
  capitalExpenditure: number | null
  investingCashFlow: number | null
  financingCashFlow: number | null
  dividendsPaid: number | null
}

export type FinancialStatement = {
  symbol: string
  market: MarketId
  period: FiscalPeriod
  /**
   * The currency the company reports in — **not** the portfolio's, and not derived from the market.
   * A company can report in a currency other than the one its shares trade in, so this is stored
   * rather than inferred.
   */
  currency: Currency
  income: IncomeStatement
  balance: BalanceSheet
  cashFlow: CashFlowStatement
  /** Which provider said so, so a correction can be traced rather than merely applied. */
  source: string
  /** When it was fetched. Distinct from the period it describes. */
  fetchedAt: string
}

// ---------------------------------------------------------------- safe arithmetic

/**
 * A ratio, or null.
 *
 * The single most important function in this file. Every margin, return and leverage figure goes
 * through it, so there is exactly one place that decides what happens when a denominator is
 * missing, zero, or negative-in-a-way-that-makes-the-ratio-meaningless.
 *
 * A **zero denominator returns null, never Infinity**. A company with no revenue does not have an
 * infinite margin; it has no margin.
 */
export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (denominator === 0) return null
  const result = numerator / denominator
  return Number.isFinite(result) ? result : null
}

/** A ratio as a percentage. Same null rules. */
export function percentRatio(numerator: number | null, denominator: number | null): number | null {
  const value = ratio(numerator, denominator)
  return value === null ? null : value * 100
}

/**
 * Growth between two figures, as a percentage.
 *
 * **Null when the base is zero or negative**, which is the case people get wrong. Growth from a
 * loss of −10 to a profit of +5 is not "+150%" — percentage growth from a negative base is not
 * defined in any way a reader would interpret correctly, and reporting a number there is worse than
 * reporting nothing. The UI says "from a loss" instead.
 */
export function growth(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/** Sums a set of nullable figures, or null if any is missing. Four quarters make a TTM only if all four exist. */
export function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null
  let total = 0
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) return null
    total += value
  }
  return total
}

// ---------------------------------------------------------------- derived metrics

export type FundamentalMetrics = {
  // Profitability — all percentages.
  grossMargin: number | null
  operatingMargin: number | null
  netMargin: number | null
  returnOnEquity: number | null
  returnOnAssets: number | null
  fcfMargin: number | null
  operatingCashFlowMargin: number | null

  // Cash flow, in the reporting currency.
  freeCashFlow: number | null
  capexToRevenue: number | null

  // Leverage.
  debtToEquity: number | null
  netDebt: number | null
  netDebtToEbitda: number | null
  currentRatio: number | null
}

/**
 * Every derived metric for one period.
 *
 * Each is one call to `ratio` or `percentRatio`, so each independently becomes `null` the moment an
 * input is missing. That is why the return type has no "available" flag: a caller reads the field
 * it wants and gets a number or nothing, with no way to mistake one for the other.
 */
export function computeMetrics(statement: FinancialStatement): FundamentalMetrics {
  const { income, balance, cashFlow } = statement

  /*
   * Free cash flow = operating cash flow − capital expenditure.
   *
   * Providers disagree about the sign of capex: some report it negative (a cash outflow), some
   * positive (an amount spent). Taking the magnitude makes the subtraction correct either way,
   * which is the one place in this file where a provider quirk is normalised rather than trusted.
   */
  const capex = cashFlow.capitalExpenditure === null ? null : Math.abs(cashFlow.capitalExpenditure)
  const freeCashFlow =
    cashFlow.operatingCashFlow === null || capex === null ? null : cashFlow.operatingCashFlow - capex

  const netDebt =
    balance.totalDebt === null || balance.cashAndEquivalents === null
      ? null
      : balance.totalDebt - balance.cashAndEquivalents

  return {
    grossMargin: percentRatio(income.grossProfit, income.revenue),
    operatingMargin: percentRatio(income.operatingIncome, income.revenue),
    netMargin: percentRatio(income.netIncome, income.revenue),
    /*
     * Return on equity against **period-end** equity, not an average of opening and closing.
     *
     * The average is the more precise definition and needs the prior period's balance sheet, which
     * a partial statement often lacks. Using period-end consistently and saying so is better than
     * silently switching between two definitions depending on what data happened to arrive —
     * `docs/FUNDAMENTALS.md` states it beside the formula.
     */
    returnOnEquity: percentRatio(income.netIncome, balance.totalEquity),
    returnOnAssets: percentRatio(income.netIncome, balance.totalAssets),
    fcfMargin: percentRatio(freeCashFlow, income.revenue),
    operatingCashFlowMargin: percentRatio(cashFlow.operatingCashFlow, income.revenue),
    freeCashFlow,
    capexToRevenue: percentRatio(capex, income.revenue),
    debtToEquity: ratio(balance.totalDebt, balance.totalEquity),
    netDebt,
    netDebtToEbitda: ratio(netDebt, income.ebitda),
    currentRatio: ratio(balance.currentAssets, balance.currentLiabilities),
  }
}

// ---------------------------------------------------------------- growth across periods

export type GrowthMetrics = {
  revenueGrowth: number | null
  netIncomeGrowth: number | null
  epsGrowth: number | null
  fcfGrowth: number | null
  operatingIncomeGrowth: number | null
  /** The two periods that were compared, so a screen can label the number rather than assert it. */
  from: string
  to: string
  /** Set when the comparison was refused, so the UI explains rather than showing a blank. */
  unavailableReason: string | null
}

/**
 * Growth between two periods.
 *
 * **Refuses to compare periods of different types.** A quarter measured against a year produces a
 * number that looks like a collapse and is an artefact of the calendar; returning nulls with a
 * reason is the only honest option.
 */
export function computeGrowth(
  current: FinancialStatement,
  previous: FinancialStatement,
): GrowthMetrics {
  const empty = {
    revenueGrowth: null,
    netIncomeGrowth: null,
    epsGrowth: null,
    fcfGrowth: null,
    operatingIncomeGrowth: null,
    from: periodLabel(previous.period),
    to: periodLabel(current.period),
  }

  if (!comparablePeriods(current.period, previous.period)) {
    return {
      ...empty,
      unavailableReason: `${periodLabel(current.period)} and ${periodLabel(previous.period)} cover different lengths of time and are not comparable.`,
    }
  }

  if (current.currency !== previous.currency) {
    // A company that changed reporting currency produces a growth figure that is mostly an
    // exchange-rate movement. Refusing is the only honest answer without historical FX.
    return {
      ...empty,
      unavailableReason: `The company reported in ${previous.currency} and then in ${current.currency}; the change is not comparable without historical exchange rates.`,
    }
  }

  const currentFcf = computeMetrics(current).freeCashFlow
  const previousFcf = computeMetrics(previous).freeCashFlow

  return {
    revenueGrowth: growth(current.income.revenue, previous.income.revenue),
    netIncomeGrowth: growth(current.income.netIncome, previous.income.netIncome),
    epsGrowth: growth(current.income.eps, previous.income.eps),
    fcfGrowth: growth(currentFcf, previousFcf),
    operatingIncomeGrowth: growth(current.income.operatingIncome, previous.income.operatingIncome),
    from: periodLabel(previous.period),
    to: periodLabel(current.period),
    unavailableReason: null,
  }
}

/**
 * Trailing twelve months from four consecutive quarters.
 *
 * **All four or nothing.** Three quarters annualised is a fabrication, and a TTM built from a gap
 * would silently understate every flow figure. Balance-sheet items are taken from the most recent
 * quarter rather than summed — a balance sheet is a snapshot at a moment, and adding four of them
 * together produces a number that means nothing.
 */
export function computeTTM(quarters: readonly FinancialStatement[]): FinancialStatement | null {
  if (quarters.length !== 4) return null
  if (quarters.some((q) => q.period.type !== "QUARTERLY")) return null
  if (new Set(quarters.map((q) => q.currency)).size !== 1) return null

  const ordered = [...quarters].sort((a, b) => a.period.periodEnd.localeCompare(b.period.periodEnd))
  const latest = ordered[ordered.length - 1]

  return {
    symbol: latest.symbol,
    market: latest.market,
    currency: latest.currency,
    period: {
      type: "TTM",
      fiscalYear: latest.period.fiscalYear,
      fiscalQuarter: null,
      reportDate: latest.period.reportDate,
      periodEnd: latest.period.periodEnd,
    },
    income: {
      revenue: sumOrNull(ordered.map((q) => q.income.revenue)),
      grossProfit: sumOrNull(ordered.map((q) => q.income.grossProfit)),
      operatingIncome: sumOrNull(ordered.map((q) => q.income.operatingIncome)),
      ebitda: sumOrNull(ordered.map((q) => q.income.ebitda)),
      netIncome: sumOrNull(ordered.map((q) => q.income.netIncome)),
      eps: sumOrNull(ordered.map((q) => q.income.eps)),
      epsDiluted: sumOrNull(ordered.map((q) => q.income.epsDiluted)),
      // Not summed: share count is a level, not a flow. The latest is the meaningful one.
      sharesDiluted: latest.income.sharesDiluted,
    },
    // A balance sheet is a moment, never a sum of moments.
    balance: latest.balance,
    cashFlow: {
      operatingCashFlow: sumOrNull(ordered.map((q) => q.cashFlow.operatingCashFlow)),
      capitalExpenditure: sumOrNull(ordered.map((q) => q.cashFlow.capitalExpenditure)),
      investingCashFlow: sumOrNull(ordered.map((q) => q.cashFlow.investingCashFlow)),
      financingCashFlow: sumOrNull(ordered.map((q) => q.cashFlow.financingCashFlow)),
      dividendsPaid: sumOrNull(ordered.map((q) => q.cashFlow.dividendsPaid)),
    },
    source: latest.source,
    fetchedAt: latest.fetchedAt,
  }
}

// ---------------------------------------------------------------- metric definitions

export type MetricDefinition = {
  label: string
  /** What it is, in one sentence a non-accountant can read. */
  definition: string
  formula: string
  unit: "percent" | "ratio" | "money"
  /** Which statements have to be present. Shown when the value is N/A. */
  requires: string
}

/**
 * Every derived metric, defined.
 *
 * A fundamental figure that a reader cannot check is a figure they have to take on faith, and this
 * codebase does not ask for faith. Each of these is rendered beside its value.
 */
export const METRIC_DEFINITIONS: Record<keyof FundamentalMetrics, MetricDefinition> = {
  grossMargin: {
    label: "Gross margin",
    definition: "What proportion of revenue is left after the direct cost of producing it.",
    formula: "Gross profit ÷ Revenue",
    unit: "percent",
    requires: "Gross profit and revenue",
  },
  operatingMargin: {
    label: "Operating margin",
    definition: "What proportion of revenue is left after the costs of running the business.",
    formula: "Operating income ÷ Revenue",
    unit: "percent",
    requires: "Operating income and revenue",
  },
  netMargin: {
    label: "Net margin",
    definition: "What proportion of revenue becomes profit after everything, including tax.",
    formula: "Net income ÷ Revenue",
    unit: "percent",
    requires: "Net income and revenue",
  },
  returnOnEquity: {
    label: "Return on equity",
    definition: "Profit measured against the money shareholders have in the business.",
    formula: "Net income ÷ Total equity (period end)",
    unit: "percent",
    requires: "Net income and total equity",
  },
  returnOnAssets: {
    label: "Return on assets",
    definition: "Profit measured against everything the business owns.",
    formula: "Net income ÷ Total assets (period end)",
    unit: "percent",
    requires: "Net income and total assets",
  },
  fcfMargin: {
    label: "Free cash flow margin",
    definition: "What proportion of revenue becomes cash the business can actually spend.",
    formula: "(Operating cash flow − Capital expenditure) ÷ Revenue",
    unit: "percent",
    requires: "Operating cash flow, capital expenditure and revenue",
  },
  operatingCashFlowMargin: {
    label: "Operating cash flow margin",
    definition: "What proportion of revenue arrives as cash from operations.",
    formula: "Operating cash flow ÷ Revenue",
    unit: "percent",
    requires: "Operating cash flow and revenue",
  },
  freeCashFlow: {
    label: "Free cash flow",
    definition: "Cash from operations after the spending needed to maintain the business.",
    formula: "Operating cash flow − Capital expenditure",
    unit: "money",
    requires: "Operating cash flow and capital expenditure",
  },
  capexToRevenue: {
    label: "Capital expenditure / revenue",
    definition: "How much of each unit of revenue is reinvested in physical assets.",
    formula: "Capital expenditure ÷ Revenue",
    unit: "percent",
    requires: "Capital expenditure and revenue",
  },
  debtToEquity: {
    label: "Debt to equity",
    definition: "Borrowed money measured against shareholders' money.",
    formula: "Total debt ÷ Total equity",
    unit: "ratio",
    requires: "Total debt and total equity",
  },
  netDebt: {
    label: "Net debt",
    definition: "Debt remaining after the cash on hand is set against it. Negative means more cash than debt.",
    formula: "Total debt − Cash and equivalents",
    unit: "money",
    requires: "Total debt and cash",
  },
  netDebtToEbitda: {
    label: "Net debt / EBITDA",
    definition: "How many years of current earnings the net debt represents.",
    formula: "Net debt ÷ EBITDA",
    unit: "ratio",
    requires: "Total debt, cash and EBITDA",
  },
  currentRatio: {
    label: "Current ratio",
    definition: "Short-term assets measured against short-term obligations.",
    formula: "Current assets ÷ Current liabilities",
    unit: "ratio",
    requires: "Current assets and current liabilities",
  },
}

/**
 * The disclaimer every fundamental screen carries.
 *
 * Short, and it does not claim more than it can.
 */
export const FUNDAMENTALS_DISCLAIMER =
  "Fundamental figures are reported by the company and supplied by a data provider. They describe " +
  "what has already happened, are not investment advice, and do not indicate future results."
